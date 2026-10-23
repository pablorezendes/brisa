import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { excluirTitulosLote, previaExclusaoTitulosLote } from "./exclusao-titulos-lote";
import { previaGovernanca, restaurarRecurso } from "./servico";

let diretorio: string;
let contador = 0;
let consultas: string[];
const criarBanco = (arquivo: string) => new PrismaClient({ datasourceUrl: `file:${arquivo.replaceAll("\\", "/")}`, log: [{ emit: "event", level: "query" }] });
let db: ReturnType<typeof criarBanco>;
const ator = { id: "admin" };
const chave = (id: string) => `BRISA:RECEBER:${id}`;

beforeAll(async () => {
  diretorio = mkdtempSync(join(tmpdir(), "brisa-exclusao-lote-"));
  const modelo = criarBanco(join(diretorio, "modelo.db"));
  // Schema sintético: nunca abre, altera ou copia uma base de usuários.
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
  await db.usuario.create({ data: { id: "admin", nome: "Admin sintético", usuario: "admin", senhaHash: "nao-autenticavel", perfil: "ADMINISTRADOR" } });
  await db.empreendimento.create({ data: { id: "emp", nome: "Empreendimento sintético" } });
  await db.unidade.create({ data: { id: "un", empreendimentoId: "emp", identificacao: "SALA TESTE" } });
  await db.locatario.create({ data: { id: "loc", nome: "Pessoa sintética", nomeNorm: "PESSOA SINTETICA" } });
  await db.contrato.create({ data: { id: "contrato", unidadeId: "un", locatarioId: "loc" } });
  await db.recebimento.createMany({ data: ["r1", "r2", "r3"].map((id, i) => ({ id, contratoId: "contrato", empreendimentoId: "emp", mesLancamento: "2026-10", competencia: "2026-10", valor: 10000 + i, taxaComissaoBps: 700, recebido: i === 0 ? 10000 : null })) });
  await db.fechamentoMensal.create({ data: { id: "fechamento", mesLancamento: "2026-10", comissaoTotal: 700, detalhe: "snapshot-sintetico" } });
  consultas = [];
});
afterEach(async () => { await db?.$disconnect(); });
afterAll(() => {
  const alvo = resolve(diretorio);
  if (!alvo.toLowerCase().startsWith(`${resolve(tmpdir())}${sep}`.toLowerCase()) || !basename(alvo).startsWith("brisa-exclusao-lote-")) throw new Error("Diretório fora do escopo temporário.");
  rmSync(alvo, { recursive: true, force: true });
});

async function confirmar(ids = ["r1", "r2"]) {
  const previa = await previaExclusaoTitulosLote(db, "RECEBER", ids.map(chave), ator);
  return previa.itens.map(({ chave, assinatura }) => ({ chave, assinatura }));
}
async function fatos() {
  return {
    contratos: await db.contrato.findMany(), recebimentos: await db.recebimento.findMany(),
    pagamentos: await db.pagamentoRecebimento.findMany(), boletos: await db.boleto.findMany(),
    fechamentos: await db.fechamentoMensal.findMany(), legados: await db.tituloFinanceiroLegado.findMany(),
  };
}

async function notaComRateio(origemChave: string | null = null) {
  await db.lancamentoCaixa.create({ data: { id: "pix-nota", mesReferencia: "2026-10", centroCusto: "GERAL", tipo: "SAIDA", valor: 256000, data: "2026-10-08" } });
  await db.despesaDocumento.create({ data: { id: "nota", origemChave, fornecedorNome: "Fornecedor sintético", numero: "42-TESTE", emissao: "2026-10-07", competencia: "2026-10", total: 256000,
    criadoPorId: ator.id, atualizadoPorId: ator.id, lancamentoCaixaId: "pix-nota", pagamentoVia: "PIX",
    rateios: { create: [{ empreendimentoId: "emp", ordem: 0, valor: 100000, descricao: "Serviço 1" }, { empreendimentoId: "emp", ordem: 1, valor: 156000, descricao: "Serviço 2" }] },
  } });
}

