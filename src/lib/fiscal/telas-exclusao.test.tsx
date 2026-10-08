import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listar: vi.fn(), contar: vi.fn(), agrupar: vi.fn(), detalhe: vi.fn(), filtro: vi.fn(), ativo: vi.fn(),
}));
vi.mock("@/lib/acesso/servidor", () => ({ exigirPaginaAcesso: vi.fn() }));
vi.mock("@/lib/fiscal/acesso", () => ({ exigirAcessoFiscal: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {
  configuracaoFiscal: { findUnique: vi.fn().mockResolvedValue(null) },
  notaFiscalServico: { findMany: mocks.listar, count: mocks.contar, groupBy: mocks.agrupar, findUnique: mocks.detalhe },
} }));
vi.mock("@/lib/governanca/filtros", () => ({ filtroGovernanca: mocks.filtro, recursoEstaAtivo: mocks.ativo }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/components/excluir-registro-link", () => ({
  // A autorização do componente real tem testes próprios; aqui conferimos a identidade entregue pela tela.
  ExcluirRegistroLink: ({ tipo, origemId }: { tipo: string; origemId: string }) => (
    <a href={`/cadastros/governanca?${new URLSearchParams({ tipo, origemId, modo: "excluir" })}`}>Excluir da plataforma</a>
  ),
}));
vi.mock("@/app/(app)/financeiro/notas-fiscais/_ui", () => ({
  AbasFiscais: () => null, AvisoFiscal: () => null, FormularioRascunho: () => null,
  StatusFiscal: ({ status }: { status: string }) => <span>{status}</span>, botaoFiscal: "", botaoFiscalSecundario: "",
}));
vi.mock("@/app/(app)/financeiro/notas-fiscais/actions", () => ({ executarAcaoFiscal: vi.fn() }));

import ListaNotas from "@/app/(app)/financeiro/notas-fiscais/page";
import DetalheNota from "@/app/(app)/financeiro/notas-fiscais/[id]/page";

describe("exclusão local nas telas fiscais", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.filtro.mockResolvedValue({ id: { notIn: ["nota-excluida"] } });
    mocks.ativo.mockResolvedValue(true);
    mocks.contar.mockResolvedValue(1);
    mocks.agrupar.mockResolvedValue([]);
    mocks.listar.mockResolvedValue([]);
  });

  it("aplica a mesma exclusão antes de paginar, contar e calcular cartões", async () => {
    await ListaNotas({ searchParams: Promise.resolve({ status: "AUTORIZADA", pagina: "2" }) });
    const where = { status: "AUTORIZADA", id: { notIn: ["nota-excluida"] } };
    expect(mocks.listar).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 30, take: 30 }));
    expect(mocks.contar).toHaveBeenCalledWith({ where });
    expect(mocks.agrupar).toHaveBeenCalledWith({ by: ["status"], where: { id: { notIn: ["nota-excluida"] } }, _count: true });
  });

  it.each(["RASCUNHO", "AUTORIZADA", "CANCELADA", "INCERTA"])("oferece revisão de exclusão também no estado %s", async (status) => {
    mocks.listar.mockResolvedValue([{ id: "nota-preservada", origemChave: "servico", tomadorNome: "Tomador", competencia: "2026-10", ambiente: "HOMOLOGACAO", valorServico: 10000, status, numero: null }]);
    const html = renderToStaticMarkup(await ListaNotas({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("tipo=NFSE&amp;origemId=nota-preservada&amp;modo=excluir");
    expect(html).toContain("não cancela a NFS-e no município ou no provedor");
  });

  it("não abre detalhe operacional de nota localmente excluída", async () => {
    mocks.ativo.mockResolvedValue(false);
    await expect(DetalheNota({ params: Promise.resolve({ id: "nota-excluida" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.detalhe).not.toHaveBeenCalled();
  });
});
