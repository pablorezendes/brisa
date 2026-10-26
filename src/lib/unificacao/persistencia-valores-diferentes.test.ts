import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { criarSchemaSinteticoDespesas } from "../despesas/testes-banco";
import { carregarFontesUnificacao } from "./fontes";
import { AUTOR_REGRA_VALOR_DIFERENTE, conferirValoresDiferentes } from "./persistencia-valores-diferentes";
import { analisarUnificacao, lerOperacaoUnificada } from "./servico";
import { DECISAO_VALOR_DIFERENTE } from "./valores-diferentes";

let diretorio: string;
let db: PrismaClient;
let contador = 0;
const banco = (arquivo: string) => new PrismaClient({ datasourceUrl: `file:${arquivo.replaceAll("\\", "/")}` });
beforeAll(async () => {
  diretorio = mkdtempSync(join(tmpdir(), "brisa-regra-valores-"));
  const modelo = banco(join(diretorio, "modelo.db"));
  try { await criarSchemaSinteticoDespesas(modelo); } finally { await modelo.$disconnect(); }
}, 30000);
beforeEach(async () => {
  const arquivo = join(diretorio, `teste-${++contador}.db`);
  copyFileSync(join(diretorio, "modelo.db"), arquivo);
  db = banco(arquivo);
  await db.pessoa.create({ data: { id: "pessoa", origem: "WIDESYS", legadoId: "pessoa", nome: "Fornecedor sintético", nomeNorm: "FORNECEDOR SINTETICO", snapshot: "{}", snapshotHash: "pessoa-v1" } });
});
afterEach(async () => { await db?.$disconnect(); });
afterAll(() => {
  if (!diretorio) return;
  const alvo = resolve(diretorio);
  if (!alvo.toLowerCase().startsWith(`${resolve(tmpdir())}${sep}`.toLowerCase()) || !basename(alvo).startsWith("brisa-regra-valores-")) throw new Error("Fora do escopo temporário.");
  rmSync(alvo, { recursive: true, force: true });
});

async function titulo(id: string, valor = 46150, natureza = "PAGAR") {
  return db.tituloFinanceiroLegado.create({ data: {
    id, origem: "WIDESYS", escopo: `TITULO_${natureza}`, legadoId: id, ultimoItemId: `item-${id}`, natureza, pessoaLegadoId: "pessoa",
    numeroDocumento: id, valorDevido: valor, valorPago: valor, valorAberto: 0,
    competencia: "2026-01", vencimento: "2026-01-30", pagamento: "2026-01-30", situacaoNormalizada: "PAGO", planoContaRotulo: "Manutenção",
    capturadoEm: new Date(), snapshot: "{}", snapshotHash: `${id}-v1`,
  } });
}

async function decisoesAntigas() {
  const fontes = (await carregarFontesUnificacao(db)).filter(f => f.dominio === "PAGAR" || f.dominio === "RECEBER");
  for (let i = 0; i < fontes.length; i++) {
    const f = fontes[i];
    await db.unificacaoRegistro.create({ data: {
      chave: f.chave, dominio: f.dominio, origem: f.origem, origemId: f.origemId, hashFonte: f.hash,
      status: i === 0 ? "ATIVO" : "PENDENTE", motivos: JSON.stringify([i === 0 ? "SEM_CORRESPONDENCIA_ENCONTRADA" : "POSSIVEL_DUPLICIDADE"]),
      candidatos: JSON.stringify(fontes.filter(o => o.chave !== f.chave).map(o => ({ chave: o.chave, motivos: ["MES_E_VINCULO"] }))),
    } });
  }
}

