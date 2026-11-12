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
vi.mock("@/lib/consultas/locacao", () => ({ taxaComissaoParaMes: async () => 1000 }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("REDIRECT"); } }));

import { registrarBaixaRecebimentoManual, salvarRecebimentoManual } from "./actions";

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