async function criarTituloComReferencias() {
  const captura = { origem: "WIDESYS", capturadoEm: new Date("2026-10-22T12:00:00Z"), snapshot: "{}", snapshotHash: "sintetico" };
  await db.pessoa.createMany({ data: [
    { id: "pessoa-legado", legadoId: "pessoa-externa", nome: "Inquilino pelo contrato", nomeNorm: "INQUILINO PELO CONTRATO", ...captura },
    { id: "pessoa-quarentena", legadoId: "pessoa-ignorada", nome: "Não usar esta pessoa", nomeNorm: "NAO USAR ESTA PESSOA", ...captura },
  ] });
  await db.imovelLegado.create({ data: { id: "imovel-legado", legadoId: "imovel-externo", nome: null, referencia: "SALA REF 100", ...captura } });
  await db.contratoLegado.create({ data: { id: "contrato-legado", legadoId: "contrato-externo", ultimoItemId: "item-contrato", imovelLegadoId: "imovel-externo", ...captura } });
  await db.contratoParteLegado.createMany({ data: [
    { id: "parte-ignorada", legadoId: "parte-ignorada", ultimoItemId: "item-ignorado", contratoId: "contrato-legado", contratoLegadoId: "contrato-externo", papel: "INQUILINO", pessoaLegadoId: "pessoa-ignorada", ordem: 0, statusImportacao: "QUARENTENA", ...captura },
    { id: "parte-valida", legadoId: "parte-valida", ultimoItemId: "item-valido", contratoId: "contrato-legado", contratoLegadoId: "contrato-externo", papel: "INQUILINO", pessoaLegadoId: "pessoa-externa", ordem: 1, ...captura },
  ] });
  const titulo = { id: "titulo-referencia", legadoId: "titulo-externo", escopo: "TITULO_RECEBER", ultimoItemId: "item-titulo", natureza: "RECEBER", situacaoNormalizada: "PENDENTE", pessoaLegadoId: null, contratoLegadoId: "contrato-externo", valorDevido: null, valorOriginal: 99999, tipoCobrancaRotulo: "Aluguel", competencia: "2026-10", ...captura };
  await db.tituloFinanceiroLegado.create({ data: titulo });
  return titulo;
}

