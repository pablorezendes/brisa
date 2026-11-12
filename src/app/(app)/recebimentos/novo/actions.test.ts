import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { criarSchemaSinteticoDespesas } from "@/lib/despesas/testes-banco";

const runtime = vi.hoisted(() => ({ banco: null as PrismaClient | null }));
vi.mock("@/lib/db", () => ({ get prisma() { return runtime.banco; } }));
vi.mock("@/lib/acesso/servidor", () => ({ exigirPermissaoAcesso: async () => ({ perfil: "ADMINISTRADOR", usuarioId: "teste" }) }));
vi.mock("@/lib/autorizacao", () => ({ exigirPermissaoFinanceira: async () => undefined }));
vi.mock("@/lib/consultas/locacao", () => ({ RE_MES: /^\d{4}-(0[1-9]|1[0-2])$/, taxaComissaoParaMes: async () => 1000 }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("REDIRECT"); } }));

import { registrarBaixaRecebimentoManual, registrarBaixaRecebimentoWidesys, salvarRecebimentoManual } from "./actions";

let banco: PrismaClient;
let pasta: string;
let contratoId: string;

function formulario(campos: Record<string, string>) {
  const dados = new FormData();
  for (const [campo, valor] of Object.entries(campos)) dados.set(campo, valor);
  return dados;
}

beforeAll(async () => {
  pasta = mkdtempSync(join(tmpdir(), "brisa-recebimento-manual-"));
  banco = new PrismaClient({ datasources: { db: { url: `file:${join(pasta, "teste.db").replaceAll("\\", "/")}` } } });
  runtime.banco = banco;
  await criarSchemaSinteticoDespesas(banco);
  const empreendimento = await banco.empreendimento.create({ data: { nome: "Teste" } });
  const unidade = await banco.unidade.create({ data: { empreendimentoId: empreendimento.id, identificacao: "101" } });
  const contrato = await banco.contrato.create({ data: { unidadeId: unidade.id } });
  contratoId = contrato.id;
});

afterAll(async () => {
  await banco?.$disconnect();
  if (pasta) {
    for (const arquivo of ["teste.db", "teste.db-journal", "teste.db-wal", "teste.db-shm"]) rmSync(join(pasta, arquivo), { force: true });
    rmdirSync(pasta);
  }
});

describe("lançamentos manuais de recebimento", () => {
  it("cria a entrada vinculada ao dar baixa na criação e reaplicar preserva uma única entrada", async () => {
    const id = randomUUID();
    const form = formulario({ contratoId, descricao: "Aluguel avulso", vencimento: "2026-11-05", valor: "100,00", dataPagamento: "2026-11-06", via: "PIX" });
    await expect(salvarRecebimentoManual(id, {}, form)).rejects.toThrow("REDIRECT");
    await expect(salvarRecebimentoManual(id, {}, form)).resolves.toHaveProperty("erro");
    const titulo = await banco.recebimento.findUniqueOrThrow({ where: { id }, include: { entradasManuais: true } });
    expect(titulo).toMatchObject({ criadoManualBrisa: true, vencimentoManual: "2026-11-05", recebido: 10000 });
    expect(titulo.entradasManuais).toMatchObject([{ recebimentoManualId: id, tipo: "ENTRADA", criadoManualBrisa: true, data: "2026-11-06", valor: 10000 }]);
  });

  it("uma baixa parcial repetida preserva o saldo e as datas das entradas", async () => {
    const id = randomUUID();
    const baixaId = randomUUID();
    const criacao = formulario({ contratoId, descricao: "Cobrança avulsa", vencimento: "2026-11-10", valor: "150,00" });
    const baixa = formulario({ valor: "30,00", dataPagamento: "2026-11-11", via: "PIX" });
    await expect(salvarRecebimentoManual(id, {}, criacao)).rejects.toThrow("REDIRECT");
    await expect(registrarBaixaRecebimentoManual(id, baixaId, "/recebimentos", {}, baixa)).rejects.toThrow("REDIRECT");
    await expect(registrarBaixaRecebimentoManual(id, baixaId, "/recebimentos", {}, baixa)).resolves.toHaveProperty("erro");
    const titulo = await banco.recebimento.findUniqueOrThrow({ where: { id }, include: { entradasManuais: true } });
    expect(titulo.recebido).toBe(3000);
    expect(titulo.entradasManuais).toMatchObject([{ data: "2026-11-11", valor: 3000 }]);
  });
});

