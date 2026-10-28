import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ acesso: vi.fn(), sessao: vi.fn(), ativo: vi.fn(), buscar: vi.fn(), criar: vi.fn(), atualizar: vi.fn(), revalidar: vi.fn() }));
vi.mock("@/lib/acesso/servidor", () => ({ exigirPermissaoAcesso: mocks.acesso }));
vi.mock("@/lib/auth", () => ({ exigirSessao: mocks.sessao }));
vi.mock("@/lib/db", () => ({ prisma: { empreendimento: { findUnique: mocks.buscar, create: mocks.criar, update: mocks.atualizar } } }));
vi.mock("@/lib/governanca/filtros", () => ({ recursoEstaAtivo: mocks.ativo }));
vi.mock("@/lib/consultas/locacao", () => ({ TIPOS_UNIDADE: [] }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidar }));
import { salvarEmpreendimentoNaTela } from "../actions";

function dados(nome: string, id?: string) {
  const form = new FormData(); form.set("nome", nome); if (id) form.set("id", id); return form;
}
beforeEach(() => { vi.resetAllMocks(); mocks.ativo.mockResolvedValue(true); mocks.buscar.mockResolvedValue({ id: "edificio" }); });

describe("editor de empreendimento na própria lista", () => {
  it("valida acesso global antes de consultar ou gravar", async () => {
    mocks.acesso.mockRejectedValue(new Error("SEM_PERMISSAO"));
    await expect(salvarEmpreendimentoNaTela(dados("Nome", "edificio"))).rejects.toThrow("SEM_PERMISSAO");
    expect(mocks.acesso).toHaveBeenCalledWith("cadastros.editar", { global: true });
    expect(mocks.buscar).not.toHaveBeenCalled(); expect(mocks.atualizar).not.toHaveBeenCalled();
  });
  it("devolve nome repetido ao formulário sem redirecionar nem revalidar", async () => {
    mocks.criar.mockRejectedValue({ code: "P2002" });
    expect(await salvarEmpreendimentoNaTela(dados("Edifício Central"))).toMatchObject({ erro: expect.stringContaining("Já existe") });
    expect(mocks.revalidar).not.toHaveBeenCalled();
  });
  it("não recria nem altera um cadastro excluído", async () => {
    mocks.ativo.mockResolvedValue(false);
    expect(await salvarEmpreendimentoNaTela(dados("Novo nome", "excluido"))).toMatchObject({ erro: expect.stringContaining("excluído") });
    expect(mocks.criar).not.toHaveBeenCalled(); expect(mocks.atualizar).not.toHaveBeenCalled();
  });
  it("salva somente o nome no mesmo ID, preservando os vínculos", async () => {
    expect(await salvarEmpreendimentoNaTela(dados("  Edifício   Central ", "edificio"))).toEqual({ ok: "Empreendimento atualizado." });
    expect(mocks.atualizar).toHaveBeenCalledWith({ where: { id: "edificio" }, data: { nome: "EDIFICIO CENTRAL" } });
    expect(mocks.criar).not.toHaveBeenCalled();
  });
  it.each(["   ", "a".repeat(121)])("recusa nome inválido sem persistência", async nome => {
    expect(await salvarEmpreendimentoNaTela(dados(nome))).toHaveProperty("erro");
    expect(mocks.criar).not.toHaveBeenCalled(); expect(mocks.atualizar).not.toHaveBeenCalled();
  });
});
