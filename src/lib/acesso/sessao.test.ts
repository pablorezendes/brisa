import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ get: vi.fn(), usuario: vi.fn(), set: vi.fn(), redirecionar: vi.fn((path: string): never => { throw new Error(path); }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mock.get, set: mock.set }) }));
vi.mock("next/navigation", () => ({ redirect: mock.redirecionar }));
vi.mock("../db", () => ({ prisma: { usuario: { findUnique: mock.usuario } } }));
vi.mock("react", () => ({ cache: (f: unknown) => f }));
import { abrirSessao, criarToken, exigirSessao, sessaoAtual, verificarToken } from "../auth";
const payload = { sub: "user1", nome: "Nome antigo", exp: Date.now() + 60000, sv: 2 };
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("AUTH_SECRET", "test-only-secret-with-at-least-32-characters"); mock.get.mockReturnValue({ value: criarToken(payload) }); mock.usuario.mockResolvedValue({ ativo: true, sessaoVersao: 2, nome: "Nome atual" }); });
describe("revogação de sessão no servidor", () => {
  it("consulta estado atual e não confia no nome/perfil do cookie", async () => { expect(await sessaoAtual()).toMatchObject({ sub: "user1", nome: "Nome atual" }); expect(mock.usuario).toHaveBeenCalledOnce(); });
  it.each([null, { ativo: false, sessaoVersao: 2 }, { ativo: true, sessaoVersao: 3 }])("nega sessão ausente/inativa/revogada %#", async usuario => { mock.usuario.mockResolvedValue(usuario); expect(await sessaoAtual()).toBeNull(); await expect(exigirSessao()).rejects.toThrow("/login"); });
  it("não toca banco com cookie inválido", async () => { mock.get.mockReturnValue({ value: "invalido" }); expect(await sessaoAtual()).toBeNull(); expect(mock.usuario).not.toHaveBeenCalled(); });
  it("sessão anterior à migração vale só enquanto versão for zero", async () => { mock.get.mockReturnValue({ value: criarToken({ sub: "user1", nome: "Antigo", exp: payload.exp }) }); expect(await sessaoAtual()).toBeNull(); mock.usuario.mockResolvedValue({ ativo: true, sessaoVersao: 0, nome: "Atual" }); expect(await sessaoAtual()).not.toBeNull(); });
  it("não emite cookie para usuário desativado", async () => { mock.usuario.mockResolvedValue({ ativo: false, sessaoVersao: 2 }); await expect(abrirSessao({ id: "user1", nome: "Nome", sessaoVersao: 2 }, false)).rejects.toThrow("/login"); expect(mock.set).not.toHaveBeenCalled(); });
  it("cookie novo incorpora versão autenticada", async () => { await abrirSessao({ id: "user1", nome: "Nome", sessaoVersao: 2 }, false); expect(verificarToken(mock.set.mock.calls[0][1])).toMatchObject({ sv: 2, sub: "user1" }); });
  it("reset concorrente não aceita senha validada na versão anterior", async () => { await expect(abrirSessao({ id: "user1", nome: "Nome", sessaoVersao: 1 }, false)).rejects.toThrow("/login"); expect(mock.set).not.toHaveBeenCalled(); });
});
