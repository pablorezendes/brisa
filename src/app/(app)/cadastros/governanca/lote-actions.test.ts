import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ acesso: vi.fn(), previa: vi.fn(), excluir: vi.fn(), revalidar: vi.fn(), db: {} }));
vi.mock("@/lib/acesso/servidor", () => ({ exigirPermissaoAcesso: mocks.acesso }));
vi.mock("@/lib/db", () => ({ prisma: mocks.db }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidar }));
vi.mock("@/lib/governanca/exclusao-titulos-lote", () => ({ previaExclusaoTitulosLote: mocks.previa, excluirTitulosLote: mocks.excluir }));

import { prepararExclusaoTitulos, excluirTitulosSelecionados } from "./lote-actions";
import { ErroGovernanca } from "@/lib/governanca/tipos";

const chaves = ["BRISA:RECEBER:1", "WIDESYS:RECEBER:2"];
const itens = chaves.map(chave => ({ chave, assinatura: "a".repeat(64) }));
function formulario(campos: Record<string, string> = {}) {
  const form = new FormData();
  for (const [chave, valor] of Object.entries({ dominio: "RECEBER", chaves: JSON.stringify(chaves), itens: JSON.stringify(itens), motivo: "Duplicatas conferidas", confirmar: "sim", cienciaExclusao: "sim", ...campos })) form.set(chave, valor);
  return form;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.acesso.mockResolvedValue({ usuarioId: "admin", perfil: "ADMINISTRADOR" });
  mocks.previa.mockResolvedValue({ dominio: "RECEBER", itens: [], total: 2 });
  mocks.excluir.mockResolvedValue({ excluidos: chaves, jaExcluidos: [] });
});

describe("ações de exclusão financeira em lote", () => {
  it("consulta prévia somente após guarda global e não revalida a página", async () => {
    expect(await prepararExclusaoTitulos(formulario())).toEqual({ estado: "PRONTO", previa: { dominio: "RECEBER", itens: [], total: 2 } });
    expect(mocks.acesso).toHaveBeenCalledExactlyOnceWith("governanca.editar", { global: true });
    expect(mocks.previa).toHaveBeenCalledExactlyOnceWith(mocks.db, "RECEBER", chaves, { id: "admin" });
    expect(mocks.acesso.mock.invocationCallOrder[0]).toBeLessThan(mocks.previa.mock.invocationCallOrder[0]);
    expect(mocks.revalidar).not.toHaveBeenCalled();
  });
  it("confirma apenas IDs explícitos e revalida uma vez após o commit", async () => {
    const resultado = await excluirTitulosSelecionados(formulario());
    expect(resultado).toMatchObject({ estado: "CONCLUIDO", excluidos: chaves, jaExcluidos: [] });
    expect(mocks.acesso).toHaveBeenCalledExactlyOnceWith("governanca.editar", { global: true });
    expect(mocks.excluir).toHaveBeenCalledExactlyOnceWith(mocks.db, "RECEBER", itens, "Duplicatas conferidas", { id: "admin" });
    expect(mocks.revalidar).toHaveBeenCalledExactlyOnceWith("/", "layout");
    expect(mocks.excluir.mock.invocationCallOrder[0]).toBeLessThan(mocks.revalidar.mock.invocationCallOrder[0]);
  });
  it("repetição já excluída não recalcula a página nem anuncia exclusão nova", async () => {
    mocks.excluir.mockResolvedValue({ excluidos: [], jaExcluidos: chaves });
    expect(await excluirTitulosSelecionados(formulario())).toMatchObject({ estado: "CONCLUIDO", excluidos: [], jaExcluidos: chaves, mensagem: expect.stringContaining("já estavam excluídos") });
    expect(mocks.revalidar).not.toHaveBeenCalled();
  });
  it.each([prepararExclusaoTitulos, excluirTitulosSelecionados])("bloqueia operador antes de consultar dados (%s)", async action => {
    mocks.acesso.mockResolvedValue({ usuarioId: "operador", perfil: "FINANCEIRO" });
    expect(await action(formulario())).toMatchObject({ estado: "ERRO", codigo: "SEM_PERMISSAO" });
    expect(mocks.previa).not.toHaveBeenCalled(); expect(mocks.excluir).not.toHaveBeenCalled();
  });
  it.each([prepararExclusaoTitulos, excluirTitulosSelecionados])("mantém falha de guarda antes de qualquer leitura (%s)", async action => {
    mocks.acesso.mockRejectedValue(new Error("SEM_SESSAO"));
    await expect(action(formulario())).rejects.toThrow("SEM_SESSAO");
    expect(mocks.previa).not.toHaveBeenCalled(); expect(mocks.excluir).not.toHaveBeenCalled();
  });
  it.each([{ confirmar: "", cienciaExclusao: "sim" }, { confirmar: "sim", cienciaExclusao: "" }])("exige confirmação e ciência de efeito apenas local (%j)", async campos => {
    expect(await excluirTitulosSelecionados(formulario(campos))).toMatchObject({ estado: "ERRO", codigo: "CONFIRMACAO" });
    expect(mocks.excluir).not.toHaveBeenCalled(); expect(mocks.revalidar).not.toHaveBeenCalled();
  });
  it.each(["", "{", "x".repeat(40001)])("recusa seleção serializada inválida ou excessiva", async chaves => {
    expect(await prepararExclusaoTitulos(formulario({ chaves }))).toMatchObject({ estado: "ERRO", codigo: "SELECAO_INVALIDA" });
    expect(mocks.previa).not.toHaveBeenCalled();
  });
  it("devolve prévia desatualizada sem invalidar listas ou confirmar sucesso", async () => {
    mocks.excluir.mockRejectedValue(new ErroGovernanca("PREVIA_DESATUALIZADA", "Confira novamente"));
    expect(await excluirTitulosSelecionados(formulario())).toEqual({ estado: "ERRO", codigo: "PREVIA_DESATUALIZADA", mensagem: "Confira novamente" });
    expect(mocks.revalidar).not.toHaveBeenCalled();
  });
  it("não expõe SQL, conteúdo privado ou exceções internas no retorno", async () => {
    mocks.excluir.mockRejectedValue(new Error("SQL_CREDENCIAL_PRIVADA"));
    const resultado = await excluirTitulosSelecionados(formulario());
    expect(resultado).toMatchObject({ estado: "ERRO", codigo: "OPERACAO_INDISPONIVEL" });
    expect(JSON.stringify(resultado)).not.toContain("SQL_CREDENCIAL_PRIVADA");
    expect(mocks.revalidar).not.toHaveBeenCalled();
  });
});
