import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  carregarDadosFontesUnificacao, carregarFontesUnificacao, derivarFontesUnificacao, hashUnificacao,
  type BancoUnificacao, type DadosFontesUnificacao,
} from "./fontes";
import { chavesRestritasUnificacao } from "./privacidade";
import { projetarFinanceiroWidesys } from "./projecao-widesys";

vi.mock("node:fs", () => ({ existsSync: vi.fn(), readFileSync: vi.fn() }));

// Dados inteiramente artificiais: cada campo usado pela projeção recebe valor
// para uma omissão em select não passar despercebida como null/undefined.
const dados: DadosFontesUnificacao = {
  despesas: [], caixasDespesasGovernados: [], caixasDespesasDecisoes: [], recebimentosWidesysLocais: [],
  locatarios: [{ id: "loc", nome: "Inquilino sintético", cpfCnpj: "00000000000", pessoaId: "pessoa",
    email: "inquilino@example.test", telefone: "62900000000", contato: "Contato sintético",
    endereco: "Rua de teste", numeroEndereco: "10", bairro: "Bairro", cidade: "Goiânia", uf: "GO", cep: "74000000" }],
  pessoas: [{ id: "pessoa", legadoId: "1", nome: "Inquilino legado", cpfCnpj: "00000000000",
    endereco: "Rua de teste", numeroEndereco: "10", bairro: "Bairro", cidade: "Goiânia", uf: "GO", cep: "74000000",
    papeis: [{ papel: "INQUILINO" }], emails: [{ email: "legado@example.test" }], telefones: [{ telefone: "62900000001" }] }],
  unidades: [{ id: "unidade", identificacao: "101", tipo: "APARTAMENTO", ativo: true, empreendimento: { nome: "Empreendimento sintético" } }],
  imoveis: [{ id: "imovel", legadoId: "2", nome: "Imóvel legado", referencia: "IM-2", empreendimentoNome: "Prédio legado",
    endereco: "Rua do imóvel", numeroEndereco: "11", tipo: "Apartamento", cidade: "Goiânia", uf: "GO",
    valorLocacao: 100000, valorIptu: 1000, valorCondominio: 2000 }],
  contratos: [{ id: "contrato", locatarioId: "loc", unidadeId: "unidade", valorBase: 100000,
    inicio: "2026-01-01", fim: "2027-01-01", iptu: 1000, condominio: 2000, status: "ativo", observacao: "Contrato sintético",
    locatario: { nome: "Inquilino sintético" }, unidade: { identificacao: "101", empreendimento: { nome: "Empreendimento sintético" } } }],
  contratosLegados: [{ id: "contrato-legado", legadoId: "3", imovelLegadoId: "2", numeroContrato: "CT-3",
    statusImportacao: "STAGING", quarentenaMotivo: null, valorLocacao: 100000, valorAdministracao: 10000,
    inicio: "2026-01-01", fim: "2027-01-01", situacaoOrigem: "Ativo",
    partes: [{ papel: "INQUILINO", pessoaLegadoId: "1", statusImportacao: "STAGING" }] }],
  recebimentos: [{ id: "recebimento", contratoId: "contrato", valor: 100000, iptu: 1000, cond: 2000,
    recebido: 103000, competencia: "2026-06", mesLancamento: "2026-06", dataPagamento: "2026-06-12",
    criadoManualBrisa: false, vencimentoManual: null,
    taxaComissaoBps: 1000, observacao: "Observação sintética", origemAgregada: false, via: "PIX",
    empreendimento: { nome: "Empreendimento sintético" },
    contrato: { diaVencimento: 15, locatarioId: "loc", unidadeId: "unidade", locatario: { nome: "Inquilino sintético" }, unidade: { identificacao: "101" } } }],
  titulos: [{ id: "titulo", legadoId: "4", escopo: "TITULO_RECEBER", natureza: "RECEBER", pessoaLegadoId: "1",
    contratoLegadoId: "3", tipoCobrancaRotulo: "Aluguel", planoContaRotulo: "Locação", statusImportacao: "STAGING",
    quarentenaMotivo: null, competencia: "2026-06-01", vencimento: "2026-06-15", pagamento: "2026-06-12",
    valorDevido: 103000, valorPago: 50000, valorAberto: 53000, situacaoNormalizada: "PARCIAL",
    numeroDocumento: "DOC-4", parcela: "1", contaBancariaRotulo: "Conta sintética" }],
  pagamentos: [{ id: "pagamento", forma: "PIX", status: "CONFIRMADO", recebimentoId: "recebimento",
    dataPagamento: "2026-06-12", valor: 103000, identificadorBanco: "ID-TESTE" }],
  baixas: [{ id: "baixa", legadoId: "5", tituloEscopo: "TITULO_RECEBER", tituloLegadoId: "4", escopo: "BAIXA_RECEBER",
    forma: "PIX", statusImportacao: "STAGING", quarentenaMotivo: null, valor: 50000, dataPagamento: "2026-06-12",
    estornada: false, contaBancariaRotulo: "Conta sintética", movimentoLegadoId: "6", importadoEm: new Date("2026-06-13T00:00:00Z") }],
  caixa: [{ id: "caixa", mesReferencia: "2026-06", centroCusto: "AL", tipo: "SAIDA", categoria: "Manutenção",
    criadoManualBrisa: false, recebimentoManualId: null,
    data: "2026-06-04", valor: 2000, descricao: "Teste de caixa", cliente: null, local: null, caixaOrigem: null, importacoesPlanilha: [] }],
  movimentos: [{ id: "movimento", legadoId: "6", tituloEscopo: "TITULO_RECEBER", tituloLegadoId: "4",
    descricao: "Entrada sintética", planoContaRotulo: "Locação", contaBancariaRotulo: "Conta sintética",
    statusImportacao: "STAGING", quarentenaMotivo: null, dataMovimento: "2026-06-12", competencia: "2026-06-01",
    natureza: "ENTRADA", valor: 50000, documento: "DOC-6", importadoEm: new Date("2026-06-13T00:00:00Z") }],
  parametros: [{ id: "parametro", modulo: "CATEGORIAS", legadoId: "7", titulo: "Categoria", label: "Locação",
    status: "STAGING", quarentenaMotivo: null }],
};

