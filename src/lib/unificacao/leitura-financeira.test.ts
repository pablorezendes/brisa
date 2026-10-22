import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { analisarUnificacao, lerOperacaoUnificada } from "./servico";
import { lerListaFinanceira } from "./leitura-financeira";

vi.mock("node:fs", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, existsSync: (arquivo: Parameters<typeof fs.existsSync>[0]) => /[\\/]data[\\/]dataset\.json$/.test(String(arquivo)) ? false : fs.existsSync(arquivo) };
});
let diretorio: string;
let contador = 0;
let consultas: string[];
const criarBanco = (arquivo: string) => new PrismaClient({ datasourceUrl: `file:${arquivo.replaceAll("\\", "/")}`, log: [{ emit: "event", level: "query" }] });
let db: ReturnType<typeof criarBanco>;
const captura = { capturadoEm: new Date("2026-10-22T12:00:00.000Z"), snapshot: "{}", snapshotHash: "sintetico" };

beforeAll(async () => {
  diretorio = mkdtempSync(join(tmpdir(), "brisa-leitura-financeira-"));
  const modelo = criarBanco(join(diretorio, "modelo.db"));
  for (const m of Prisma.dmmf.datamodel.models) {
    const colunas = m.fields.filter(f => f.kind !== "object").map(f => {
      const tipo = ["Int", "BigInt", "Boolean"].includes(f.type) ? "INTEGER" : f.type === "Float" ? "REAL" : f.type === "DateTime" ? "DATETIME" : "TEXT";
      const d = f.default;
      const padrao = typeof d === "boolean" ? ` DEFAULT ${d ? 1 : 0}` : typeof d === "number" ? ` DEFAULT ${d}`
        : typeof d === "string" ? ` DEFAULT '${d.replaceAll("'", "''")}'` : f.type === "DateTime" ? " DEFAULT CURRENT_TIMESTAMP" : "";
      return `"${f.name}" ${tipo}${f.isId ? " PRIMARY KEY" : ""}${f.isRequired ? " NOT NULL" : ""}${f.isUnique ? " UNIQUE" : ""}${padrao}`;
    });
    for (const campos of m.uniqueFields) colunas.push(`UNIQUE (${campos.map(c => `"${c}"`).join(",")})`);
    await modelo.$executeRawUnsafe(`CREATE TABLE "${m.name}" (${colunas.join(",")})`);
  }
  await modelo.$disconnect();
}, 30000);
beforeEach(async () => {
  const arquivo = join(diretorio, `teste-${++contador}.db`);
  copyFileSync(join(diretorio, "modelo.db"), arquivo);
  db = criarBanco(arquivo);
  consultas = [];
  db.$on("query", e => consultas.push(e.query));
  await db.pessoa.create({ data: { id: "pessoa-legado", legadoId: "pessoa-externa", nome: "Pessoa sintética", nomeNorm: "PESSOA SINTETICA", ...captura } });
  await db.locatario.create({ data: { id: "loc", nome: "Pessoa sintética", nomeNorm: "PESSOA SINTETICA", pessoaId: "pessoa-legado" } });
  await db.empreendimento.create({ data: { id: "emp", nome: "Edifício sintético" } });
  await db.unidade.create({ data: { id: "un", empreendimentoId: "emp", identificacao: "SALA SINTETICA" } });
  await db.contrato.create({ data: { id: "contrato", unidadeId: "un", locatarioId: "loc", diaVencimento: 15, valorBase: 10000 } });
  await db.imovelLegado.create({ data: { id: "imovel-legado", legadoId: "imovel-externo", nome: "SALA SINTETICA", referencia: "SINTETICA", ...captura } });
  await db.contratoLegado.create({ data: { id: "contrato-legado", legadoId: "contrato-externo", ultimoItemId: "item-contrato", imovelLegadoId: "imovel-externo", numeroContrato: "123", valorLocacao: 10000, ...captura } });
  await db.contratoParteLegado.create({ data: { id: "parte", legadoId: "parte-externa", ultimoItemId: "item-parte", contratoId: "contrato-legado", contratoLegadoId: "contrato-externo", papel: "INQUILINO", pessoaLegadoId: "pessoa-externa", ...captura } });
  await db.recebimento.createMany({ data: ["r1", "r2"].map((id, i) => ({ id, contratoId: "contrato", empreendimentoId: "emp", competencia: "2026-10", mesLancamento: "2026-10", valor: 10000 + i, recebido: i ? 500 : null, taxaComissaoBps: 750 })) });
  await db.tituloFinanceiroLegado.createMany({ data: [
    { id: "w1", natureza: "RECEBER", valorDevido: 10000, statusImportacao: "STAGING" },
    { id: "w2", natureza: "RECEBER", valorDevido: 34567, statusImportacao: "STAGING" },
    { id: "p1", natureza: "PAGAR", valorDevido: 5000, statusImportacao: "STAGING" },
    { id: "p2", natureza: "PAGAR", valorDevido: 5000, statusImportacao: "STAGING" },
    { id: "inconsistente", natureza: "DESCONHECIDA", valorDevido: 150, statusImportacao: "QUARENTENA" },
  ].map(t => ({ ...t, legadoId: `${t.id}-externo`, ultimoItemId: `item-${t.id}`, escopo: t.natureza === "PAGAR" ? "TITULO_PAGAR" : "TITULO_RECEBER", pessoaLegadoId: t.id === "w2" ? null : "pessoa-externa", contratoLegadoId: "contrato-externo", competencia: "2026-10", vencimento: "2026-10-15", valorPago: 0, valorAberto: t.valorDevido, situacaoNormalizada: "PENDENTE", ...captura })) });
  await db.pagamentoRecebimento.create({ data: { id: "pagamento", recebimentoId: "r2", chaveIdempotencia: "pg-sintetico", valor: 500, dataPagamento: "2026-10-10" } });
  await db.baixaFinanceiraLegado.create({ data: { id: "baixa", legadoId: "baixa-externa", ultimoItemId: "item-baixa", escopo: "BAIXA_PAGAR", natureza: "PAGAMENTO", tituloEscopo: "TITULO_PAGAR", tituloLegadoId: "p1-externo", valor: 5000, ...captura } });
  await db.lancamentoCaixa.create({ data: { id: "caixa", mesReferencia: "2026-10", centroCusto: "GERAL", tipo: "ENTRADA", valor: 500, descricao: "Caixa sintético" } });
  consultas = [];
});
afterEach(async () => { await db?.$disconnect(); });
afterAll(() => {
  const alvo = resolve(diretorio);
  if (!alvo.toLowerCase().startsWith(`${resolve(tmpdir())}${sep}`.toLowerCase()) || !basename(alvo).startsWith("brisa-leitura-financeira-")) throw new Error("Diretório fora do escopo temporário.");
  rmSync(alvo, { recursive: true, force: true });
});

