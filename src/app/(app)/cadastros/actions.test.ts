import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acesso: vi.fn(),
  sessao: vi.fn(),
  redirect: vi.fn(),
  revalidar: vi.fn(),
  transacao: vi.fn(),
  unidade: vi.fn(),
  empreendimento: vi.fn(),
  governado: vi.fn(),
  atualizarUnidade: vi.fn(),
  atualizarRecebimentos: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/acesso/servidor", () => ({ exigirPermissaoAcesso: mocks.acesso }));
vi.mock("@/lib/auth", () => ({ exigirSessao: mocks.sessao }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidar }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/consultas/locacao", () => ({
  TIPOS_UNIDADE: ["comercial", "residencial", "temporada"],
}));
// Os delegates existem somente dentro da transação. Uma leitura ou escrita
// fora dela falha, assim como uma tentativa de alterar contratos ou boletos.
vi.mock("@/lib/db", () => ({ prisma: { $transaction: mocks.transacao } }));

import { atualizarUnidade } from "./actions";

const unidadeId = "11111111-1111-4111-8111-111111111111";
const origemId = "22222222-2222-4222-8222-222222222222";
const destinoId = "33333333-3333-4333-8333-333333333333";

function formulario(alteracoes: Record<string, string> = {}) {
  const form = new FormData();
  for (const [chave, valor] of Object.entries({
    id: unidadeId,
    empreendimentoId: destinoId,
    identificacao: "  Sala   São José 01  ",
    tipo: "comercial",
    ...alteracoes,
  })) form.set(chave, valor);
  return form;
}

async function executar(form = formulario()) {
  await expect(atualizarUnidade(form)).rejects.toThrow("REDIRECT:");
  expect(mocks.redirect).toHaveBeenCalledTimes(1);
  const destino = new URL(mocks.redirect.mock.calls[0][0], "https://brisa.invalid");
  expect(destino.pathname).toBe("/cadastros/unidades");
  return destino.searchParams;
}

function semAlteracoes() {
  expect(mocks.atualizarUnidade).not.toHaveBeenCalled();
  expect(mocks.atualizarRecebimentos).not.toHaveBeenCalled();
  expect(mocks.revalidar).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.acesso.mockResolvedValue({ perfil: "ADMINISTRADOR" });
  mocks.sessao.mockResolvedValue({ sub: "administrador" });
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });
  mocks.unidade.mockResolvedValue({ id: unidadeId, empreendimentoId: origemId });
  mocks.empreendimento.mockResolvedValue({ id: destinoId, ativo: true });
  mocks.governado.mockResolvedValue(null);
  mocks.atualizarUnidade.mockResolvedValue({ id: unidadeId, empreendimentoId: destinoId });
  mocks.atualizarRecebimentos.mockResolvedValue({ count: 4 });
  mocks.transacao.mockImplementation(async (operacao) => operacao({
    unidade: { findUnique: mocks.unidade, update: mocks.atualizarUnidade },
    empreendimento: { findUnique: mocks.empreendimento },
    recursoGovernado: { findUnique: mocks.governado },
    recebimento: { updateMany: mocks.atualizarRecebimentos },
  }));
});

