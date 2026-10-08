import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LinhaUnificada } from "../unificacao/tipos";

const mocks = vi.hoisted(() => ({ exigir: vi.fn(), perfil: vi.fn(), ler: vi.fn(), lotes: vi.fn(), captura: vi.fn(), analise: vi.fn(), excluidos: vi.fn(), excel: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("../acesso/servidor", () => ({ exigirPermissaoAcesso: mocks.exigir }));
vi.mock("../autorizacao", () => ({ perfilAtual: mocks.perfil, perfilPodeVerComissoes: (p: string) => p === "ADMINISTRADOR" }));
vi.mock("./operacao-na-requisicao", () => ({ operacaoNaRequisicao: mocks.ler }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEGADO"); } }));
vi.mock("../db", () => ({ prisma: {
  importacaoPlanilhaLinha: { groupBy: mocks.lotes }, importacaoLegadoLote: { findFirst: mocks.captura },
  unificacaoDecisao: { findFirst: mocks.analise }, recursoGovernado: { count: mocks.excluidos },
  importacaoPlanilhaLote: { findFirst: mocks.excel },
} }));
import { listarUnificados, organizacaoDosDados } from "./unificacao";

const linha = (chave: string, origem: "BRISA" | "WIDESYS", origens: string[], estado = "ATIVO") => ({
  chave, origem, origens, estado, contabiliza: estado === "ATIVO", dominio: "MOVIMENTO", titulo: chave,
  descricao: "teste", campos: {}, natureza: "ENTRADA", valor: 100, data: "2026-09-10",
} as LinhaUnificada);

describe("consulta de origens e situação real da consolidação", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.exigir.mockResolvedValue({}); mocks.perfil.mockResolvedValue("ADMINISTRADOR");
    mocks.ler.mockResolvedValue({ linhas: [linha("a", "BRISA", ["PLANILHA"]), linha("b", "WIDESYS", ["WIDESYS"]), linha("c", "BRISA", ["BRISA"], "PENDENTE")], decisoes: [] });
    mocks.lotes.mockResolvedValue([{ status: "IMPORTADO", _count: { _all: 3 } }, { status: "PENDENTE", _count: { _all: 5 } }]);
    mocks.captura.mockResolvedValue(null); mocks.analise.mockResolvedValue(null); mocks.excluidos.mockResolvedValue(0); mocks.excel.mockResolvedValue(null);
  });
  it("aplica origem antes da contagem, paginação e totalização", async () => {
    const r = await listarUnificados({ dominio: "MOVIMENTO", origem: "WIDESYS", porPagina: 1 });
    expect(r.total).toBe(1); expect(r.itens[0].chave).toBe("b"); expect(r.resumo.entradas).toBe(100);
    expect(r.resumo.pendentes).toBe(0);
  });
  it("não confunde pendências da importação com pendências operacionais", async () => {
    const r = await organizacaoDosDados();
    expect(r.pendentes).toBe(1); expect(r.planilhas.pendentes).toBe(5);
    expect(r.ultimoWidesys).toBeNull(); expect(r.ultimaAnalise).toBeNull();
    expect(JSON.stringify(r)).not.toContain('"titulo"'); expect(JSON.stringify(r)).not.toContain('"campos"');
    expect(mocks.exigir).toHaveBeenCalledWith("unificacao.ver", { global: true });
    expect(mocks.exigir).toHaveBeenCalledWith("cadastros.sensiveis", { global: true });
    expect(mocks.lotes).toHaveBeenCalledWith({ by: ["status"], where: { reservado: false }, _count: { _all: true } });
  });
  it("nega antes de consultar dados de importação", async () => {
    mocks.exigir.mockRejectedValue(new Error("NEGADO"));
    await expect(organizacaoDosDados()).rejects.toThrow("NEGADO");
    expect(mocks.ler).not.toHaveBeenCalled(); expect(mocks.lotes).not.toHaveBeenCalled();
  });
});