const dataset = {
  origem: { relatorio: "fixture-recebimentos.xlsx", conta_ac: "fixture-caixa.xlsx" },
  recebimentos: [{ empreendimento: "Empreendimento sintético", localizacao: "101", locatario: "Inquilino sintético",
    mes: 6, mes_ref: "JUNHO", competencia: "2026-06", valor: 1000, iptu: 10, cond: 20, recebido: 1030,
    taxa_comissao: 0.1, data_pagamento: "2026-06-12", via: "PIX", observacao: "Observação sintética" }],
  livro_caixa: { "JUNHO 2026": { saida_ac: [{ valor: 20, secao: "Manutenção", data: "2026-06-04", descricao: "Teste de caixa", linha: 7 }] } },
};

type Selecao = { [campo: string]: boolean | { select: Selecao; orderBy?: unknown } };
type Consulta = { select: Selecao; where?: unknown };

function selecionar(registro: Record<string, unknown>, select: Selecao): Record<string, unknown> {
  return Object.fromEntries(Object.entries(select).map(([campo, escolha]) => {
    const valor = registro[campo];
    if (escolha === true || valor === null || valor === undefined) return [campo, valor];
    if (typeof escolha !== "object") throw new Error("Seleção artificial inválida");
    return [campo, Array.isArray(valor)
      ? valor.map(item => selecionar(item, escolha.select))
      : selecionar(valor as Record<string, unknown>, escolha.select)];
  }));
}