describe("atualizarUnidade — correção do empreendimento na implantação", () => {
  it("move o mesmo imóvel e seus recebimentos sem exigir ausência de contratos", async () => {
    const retorno = await executar();

    expect(retorno.has("erro")).toBe(false);
    expect(retorno.get("ok")).toBeTruthy();
    expect(retorno.get("ok")).not.toBe("Imóvel atualizado.");
    expect(mocks.acesso).toHaveBeenCalledWith("cadastros.editar", { global: true });
    expect(mocks.sessao).toHaveBeenCalledTimes(1);
    expect(mocks.transacao).toHaveBeenCalledTimes(1);
    expect(mocks.unidade).toHaveBeenCalledWith({
      where: { id: unidadeId },
      select: { id: true, empreendimentoId: true },
    });
    expect(mocks.atualizarUnidade).toHaveBeenCalledExactlyOnceWith({
      where: { id: unidadeId },
      data: { empreendimentoId: destinoId, identificacao: "SALA SAO JOSE 01", tipo: "comercial" },
    });
    expect(mocks.atualizarRecebimentos).toHaveBeenCalledExactlyOnceWith({
      where: { contrato: { unidadeId } },
      data: { empreendimentoId: destinoId },
    });
    // Apenas o vínculo desnormalizado é atualizado: sem valores, taxas,
    // competências, pagamentos ou IDs de contratos novos.
    expect(Object.keys(mocks.atualizarRecebimentos.mock.calls[0][0].data)).toEqual(["empreendimentoId"]);
    expect(mocks.revalidar).toHaveBeenCalledWith("/", "layout");
  });

  it("valida a governança e o destino dentro da mesma transação", async () => {
    await executar();

    expect(mocks.governado).toHaveBeenCalledWith({
      where: { tipo_origemId: { tipo: "UNIDADE", origemId: unidadeId } },
      select: { status: true },
    });
    expect(mocks.governado).toHaveBeenCalledWith({
      where: { tipo_origemId: { tipo: "EMPREENDIMENTO", origemId: destinoId } },
      select: { status: true },
    });
    expect(mocks.empreendimento).toHaveBeenCalledWith({
      where: { id: destinoId }, select: { id: true, ativo: true },
    });
    expect(mocks.acesso.mock.invocationCallOrder[0]).toBeLessThan(mocks.sessao.mock.invocationCallOrder[0]);
    expect(mocks.sessao.mock.invocationCallOrder[0]).toBeLessThan(mocks.transacao.mock.invocationCallOrder[0]);
    expect(mocks.atualizarUnidade.mock.invocationCallOrder[0]).toBeLessThan(mocks.atualizarRecebimentos.mock.invocationCallOrder[0]);
  });

  it("edita nome e tipo sem movimentar recebimentos quando o empreendimento não muda", async () => {
    mocks.empreendimento.mockResolvedValue({ id: origemId, ativo: true });
    const retorno = await executar(formulario({ empreendimentoId: origemId, tipo: "residencial" }));

    expect(retorno.get("ok")).toBe("Imóvel atualizado.");
    expect(mocks.atualizarUnidade).toHaveBeenCalledWith({
      where: { id: unidadeId },
      data: { empreendimentoId: origemId, identificacao: "SALA SAO JOSE 01", tipo: "residencial" },
    });
    expect(mocks.atualizarRecebimentos).not.toHaveBeenCalled();
    expect(mocks.revalidar).not.toHaveBeenCalledWith("/", "layout");
    expect(mocks.revalidar).toHaveBeenCalledWith("/cadastros", "layout");
    expect(mocks.revalidar).toHaveBeenCalledWith("/recebimentos");
  });

  it("permite corrigir o cadastro mantendo o empreendimento atual inativo", async () => {
    mocks.empreendimento.mockResolvedValue({ id: origemId, ativo: false });
    const retorno = await executar(formulario({ empreendimentoId: origemId }));

    expect(retorno.has("erro")).toBe(false);
    expect(mocks.atualizarUnidade).toHaveBeenCalledTimes(1);
    expect(mocks.atualizarRecebimentos).not.toHaveBeenCalled();
  });

  it("não inicia transação sem permissão global de editar cadastros", async () => {
    mocks.acesso.mockRejectedValue(new Error("ACESSO_NEGADO"));

    await expect(atualizarUnidade(formulario())).rejects.toThrow("ACESSO_NEGADO");

    expect(mocks.sessao).not.toHaveBeenCalled();
    expect(mocks.transacao).not.toHaveBeenCalled();
    semAlteracoes();
  });

  it("não inicia transação sem sessão", async () => {
    mocks.sessao.mockRejectedValue(new Error("SESSAO_AUSENTE"));

    await expect(atualizarUnidade(formulario())).rejects.toThrow("SESSAO_AUSENTE");

    expect(mocks.transacao).not.toHaveBeenCalled();
    semAlteracoes();
  });

  it("recusa ID vazio antes de consultar a base", async () => {
    const retorno = await executar(formulario({ id: "   " }));

    expect(retorno.get("erro")).toBe("Imóvel não informado.");
    expect(mocks.transacao).not.toHaveBeenCalled();
    expect(mocks.governado).not.toHaveBeenCalled();
    semAlteracoes();
  });

  it("recusa um imóvel que não existe", async () => {
    mocks.unidade.mockResolvedValue(null);
    const retorno = await executar();

    expect(retorno.get("erro")).toBe("Imóvel não encontrado.");
    semAlteracoes();
  });

  it.each(["EXCLUIDO", "MESCLADO"])("não restaura implicitamente imóvel %s", async (status) => {
    mocks.governado.mockImplementation(async ({ where }) => (
      where.tipo_origemId.tipo === "UNIDADE" ? { status } : null
    ));
    const retorno = await executar();

    expect(retorno.get("erro")).toContain("Este imóvel foi excluído ou mesclado.");
    semAlteracoes();
  });

  it("recusa empreendimento de destino ausente", async () => {
    mocks.empreendimento.mockResolvedValue(null);
    const retorno = await executar();

    expect(retorno.get("erro")).toBe("Empreendimento não encontrado.");
    expect(retorno.get("editar")).toBe(unidadeId);
    semAlteracoes();
  });

  it("recusa mudança para empreendimento inativo", async () => {
    mocks.empreendimento.mockResolvedValue({ id: destinoId, ativo: false });
    const retorno = await executar();

    expect(retorno.get("erro")).toBe("Selecione um empreendimento ativo para o imóvel.");
    semAlteracoes();
  });

  it.each(["EXCLUIDO", "MESCLADO"])("recusa empreendimento de destino %s", async (status) => {
    mocks.governado.mockImplementation(async ({ where }) => (
      where.tipo_origemId.tipo === "EMPREENDIMENTO" ? { status } : null
    ));
    const retorno = await executar();

    expect(retorno.get("erro")).toBe("Este empreendimento foi excluído ou mesclado.");
    semAlteracoes();
  });

  it.each([
    [{ empreendimentoId: "" }, "Selecione o empreendimento."],
    [{ identificacao: "" }, "Informe uma identificação com até 120 caracteres."],
    [{ identificacao: "a".repeat(121) }, "Informe uma identificação com até 120 caracteres."],
    [{ tipo: "inexistente" }, "Selecione um tipo de imóvel válido."],
  ])("valida dados do formulário antes de modificar vínculos (%j)", async (campos, mensagem) => {
    const retorno = await executar(formulario(campos));

    expect(retorno.get("erro")).toBe(mensagem);
    semAlteracoes();
  });

  it("mantém a proteção contra identificação duplicada no destino (P2002)", async () => {
    mocks.atualizarUnidade.mockRejectedValue({ code: "P2002" });
    const retorno = await executar();

    expect(retorno.get("erro")).toBe("Essa identificação já existe no empreendimento selecionado.");
    expect(retorno.get("editar")).toBe(unidadeId);
    expect(mocks.atualizarRecebimentos).not.toHaveBeenCalled();
    expect(mocks.revalidar).not.toHaveBeenCalled();
  });

  it("não confirma sucesso nem revalida se a atualização de recebimentos falhar", async () => {
    mocks.atualizarRecebimentos.mockRejectedValue(new Error("FALHA_RECEBIMENTOS"));
    const retorno = await executar();

    expect(retorno.get("erro")).toBe("Não foi possível atualizar o imóvel.");
    expect(retorno.has("ok")).toBe(false);
    expect(mocks.transacao).toHaveBeenCalledTimes(1);
    expect(mocks.atualizarUnidade).toHaveBeenCalledTimes(1);
    expect(mocks.atualizarRecebimentos).toHaveBeenCalledTimes(1);
    expect(mocks.revalidar).not.toHaveBeenCalled();
  });
});
