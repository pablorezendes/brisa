import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  perfil: vi.fn(), lotes: vi.fn(), totalLotes: vi.fn(), lote: vi.fn(), grupos: vi.fn(),
  total: vi.fn(), linhas: vi.fn(), linha: vi.fn(), detalhe: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../autorizacao", () => ({ perfilAtual: mocks.perfil }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("../db", () => ({ prisma: {
  importacaoPlanilhaLote: { findMany: mocks.lotes, count: mocks.totalLotes, findUnique: mocks.lote },
  importacaoPlanilhaLinha: { groupBy: mocks.grupos, count: mocks.total, findMany: mocks.linhas, findUnique: mocks.linha, findFirst: mocks.detalhe },
} }));

import { detalheImportacaoPlanilha, filtrosImportacaoPlanilha, listarImportacoesPlanilha, motivosPublicosImportacao, resumirControlesImportacao } from "./importacoes-planilha";

const lote = { id: "lote-1", arquivo: "Teste.xlsx", hashArquivo: "hash", versao: "v1", status: "CONCLUIDO", criadoEm: new Date("2026-10-01T12:00:00Z"), _count: { linhas: 1 } };
const base = { id: "linha-1", loteId: lote.id, aba: "JAN_2026", linha: 12, faixa: "A:F", status: "PENDENTE", reservado: false, lote: { arquivo: lote.arquivo } };
const conteudo = { id: base.id, caixaOrigem: "GASTOS_BRISA:ALIANA", mesReferencia: "2026-01", data: "2026-01-05", centroCusto: "GERAL", tipo: "SAIDA", valor: 1000, descricao: "Compra teste", categoria: null, cliente: null, local: null, lancamentoCaixaId: null };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.perfil.mockResolvedValue("ADMINISTRADOR");
  mocks.lotes.mockResolvedValue([lote]);
  mocks.totalLotes.mockResolvedValue(1);
  mocks.grupos.mockResolvedValue([{ status: "PENDENTE", reservado: false, _count: { _all: 1 } }]);
  mocks.total.mockResolvedValue(1);
  mocks.linhas.mockResolvedValue([]);
  mocks.linha.mockResolvedValue(base);
  mocks.detalhe.mockResolvedValue({ ...conteudo, celulas: "A12:F12", hashConteudo: "sha256", motivos: '["DATA_INVALIDA"]', candidatos: "[]" });
});

