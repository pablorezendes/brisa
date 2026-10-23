import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { montarPolitica, type Regra } from "../acesso/politica";
import { criarSchemaSinteticoDespesas } from "../despesas/testes-banco";
import { carregarFontesUnificacao } from "../unificacao/fontes";
import { consultarResumoRateios } from "./rateios";

vi.mock("server-only", () => ({}));
vi.mock("node:fs", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, existsSync: (arquivo: Parameters<typeof fs.existsSync>[0]) => /[\\/]data[\\/]dataset\.json$/.test(String(arquivo)) ? false : fs.existsSync(arquivo) };
});
let diretorio: string, contador = 0, db: PrismaClient;
const criarBanco = (arquivo: string) => new PrismaClient({ datasourceUrl: `file:${arquivo.replaceAll("\\", "/")}` });
const politica = (perfil = "ADMINISTRADOR", regras: Regra[] = [], global = false) => montarPolitica({ id: "usuario", perfil, ativo: true, acessoGlobal: global, permissoesExtras: "[]", permissoesNegadas: "[]", regrasAcesso: regras });
const permitir = (tipo: string, recursoId: string): Regra => ({ tipo, recursoId, efeito: "PERMITIR" });
const bloquear = (tipo: string, recursoId: string): Regra => ({ tipo, recursoId, efeito: "BLOQUEAR" });

beforeAll(async () => {
  diretorio = mkdtempSync(join(tmpdir(), "brisa-rateios-relatorio-"));
  const modelo = criarBanco(join(diretorio, "modelo.db"));
  await criarSchemaSinteticoDespesas(modelo);
  await modelo.$disconnect();
}, 30000);
beforeEach(async () => {
  const arquivo = join(diretorio, `teste-${++contador}.db`);
  copyFileSync(join(diretorio, "modelo.db"), arquivo); db = criarBanco(arquivo);
  await db.empreendimento.createMany({ data: [{ id: "e1", nome: "Empreendimento liberado" }, { id: "e2", nome: "Empreendimento reservado" }] });
  await db.unidade.createMany({ data: [{ id: "u1", empreendimentoId: "e1", identificacao: "Unidade autorizada" }, { id: "u2", empreendimentoId: "e2", identificacao: "Unidade reservada" }] });
  await db.despesaDocumento.create({ data: { id: "nota", fornecedorNome: "Fornecedor confidencial", fornecedorDocumento: "00000000000", tomadorNome: "Tomador confidencial", numero: "NF-42-TESTE", emissao: "2026-10-07", competencia: "2026-10", total: 256000, statusRateio: "CONFERIDO", criadoPorId: "admin", atualizadoPorId: "admin",
    rateios: { create: [{ ordem: 0, empreendimentoId: "e1", unidadeId: "u1", descricao: "Manutenção privativa", valor: 43000 }, { ordem: 1, empreendimentoId: "e2", descricao: "Manutenção reservada", valor: 213000 }] },
  } });
});
afterEach(async () => { await db.$disconnect(); });
afterAll(() => {
  const alvo = resolve(diretorio);
  if (!alvo.toLowerCase().startsWith(`${resolve(tmpdir())}${sep}`.toLowerCase()) || !basename(alvo).startsWith("brisa-rateios-relatorio-")) throw new Error("Diretório fora do escopo temporário.");
  rmSync(alvo, { recursive: true, force: true });
});

async function decisao(status: string) {
  const f = (await carregarFontesUnificacao(db)).find(f => f.chave === "BRISA:PAGAR:nota")!;
  await db.unificacaoRegistro.create({ data: { chave: f.chave, dominio: "PAGAR", origem: "BRISA", origemId: "nota", hashFonte: f.hash, status, decisao: "MANUAL" } });
}

