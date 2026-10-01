import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { PrismaClient, type LancamentoCaixa } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { carregarPlanilhasFinanceiras, hashConteudoCaixa, planejarLinhaPlanilha, type ContextoCarga } from "./planilhas-financeiras";
import type { RegistroPlanilhaFinanceira, ResultadoPlanilhaFinanceira } from "./planilhas-financeiras-parser";
import { carregarDadosFontesUnificacao, type BancoUnificacao } from "../unificacao/fontes";

const datasetVazio = { recebimentos: [], livro_caixa: {} };
const opcoes = { hoje: "2026-10-01", dataset: datasetVazio };

function registro(alteracoes: Partial<RegistroPlanilhaFinanceira> = {}): RegistroPlanilhaFinanceira {
  return { origemArquivo: "GASTOS BRISA AZUL.xlsx", hashArquivo: "a".repeat(64), aba: "Plan1", linha: 10,
    faixa: "SAIDA", celulas: "A10:E10", mesReferencia: "2026-09", data: "2026-09-10", centroCusto: "BRISA",
    caixaOrigem: "GASTOS_BRISA:Plan1", tipo: "SAIDA", valor: 12345, descricao: "Manutenção artificial",
    cliente: null, local: null, categoria: "SERVIÇO", motivos: [], status: "PRONTO", sourceJSON: "{}", ...alteracoes };
}
function arquivo(registros = [registro()], hashArquivo = registros[0]?.hashArquivo ?? "a".repeat(64)): ResultadoPlanilhaFinanceira {
  return { origemArquivo: "GASTOS BRISA AZUL.xlsx", hashArquivo, tipoArquivo: "GASTOS_BRISA",
    registros: registros.map(r => ({ ...r, hashArquivo })), controles: [], avisos: [] };
}
function caixa(r = registro(), id = "caixa-artificial"): LancamentoCaixa {
  return { id, mesReferencia: r.mesReferencia!, data: r.data, centroCusto: r.centroCusto, caixaOrigem: r.caixaOrigem,
    tipo: r.tipo, valor: r.valor!, descricao: r.descricao, categoria: r.categoria, cliente: r.cliente, local: r.local };
}
function contexto(alteracoes: Partial<ContextoCarga> = {}): ContextoCarga {
  return { caixa: [], anteriores: [], legados: [], mesesFechados: new Set(), caixaComProvenienciaInicial: new Set(), hoje: opcoes.hoje, ...alteracoes };
}
function anterior(r: RegistroPlanilhaFinanceira, id: string | null) {
  return { hashConteudo: hashConteudoCaixa(caixa(r)), tipoArquivo: "GASTOS_BRISA", caixaOrigem: r.caixaOrigem,
    aba: r.aba, linha: r.linha, faixa: r.faixa, lancamentoCaixaId: id };
}

