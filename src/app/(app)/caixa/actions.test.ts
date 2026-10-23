import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ acesso: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn(), ativo: vi.fn(), redirect: vi.fn(), revalidar: vi.fn() }));
vi.mock("@/lib/acesso/servidor", () => ({ exigirPermissaoAcesso: mocks.acesso }));
vi.mock("@/lib/db", () => ({ prisma: { lancamentoCaixa: { findFirst: mocks.findFirst, updateMany: mocks.updateMany, create: mocks.create } } }));
vi.mock("@/lib/governanca/filtros", () => ({ recursoEstaAtivo: mocks.ativo }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidar }));
import { excluirLancamento, salvarLancamento } from "./actions";

function formulario() {
  const f = new FormData();
  for (const [k, v] of Object.entries({ id: "saida", tipo: "SAIDA", mesReferencia: "2026-10", valor: "100,00", data: "2026-10-08", centro: "AL", categoria: "Manutenção", descricao: "Serviço" })) f.set(k, v);
  return f;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.acesso.mockResolvedValue({ perfil: "FINANCEIRO", usuarioId: "fin" });
  mocks.ativo.mockResolvedValue(true);
  mocks.findFirst.mockResolvedValue({ id: "saida" });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.redirect.mockImplementation((destino: string) => { throw new Error(`REDIRECT:${destino}`); });
});
describe("sigilo do pagamento de uma nota restrita no caixa", () => {
  it("nega nota restrita sem enviar alteração ou revelar dados", async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect((await salvarLancamento({ erro: null }, formulario())).erro).toContain("não encontrado");
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{ id: "saida" }, { OR: [{ despesaDocumento: { is: null } }, { despesaDocumento: { is: { restrita: false } } }] }] } }));
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.revalidar).not.toHaveBeenCalled();
  });
  it("repete o filtro no UPDATE e não confirma sucesso quando a restrição mudou", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    expect((await salvarLancamento({ erro: null }, formulario())).erro).toContain("indisponível");
    expect(mocks.updateMany.mock.calls[0][0].where).toEqual(mocks.findFirst.mock.calls[0][0].where);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("administrador continua autorizado a editar, sem filtro de nota reservada", async () => {
    mocks.acesso.mockResolvedValue({ perfil: "ADMINISTRADOR", usuarioId: "admin" });
    await expect(salvarLancamento({ erro: null }, formulario())).rejects.toThrow("REDIRECT:/caixa?mes=2026-10");
    expect(mocks.updateMany.mock.calls[0][0].where).toEqual({ AND: [{ id: "saida" }, {}] });
  });
  it("não abre exclusão de uma saída oculta para outro perfil", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await excluirLancamento(formulario());
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