async function paridade(dominio: "RECEBER" | "PAGAR") {
  const completa = await lerOperacaoUnificada(db);
  const financeira = await lerListaFinanceira(db, dominio);
  expect(financeira).toEqual({
    fontes: completa.fontes.filter(f => f.dominio === dominio),
    linhas: completa.linhas.filter(l => l.dominio === dominio),
    decisoes: completa.decisoes.filter(d => d.dominio === dominio),
  });
  return financeira;
}

async function decisoesManuais() {
  await analisarUnificacao(db, "teste-sintetico");
  const dados = await lerOperacaoUnificada(db);
  const origem = dados.fontes.find(f => f.chave === "WIDESYS:RECEBER:w1")!;
  const alvo = dados.fontes.find(f => f.chave === "BRISA:RECEBER:r1")!;
  await db.unificacaoRegistro.update({ where: { chave: alvo.chave }, data: { status: "ATIVO", decisao: "MANUAL", hashFonte: alvo.hash } });
  await db.unificacaoRegistro.update({ where: { chave: origem.chave }, data: { status: "VINCULADO", decisao: "MANUAL", destinoChave: alvo.chave, hashFonte: origem.hash, hashDestino: alvo.hash } });
  await db.unificacaoRegistro.update({ where: { chave: "WIDESYS:PAGAR:p1" }, data: { status: "ATIVO", decisao: "MANUAL" } });
}