describe("exclusão administrativa agrupada de títulos", () => {
  it("exclui e restaura nota nativa preservando rateios e o único PIX", async () => {
    await notaComRateio();
    const retrato = async () => ({ notas: await db.despesaDocumento.findMany(), rateios: await db.despesaRateio.findMany(), caixa: await db.lancamentoCaixa.findMany() });
    const antes = await retrato();
    const previa = await previaExclusaoTitulosLote(db, "PAGAR", ["BRISA:PAGAR:nota"], ator);
    expect(previa.itens[0]).toMatchObject({ nome: "Fornecedor sintético · NF 42-TESTE", valor: 256000, vinculos: { pagamentos: 1, boletos: 0, baixas: 0 } });
    await excluirTitulosLote(db, "PAGAR", previa.itens, "Nota duplicada conferida", ator);
    expect(await retrato()).toEqual(antes);
    const lixeira = await previaGovernanca(db, "TITULO", "BRISA:PAGAR:nota");
    expect(lixeira).toMatchObject({ status: "EXCLUIDO", vinculos: { pagamentos: 1, rateios: 2 } });
    await restaurarRecurso(db, "TITULO", "BRISA:PAGAR:nota", "Restaurar a nota", { ...ator, administrador: true, assinaturaPrevia: lixeira.assinatura });
    expect(await retrato()).toEqual(antes);
    expect((await previaGovernanca(db, "TITULO", "BRISA:PAGAR:nota")).status).toBe("ATIVO");
  });

  it("não trata o overlay de uma nota Widesys como título nativo independente", async () => {
    await notaComRateio("WIDESYS:PAGAR:externa");
    await expect(previaExclusaoTitulosLote(db, "PAGAR", ["BRISA:PAGAR:nota"], ator)).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
    await expect(previaGovernanca(db, "TITULO", "BRISA:PAGAR:nota")).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
    expect(await db.recursoGovernado.count()).toBe(0);
  });

  it("mudança no PIX ou versão da nota invalida a prévia de exclusão antes de escrever", async () => {
    await notaComRateio();
    const previa = await previaExclusaoTitulosLote(db, "PAGAR", ["BRISA:PAGAR:nota"], ator);
    await db.lancamentoCaixa.update({ where: { id: "pix-nota" }, data: { valor: 200000 } });
    await expect(excluirTitulosLote(db, "PAGAR", previa.itens, "Nota duplicada conferida", ator)).rejects.toMatchObject({ codigo: "PREVIA_DESATUALIZADA" });
    expect(await db.recursoGovernado.count()).toBe(0);
  });

  it("retira somente os IDs explícitos, preserva fatos e permite restaurar pela lixeira existente", async () => {
    const antes = await fatos();
    const itens = await confirmar();
    const resultado = await excluirTitulosLote(db, "RECEBER", itens, "Duplicatas conferidas", ator);
    expect(resultado).toEqual({ excluidos: [chave("r1"), chave("r2")], jaExcluidos: [] });
    expect(await fatos()).toEqual(antes);
    expect(await db.recursoGovernado.count()).toBe(2);
    expect(await db.eventoGovernanca.count()).toBe(2);
    const previa = await previaGovernanca(db, "TITULO", chave("r1"));
    await restaurarRecurso(db, "TITULO", chave("r1"), "Restaurar teste", { ...ator, administrador: true, assinaturaPrevia: previa.assinatura });
    expect((await db.recursoGovernado.findUniqueOrThrow({ where: { tipo_origemId: { tipo: "TITULO", origemId: chave("r1") } } })).status).toBe("ATIVO");
    expect(await fatos()).toEqual(antes);
  });

  it("repetir a confirmação é idempotente e não duplica eventos", async () => {
    const itens = await confirmar();
    await excluirTitulosLote(db, "RECEBER", itens, "Duplicatas conferidas", ator);
    expect(await excluirTitulosLote(db, "RECEBER", itens, "Duplicatas conferidas", ator)).toEqual({ excluidos: [], jaExcluidos: [chave("r1"), chave("r2")] });
    expect(await db.eventoGovernanca.count()).toBe(2);
  });

  it("um registro alterado invalida o lote inteiro antes de escrever", async () => {
    const itens = await confirmar();
    await db.recebimento.update({ where: { id: "r2" }, data: { valor: 99999 } });
    await expect(excluirTitulosLote(db, "RECEBER", itens, "Duplicatas conferidas", ator)).rejects.toMatchObject({ codigo: "PREVIA_DESATUALIZADA" });
    expect(await db.recursoGovernado.count()).toBe(0);
    expect(await db.eventoGovernanca.count()).toBe(0);
  });

  it("novo pagamento posterior à prévia exige reconferência", async () => {
    const itens = await confirmar();
    await db.pagamentoRecebimento.create({ data: { recebimentoId: "r1", chaveIdempotencia: "pg1", valor: 1500, dataPagamento: "2026-10-22" } });
    await expect(excluirTitulosLote(db, "RECEBER", itens, "Duplicatas conferidas", ator)).rejects.toMatchObject({ codigo: "PREVIA_DESATUALIZADA" });
    expect(await db.recursoGovernado.count()).toBe(0);
  });

  it("atualiza overlays anteriores em lote e restaura exatamente a situação anterior", async () => {
    await db.recursoGovernado.create({ data: { id: "overlay", tipo: "TITULO", origemId: chave("r1"), status: "DESCARTADO", destinoId: chave("r3"), motivo: "Decisão anterior", autorId: "admin", estadoAnterior: "{}", versao: 4 } });
    await excluirTitulosLote(db, "RECEBER", await confirmar(), "Duplicatas conferidas", ator);
    const r = await db.recursoGovernado.findUniqueOrThrow({ where: { id: "overlay" } });
    expect(r.status).toBe("EXCLUIDO");
    expect(r.versao).toBe(5);
    expect(JSON.parse(r.estadoAnterior).anterior).toEqual({ status: "DESCARTADO", destinoId: chave("r3"), motivo: "Decisão anterior", estadoAnterior: "{}" });
    const previa = await previaGovernanca(db, "TITULO", chave("r1"));
    await restaurarRecurso(db, "TITULO", chave("r1"), "Restaurar anterior", { ...ator, administrador: true, assinaturaPrevia: previa.assinatura });
    expect((await db.recursoGovernado.findUniqueOrThrow({ where: { id: "overlay" } })).status).toBe("DESCARTADO");
  });

  it("falha na auditoria desfaz todas as exclusões", async () => {
    const itens = await confirmar();
    await db.$executeRawUnsafe(`CREATE TRIGGER falha_auditoria BEFORE INSERT ON EventoGovernanca BEGIN SELECT RAISE(ABORT, 'falha-sintetica'); END`);
    await expect(excluirTitulosLote(db, "RECEBER", itens, "Duplicatas conferidas", ator)).rejects.toThrow();
    expect(await db.recursoGovernado.count()).toBe(0);
    expect(await db.eventoGovernanca.count()).toBe(0);
  });

  it.each(["FINANCEIRO", "CONTABILIDADE", "SOCIO", "CONSULTA"])("prévia e exclusão rejeitam perfil %s mesmo com permissões extras", async perfil => {
    const itens = await confirmar();
    await db.usuario.update({ where: { id: "admin" }, data: { perfil, acessoGlobal: true, permissoesExtras: '["governanca.editar"]' } });
    await expect(previaExclusaoTitulosLote(db, "RECEBER", [chave("r1")], ator)).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    await expect(excluirTitulosLote(db, "RECEBER", itens, "Duplicatas conferidas", ator)).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
  });

  it("revalida o administrador que foi desativado após a prévia", async () => {
    const itens = await confirmar();
    await db.usuario.update({ where: { id: "admin" }, data: { ativo: false } });
    await expect(excluirTitulosLote(db, "RECEBER", itens, "Duplicatas conferidas", ator)).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    expect(await db.recursoGovernado.count()).toBe(0);
  });

  it.each([
    [[], "LIMITE_LOTE"], [[chave("r1"), chave("r1")], "SELECAO_REPETIDA"],
    [["BRISA:PAGAR:r1"], "IDENTIDADE_INVALIDA"], [["BRISA:RECEBER:r1:extra"], "IDENTIDADE_INVALIDA"],
    [[chave("ausente")], "NAO_ENCONTRADO"], [Array.from({ length: 101 }, (_, i) => chave(String(i))), "LIMITE_LOTE"],
  ])("recusa seleção inválida sem escrever (%j)", async (ids, codigo) => {
    await expect(previaExclusaoTitulosLote(db, "RECEBER", ids, ator)).rejects.toMatchObject({ codigo });
    expect(await db.recursoGovernado.count()).toBe(0);
  });

  it("preserva contas a pagar Widesys, inclusive baixas, ao excluir do Brisa", async () => {
    await db.tituloFinanceiroLegado.create({ data: { id: "legado", origem: "WIDESYS", escopo: "TITULO_PAGAR", legadoId: "123", ultimoItemId: "item-sintetico", natureza: "PAGAR", situacaoNormalizada: "PAGO", valorDevido: 12345, valorPago: 12345, capturadoEm: new Date(), snapshot: "{}", snapshotHash: "hash-sintetico" } });
    await db.baixaFinanceiraLegado.create({ data: { origem: "WIDESYS", escopo: "BAIXA_PAGAR", legadoId: "456", ultimoItemId: "baixa-sintetica", natureza: "PAGAMENTO", tituloEscopo: "TITULO_PAGAR", tituloLegadoId: "123", valor: 12345, capturadoEm: new Date(), snapshot: "{}", snapshotHash: "hash-sintetico" } });
    const antes = await fatos();
    const previa = await previaExclusaoTitulosLote(db, "PAGAR", ["WIDESYS:PAGAR:legado"], ator);
    expect(previa.itens[0].vinculos.baixas).toBe(1);
    expect(previa.itens[0].valor).toBe(12345);
    await excluirTitulosLote(db, "PAGAR", previa.itens, "Duplicata conferida", ator);
    expect(await fatos()).toEqual(antes);
    expect(await db.baixaFinanceiraLegado.count()).toBe(1);
    await expect(previaExclusaoTitulosLote(db, "RECEBER", ["WIDESYS:RECEBER:legado"], ator)).rejects.toMatchObject({ codigo: "NAO_ENCONTRADO" });
  });

  it("confere e exclui 100 títulos com consultas agrupadas, sem N+1 ou motor de reconciliação", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `volume-${i}`);
    await db.recebimento.createMany({ data: ids.map(id => ({ id, contratoId: "contrato", empreendimentoId: "emp", mesLancamento: "2026-10", competencia: "2026-10", valor: 100 })) });
    consultas = [];
    const previa = await previaExclusaoTitulosLote(db, "RECEBER", ids.map(chave), ator);
    expect(consultas.length).toBeLessThanOrEqual(15);
    consultas = [];
    const resultado = await excluirTitulosLote(db, "RECEBER", previa.itens, "Duplicatas do lote sintético", ator);
    expect(resultado.excluidos).toHaveLength(100);
    expect(consultas.length).toBeLessThanOrEqual(22);
    expect(consultas.join(" ")).not.toContain("UnificacaoRegistro");
    expect(await db.eventoGovernanca.count()).toBe(100);
  });

  it("permite retirar natureza inconsistente exibida pela lista a receber", async () => {
    await db.tituloFinanceiroLegado.create({ data: { id: "inconsistente", origem: "WIDESYS", escopo: "TITULO_RECEBER", legadoId: "999", ultimoItemId: "item-999", natureza: "DESCONHECIDA", situacaoNormalizada: "DESCONHECIDO", statusImportacao: "QUARENTENA", capturadoEm: new Date(), snapshot: "{}", snapshotHash: "inconsistente" } });
    const previa = await previaExclusaoTitulosLote(db, "RECEBER", ["WIDESYS:RECEBER:inconsistente"], ator);
    expect((await excluirTitulosLote(db, "RECEBER", previa.itens, "Dado inconsistente conferido", ator)).excluidos).toEqual(["WIDESYS:RECEBER:inconsistente"]);
    const restauracao = await previaGovernanca(db, "TITULO", "WIDESYS:RECEBER:inconsistente");
    await restaurarRecurso(db, "TITULO", "WIDESYS:RECEBER:inconsistente", "Restaurar inconsistência", { ...ator, administrador: true, assinaturaPrevia: restauracao.assinatura });
    expect((await db.recursoGovernado.findUniqueOrThrow({ where: { tipo_origemId: { tipo: "TITULO", origemId: "WIDESYS:RECEBER:inconsistente" } } })).status).toBe("ATIVO");
  });

  it("confere o mesmo inquilino e imóvel da lista sem substituir devido ausente pelo original", async () => {
    await criarTituloComReferencias();
    const previa = await previaExclusaoTitulosLote(db, "RECEBER", ["WIDESYS:RECEBER:titulo-referencia"], ator);
    expect(previa.itens[0].nome).toBe("Inquilino pelo contrato · titulo-externo · a receber");
    expect(previa.itens[0].referencia).toContain("SALA REF 100 · Aluguel");
    expect(previa.itens[0].valor).toBeNull();
    expect(JSON.stringify(previa)).not.toContain("99999");
    expect(JSON.stringify(previa)).not.toContain("Não usar esta pessoa");
  });

  it.each(["nome", "referencia", "parte"])("mudança de %s após a prévia exige reconferir o título ligado ao contrato", async campo => {
    await criarTituloComReferencias();
    const chaves = ["WIDESYS:RECEBER:titulo-referencia"];
    const antes = await previaExclusaoTitulosLote(db, "RECEBER", chaves, ator);
    if (campo === "nome") await db.pessoa.update({ where: { id: "pessoa-legado" }, data: { nome: "Nome conferido depois" } });
    if (campo === "referencia") await db.imovelLegado.update({ where: { id: "imovel-legado" }, data: { referencia: "SALA REF 200" } });
    if (campo === "parte") await db.contratoParteLegado.update({ where: { id: "parte-valida" }, data: { pessoaLegadoId: "pessoa-ignorada" } });
    const depois = await previaExclusaoTitulosLote(db, "RECEBER", chaves, ator);
    expect(depois.itens[0].assinatura).not.toBe(antes.itens[0].assinatura);
    await expect(excluirTitulosLote(db, "RECEBER", antes.itens, "Duplicata conferida anteriormente", ator)).rejects.toMatchObject({ codigo: "PREVIA_DESATUALIZADA" });
    expect(await db.recursoGovernado.count()).toBe(0);
  });

  it("resolve referências de 100 títulos Widesys em consultas agrupadas", async () => {
    const titulo = await criarTituloComReferencias();
    const ids = Array.from({ length: 100 }, (_, i) => `legado-volume-${i}`);
    await db.tituloFinanceiroLegado.createMany({ data: ids.map(id => ({ ...titulo, id, legadoId: id, ultimoItemId: `item-${id}` })) });
    consultas = [];
    const previa = await previaExclusaoTitulosLote(db, "RECEBER", ids.map(id => `WIDESYS:RECEBER:${id}`), ator);
    expect(previa.itens).toHaveLength(100);
    expect(previa.itens.every(i => i.nome.startsWith("Inquilino pelo contrato") && i.referencia?.includes("SALA REF 100"))).toBe(true);
    expect(consultas.length).toBeLessThanOrEqual(17);
    consultas = [];
    const resultado = await excluirTitulosLote(db, "RECEBER", previa.itens, "Duplicatas legadas conferidas", ator);
    expect(resultado.excluidos).toHaveLength(100);
    expect(consultas.length).toBeLessThanOrEqual(22);
    expect(consultas.join(" ")).not.toContain("UnificacaoRegistro");
  });
});