const decisoes = () => db.unificacaoRegistro.findMany({ orderBy: { chave: "asc" } });
const auditorias = () => db.unificacaoDecisao.findMany({ orderBy: { id: "asc" } });
async function fotografiaFinanceira() {
  return Promise.all([
    db.tituloFinanceiroLegado.findMany({ orderBy: { id: "asc" } }),
    db.baixaFinanceiraLegado.findMany({ orderBy: { id: "asc" } }),
    db.movimentoFinanceiroLegado.findMany({ orderBy: { id: "asc" } }),
    db.recebimento.findMany({ orderBy: { id: "asc" } }),
    db.pagamentoRecebimento.findMany({ orderBy: { id: "asc" } }),
    db.lancamentoCaixa.findMany({ orderBy: { id: "asc" } }),
  ]);
}

async function parNativo() {
  await db.empreendimento.create({ data: { id: "emp", nome: "Edifício sintético" } });
  await db.unidade.create({ data: { id: "un", empreendimentoId: "emp", identificacao: "Sala sintética" } });
  await db.locatario.create({ data: { id: "loc", nome: "Locatário sintético", nomeNorm: "LOCATARIO SINTETICO" } });
  await db.contrato.create({ data: { id: "contrato", unidadeId: "un", locatarioId: "loc", diaVencimento: 10, valorBase: 46150 } });
  for (const [id, valor] of [["nativo-a", 46150], ["nativo-b", 19500]] as const) {
    await db.recebimento.create({ data: { id, contratoId: "contrato", empreendimentoId: "emp", mesLancamento: "2026-01", competencia: "2026-01", valor, recebido: valor, taxaComissaoBps: 0 } });
  }
}