function bancoArtificial(importacoesPlanilha: DadosFontesUnificacao["caixa"][number]["importacoesPlanilha"] = []) {
  const tabelas = {
    locatario: dados.locatarios, pessoa: dados.pessoas, unidade: dados.unidades,
    imovelLegado: dados.imoveis, contrato: dados.contratos, contratoLegado: dados.contratosLegados,
    recebimento: dados.recebimentos, tituloFinanceiroLegado: dados.titulos,
    pagamentoRecebimento: dados.pagamentos, baixaFinanceiraLegado: dados.baixas,
    lancamentoCaixa: dados.caixa, movimentoFinanceiroLegado: dados.movimentos,
    catalogoLegadoRegistro: dados.parametros,
    despesaDocumento: dados.despesas,
    importacaoPlanilhaLinha: importacoesPlanilha,
    recebimentoWidesysLocal: dados.recebimentosWidesysLocais,
  };
  const mocks = Object.fromEntries(Object.entries(tabelas).map(([nome, registros]) => [nome, {
    findMany: vi.fn(async (consulta: Consulta) => registros.map(registro => selecionar({ ...registro,
      snapshot: "CONTEUDO_BRUTO_NAO_USADO", payload: "CONTEUDO_BRUTO_NAO_USADO",
    }, consulta.select))),
  }]));
  return { db: mocks as unknown as BancoUnificacao, mocks };
}

beforeEach(() => {
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue(JSON.stringify(dataset));
});