describe("leitura financeira restrita ao domínio — paridade real com SQLite", () => {
  it.each(["RECEBER", "PAGAR"] as const)("preserva fontes, hashes, vínculos e candidatos de %s sem análise persistida", async dominio => {
    const dados = await paridade(dominio);
    if (dominio === "RECEBER") {
      const fallback = dados.fontes.find(f => f.chave === "WIDESYS:RECEBER:w2")!;
      expect(fallback.titulo).toBe("Pessoa sintética");
      expect(fallback.pessoaChave).toBe("WIDESYS:PESSOA:pessoa-legado");
      expect(fallback.imovelChave).toBe("WIDESYS:IMOVEL:imovel-legado");
      expect(dados.linhas.find(f => f.origemId === "inconsistente")?.estado).toBe("QUARENTENA");
    }
  });

  it("mantém decisões manuais, principal vinculado, divergências e fontes consolidadas", async () => {
    await decisoesManuais();
    const receber = await paridade("RECEBER");
    await paridade("PAGAR");
    expect(receber.linhas.find(l => l.chave === "WIDESYS:RECEBER:w1")?.estado).toBe("VINCULADO");
    expect(receber.linhas.find(l => l.chave === "BRISA:RECEBER:r1")?.fontes).toContain("WIDESYS:RECEBER:w1");
  });

  it("mantém reconferência de decisão manual e reavaliação nativa quando a fonte muda", async () => {
    await decisoesManuais();
    await db.tituloFinanceiroLegado.update({ where: { id: "w1" }, data: { valorDevido: 12345 } });
    await db.recebimento.update({ where: { id: "r2" }, data: { valor: 98989 } });
    const dados = await paridade("RECEBER");
    expect(dados.linhas.find(l => l.origemId === "w1")?.estado).toBe("REVISAR");
    expect(dados.fontes.find(l => l.origemId === "r2")?.valor).toBe(98989);
  });

  it("mantém exclusões governadas e revisão de vínculo cujo principal foi excluído", async () => {
    await decisoesManuais();
    await db.recursoGovernado.createMany({ data: [
      { tipo: "TITULO", origemId: "BRISA:RECEBER:r1", status: "EXCLUIDO", motivo: "Teste sintético", autorId: "admin" },
      { tipo: "TITULO", origemId: "WIDESYS:PAGAR:p2", status: "EXCLUIDO", motivo: "Teste sintético", autorId: "admin" },
      { tipo: "PESSOA", origemId: "pessoa-legado", status: "EXCLUIDO", motivo: "Cadastro excluído não remove título", autorId: "admin" },
    ] });
    const receber = await paridade("RECEBER");
    const pagar = await paridade("PAGAR");
    expect(receber.fontes.some(f => f.chave === "BRISA:RECEBER:r1")).toBe(false);
    expect(receber.linhas.find(f => f.origemId === "w1")?.estado).toBe("REVISAR");
    expect(pagar.fontes.some(f => f.chave === "WIDESYS:PAGAR:p2")).toBe(false);
  });

  it.each(["RECEBER", "PAGAR"] as const)("%s não consulta outros módulos nem escreve e lê menos tabelas que a operação inteira", async dominio => {
    consultas = [];
    await lerOperacaoUnificada(db);
    const totalCompleta = consultas.length;
    consultas = [];
    await lerListaFinanceira(db, dominio);
    const tabelas = consultas.flatMap(sql => [...sql.matchAll(/\b(?:FROM|JOIN)\s+[`"]?main[`"]?\.[`"]?(\w+)[`"]?/g)].map(m => m[1]));
    for (const tabela of ["LancamentoCaixa", "PagamentoRecebimento", "BaixaFinanceiraLegado", "MovimentoFinanceiroLegado", "CatalogoLegadoRegistro", "ImportacaoPlanilhaLinha", "ImportacaoPlanilhaLote"]) {
      expect(tabelas).not.toContain(tabela);
    }
    expect(tabelas).toContain("TituloFinanceiroLegado");
    expect(tabelas).toContain("RecursoGovernado");
    if (dominio === "PAGAR") for (const tabela of ["Recebimento", "Contrato", "Unidade", "Locatario", "Empreendimento"]) expect(tabelas).not.toContain(tabela);
    expect(consultas.length).toBeLessThan(totalCompleta);
    expect(consultas.some(sql => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql))).toBe(false);
  });

  it("não usa cache entre requisições após mudança de saldo ou exclusão", async () => {
    const antes = await lerListaFinanceira(db, "RECEBER");
    await db.recebimento.update({ where: { id: "r2" }, data: { recebido: 10001 } });
    await db.recursoGovernado.create({ data: { tipo: "TITULO", origemId: "BRISA:RECEBER:r1", status: "EXCLUIDO", motivo: "Teste sintético", autorId: "admin" } });
    const depois = await lerListaFinanceira(db, "RECEBER");
    expect(antes.fontes.find(f => f.origemId === "r2")?.aberto).toBe(9501);
    expect(depois.fontes.find(f => f.origemId === "r2")?.aberto).toBe(0);
    expect(depois.fontes.some(f => f.origemId === "r1")).toBe(false);
  });
});
