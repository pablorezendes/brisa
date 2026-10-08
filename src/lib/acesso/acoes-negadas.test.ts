import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  negar: vi.fn(),
  efeito: vi.fn(),
  bloqueio: new Error("ACESSO_NEGADO_ANTES_DA_OPERACAO"),
}));
vi.mock("server-only", () => ({}));
vi.mock("./servidor", () => ({ exigirPermissaoAcesso: mocks.negar }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.efeito }));
vi.mock("next/navigation", () => ({ redirect: mocks.efeito }));
vi.mock("../db", () => ({
  prisma: new Proxy({}, { get() { mocks.efeito(); throw new Error("Banco acessado sem autorização"); } }),
}));
vi.mock("../consultas/locacao", () => ({
  RE_DATA: /^\d{4}-\d{2}-\d{2}$/,
  STATUS_CONTRATO: ["ativo", "encerrado", "acordo"],
  TIPOS_UNIDADE: ["residencial", "comercial", "temporada"],
}));

import * as caixa from "@/app/(app)/caixa/actions";
import * as contratos from "@/app/(app)/contratos/actions";
import * as temporada from "@/app/(app)/temporada/actions";

const CASOS = [
  ...Object.entries(caixa).map(([nome, executar]) => ({ nome: "caixa." + nome, permissao: nome === "excluirLancamento" ? "governanca.editar" : "caixa.editar", executar })),
  ...Object.entries(contratos).map(([nome, executar]) => ({ nome: "contratos." + nome, permissao: "contratos.editar", executar })),
  ...Object.entries(temporada).map(([nome, executar]) => ({ nome: "temporada." + nome, permissao: nome.startsWith("excluir") ? "governanca.editar" : "temporada.editar", executar })),
];

describe("ações anteriormente sem autorização interna", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.negar.mockRejectedValue(mocks.bloqueio);
  });

  it.each(CASOS)("$nome interrompe chamada direta sem ler formulário ou tocar no banco", async ({ executar, permissao }) => {
    const formulario = new FormData();
    const lerCampo = vi.spyOn(formulario, "get");
    const chamada = executar as (...argumentos: unknown[]) => Promise<unknown>;
    await expect(chamada(formulario, formulario)).rejects.toBe(mocks.bloqueio);
    expect(mocks.negar).toHaveBeenCalledOnce();
    expect(mocks.negar).toHaveBeenCalledWith(permissao, { global: true });
    expect(lerCampo).not.toHaveBeenCalled();
    expect(mocks.efeito).not.toHaveBeenCalled();
  });
});