describe("planejamento conservador da carga financeira", () => {
  it("não deduplica lançamentos iguais de caixas explicitamente distintos", () => {
    const r = registro();
    const outro = registro({ aba: "ALIANA", caixaOrigem: "GASTOS_BRISA:ALIANA" });
    expect(planejarLinhaPlanilha(r, "GASTOS_BRISA", contexto({ caixa: [caixa(outro)] }), [r, outro]))
      .toMatchObject({ status: "IMPORTADO", motivos: [], candidatos: [] });
  });

  it("mantém repetições dentro do mesmo caixa fora da operação", () => {
    const r = registro();
    const plano = planejarLinhaPlanilha(r, "GASTOS_BRISA", contexto(), [r, registro({ linha: 11 })]);
    expect(plano).toMatchObject({ status: "PENDENTE", lancamentoCaixaId: null });
    expect(plano.motivos).toContain("CONTEUDO_REPETIDO_NA_CARGA");
  });

  it("nome, data e valor iguais não comprovam que o registro já existe", () => {
    const r = registro();
    const plano = planejarLinhaPlanilha(r, "GASTOS_BRISA", contexto({ caixa: [caixa(r)] }), [r]);
    expect(plano).toMatchObject({ status: "PENDENTE", lancamentoCaixaId: null, candidatos: ["BRISA:MOVIMENTO:caixa-artificial"] });
    expect(plano.motivos).toContain("POSSIVEL_DUPLICIDADE");
  });

  it("só reconhece JA_EXISTENTE com vínculo anterior e conteúdo atual íntegro", () => {
    const r = registro();
    const plano = planejarLinhaPlanilha(r, "GASTOS_BRISA", contexto({ caixa: [caixa(r)], anteriores: [anterior(r, "caixa-artificial")] }), [r]);
    expect(plano).toMatchObject({ status: "JA_EXISTENTE", lancamentoCaixaId: "caixa-artificial", motivos: ["PROVENIENCIA_ANTERIOR_CONFIRMADA"] });
  });

  it.each(["alterado", "removido"])("não recria destino anterior %s", situacao => {
    const r = registro();
    const atuais = situacao === "alterado" ? [caixa({ ...r, valor: 54321 })] : [];
    const plano = planejarLinhaPlanilha(r, "GASTOS_BRISA", contexto({ caixa: atuais, anteriores: [anterior(r, "caixa-artificial")] }), [r]);
    expect(plano.status).toBe("PENDENTE");
    expect(plano.motivos).toContain("DESTINO_ANTERIOR_ALTERADO_OU_AUSENTE");
  });

  it("sinaliza posição modificada sem atualizar o lançamento anterior", () => {
    const original = registro();
    const r = registro({ valor: 54321 });
    const plano = planejarLinhaPlanilha(r, "GASTOS_BRISA", contexto({ caixa: [caixa(original)], anteriores: [anterior(original, "caixa-artificial")] }), [r]);
    expect(plano.status).toBe("PENDENTE");
    expect(plano.motivos).toContain("POSICAO_DA_ORIGEM_ALTERADA");
  });

  it.each([
    ["comissão", { descricao: "Comissão administrativa artificial" }, "CONTEUDO_RESERVADO"],
    ["restrito", { status: "PENDENTE_RESERVADO" }, "CONTEUDO_RESERVADO"],
    ["futuro", { data: "2026-11-02", mesReferencia: "2026-11" }, "DATA_FUTURA_CONFERIR"],
    ["sem data", { data: null }, "DATA_NAO_COMPROVADA"],
    ["sem mês", { mesReferencia: null }, "MES_NAO_COMPROVADO"],
    ["valor inválido", { valor: 0 }, "VALOR_NAO_IMPORTAVEL"],
    ["limite Int32", { valor: 2147483648 }, "VALOR_NAO_IMPORTAVEL"],
    ["transferência", { descricao: "Transferência entre contas" }, "TRANSFERENCIA_OU_PATRIMONIO_CONFERIR"],
    ["previsão", { descricao: "Despesa a pagar" }, "REALIZACAO_NAO_COMPROVADA"],
    ["auxiliar", { status: "PENDENTE_AUXILIAR" }, "ABA_AUXILIAR_CONFERIR"],
  ] as Array<[string, Partial<RegistroPlanilhaFinanceira>, string]>)("preserva %s sem efeito financeiro", (_, alteracoes, motivo) => {
    const r = registro(alteracoes);
    const plano = planejarLinhaPlanilha(r, "GASTOS_BRISA", contexto(), [r]);
    expect(plano.status).toBe("PENDENTE");
    expect(plano.motivos).toContain(motivo);
  });

  it("não lança em mês fechado nem sobre movimento legado equivalente", () => {
    const r = registro();
    const c = contexto({ mesesFechados: new Set(["2026-09"]), legados: [{ chave: "WIDESYS:MOVIMENTO:artificial", data: r.data, mes: r.mesReferencia, valor: r.valor, tipo: r.tipo, descricao: "Outra descrição" }] });
    const plano = planejarLinhaPlanilha(r, "GASTOS_BRISA", c, [r]);
    expect(plano.status).toBe("PENDENTE");
    expect(plano.motivos).toEqual(expect.arrayContaining(["MES_FECHADO", "POSSIVEL_DUPLICIDADE"]));
    expect(plano.candidatos).toContain("WIDESYS:MOVIMENTO:artificial");
  });
});

