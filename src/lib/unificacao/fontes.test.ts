import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  carregarDadosFontesUnificacao, carregarFontesUnificacao, derivarFontesUnificacao,
  type BancoUnificacao, type DadosFontesUnificacao,
} from "./fontes";

vi.mock("node:fs", () => ({ existsSync: vi.fn(), readFileSync: vi.fn() }));

// Dados inteiramente artificiais: cada campo usado pela projeção recebe valor
// para uma omissão em select não passar despercebida como null/undefined.
const dados: DadosFontesUnificacao = {
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
    estornada: false, contaBancariaRotulo: "Conta sintética", movimentoLegadoId: "6" }],
  caixa: [{ id: "caixa", mesReferencia: "2026-06", centroCusto: "AL", tipo: "SAIDA", categoria: "Manutenção",
    data: "2026-06-04", valor: 2000, descricao: "Teste de caixa", cliente: null, local: null }],
  movimentos: [{ id: "movimento", legadoId: "6", tituloEscopo: "TITULO_RECEBER", tituloLegadoId: "4",
    descricao: "Entrada sintética", planoContaRotulo: "Locação", contaBancariaRotulo: "Conta sintética",
    statusImportacao: "STAGING", quarentenaMotivo: null, dataMovimento: "2026-06-12", competencia: "2026-06-01",
    natureza: "ENTRADA", valor: 50000, documento: "DOC-6" }],
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

function bancoArtificial() {
  const tabelas = {
    locatario: dados.locatarios, pessoa: dados.pessoas, unidade: dados.unidades,
    imovelLegado: dados.imoveis, contrato: dados.contratos, contratoLegado: dados.contratosLegados,
    recebimento: dados.recebimentos, tituloFinanceiroLegado: dados.titulos,
    pagamentoRecebimento: dados.pagamentos, baixaFinanceiraLegado: dados.baixas,
    lancamentoCaixa: dados.caixa, movimentoFinanceiroLegado: dados.movimentos,
    catalogoLegadoRegistro: dados.parametros,
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
