import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LinhaUnificada } from "../unificacao/tipos";

const mocks = vi.hoisted(() => ({ exigir: vi.fn(), perfil: vi.fn(), operacao: vi.fn(), historico: vi.fn(), overlays: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("../acesso/servidor", () => ({ exigirPermissaoAcesso: mocks.exigir }));
vi.mock("../autorizacao", () => ({ perfilAtual: mocks.perfil, perfilPodeVerComissoes: (perfil: string) => perfil === "ADMINISTRADOR" }));
vi.mock("./operacao-na-requisicao", () => ({ operacaoNaRequisicao: mocks.operacao }));
vi.mock("../db", () => ({ prisma: { unificacaoDecisao: { findMany: mocks.historico }, despesaDocumento: { findMany: mocks.overlays } } }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEGADO"); } }));
import { detalheUnificado, listarTitulosFinanceiros, listarUnificados } from "./unificacao";

function linha(id: string, extra: Partial<LinhaUnificada> = {}): LinhaUnificada {
  const chave = `WIDESYS:PAGAR:${id}`;
  return { chave, dominio: "PAGAR", origem: "WIDESYS", origemId: id, titulo: id, descricao: "Plano original", href: null,
    hash: `hash-${id}`, qualidade: "OK", motivos: [], campos: {}, nomeNorm: id, estado: "ATIVO", origens: ["WIDESYS"], fontes: [chave], versao: 1,
    candidatos: [], avisos: [], contabiliza: true, divergencias: [], competencia: "2026-10", vencimento: "2026-10-20", valor: 10000, pago: 10000, aberto: 0, ...extra };
}
const a = linha("a"), b = linha("b"), reservada = linha("reservada", { restrito: true, valor: 9999999 });
const overlay = { origemChave: a.chave, categoriaCodigo: "PROGRAMA_WIDESYS", destinoCusto: "ADMINISTRADORA", restrita: false };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.exigir.mockResolvedValue({}); mocks.perfil.mockResolvedValue("FINANCEIRO"); mocks.historico.mockResolvedValue([]); mocks.overlays.mockResolvedValue([overlay]);
  mocks.operacao.mockResolvedValue({ linhas: [a, b, reservada], fontes: [a, b, reservada], decisoes: [] });
});

describe("apresentação da categoria local após autorização e paginação", () => {
  it("consulta somente a página autorizada, preservando totais e hashes", async () => {
    const resultado = await listarTitulosFinanceiros({ dominio: "PAGAR", porPagina: 1 });
    expect(resultado.total).toBe(2);
    expect(resultado.resumo).toMatchObject({ devido: 20000, pago: 20000 });
    expect(mocks.overlays).toHaveBeenCalledTimes(1);
    expect(mocks.overlays.mock.calls[0][0].where.origemChave.in).toEqual([a.chave]);
    expect(resultado.itens[0]).toMatchObject({ hash: a.hash, valor: 10000, pago: 10000 });
    expect(resultado.itens[0].descricao).toContain("Categoria no Brisa: Programa Widesys");
    expect(a.descricao).toBe("Plano original");
  });

  it("o filtro é aplicado antes de carregar a classificação", async () => {
    const resultado = await listarUnificados({ dominio: "PAGAR", q: "inexistente" });
    expect(resultado.total).toBe(0);
    expect(mocks.overlays).not.toHaveBeenCalled();
  });

  it("nega acesso antes de consultar metadados, inclusive por URL restrita", async () => {
    expect(await detalheUnificado(reservada.chave)).toBeNull();
    expect(mocks.overlays).not.toHaveBeenCalled();
    mocks.exigir.mockRejectedValue(new Error("NEGADO"));
    await expect(listarTitulosFinanceiros({ dominio: "PAGAR" })).rejects.toThrow("NEGADO");
    expect(mocks.overlays).not.toHaveBeenCalled();
  });

  it("detalhe carrega registro, fontes e candidatos visíveis em uma consulta", async () => {
    const origem = { ...a, candidatos: [{ chave: b.chave, titulo: b.titulo, descricao: b.descricao, motivos: [] }] };
    mocks.operacao.mockResolvedValue({ linhas: [origem, b, reservada], fontes: [a, b, reservada], decisoes: [] });
    const resultado = await detalheUnificado(a.chave);
    expect(mocks.overlays).toHaveBeenCalledTimes(1);
    expect(mocks.overlays.mock.calls[0][0].where.origemChave.in).toEqual([a.chave, b.chave]);
    expect(resultado?.registro.campos.categoriaBrisa.valor).toBe("Programa Widesys");
    expect(resultado?.fontes[0].campos.categoriaBrisa.valor).toBe("Programa Widesys");
    expect(resultado?.registro.hash).toBe(a.hash);
    expect(resultado?.candidatos[0]).toEqual(b);
  });
});
