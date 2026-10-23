import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { analisarUnificacao, lerOperacaoUnificada } from "./servico";
import { lerListaFinanceira } from "./leitura-financeira";
import { fonteLancamentoCaixa } from "./fontes";

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

async function despesaSintetica(paga = false) {
  if (paga) await db.lancamentoCaixa.create({ data: { id: "pix-nota", tipo: "SAIDA", centroCusto: "GERAL", mesReferencia: "2026-10", data: "2026-10-08", valor: 256000 } });
  return db.despesaDocumento.create({ data: {
    id: "nota-nativa", fornecedorNome: "Fornecedor da manutenção", numero: "NF-SINTETICA", emissao: "2026-10-07", competencia: "2026-10", total: 256000,
    criadoPorId: "admin", atualizadoPorId: "admin", lancamentoCaixaId: paga ? "pix-nota" : null, pagamentoVia: paga ? "PIX" : null,
    rateios: { create: [{ empreendimentoId: "emp", ordem: 0, descricao: "Serviço parcial", valor: 43000 }, { empreendimentoId: "emp", ordem: 1, descricao: "Outros serviços", valor: 213000 }] },
  } });
}

describe("leitura financeira restrita ao domínio — paridade real com SQLite", () => {
  it("nota com várias parcelas aparece uma única vez em pagar e conserva uma única saída", async () => {
    await despesaSintetica(true);
    const dados = await paridade("PAGAR");
    expect(dados.fontes.filter(f => f.chave === "BRISA:PAGAR:nota-nativa")).toHaveLength(1);
    expect(dados.linhas.find(f => f.chave === "BRISA:PAGAR:nota-nativa")).toMatchObject({ valor: 256000, pago: 256000, aberto: 0, contabiliza: true });
    expect(await db.lancamentoCaixa.count({ where: { tipo: "SAIDA" } })).toBe(1);
    expect(await db.despesaRateio.count()).toBe(2);
    expect((await paridade("RECEBER")).fontes.some(f => f.origemId === "nota-nativa")).toBe(false);
  });

  it("rateio de título Widesys é overlay e nunca cria outra conta a pagar", async () => {
    await despesaSintetica();
    await db.despesaDocumento.update({ where: { id: "nota-nativa" }, data: { origemChave: "WIDESYS:PAGAR:p1" } });
    const dados = await paridade("PAGAR");
    expect(dados.fontes.some(f => f.chave === "BRISA:PAGAR:nota-nativa")).toBe(false);
    expect(dados.fontes.filter(f => f.chave === "WIDESYS:PAGAR:p1")).toHaveLength(1);
    expect(await db.lancamentoCaixa.count({ where: { tipo: "SAIDA" } })).toBe(0);
  });

  it.each(["EXCLUIDO", "VALOR_DIVERGENTE", "NATUREZA_DIVERGENTE"])("saída %s coloca a nota em conferência sem duplicar nem gerar nova cobrança", async caso => {
    await despesaSintetica(true);
    if (caso === "EXCLUIDO") await db.recursoGovernado.create({ data: { tipo: "CAIXA", origemId: "pix-nota", status: "EXCLUIDO", motivo: "Conferência sintética", autorId: "admin" } });
    else await db.lancamentoCaixa.update({ where: { id: "pix-nota" }, data: caso === "VALOR_DIVERGENTE" ? { valor: 1 } : { tipo: "ENTRADA" } });
    const dados = await paridade("PAGAR");
    expect(dados.linhas.find(f => f.chave === "BRISA:PAGAR:nota-nativa")).toMatchObject({ qualidade: "QUARENTENA", estado: "QUARENTENA", contabiliza: false, motivos: ["PAGAMENTO_DESPESA_CONFERIR"] });
    expect(await db.despesaDocumento.count()).toBe(1);
    expect(await db.lancamentoCaixa.count({ where: { id: "pix-nota" } })).toBe(1);
  });

  it.each(["PENDENTE", "VINCULADO", "REVISAR", "ATIVO_DESATUALIZADO"])("saída com unificação %s não liquida a nota silenciosamente", async status => {
    await despesaSintetica(true);
    const caixa = await db.lancamentoCaixa.findUniqueOrThrow({ where: { id: "pix-nota" } });
    const fonte = fonteLancamentoCaixa(caixa);
    await db.unificacaoRegistro.create({ data: { chave: fonte.chave, dominio: "MOVIMENTO", origem: "BRISA", origemId: caixa.id,
      status: status === "ATIVO_DESATUALIZADO" ? "ATIVO" : status, hashFonte: status === "ATIVO_DESATUALIZADO" ? "hash-antigo" : fonte.hash,
    } });
    const dados = await paridade("PAGAR");
    expect(dados.linhas.find(f => f.chave === "BRISA:PAGAR:nota-nativa")).toMatchObject({ qualidade: "QUARENTENA", contabiliza: false });
    expect(await db.lancamentoCaixa.count({ where: { id: "pix-nota" } })).toBe(1);
  });

  it("a exclusão administrativa da nota preserva sua saída original", async () => {
    await despesaSintetica(true);
    await db.recursoGovernado.create({ data: { tipo: "TITULO", origemId: "BRISA:PAGAR:nota-nativa", status: "EXCLUIDO", motivo: "Nota duplicada", autorId: "admin" } });
    expect((await paridade("PAGAR")).linhas.some(f => f.chave === "BRISA:PAGAR:nota-nativa")).toBe(false);
    expect((await lerOperacaoUnificada(db)).fontes.some(f => f.chave === "BRISA:MOVIMENTO:pix-nota")).toBe(true);
    expect(await db.despesaDocumento.count()).toBe(1);
    expect(await db.despesaRateio.count()).toBe(2);
  });

  it("o rateio não muda hash financeiro e não consulta parcelas na listagem de pagar", async () => {
    await despesaSintetica(true);
    const antes = await paridade("PAGAR");
    await db.despesaRateio.updateMany({ where: { despesaId: "nota-nativa" }, data: { descricao: "Descrição reorganizada" } });
    consultas = [];
    const depois = await lerListaFinanceira(db, "PAGAR");
    expect(depois.fontes.find(f => f.origemId === "nota-nativa")?.hash).toBe(antes.fontes.find(f => f.origemId === "nota-nativa")?.hash);
    expect(consultas.some(sql => sql.includes('"DespesaRateio"'))).toBe(false);
  });

  it("marca nota restrita e a saída correspondente sem divulgar o total por outro módulo", async () => {
    await despesaSintetica(true);
    const antes = (await lerOperacaoUnificada(db)).fontes.find(f => f.chave === "BRISA:MOVIMENTO:pix-nota")!;
    await db.despesaDocumento.update({ where: { id: "nota-nativa" }, data: { restrita: true } });
    const fontes = (await lerOperacaoUnificada(db)).fontes;
    expect(fontes.find(f => f.chave === "BRISA:PAGAR:nota-nativa")?.restrito).toBe(true);
    expect(fontes.find(f => f.chave === "BRISA:MOVIMENTO:pix-nota")).toMatchObject({ restrito: true, hash: antes.hash });
  });

  it.each(["CLASSIFICACAO", "OVERLAY_STICKY"])("protege título Widesys e baixa quando comissão é marcada por %s", async tipo => {
    if (tipo === "CLASSIFICACAO") await db.tituloFinanceiroLegado.update({ where: { id: "p1" }, data: { planoContaRotulo: "Comissão administrativa" } });
    else {
      await despesaSintetica();
      await db.despesaDocumento.update({ where: { id: "nota-nativa" }, data: { origemChave: "WIDESYS:PAGAR:p1", restrita: true } });
    }
    const lista = await paridade("PAGAR");
    expect(lista.fontes.find(f => f.chave === "WIDESYS:PAGAR:p1")?.restrito).toBe(true);
    expect(lista.fontes.some(f => f.chave === "BRISA:PAGAR:nota-nativa")).toBe(false);
    expect((await lerOperacaoUnificada(db)).fontes.find(f => f.chave === "WIDESYS:BAIXA_PAGAR:baixa")?.restrito).toBe(true);
  });
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