describe("rateios gerenciais sem duplicação e com carteira isolada", () => {
  it("soma parcelas, não nota + parcelas + pagamento", async () => {
    await db.lancamentoCaixa.create({ data: { id: "pix", tipo: "SAIDA", valor: 256000, data: "2026-10-08", mesReferencia: "2026-10", centroCusto: "BRISA" } });
    await db.despesaDocumento.update({ where: { id: "nota" }, data: { lancamentoCaixaId: "pix" } });
    expect(await consultarResumoRateios(db, politica(), "2026-10")).toEqual({
      custos: [
        { empreendimentoId: "e1", empreendimento: "Empreendimento liberado", competencia: "2026-10", valor: 43000, parcelas: 1 },
        { empreendimentoId: "e2", empreendimento: "Empreendimento reservado", competencia: "2026-10", valor: 213000, parcelas: 1 },
      ], total: 256000, notasConferidas: 1, notasPendentes: 0,
    });
    expect(await db.lancamentoCaixa.count()).toBe(1);
  });

  it("sócio vê somente sua parcela, sem total da nota, fornecedor, anexo ou outra carteira", async () => {
    const resumo = await consultarResumoRateios(db, politica("SOCIO", [permitir("EMPREENDIMENTO", "e1")]), "2026-10");
    expect(resumo).toEqual({ custos: [{ empreendimentoId: "e1", empreendimento: "Empreendimento liberado", competencia: "2026-10", valor: 43000, parcelas: 1 }], total: 43000, notasConferidas: 1, notasPendentes: 0 });
    expect(JSON.stringify(resumo)).not.toMatch(/256000|213000|reservad|confidencial|00000000000|NF-42|anexo|fornecedor|tomador|notaId|despesaId/i);
  });

  it("permissão só de imóvel não libera custos gerais do empreendimento", async () => {
    await db.despesaRateio.updateMany({ where: { despesaId: "nota", ordem: 1 }, data: { valor: 203000 } });
    await db.despesaRateio.create({ data: { despesaId: "nota", ordem: 2, empreendimentoId: "e1", descricao: "Custo geral sem imóvel", valor: 10000 } });
    expect((await consultarResumoRateios(db, politica("SOCIO", [permitir("UNIDADE", "u1")]), "2026-10")).total).toBe(43000);
    expect((await consultarResumoRateios(db, politica("SOCIO", [permitir("EMPREENDIMENTO", "e1")]), "2026-10")).total).toBe(53000);
  });

  it("bloqueio de empreendimento ou imóvel prevalece sobre liberação global/herdada", async () => {
    expect((await consultarResumoRateios(db, politica("SOCIO", [permitir("UNIDADE", "u1"), bloquear("EMPREENDIMENTO", "e1")], true), "2026-10")).total).toBe(213000);
    expect((await consultarResumoRateios(db, politica("SOCIO", [permitir("EMPREENDIMENTO", "e1"), bloquear("UNIDADE", "u1")]), "2026-10")).total).toBe(0);
  });

  it.each(["RASCUNHO", "SOMA_INCOMPLETA", "PENDENTE", "QUARENTENA", "EXCLUIDO"])("%s não entra nos custos conferidos", async situacao => {
    if (situacao === "RASCUNHO") await db.despesaDocumento.update({ where: { id: "nota" }, data: { statusRateio: "RASCUNHO" } });
    if (situacao === "SOMA_INCOMPLETA") await db.despesaRateio.updateMany({ where: { despesaId: "nota", ordem: 0 }, data: { valor: 1 } });
    if (situacao === "PENDENTE") await decisao("PENDENTE");
    if (situacao === "QUARENTENA") {
      await db.lancamentoCaixa.create({ data: { id: "pix", tipo: "SAIDA", valor: 1, mesReferencia: "2026-10", centroCusto: "BRISA" } });
      await db.despesaDocumento.update({ where: { id: "nota" }, data: { lancamentoCaixaId: "pix" } });
    }
    if (situacao === "EXCLUIDO") await db.recursoGovernado.create({ data: { tipo: "TITULO", origemId: "BRISA:PAGAR:nota", status: "EXCLUIDO", motivo: "Nota duplicada", autorId: "admin" } });
    expect(await consultarResumoRateios(db, politica(), "2026-10")).toMatchObject({ total: 0, notasConferidas: 0, notasPendentes: situacao === "EXCLUIDO" ? 0 : 1 });
    expect((await consultarResumoRateios(db, politica("SOCIO", [permitir("EMPREENDIMENTO", "e1")]), "2026-10")).notasPendentes).toBe(0);
  });

  it("snapshot Widesys alterado invalida rateio mesmo se o valor financeiro permaneceu igual", async () => {
    await db.despesaDocumento.update({ where: { id: "nota" }, data: { origemChave: "WIDESYS:PAGAR:w1", origemHash: "captura-1" } });
    await db.tituloFinanceiroLegado.create({ data: { id: "w1", origem: "WIDESYS", escopo: "TITULO_PAGAR", legadoId: "w1", ultimoItemId: "item-w1", natureza: "PAGAR", competencia: "2026-10", situacaoNormalizada: "PENDENTE", statusImportacao: "STAGING", valorDevido: 256000, valorAberto: 256000, valorPago: 0, snapshot: "{}", snapshotHash: "captura-1", capturadoEm: new Date("2026-10-23T12:00:00Z") } });
    const fonte = (await carregarFontesUnificacao(db)).find(f => f.chave === "WIDESYS:PAGAR:w1")!;
    await db.unificacaoRegistro.create({ data: { chave: fonte.chave, dominio: "PAGAR", origem: "WIDESYS", origemId: "w1", hashFonte: fonte.hash, status: "ATIVO", decisao: "MANUAL" } });
    expect((await consultarResumoRateios(db, politica(), "2026-10")).total).toBe(256000);
    await db.tituloFinanceiroLegado.update({ where: { id: "w1" }, data: { snapshotHash: "captura-2" } });
    expect(await consultarResumoRateios(db, politica(), "2026-10")).toMatchObject({ total: 0, notasPendentes: 1 });
  });

  it.each(["planoContaRotulo", "tipoCobrancaRotulo"] as const)("classificação de comissão em %s não vaza no rateio de descrição genérica", async campo => {
    await db.despesaDocumento.update({ where: { id: "nota" }, data: { origemChave: "WIDESYS:PAGAR:w1", origemHash: "captura-1" } });
    await db.tituloFinanceiroLegado.create({ data: { id: "w1", origem: "WIDESYS", escopo: "TITULO_PAGAR", legadoId: "w1", ultimoItemId: "item-w1", natureza: "PAGAR", competencia: "2026-10", situacaoNormalizada: "PENDENTE", statusImportacao: "STAGING", valorDevido: 256000, valorAberto: 256000, valorPago: 0, snapshot: "{}", snapshotHash: "captura-1", capturadoEm: new Date("2026-10-23T12:00:00Z"), [campo]: "Comissão da administradora" } });
    const fonte = (await carregarFontesUnificacao(db)).find(f => f.chave === "WIDESYS:PAGAR:w1")!;
    await db.unificacaoRegistro.create({ data: { chave: fonte.chave, dominio: "PAGAR", origem: "WIDESYS", origemId: "w1", hashFonte: fonte.hash, status: "ATIVO", decisao: "MANUAL" } });
    expect((await consultarResumoRateios(db, politica(), "2026-10")).total).toBe(256000);
    expect(await consultarResumoRateios(db, politica("FINANCEIRO", [], true), "2026-10")).toEqual({ custos: [], total: 0, notasConferidas: 0, notasPendentes: 0 });
    expect(await consultarResumoRateios(db, politica("SOCIO", [permitir("EMPREENDIMENTO", "e1")]), "2026-10")).toEqual({ custos: [], total: 0, notasConferidas: 0, notasPendentes: 0 });
  });

  it("imóvel movido não vaza à nova carteira e exige reconferir a nota inteira", async () => {
    await db.unidade.update({ where: { id: "u1" }, data: { empreendimentoId: "e2" } });
    expect(await consultarResumoRateios(db, politica(), "2026-10")).toMatchObject({ total: 0, notasPendentes: 1, notasConferidas: 0 });
    expect((await consultarResumoRateios(db, politica("SOCIO", [permitir("UNIDADE", "u1")]), "2026-10")).total).toBe(0);
    expect((await consultarResumoRateios(db, politica("SOCIO", [permitir("EMPREENDIMENTO", "e2")]), "2026-10")).total).toBe(0);
  });

  it("comissões só compõem o relatório do administrador", async () => {
    await db.despesaRateio.updateMany({ where: { despesaId: "nota", ordem: 0 }, data: { categoria: "Comissão administrativa", descricao: "Valor restrito" } });
    expect((await consultarResumoRateios(db, politica(), "2026-10")).total).toBe(256000);
    expect((await consultarResumoRateios(db, politica("FINANCEIRO", [], true), "2026-10")).total).toBe(213000);
    expect((await consultarResumoRateios(db, politica("SOCIO", [permitir("EMPREENDIMENTO", "e1")]), "2026-10")).total).toBe(0);
  });

  it("sigilo persistente exclui a nota inteira a não administradores mesmo após retirar a descrição de comissão", async () => {
    await db.despesaDocumento.update({ where: { id: "nota" }, data: { restrita: true } });
    await db.despesaRateio.updateMany({ where: { despesaId: "nota" }, data: { categoria: "Manutenção", descricao: "Serviço reclassificado" } });
    expect((await consultarResumoRateios(db, politica(), "2026-10")).total).toBe(256000);
    const vazio = { custos: [], total: 0, notasConferidas: 0, notasPendentes: 0 };
    expect(await consultarResumoRateios(db, politica("FINANCEIRO", [], true), "2026-10")).toEqual(vazio);
    expect(await consultarResumoRateios(db, politica("SOCIO", [permitir("EMPREENDIMENTO", "e1")]), "2026-10")).toEqual(vazio);
    expect(await consultarResumoRateios(db, politica("SOCIO", [permitir("UNIDADE", "u1")]), "2026-10")).toEqual(vazio);
    await db.despesaDocumento.update({ where: { id: "nota" }, data: { statusRateio: "RASCUNHO" } });
    expect(await consultarResumoRateios(db, politica("FINANCEIRO", [], true), "2026-10")).toEqual(vazio);
  });

  it("nega sem financeiro.ver e exige competência no compartilhamento", async () => {
    expect(await consultarResumoRateios(db, politica("CONSULTA"), "2026-10")).toEqual({ custos: [], total: 0, notasConferidas: 0, notasPendentes: 0 });
    await expect(consultarResumoRateios(db, politica("SOCIO", [permitir("EMPREENDIMENTO", "e1")]))).rejects.toThrow("competência");
    await expect(consultarResumoRateios(db, politica(), "2026-13")).rejects.toThrow("competência");
  });
});