describe("persistência da conferência por valores diferentes", () => {
  it.each(["PAGAR", "RECEBER"])("corrige %s antigo, mantém origens/pagamentos e soma cada título uma vez", async natureza => {
    await titulo("a", 46150, natureza); await titulo("b", 19500, natureza);
    await db.baixaFinanceiraLegado.create({ data: { id: "baixa", legadoId: "baixa", ultimoItemId: "item-baixa", escopo: `BAIXA_${natureza}`, natureza: natureza === "PAGAR" ? "PAGAMENTO" : "RECEBIMENTO", tituloEscopo: `TITULO_${natureza}`, tituloLegadoId: "a", valor: 46150, dataPagamento: "2026-01-30", capturadoEm: new Date(), snapshot: "{}", snapshotHash: "baixa-v1" } });
    await db.movimentoFinanceiroLegado.create({ data: { id: "mov", legadoId: "mov", ultimoItemId: "item-mov", natureza: natureza === "PAGAR" ? "SAIDA" : "ENTRADA", valor: 46150, dataMovimento: "2026-01-30", capturadoEm: new Date(), snapshot: "{}", snapshotHash: "mov-v1" } });
    await decisoesAntigas();
    const origens = await fotografiaFinanceira(), antes = await decisoes();
    expect(await conferirValoresDiferentes(db)).toMatchObject({ modo: "DRY_RUN", conferidos: 2, decisoesAtualizadas: 2, titulosCriados: 0, pagamentosCriados: 0, movimentosCriados: 0 });
    expect(await decisoes()).toEqual(antes); expect(await auditorias()).toHaveLength(0);

    expect(await conferirValoresDiferentes(db, { aplicar: true })).toMatchObject({ modo: "APLICADO", conferidos: 2 });
    const gravadas = await decisoes();
    for (const d of gravadas) expect(d).toMatchObject({ status: "ATIVO", decisao: DECISAO_VALOR_DIFERENTE, decididoPor: AUTOR_REGRA_VALOR_DIFERENTE, decididoEm: expect.any(Date), versao: 2, motivos: '["VALORES_DIFERENTES_CONFIRMADOS"]' });
    const trilha = await auditorias();
    expect(trilha).toHaveLength(2);
    for (const a of trilha) {
      expect(a).toMatchObject({ acao: DECISAO_VALOR_DIFERENTE, usuarioId: AUTOR_REGRA_VALOR_DIFERENTE, estadoNovo: "ATIVO" });
      expect(JSON.parse(a.justificativa)).toMatchObject({ versao: 1, comparados: [{ hash: expect.any(String), chave: expect.any(String), valor: expect.any(Number) }] });
    }
    const linhas = (await lerOperacaoUnificada(db)).linhas.filter(l => l.dominio === natureza);
    expect(linhas).toHaveLength(2);
    expect(linhas.every(l => l.contabiliza && l.conferidoPorRegra && !l.conferidoManualmente)).toBe(true);
    expect(linhas.reduce((s, l) => s + l.valor!, 0)).toBe(65650);
    expect(linhas.reduce((s, l) => s + l.pago!, 0)).toBe(65650);
    expect(await fotografiaFinanceira()).toEqual(origens);
    expect(await conferirValoresDiferentes(db, { aplicar: true })).toMatchObject({ conferidos: 0, decisoesAtualizadas: 0 });
    expect(await decisoes()).toEqual(gravadas); expect(await auditorias()).toEqual(trilha);
  });

  it("integra novas análises sem duplicar confirmação, auditoria ou títulos", async () => {
    await titulo("a"); await titulo("b", 19500);
    expect(await analisarUnificacao(db, "operador", true)).toMatchObject({ conferidosPorValoresDiferentes: 2 });
    expect(await decisoes()).toHaveLength(0);
    expect(await analisarUnificacao(db, "operador")).toMatchObject({ conferidosPorValoresDiferentes: 2 });
    const antes = await decisoes(), trilha = await auditorias();
    expect(await analisarUnificacao(db, "operador")).toMatchObject({ conferidosPorValoresDiferentes: 0, atualizados: 0, criados: 0 });
    expect(await decisoes()).toEqual(antes); expect(await auditorias()).toEqual(trilha);
    expect(await db.tituloFinanceiroLegado.count()).toBe(2);
  });

  it("mantém candidatos de valor igual e desconhecido pendentes", async () => {
    await titulo("a"); await titulo("b", 19500); await titulo("igual", 46150); await titulo("desconhecido", 50000);
    await db.tituloFinanceiroLegado.update({ where: { id: "desconhecido" }, data: { valorDevido: null } });
    await decisoesAntigas();
    const antes = await decisoes();
    expect(await conferirValoresDiferentes(db, { aplicar: true })).toMatchObject({ conferidos: 0 });
    expect(await decisoes()).toEqual(antes);
    await db.tituloFinanceiroLegado.update({ where: { id: "desconhecido" }, data: { statusImportacao: "QUARENTENA", quarentenaMotivo: "VALOR_INVALIDO" } });
    expect(await conferirValoresDiferentes(db, { aplicar: true })).toMatchObject({ conferidos: 1 });
    expect(await db.unificacaoRegistro.findUnique({ where: { chave: "WIDESYS:PAGAR:igual" } })).toMatchObject({ status: "PENDENTE", decisao: "AUTOMATICA" });
  });

  it("preserva decisões manuais, reabertas, alteradas, inconsistentes, canceladas e excluídas", async () => {
    const ids = ["manual", "vinculado", "reaberto", "revisar", "alterado", "quarentena", "cancelado", "excluido"];
    for (let i = 0; i < ids.length; i++) await titulo(ids[i], 10000 + i * 100);
    await decisoesAntigas();
    await db.unificacaoRegistro.update({ where: { chave: "WIDESYS:PAGAR:manual" }, data: { status: "ATIVO", decisao: "MANUAL", motivos: '["REGISTRO_DISTINTO_CONFIRMADO"]' } });
    await db.unificacaoRegistro.update({ where: { chave: "WIDESYS:PAGAR:vinculado" }, data: { status: "VINCULADO", decisao: "MANUAL", destinoChave: "WIDESYS:PAGAR:manual" } });
    await db.unificacaoRegistro.update({ where: { chave: "WIDESYS:PAGAR:reaberto" }, data: { status: "PENDENTE", decisao: "MANUAL", motivos: '["REVISAO_REABERTA"]' } });
    await db.unificacaoRegistro.update({ where: { chave: "WIDESYS:PAGAR:revisar" }, data: { status: "REVISAR", motivos: '["FONTE_ALTERADA_APOS_DECISAO"]' } });
    await db.tituloFinanceiroLegado.update({ where: { id: "alterado" }, data: { valorPago: 0 } });
    await db.tituloFinanceiroLegado.update({ where: { id: "quarentena" }, data: { statusImportacao: "QUARENTENA", quarentenaMotivo: "VALOR_INVALIDO" } });
    await db.tituloFinanceiroLegado.update({ where: { id: "cancelado" }, data: { situacaoNormalizada: "CANCELADO" } });
    await db.recursoGovernado.create({ data: { tipo: "TITULO", origemId: "WIDESYS:PAGAR:excluido", status: "EXCLUIDO", motivo: "Exclusão sintética", autorId: "admin" } });
    const antes = await decisoes(), origens = await fotografiaFinanceira();
    expect(await conferirValoresDiferentes(db, { aplicar: true })).toMatchObject({ conferidos: 0 });
    expect(await decisoes()).toEqual(antes); expect(await fotografiaFinanceira()).toEqual(origens);
  });

  it.each(["MES_FECHADO", "BOLETO_ATIVO", "RESERVA"])("protege recebimentos nativos com %s", async protecao => {
    await parNativo(); await decisoesAntigas();
    if (protecao === "MES_FECHADO") await db.fechamentoMensal.create({ data: { mesLancamento: "2026-01", comissaoTotal: 0, detalhe: "{}" } });
    if (protecao === "RESERVA") await db.recebimento.updateMany({ data: { reservaEmissaoToken: "reserva-sintetica" } });
    if (protecao === "BOLETO_ATIVO") {
      await db.contaBancaria.create({ data: { id: "conta", codigoBanco: "756", nomeBanco: "Banco sintético", agencia: "1", numero: "2", apelido: "Teste" } });
      for (const id of ["nativo-a", "nativo-b"]) await db.boleto.create({ data: { contaBancariaId: "conta", recebimentoId: id, chaveIdempotencia: id, seuNumero: id, ambienteBanco: "SANDBOX", numeroClienteBanco: 1, numeroContaBanco: 2, codigoModalidadeBanco: 1, especieDocumentoBanco: "DS", status: "REGISTRADO", valor: 10000, dataVencimento: "2026-01-10", pagadorNome: "Locatário sintético", pagadorCpfCnpj: "12345678901" } });
    }
    const antes = await decisoes(), origens = await fotografiaFinanceira();
    expect(await conferirValoresDiferentes(db, { aplicar: true })).toMatchObject({ conferidos: 0, protegidos: 2 });
    expect(await decisoes()).toEqual(antes); expect(await fotografiaFinanceira()).toEqual(origens);
    expect(await analisarUnificacao(db, "operador")).toMatchObject({ conferidosPorValoresDiferentes: 0, protegidosDaRegra: 2 });
    expect((await decisoes()).filter(d => d.dominio === "RECEBER")).toEqual(antes);
    expect(await fotografiaFinanceira()).toEqual(origens);
  });

  it("mudança posterior reabre a conferência e não reconfirma silenciosamente", async () => {
    await titulo("a"); await titulo("b", 19500); await conferirValoresDiferentes(db, { aplicar: true });
    await db.tituloFinanceiroLegado.update({ where: { id: "a" }, data: { valorPago: 0, valorAberto: 46150 } });
    expect((await lerOperacaoUnificada(db)).linhas.find(l => l.chave === "WIDESYS:PAGAR:a")).toMatchObject({ estado: "REVISAR", conferidoPorRegra: false });
    await analisarUnificacao(db, "operador");
    const anterior = await db.unificacaoRegistro.findUniqueOrThrow({ where: { chave: "WIDESYS:PAGAR:a" } });
    expect(anterior.status).toBe("REVISAR");
    expect(await conferirValoresDiferentes(db, { aplicar: true })).toMatchObject({ conferidos: 0 });
    expect(await db.unificacaoRegistro.findUniqueOrThrow({ where: { chave: "WIDESYS:PAGAR:a" } })).toEqual(anterior);
  });
});
