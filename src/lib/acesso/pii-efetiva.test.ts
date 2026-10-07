import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ acesso: vi.fn(), usuario: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./servidor", () => ({ acessoAtual: mocks.acesso, exigirPermissaoAcesso: vi.fn() }));
vi.mock("../db", () => ({ prisma: { usuario: { findUnique: mocks.usuario } } }));
vi.mock("../auth", () => ({ exigirSessao: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));

import { podeVerPiiCadastrosAtual } from "../autorizacao";
import { montarPolitica, type DadosPolitica } from "./politica";

const usuario: DadosPolitica = {
  id: "usuario-teste", perfil: "FINANCEIRO", ativo: true, acessoGlobal: true,
  permissoesExtras: "[]", permissoesNegadas: "[]", papelAcesso: null, regrasAcesso: [],
};

describe("PII cadastral depende da permissão efetiva, não só do nome do perfil", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["financeiro sem concessão", {}, false],
    ["financeiro com concessão", { permissoesExtras: '["cadastros.sensiveis"]' }, true],
    ["bloqueio explícito vence concessão", { permissoesExtras: '["cadastros.sensiveis"]', permissoesNegadas: '["cadastros.sensiveis"]' }, false],
    ["função concede acesso", { papelAcesso: { ativo: true, permissoes: '["cadastros.sensiveis"]' } }, true],
    ["bloqueio vence função", { papelAcesso: { ativo: true, permissoes: '["cadastros.sensiveis"]' }, permissoesNegadas: '["cadastros.sensiveis"]' }, false],
    ["função desativada não concede acesso", { papelAcesso: { ativo: false, permissoes: '["cadastros.sensiveis"]' }, permissoesExtras: '["cadastros.sensiveis"]' }, false],
    ["contabilidade sem acesso sensível", { perfil: "CONTABILIDADE" }, false],
    ["contabilidade autorizada explicitamente", { perfil: "CONTABILIDADE", permissoesExtras: '["cadastros.sensiveis"]' }, true],
    ["usuário desativado", { ativo: false, permissoesExtras: '["cadastros.sensiveis"]' }, false],
    ["administrador global", { perfil: "ADMINISTRADOR" }, true],
  ] as Array<[string, Partial<DadosPolitica>, boolean]>)("%s", async (_nome, alteracoes, permitido) => {
    mocks.acesso.mockResolvedValue(montarPolitica({ ...usuario, ...alteracoes }));
    expect(await podeVerPiiCadastrosAtual()).toBe(permitido);
    expect(mocks.acesso).toHaveBeenCalledOnce();
    expect(mocks.usuario).not.toHaveBeenCalled();
  });

  it("não mantém um resultado de autorização próprio entre requisições", async () => {
    mocks.acesso.mockResolvedValueOnce(montarPolitica({ ...usuario, permissoesExtras: '["cadastros.sensiveis"]' }));
    mocks.acesso.mockResolvedValueOnce(montarPolitica({ ...usuario, permissoesNegadas: '["cadastros.sensiveis"]' }));
    expect(await podeVerPiiCadastrosAtual()).toBe(true);
    expect(await podeVerPiiCadastrosAtual()).toBe(false);
  });
});