describe("fotografia compacta das fontes de unificação", () => {
  it("preserva baixas locais e caixa uma única vez quando a nova captura repete o recebimento", async () => {
    const primeira = {
      id: "local-1", tituloId: "titulo", lancamentoCaixaId: "caixa-local-1", valor: 25000, dataPagamento: "2026-06-18",
      via: "PIX", criadoEm: new Date("2026-06-18T18:00:00Z"), valorDevidoOrigemNaBaixa: 103000,
      valorPagoOrigemNaBaixa: 50000, valorAbertoOrigemNaBaixa: 53000, restrito: false,
    };
    const segunda = { ...primeira, id: "local-2", lancamentoCaixaId: "caixa-local-2", valor: 28000,
      dataPagamento: "2026-06-22", criadoEm: new Date("2026-06-22T18:00:00Z") };
    const recebimentosWidesysLocais = [primeira, segunda];
    const base = {
      ...dados,
      recebimentosWidesysLocais,
      caixa: recebimentosWidesysLocais.map(baixa => ({ ...dados.caixa[0], id: baixa.lancamentoCaixaId, criadoManualBrisa: true,
        tipo: "ENTRADA", data: baixa.dataPagamento, valor: baixa.valor, descricao: "Baixa manual de título importado" })),
    };
    const importadoEm = new Date("2026-06-20T18:00:00Z");
    const movimentoAgrupado = { ...dados.movimentos[0], id: "agrupado", legadoId: "7", valor: 29000,
      tituloEscopo: null, tituloLegadoId: null, dataMovimento: primeira.dataPagamento, importadoEm };
    const captura = {
      ...base,
      titulos: [{ ...dados.titulos[0], valorPago: 75000, valorAberto: 28000 }],
      baixas: [...dados.baixas, { ...dados.baixas[0], id: "importada", valor: 25000,
        movimentoLegadoId: "7", dataPagamento: primeira.dataPagamento, importadoEm }],
      movimentos: [...dados.movimentos, movimentoAgrupado],
    };
    const obterLinhas = async (dados: DadosFontesUnificacao) => projetarFinanceiroWidesys(await derivarFontesUnificacao(dados, false), []).linhas;
    const antes = await obterLinhas(base);
    const depois = await obterLinhas(captura);
    const titulo = (linhas: typeof depois) => linhas.find(linha => linha.chave === "WIDESYS:RECEBER:titulo");
    const somarCaixa = (linhas: typeof depois) => linhas.filter(linha => linha.dominio === "MOVIMENTO" && linha.contabiliza)
      .reduce((total, linha) => total + (linha.valor ?? 0), 0);

    expect(titulo(antes)).toMatchObject({ pago: 103000, aberto: 0, baixaLocalWidesys: true });
    expect(titulo(depois)).toMatchObject({ pago: 103000, aberto: 0, avisos: [] });
    expect(somarCaixa(antes)).toBe(103000);
    expect(somarCaixa(depois)).toBe(107000);
    expect(depois.find(linha => linha.chave === "WIDESYS:MOVIMENTO:agrupado")).toMatchObject({ valor: 4000, contabiliza: true });
    expect(depois.some(linha => linha.chave === "WIDESYS:BAIXA_RECEBER:importada")).toBe(false);
    expect(depois.find(linha => linha.chave === "BRISA:BAIXA_RECEBER:local-1")).toMatchObject({ valor: 25000, contabiliza: false, tituloChave: "WIDESYS:RECEBER:titulo" });
  });

  it("mantém o saldo local e indica conferência quando a captura traz apenas totais divergentes ou perde o título", async () => {
    const leitura = await derivarFontesUnificacao({
      ...dados,
      recebimentosWidesysLocais: [{ id: "local-1", tituloId: "titulo", lancamentoCaixaId: "caixa-local-1", valor: 25000,
        dataPagamento: "2026-06-18", via: "PIX", criadoEm: new Date("2026-06-18T18:00:00Z"), valorDevidoOrigemNaBaixa: 103000,
        valorPagoOrigemNaBaixa: 50000, valorAbertoOrigemNaBaixa: 53000, restrito: true }],
      titulos: [{ ...dados.titulos[0], valorPago: 75000, valorAberto: 28000, statusImportacao: "AUSENTE_NA_FONTE" }],
      movimentos: [{ ...dados.movimentos[0], id: "sem-vinculo", legadoId: "9", tituloEscopo: null, tituloLegadoId: null,
        valor: 25000, dataMovimento: "2026-06-18", importadoEm: new Date("2026-06-21T00:00:00Z") }],
    }, false);
    const linhas = projetarFinanceiroWidesys(leitura, []).linhas;
    expect(linhas.find(linha => linha.chave === "WIDESYS:RECEBER:titulo")).toMatchObject({ pago: 75000, aberto: 28000, estado: "ATIVO",
      contabiliza: true, restrito: true, avisos: ["BAIXA_ORIGEM_APOS_BRISA"] });
    expect(linhas.find(linha => linha.chave === "WIDESYS:MOVIMENTO:sem-vinculo")).toMatchObject({ valor: 25000, contabiliza: true });
  });

  it.each(["planoContaRotulo", "tipoCobrancaRotulo"] as const)("comissão explícita a receber em %s protege título, baixa e movimento sem alterar assinatura financeira", async campo => {
    const fontes = await derivarFontesUnificacao({ ...dados, titulos: [{ ...dados.titulos[0], [campo]: "Comissão de administração" }] });
    const chaves = ["WIDESYS:RECEBER:titulo", "WIDESYS:BAIXA_RECEBER:baixa", "WIDESYS:MOVIMENTO:movimento"];
    const restritas = chavesRestritasUnificacao(fontes, []);
    for (const chave of chaves) {
      const f = fontes.find(fonte => fonte.chave === chave)!;
      expect(f.restrito).toBe(true);
      expect(restritas.has(chave)).toBe(true);
      const conteudoAnteriorSemFlag = Object.fromEntries(Object.entries(f).filter(([nome]) => !["hash", "hashesCompativeis", "restrito"].includes(nome)));
      expect(f.hash).toBe(hashUnificacao(conteudoAnteriorSemFlag));
    }
    expect(fontes.find(f => f.chave === "BRISA:RECEBER:recebimento")?.restrito).not.toBe(true);
  });
  it("a referência genérica à composição para comissão não restringe aluguel nem honorários contábeis", async () => {
    for (const planoContaRotulo of ["Locação", "Honorários contábeis"]) {
      const fontes = await derivarFontesUnificacao({ ...dados, titulos: [{ ...dados.titulos[0], planoContaRotulo }] });
      const titulo = fontes.find(f => f.chave === "WIDESYS:RECEBER:titulo")!;
      expect(titulo.campos.composicao.rotulo).toContain("comissão");
      expect(titulo.restrito).not.toBe(true);
      expect(chavesRestritasUnificacao(fontes, []).has(titulo.chave)).toBe(false);
    }
  });
  const despesaBase: DadosFontesUnificacao["despesas"][number] = {
    id: "despesa-teste", origemChave: null, fornecedorNome: "Fornecedor teste", fornecedorDocumento: null,
    criadoManualBrisa: false,
    numero: "42", serie: null, tomadorNome: null, tomadorDocumento: null, competencia: "2026-10", emissao: "2026-10-07",
    vencimento: "2026-10-30", total: 15000, restrita: false, lancamentoCaixaId: null, lancamentoCaixa: null, pagamentoVia: null,
    categoriaCodigo: null, categoriaRotulo: null, descricao: null, tipoDocumento: "NOTA_FISCAL", destinoCusto: "EMPREENDIMENTOS",
  };

  it("campos de classificação adicionados pelo schema preservam a projeção de notas antigas", async () => {
    const fotografia = { ...dados, despesas: [despesaBase] };
    const atual = (await derivarFontesUnificacao(fotografia)).find(f => f.chave === "BRISA:PAGAR:despesa-teste")!;
    const antigo = Object.fromEntries(Object.entries(despesaBase).filter(([chave]) => !["categoriaCodigo", "descricao", "tipoDocumento", "destinoCusto"].includes(chave))) as unknown as typeof despesaBase;
    const semNovosCampos = (await derivarFontesUnificacao({ ...dados, despesas: [antigo] })).find(f => f.chave === atual.chave)!;
    expect(atual).toEqual(semNovosCampos);
    expect(atual.descricao).toBe("NF 42");
    expect(atual.campos).not.toHaveProperty("categoria");
    expect(atual.campos.tratamento.valor).toBe("Uma nota e uma obrigação. O rateio apenas distribui custos; o pagamento permanece uma única saída no caixa.");
  });

  it("despesa sem documento mostra classificação e responsabilidade sem inventar NF ou pagamento", async () => {
    const fontes = await derivarFontesUnificacao({ ...dados, despesas: [{ ...despesaBase, numero: "", emissao: "", tipoDocumento: "SEM_DOCUMENTO", destinoCusto: "ADMINISTRADORA", categoriaCodigo: "PROGRAMA_WIDESYS", descricao: "Mensalidade administrativa" }] });
    const despesas = fontes.filter(f => f.dominio === "PAGAR");
    expect(despesas).toHaveLength(1);
    expect(despesas[0]).toMatchObject({ valor: 15000, pago: 0, aberto: 15000, proveniencia: { tipo: "CADASTRO_MANUAL" } });
    expect(despesas[0].descricao).toBe("Programa Widesys · Mensalidade administrativa · Administradora");
    expect(despesas[0].campos.tipoDocumento.valor).toBe("Sem documento");
  });

  it("classificação administrativa de título Widesys não cria conta a pagar nativa adicional", async () => {
    const fontes = await derivarFontesUnificacao({ ...dados, despesas: [{ ...despesaBase, origemChave: "WIDESYS:PAGAR:existente", tipoDocumento: "SEM_DOCUMENTO", destinoCusto: "ADMINISTRADORA", categoriaCodigo: "IMPOSTOS" }] });
    expect(fontes.some(f => f.chave === "BRISA:PAGAR:despesa-teste")).toBe(false);
    expect(fontes).toHaveLength(13);
  });

  it("seleciona apenas os insumos e conserva todas as fontes, hashes e proveniência", async () => {
    const { db, mocks } = bancoArtificial();
    const esperadas = await derivarFontesUnificacao(dados);
    const atuais = await carregarFontesUnificacao(db);
    expect(atuais).toHaveLength(13);
    expect(atuais).toEqual(esperadas);
    expect(atuais.find(f => f.origemId === "recebimento")?.proveniencia)
      .toMatchObject({ arquivo: "fixture-recebimentos.xlsx", indiceDataset: 0 });
    expect(atuais.find(f => f.origemId === "caixa")?.proveniencia)
      .toMatchObject({ arquivo: "fixture-caixa.xlsx", linha: 7 });
    for (const mock of Object.values(mocks)) {
      expect(mock.findMany).toHaveBeenCalledTimes(1);
      const [consulta] = mock.findMany.mock.calls[0];
      expect(consulta.select).toBeDefined();
      expect(JSON.stringify(consulta.select)).not.toMatch(/snapshot|payload/);
    }
  });

  it("lê a fotografia sem acessar a planilha nem derivar campos", async () => {
    vi.mocked(readFileSync).mockClear();
    const { db } = bancoArtificial();
    const atuais = await carregarDadosFontesUnificacao(db);
    expect(atuais).toEqual(dados);
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it("lê proveniências pela FK em lote, sem relação reversa, e mantém a primeira por lançamento", async () => {
    const primeira = { lancamentoCaixaId: "caixa", aba: "Plan1", linha: 10, faixa: "SAIDA", celulas: "A10:E10",
      caixaOrigem: "GASTOS_BRISA:Plan1", hashConteudo: "hash-artificial", lote: { arquivo: "fixture-gastos.xlsx", hashArquivo: "hash-arquivo" } };
    const posterior = { ...primeira, linha: 11, lote: { arquivo: "fixture-revisado.xlsx", hashArquivo: "hash-revisado" } };
    const outro = { ...primeira, lancamentoCaixaId: "outro-caixa" };
    const { db, mocks } = bancoArtificial([primeira, posterior, outro]);
    const foto = await carregarDadosFontesUnificacao(db);
    expect(foto.caixa[0].importacoesPlanilha).toEqual([primeira]);
    expect(mocks.lancamentoCaixa.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.not.objectContaining({ importacoesPlanilha: expect.anything() }) }));
    expect(mocks.importacaoPlanilhaLinha.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { reservado: false, status: { in: ["IMPORTADO", "JA_EXISTENTE"] }, lancamentoCaixaId: { not: null } },
      orderBy: [{ criadoEm: "asc" }, { id: "asc" }],
    }));
    const fontes = await derivarFontesUnificacao(foto);
    expect(fontes.find(f => f.origemId === "caixa")?.proveniencia).toMatchObject({ arquivo: "fixture-gastos.xlsx", aba: "Plan1", linha: 10 });
  });

  it("mantém a operação sem dataset, mas não esconde um dataset existente inválido", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const fontes = await derivarFontesUnificacao(dados);
    expect(fontes).toHaveLength(13);
    expect(fontes.every(f => !f.proveniencia)).toBe(true);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("{arquivo incompleto");
    await expect(derivarFontesUnificacao(dados)).rejects.toBeInstanceOf(SyntaxError);
  });

  it("não reaproveita fontes financeiras depois de uma alteração", async () => {
    const { db } = bancoArtificial();
    const original = await carregarFontesUnificacao(db);
    const modificado = structuredClone(dados);
    modificado.recebimentos[0].recebido = 0;
    const fontes = await derivarFontesUnificacao(modificado);
    expect(fontes.find(f => f.origemId === "recebimento")?.hash)
      .not.toBe(original.find(f => f.origemId === "recebimento")?.hash);
    expect(fontes.find(f => f.origemId === "recebimento")?.proveniencia).toBeUndefined();
  });
});