describe("carga transacional em SQLite descartável", () => {
  let diretorio: string;
  let db: PrismaClient;
  const queries: string[] = [];

  beforeEach(async () => {
    diretorio = mkdtempSync(join(tmpdir(), "brisa-planilha-carga-"));
    const cliente = new PrismaClient({ datasourceUrl: `file:${join(diretorio, "fixture.db").replaceAll("\\", "/")}`, log: [{ emit: "event", level: "query" }] });
    cliente.$on("query", e => queries.push(e.query));
    db = cliente;
    // Apenas as tabelas utilizadas neste serviço, sem acesso ao DATABASE_URL real.
    const tabelas = [
      `CREATE TABLE LancamentoCaixa (id TEXT PRIMARY KEY, mesReferencia TEXT NOT NULL, centroCusto TEXT NOT NULL, tipo TEXT NOT NULL, categoria TEXT, data TEXT, valor INTEGER NOT NULL, descricao TEXT, cliente TEXT, local TEXT, caixaOrigem TEXT)`,
      `CREATE TABLE ImportacaoPlanilhaLote (id TEXT PRIMARY KEY, arquivo TEXT NOT NULL, hashArquivo TEXT NOT NULL, tipoArquivo TEXT NOT NULL, versao TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'CONCLUIDO', resumo TEXT NOT NULL DEFAULT '{}', controles TEXT NOT NULL DEFAULT '[]', avisos TEXT NOT NULL DEFAULT '[]', criadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(hashArquivo,versao))`,
      `CREATE TABLE ImportacaoPlanilhaLinha (id TEXT PRIMARY KEY, loteId TEXT NOT NULL, aba TEXT NOT NULL, linha INTEGER NOT NULL, faixa TEXT NOT NULL, celulas TEXT NOT NULL, hashConteudo TEXT NOT NULL, mesReferencia TEXT, data TEXT, centroCusto TEXT NOT NULL, caixaOrigem TEXT NOT NULL, tipo TEXT NOT NULL, valor INTEGER, descricao TEXT, categoria TEXT, cliente TEXT, local TEXT, status TEXT NOT NULL, reservado BOOLEAN NOT NULL DEFAULT false, motivos TEXT NOT NULL DEFAULT '[]', candidatos TEXT NOT NULL DEFAULT '[]', origemDados TEXT NOT NULL, lancamentoCaixaId TEXT, criadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(loteId,aba,linha,faixa), FOREIGN KEY(loteId) REFERENCES ImportacaoPlanilhaLote(id) ON DELETE RESTRICT, FOREIGN KEY(lancamentoCaixaId) REFERENCES LancamentoCaixa(id) ON DELETE SET NULL)`,
      `CREATE TABLE MovimentoFinanceiroLegado (id TEXT PRIMARY KEY, origem TEXT, dataMovimento TEXT, competencia TEXT, valor INTEGER, natureza TEXT, descricao TEXT)`,
      `CREATE TABLE PagamentoRecebimento (id TEXT PRIMARY KEY, status TEXT, dataPagamento TEXT, valor INTEGER)`,
      `CREATE TABLE FechamentoMensal (id TEXT PRIMARY KEY, mesLancamento TEXT)`,
    ];
    for (const sql of tabelas) await db.$executeRawUnsafe(sql);
    queries.length = 0;
  });

  afterEach(async () => {
    await db?.$disconnect();
    if (!diretorio) return;
    const alvo = resolve(diretorio);
    const raizTemporaria = `${resolve(tmpdir())}${sep}`.toLowerCase();
    if (alvo.toLowerCase().startsWith(raizTemporaria) && basename(alvo).startsWith("brisa-planilha-carga-")) rmSync(alvo, { recursive: true, force: true });
  });

  it("dry-run calcula o plano sem INSERT, UPDATE ou DELETE", async () => {
    const resultado = await carregarPlanilhasFinanceiras(db, [arquivo()], opcoes);
    expect(resultado).toMatchObject({ modo: "PREVIA", arquivos: [{ loteId: null, repetido: false, resumo: { importados: 1, pendentes: 0 } }] });
    expect(queries.some(q => /^\s*(INSERT|UPDATE|DELETE)/i.test(q))).toBe(false);
    expect(await db.lancamentoCaixa.count()).toBe(0);
    expect(await db.importacaoPlanilhaLote.count()).toBe(0);
    expect(await db.importacaoPlanilhaLinha.count()).toBe(0);
  });

  it("aplica uma vez e repete sem duplicar valores, lote ou linha", async () => {
    const a = arquivo();
    const primeira = await carregarPlanilhasFinanceiras(db, [a], { ...opcoes, aplicar: true });
    const segunda = await carregarPlanilhasFinanceiras(db, [a], { ...opcoes, aplicar: true });
    expect(primeira.arquivos[0].resumo).toMatchObject({ importados: 1 });
    expect(segunda.arquivos[0]).toMatchObject({ repetido: true, loteId: primeira.arquivos[0].loteId });
    expect(await db.lancamentoCaixa.count()).toBe(1);
    expect(await db.importacaoPlanilhaLote.count()).toBe(1);
    expect(await db.importacaoPlanilhaLinha.count()).toBe(1);
  });

  it("fotografia unificada lê proveniência vinculada em Prisma/SQLite real sem relação reversa", async () => {
    await carregarPlanilhasFinanceiras(db, [arquivo()], { ...opcoes, aplicar: true });
    // As demais fontes não pertencem a este fixture; os dois delegates sob
    // regressão usam o engine real e uma linha vinculada, que causava panic.
    const tabelasVazias = Object.fromEntries([
      "locatario", "pessoa", "unidade", "imovelLegado", "contrato", "contratoLegado",
      "recebimento", "tituloFinanceiroLegado", "pagamentoRecebimento", "baixaFinanceiraLegado",
      "movimentoFinanceiroLegado", "catalogoLegadoRegistro",
    ].map(nome => [nome, { findMany: async () => [] }]));
    const banco = { ...tabelasVazias, lancamentoCaixa: db.lancamentoCaixa, importacaoPlanilhaLinha: db.importacaoPlanilhaLinha } as unknown as BancoUnificacao;
    const foto = await carregarDadosFontesUnificacao(banco);
    expect(foto.caixa).toHaveLength(1);
    expect(foto.caixa[0].importacoesPlanilha).toEqual([expect.objectContaining({
      lancamentoCaixaId: foto.caixa[0].id, aba: "Plan1", linha: 10,
      lote: { arquivo: "GASTOS BRISA AZUL.xlsx", hashArquivo: "a".repeat(64) },
    })]);
  });

  it("arquivo revisado reconhece prova anterior sem copiar o movimento", async () => {
    await carregarPlanilhasFinanceiras(db, [arquivo()], { ...opcoes, aplicar: true });
    const resultado = await carregarPlanilhasFinanceiras(db, [arquivo([registro()], "b".repeat(64))], { ...opcoes, aplicar: true });
    expect(resultado.arquivos[0].resumo).toMatchObject({ importados: 0, existentes: 1 });
    expect(await db.lancamentoCaixa.count()).toBe(1);
    expect(await db.importacaoPlanilhaLinha.count({ where: { status: "JA_EXISTENTE" } })).toBe(1);
  });

  it("dataset inicial só prova CONTA ACAMARGO, não uma caixa GASTOS semelhante", async () => {
    const r = registro({ origemArquivo: "CONTA ACAMARGO.xlsx", aba: "SETEMBRO 2026", centroCusto: "AL", caixaOrigem: "CONTA_ACAMARGO" });
    await db.lancamentoCaixa.create({ data: { ...caixa(r), caixaOrigem: null } });
    const dataset = { recebimentos: [], livro_caixa: { "SETEMBRO 2026": {
      saida_ac: [{ linha: 10, secao: r.categoria, data: r.data, valor: r.valor! / 100, descricao: r.descricao }],
      saida_ch: [], entrada: [], receb_dinheiro: [],
    } } };
    const a = { ...arquivo([r]), tipoArquivo: "CONTA_ACAMARGO" as const };
    const resultado = await carregarPlanilhasFinanceiras(db, [a], { ...opcoes, dataset, aplicar: true });
    expect(resultado.arquivos[0].resumo).toMatchObject({ importados: 0, existentes: 1 });
    expect(await db.lancamentoCaixa.count()).toBe(1);
    const outroCaixa = registro({ centroCusto: "AL" });
    const distinto = await carregarPlanilhasFinanceiras(db, [arquivo([outroCaixa], "d".repeat(64))], { ...opcoes, dataset, aplicar: true });
    expect(distinto.arquivos[0].resumo).toMatchObject({ importados: 1, existentes: 0 });
    expect(await db.lancamentoCaixa.count()).toBe(2);
  });

  it("baixa bancária ou movimento Widesys equivalente exige conferência", async () => {
    await db.$executeRaw`INSERT INTO MovimentoFinanceiroLegado (id,origem,dataMovimento,competencia,valor,natureza,descricao) VALUES ('movimento-artificial','WIDESYS','2026-09-10','2026-09',12345,'SAIDA','Pagamento artificial')`;
    await db.$executeRaw`INSERT INTO PagamentoRecebimento (id,status,dataPagamento,valor) VALUES ('baixa-artificial','CONFIRMADO','2026-09-11',20000)`;
    const a = arquivo([registro(), registro({ linha: 11, tipo: "ENTRADA", centroCusto: "GERAL", data: "2026-09-11", valor: 20000 })]);
    const resultado = await carregarPlanilhasFinanceiras(db, [a], { ...opcoes, aplicar: true });
    expect(resultado.arquivos[0].resumo).toMatchObject({ importados: 0, pendentes: 2, motivos: { POSSIVEL_DUPLICIDADE: 2 } });
    expect(await db.lancamentoCaixa.count()).toBe(0);
    const linhas = await db.importacaoPlanilhaLinha.findMany({ orderBy: { linha: "asc" } });
    expect(JSON.parse(linhas[0].candidatos)).toContain("WIDESYS:MOVIMENTO:movimento-artificial");
    expect(JSON.parse(linhas[1].candidatos)).toContain("BRISA:BAIXA_RECEBER:baixa-artificial");
  });

  it("preserva quatro caixas independentes e reexecuta sem duplicar", async () => {
    const rs = ["Plan1", "Plan3", "Plan4", "ALIANA"].map(aba => registro({ aba, caixaOrigem: `GASTOS_BRISA:${aba}` }));
    const a = arquivo(rs);
    const previa = await carregarPlanilhasFinanceiras(db, [a], opcoes);
    const aplicado = await carregarPlanilhasFinanceiras(db, [a], { ...opcoes, aplicar: true });
    expect(aplicado.arquivos[0].resumo).toEqual(previa.arquivos[0].resumo);
    expect(aplicado.arquivos[0].resumo).toMatchObject({ importados: 4 });
    await carregarPlanilhasFinanceiras(db, [a], { ...opcoes, aplicar: true });
    expect(await db.lancamentoCaixa.count()).toBe(4);
  });

  it("repetições da mesma caixa ficam no staging", async () => {
    const a = arquivo([registro(), registro({ linha: 11 })]);
    const resultado = await carregarPlanilhasFinanceiras(db, [a], { ...opcoes, aplicar: true });
    expect(resultado.arquivos[0].resumo).toMatchObject({ importados: 0, pendentes: 2 });
    expect(await db.lancamentoCaixa.count()).toBe(0);
    expect(await db.importacaoPlanilhaLinha.count()).toBe(2);
  });

  it.each(["alterado", "removido"])("arquivo novo não recria lançamento %s no Brisa", async situacao => {
    await carregarPlanilhasFinanceiras(db, [arquivo()], { ...opcoes, aplicar: true });
    const c = await db.lancamentoCaixa.findFirstOrThrow();
    if (situacao === "alterado") await db.lancamentoCaixa.update({ where: { id: c.id }, data: { valor: 54321 } });
    else await db.lancamentoCaixa.delete({ where: { id: c.id } });
    const resultado = await carregarPlanilhasFinanceiras(db, [arquivo([registro()], "c".repeat(64))], { ...opcoes, aplicar: true });
    expect(resultado.arquivos[0].resumo).toMatchObject({ importados: 0, pendentes: 1, motivos: { DESTINO_ANTERIOR_ALTERADO_OU_AUSENTE: 1 } });
    expect(await db.lancamentoCaixa.count()).toBe(situacao === "alterado" ? 1 : 0);
  });

  it("linhas reservadas, futuras e fechadas permanecem fora da operação", async () => {
    await db.$executeRaw`INSERT INTO FechamentoMensal (id,mesLancamento) VALUES ('fechado-artificial','2026-08')`;
    const a = arquivo([
      registro({ linha: 10, descricao: "Comissão artificial" }),
      registro({ linha: 11, data: "2026-11-02", mesReferencia: "2026-11" }),
      registro({ linha: 12, data: "2026-08-02", mesReferencia: "2026-08" }),
    ]);
    const resultado = await carregarPlanilhasFinanceiras(db, [a], { ...opcoes, aplicar: true });
    expect(resultado.arquivos[0].resumo).toMatchObject({ importados: 0, pendentes: 3, reservados: 1 });
    expect(await db.lancamentoCaixa.count()).toBe(0);
    expect(await db.importacaoPlanilhaLinha.count({ where: { reservado: true } })).toBe(1);
  });

  it("valor fora de Int32 é preservado em origemDados sem abortar o lote", async () => {
    const valorOriginal = 2147483648;
    const a = arquivo([registro({ valor: valorOriginal, sourceJSON: JSON.stringify({ valor: valorOriginal }) })]);
    const resultado = await carregarPlanilhasFinanceiras(db, [a], { ...opcoes, aplicar: true });
    expect(resultado.arquivos[0].resumo).toMatchObject({ importados: 0, pendentes: 1, motivos: { VALOR_NAO_IMPORTAVEL: 1 } });
    const linha = await db.importacaoPlanilhaLinha.findFirstOrThrow();
    expect(linha.valor).toBeNull();
    expect(JSON.parse(linha.origemDados)).toEqual({ valor: valorOriginal });
    expect(await db.lancamentoCaixa.count()).toBe(0);
  });

  it("pendência sem destino anterior não impede nova captura válida", async () => {
    const r = registro({ data: "2026-11-02", mesReferencia: "2026-11" });
    const primeira = await carregarPlanilhasFinanceiras(db, [arquivo([r])], { ...opcoes, aplicar: true });
    expect(primeira.arquivos[0].resumo).toMatchObject({ importados: 0, pendentes: 1 });
    const segunda = await carregarPlanilhasFinanceiras(db, [arquivo([r], "f".repeat(64))], { ...opcoes, hoje: "2026-11-05", aplicar: true });
    expect(segunda.arquivos[0].resumo).toMatchObject({ importados: 1, pendentes: 0 });
    expect(await db.lancamentoCaixa.count()).toBe(1);
    expect(await db.importacaoPlanilhaLinha.count({ where: { status: "PENDENTE" } })).toBe(1);
  });

  it("desfaz toda a transação se houver coordenada repetida no lote", async () => {
    const a = arquivo([registro(), registro({ valor: 54321, descricao: "Outro serviço artificial" })]);
    await expect(carregarPlanilhasFinanceiras(db, [a], { ...opcoes, aplicar: true })).rejects.toThrow();
    expect(await db.lancamentoCaixa.count()).toBe(0);
    expect(await db.importacaoPlanilhaLote.count()).toBe(0);
    expect(await db.importacaoPlanilhaLinha.count()).toBe(0);
  });
});