describe("auditoria administrativa das cargas de planilhas", () => {
  it.each(["FINANCEIRO", "OPERADOR", "CONSULTA", "", "administrador"])("recusa %s antes de consultar a carga", async perfil => {
    mocks.perfil.mockResolvedValue(perfil);
    await expect(listarImportacoesPlanilha({})).rejects.toThrow("NOT_FOUND");
    await expect(detalheImportacaoPlanilha(base.id)).rejects.toThrow("NOT_FOUND");
    expect(mocks.lotes).not.toHaveBeenCalled();
    expect(mocks.total).not.toHaveBeenCalled();
    expect(mocks.linha).not.toHaveBeenCalled();
    expect(mocks.detalhe).not.toHaveBeenCalled();
  });

  it("limita filtros e paginação sem aceitar limites arbitrários", () => {
    expect(filtrosImportacaoPlanilha({ pagina: "-1", limite: "99999", status: "INJETADO" })).toEqual({ lote: "", pagina: 1, porPagina: 30, status: "" });
    expect(filtrosImportacaoPlanilha({ pagina: ["2", "99"], limite: "50", status: "PENDENTE", lote: "a".repeat(200) })).toEqual({ lote: "a".repeat(128), pagina: 2, porPagina: 50, status: "PENDENTE" });
    expect(filtrosImportacaoPlanilha({ pagina: "1e100" }).pagina).toBe(1);
  });

  it("pagina no banco, seleciona campos mínimos e não carrega todos os snapshots", async () => {
    mocks.total.mockResolvedValue(65);
    mocks.linhas.mockResolvedValueOnce([base]).mockResolvedValueOnce([conteudo]);
    const resultado = await listarImportacoesPlanilha({ pagina: "999", limite: "30", lote: lote.id, status: "PENDENTE" });
    expect(resultado.filtros.pagina).toBe(3);
    expect(resultado.totalPaginas).toBe(3);
    expect(resultado.linhas[0].conteudo).toEqual(conteudo);
    expect(mocks.linhas.mock.calls[0][0]).toMatchObject({ where: { loteId: lote.id, status: "PENDENTE" }, skip: 60, take: 30 });
    expect(mocks.linhas.mock.calls[0][0].select).not.toHaveProperty("valor");
    expect(mocks.linhas.mock.calls[1][0].where).toEqual({ id: { in: [base.id] }, reservado: false });
    expect(mocks.linhas.mock.calls[1][0].select).not.toHaveProperty("origemDados");
    expect(mocks.lotes.mock.calls[0][0].select).not.toHaveProperty("resumo");
    expect(resultado.lotes[0].controles).toEqual({ total: 0, divergencias: 0, semResultado: 0, formulasNaoConferidas: 0, ilegivel: false });
  });

  it("não consulta valores nem divulga períodos, descrições ou snapshots de reservado", async () => {
    const reservado = { ...base, reservado: true, descricao: "segredo", valor: 7654321, mesReferencia: "2099-12", data: "2099-12-15", cliente: "Pessoa reservada", origemDados: '{"confidencial":true}' };
    mocks.linhas.mockResolvedValueOnce([reservado]);
    mocks.grupos.mockResolvedValue([{ status: "PENDENTE", reservado: true, _count: { _all: 1 } }]);
    const resultado = await listarImportacoesPlanilha({});
    expect(mocks.linhas).toHaveBeenCalledTimes(1);
    expect(resultado.totais.reservados).toBe(1);
    expect(resultado.linhas[0]).toEqual({ id: base.id, loteId: lote.id, arquivo: lote.arquivo, linha: 12, status: "PENDENTE", reservado: true, aba: null, faixa: null, conteudo: null });
    const serializado = JSON.stringify(resultado);
    for (const segredo of ["7654321", "2099-12", "segredo", "Pessoa reservada", "JAN_2026", "confidencial"]) expect(serializado).not.toContain(segredo);
  });

  it("no detalhe reservado encerra antes de carregar conteúdo ou motivos", async () => {
    mocks.linha.mockResolvedValue({ ...base, reservado: true });
    const resultado = await detalheImportacaoPlanilha(base.id);
    expect(resultado.detalhe).toBeNull();
    expect(resultado.aba).toBeNull();
    expect(resultado.faixa).toBeNull();
    expect(mocks.detalhe).not.toHaveBeenCalled();
  });

  it("expõe apenas motivos conhecidos e referências com formato estrutural", async () => {
    mocks.detalhe.mockResolvedValue({ ...conteudo, celulas: "A12:F12", hashConteudo: "sha256", motivos: '["DATA_INVALIDA","SEGREDO_PRIVADO"]', candidatos: '["BRISA:MOVIMENTO:abc-123","WIDESYS:MOVIMENTO:789","PLANILHA:hash:aba:faixa:12","javascript:alert(1)",{"privado":true}]' });
    const resultado = await detalheImportacaoPlanilha(base.id);
    expect(resultado.detalhe?.motivos).not.toContain("SEGREDO_PRIVADO");
    expect(resultado.detalhe?.candidatos).toEqual(["BRISA:MOVIMENTO:abc-123", "WIDESYS:MOVIMENTO:789"]);
    expect(mocks.detalhe.mock.calls[0][0].select).not.toHaveProperty("origemDados");
    expect(mocks.detalhe.mock.calls[0][0].where).toEqual({ id: base.id, reservado: false });
  });

  it("não interpreta motivos livres como texto a publicar", () => {
    expect(motivosPublicosImportacao("invalid json")).toEqual([]);
    expect(motivosPublicosImportacao('{"valor":123}')).toEqual([]);
    expect(motivosPublicosImportacao('["Valor secreto 123", "Outro segredo", "DATA_INVALIDA"]')).toEqual([
      "Existe uma condição de conferência não detalhada nesta tela. Consulte a origem.", "A origem contém uma data inválida.",
    ]);
  });

  it("reduz controles a contagens sem divulgar fórmula, célula ou valores reservados", async () => {
    const controles = JSON.stringify([
      { aba: "reservada", celula: "G99", formula: "SUM(G1:G98)", valorFonte: 7654321, valorCalculado: null, motivos: ["CONTROLE_SEM_RESULTADO_VALIDO"] },
      { aba: "restrita", celula: "X7", formula: "SUM(X1:X6)", valorFonte: 555, valorCalculado: 666, diferenca: -111, motivos: ["CONTROLE_DIVERGENTE"] },
    ]);
    mocks.lotes.mockResolvedValue([{ ...lote, controles }]);
    const resultado = await listarImportacoesPlanilha({});
    expect(resultado.lotes[0].controles).toEqual({ total: 2, divergencias: 1, semResultado: 1, formulasNaoConferidas: 1, ilegivel: false });
    for (const segredo of ["7654321", "555", "SUM(", "G99", "restrita"]) expect(JSON.stringify(resultado)).not.toContain(segredo);
    expect(resumirControlesImportacao("não é JSON").ilegivel).toBe(true);
    expect(resumirControlesImportacao("{}").ilegivel).toBe(true);
  });

  it("recusa lote ou linha inexistente", async () => {
    mocks.lote.mockResolvedValue(null);
    await expect(listarImportacoesPlanilha({ lote: "inexistente" })).rejects.toThrow("NOT_FOUND");
    mocks.linha.mockResolvedValue(null);
    await expect(detalheImportacaoPlanilha("inexistente")).rejects.toThrow("NOT_FOUND");
  });
});