async function tituloWidesys() {
  const legadoId = randomUUID();
  const capturadoEm = new Date("2026-11-10T12:00:00Z");
  const lote = await banco.importacaoLegadoLote.create({ data: {
    origem: "WIDESYS", capturaId: legadoId, manifestoHash: legadoId, capturadoEm, status: "CONCLUIDO",
  } });
  const item = await banco.importacaoLegadoItem.create({ data: {
    loteId: lote.id, origem: "WIDESYS", escopo: "TITULO_RECEBER", legadoId, snapshotHash: legadoId, acao: "CRIAR",
  } });
  return banco.tituloFinanceiroLegado.create({ data: {
    escopo: "TITULO_RECEBER", natureza: "RECEBER", legadoId, ultimoItemId: item.id, capturadoEm,
    competencia: "2026-11", vencimento: "2026-11-10", valorDevido: 15000, valorPago: 2000, valorAberto: 13000,
    situacaoNormalizada: "PARCIAL", snapshot: "{}", snapshotHash: legadoId,
  } });
}

describe("baixa no Brisa de título do Widesys", () => {
  const baixa = (valor: string) => formulario({ valor, dataPagamento: "2026-11-11", via: "PIX" });

  it("aceita parcial e quitação, preservando a base original e um movimento por recebimento", async () => {
    const titulo = await tituloWidesys();
    const id = randomUUID();
    const registrar = (valor: string, requisicao = randomUUID()) => registrarBaixaRecebimentoWidesys(titulo.id, requisicao, "/recebimentos", {}, baixa(valor));
    await expect(registrar("30,00", id)).rejects.toThrow("REDIRECT");
    await expect(registrar("30,00", id)).rejects.toThrow("REDIRECT");
    await expect(registrar("40,00", id)).resolves.toHaveProperty("erro");

    // A mesma baixa chegou posteriormente na fotografia do Widesys.
    await banco.tituloFinanceiroLegado.update({ where: { id: titulo.id }, data: { valorPago: 5000, valorAberto: 10000 } });
    await expect(registrar("100,01")).resolves.toHaveProperty("erro", "O valor informado ultrapassa o saldo em aberto.");
    await expect(registrar("100,00")).rejects.toThrow("REDIRECT");
    await expect(registrar("0,01")).resolves.toHaveProperty("erro");

    const pagamentos = await banco.recebimentoWidesysLocal.findMany({ where: { tituloId: titulo.id }, orderBy: { valor: "asc" }, include: { lancamentoCaixa: true } });
    expect(pagamentos.map(pagamento => pagamento.valor)).toEqual([3000, 10000]);
    for (const pagamento of pagamentos) {
      expect(pagamento).toMatchObject({ valorDevidoOrigemNaBaixa: 15000, valorPagoOrigemNaBaixa: 2000, valorAbertoOrigemNaBaixa: 13000, usuarioId: "teste" });
      expect(pagamento.lancamentoCaixa).toMatchObject({ id: pagamento.id, valor: pagamento.valor, data: "2026-11-11", tipo: "ENTRADA" });
    }
    expect(await banco.tituloFinanceiroLegado.findUnique({ where: { id: titulo.id } })).toMatchObject({ valorPago: 5000, valorAberto: 10000 });
  });

  it("não inicia o controle do título enquanto uma importação estiver processando", async () => {
    const titulo = await tituloWidesys();
    const lote = await banco.importacaoLegadoLote.create({ data: {
      origem: "WIDESYS", capturaId: randomUUID(), manifestoHash: "teste", capturadoEm: new Date(),
    } });
    const id = randomUUID();
    try {
      await expect(registrarBaixaRecebimentoWidesys(titulo.id, id, "/recebimentos", {}, baixa("30,00"))).resolves.toHaveProperty("erro");
      expect(await banco.lancamentoCaixa.findUnique({ where: { id } })).toBeNull();
    } finally {
      await banco.importacaoLegadoLote.delete({ where: { id: lote.id } });
    }
  });
});
