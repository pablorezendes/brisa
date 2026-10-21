import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acesso: vi.fn(), sessao: vi.fn(), revalidar: vi.fn(), redirect: vi.fn(),
  conta: vi.fn(), outraConta: vi.fn(), atualizar: vi.fn(), atualizarMuitas: vi.fn(),
  titulos: vi.fn(), politica: vi.fn(), atualizarPolitica: vi.fn(), transacao: vi.fn(),
  governado: vi.fn(), inativos: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/acesso/servidor", () => ({ exigirPermissaoAcesso: mocks.acesso }));
vi.mock("@/lib/autorizacao", () => ({ exigirPermissaoFinanceira: mocks.sessao }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidar }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: mocks.transacao } }));

import { atualizarCadastroContaBancaria, atualizarContaBancaria, atualizarPoliticaCobrancaSicoob } from "./actions";

const id = "11111111-1111-4111-8111-111111111111";
const atual = {
  id, ativa: true, padrao: true, numeroCliente: "123", numeroContaCorrenteApi: "456",
  codigoEspecieDocumento: "RC", codigoModalidade: 1, numeroContratoCobranca: null,
  integracaoHabilitada: true, ambiente: "PRODUCAO",
};
function formulario(valores: Record<string, string> = {}) {
  const form = new FormData();
  for (const [chave, valor] of Object.entries({
    id, apelido: "Conta de exemplo", finalidade: "OPERACIONAL", ativa: "on", padrao: "on",
    numeroCliente: "123", numeroContaCorrenteApi: "456", codigoEspecieDocumento: "RC",
    codigoModalidade: "1", ambiente: "PRODUCAO", integracaoHabilitada: "on",
    retorno: "/integracoes/sicoob", ...valores,
  })) form.set(chave, valor);
  return form;
}

describe("separação entre cadastro bancário e integração", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acesso.mockResolvedValue({ perfil: "ADMINISTRADOR" });
    mocks.sessao.mockResolvedValue({ sub: "administrador" });
    mocks.redirect.mockImplementation((url) => { throw new Error("REDIRECT:" + url); });
    mocks.conta.mockResolvedValue(atual);
    mocks.outraConta.mockResolvedValue(null);
    mocks.titulos.mockResolvedValue(0);
    mocks.politica.mockResolvedValue({ id: "politica" });
    mocks.governado.mockResolvedValue(null);
    mocks.inativos.mockResolvedValue([]);
    mocks.transacao.mockImplementation(async (fn) => fn({
      contaBancaria: { findUnique: mocks.conta, findFirst: mocks.outraConta, update: mocks.atualizar, updateMany: mocks.atualizarMuitas },
      boleto: { count: mocks.titulos },
      configuracaoCobrancaSicoob: { findUnique: mocks.politica, update: mocks.atualizarPolitica },
      recursoGovernado: { findUnique: mocks.governado, findMany: mocks.inativos },
    }));
  });

  it("cadastro simples ignora campos bancários e de ativação injetados", async () => {
    await expect(atualizarCadastroContaBancaria(formulario({
      retorno: "/financeiro/contas-bancarias", agencia: "alterada", boletosHabilitados: "on",
    }))).rejects.toThrow("REDIRECT:/financeiro/contas-bancarias?ok=");
    expect(mocks.atualizar).toHaveBeenCalledWith({
      where: { id },
      data: { apelido: "Conta de exemplo", finalidade: "OPERACIONAL", padrao: true, atualizadoPorUsuarioId: "administrador" },
    });
    expect(mocks.revalidar).toHaveBeenCalledWith("/integracoes/sicoob");
    expect(mocks.revalidar).toHaveBeenCalledWith("/financeiro/contas-bancarias");
  });

  it("rejeita alteração direta sem permissão antes de acessar dados", async () => {
    mocks.acesso.mockRejectedValue(new Error("NEGADO"));
    await expect(atualizarCadastroContaBancaria(formulario())).rejects.toThrow("NEGADO");
    expect(mocks.transacao).not.toHaveBeenCalled();
    expect(mocks.atualizar).not.toHaveBeenCalled();
  });

  it("não altera conta na lixeira por formulário aberto antes da exclusão", async () => {
    mocks.governado.mockResolvedValue({ status: "EXCLUIDO" });
    await expect(atualizarCadastroContaBancaria(formulario({ retorno: "/financeiro/contas-bancarias" })))
      .rejects.toThrow("REDIRECT:/financeiro/contas-bancarias?erro=");
    expect(mocks.governado).toHaveBeenCalledWith({
      where: { tipo_origemId: { tipo: "CONTA", origemId: id } }, select: { status: true },
    });
    expect(mocks.conta).not.toHaveBeenCalled();
    expect(mocks.atualizar).not.toHaveBeenCalled();
    expect(mocks.atualizarMuitas).not.toHaveBeenCalled();
  });

  it("conta padrão excluída não permite desmarcar a última padrão visível", async () => {
    mocks.inativos.mockResolvedValue([{ origemId: "padrao-excluida" }]);
    await expect(atualizarCadastroContaBancaria(formulario({ padrao: "" })))
      .rejects.toThrow("REDIRECT:/integracoes/sicoob?erro=");
    expect(mocks.outraConta).toHaveBeenCalledWith({
      where: { AND: [{ id: { not: id }, padrao: true, ativa: true }, { id: { notIn: ["padrao-excluida"] } }] },
      select: { id: true },
    });
    expect(mocks.atualizar).not.toHaveBeenCalled();
  });

  it.each(["integracoes.gerenciar", "boletos.configurar"])("ações da integração exigem %s mesmo com contas.editar", async (permissao) => {
    mocks.acesso.mockImplementation(async (codigo) => {
      if (codigo === permissao) throw new Error("NEGADO");
    });
    await expect(atualizarContaBancaria(formulario())).rejects.toThrow("NEGADO");
    await expect(atualizarPoliticaCobrancaSicoob(formulario())).rejects.toThrow("NEGADO");
    expect(mocks.transacao).not.toHaveBeenCalled();
    expect(mocks.atualizar).not.toHaveBeenCalled();
  });

  it("edição simples não exige autorização para configurar integração", async () => {
    mocks.acesso.mockImplementation(async (codigo) => {
      if (codigo === "integracoes.gerenciar" || codigo === "boletos.configurar") throw new Error("NEGADO");
    });
    await expect(atualizarCadastroContaBancaria(formulario({ retorno: "/financeiro/contas-bancarias" })))
      .rejects.toThrow("REDIRECT:/financeiro/contas-bancarias?ok=");
    expect(mocks.atualizar).toHaveBeenCalledOnce();
  });

  it("não aceita destino externo de retorno", async () => {
    await expect(atualizarContaBancaria(formulario({ id: "invalido", retorno: "https://externo.invalid" })))
      .rejects.toThrow("REDIRECT:/financeiro/contas-bancarias?erro=");
    expect(mocks.transacao).not.toHaveBeenCalled();
  });

  it("volta à conta na integração após salvar sem ativar automaticamente boletos", async () => {
    await expect(atualizarContaBancaria(formulario())).rejects.toThrow("REDIRECT:/integracoes/sicoob?ok=");
    expect(mocks.redirect.mock.calls[0][0]).toContain("#conta-" + id);
    expect(mocks.atualizar.mock.calls[0][0].data.boletosHabilitados).toBe(false);
    expect(mocks.revalidar).toHaveBeenCalledWith("/integracoes/sicoob");
  });

  it("continua bloqueando mudança de identidade com títulos ativos", async () => {
    mocks.titulos.mockResolvedValue(1);
    await expect(atualizarContaBancaria(formulario({ numeroCliente: "789" }))).rejects.toThrow("REDIRECT:/integracoes/sicoob?erro=");
    expect(decodeURIComponent(mocks.redirect.mock.calls[0][0])).toContain("títulos+ativos");
    expect(mocks.atualizar).not.toHaveBeenCalled();
  });

  it("continua exigindo confirmação explícita da primeira ativação em produção", async () => {
    mocks.conta.mockResolvedValue({ ...atual, integracaoHabilitada: false });
    await expect(atualizarContaBancaria(formulario())).rejects.toThrow("REDIRECT:/integracoes/sicoob?erro=");
    expect(mocks.atualizar).not.toHaveBeenCalled();
    expect(decodeURIComponent(mocks.redirect.mock.calls[0][0])).toContain("Confirme+conscientemente");
  });

  it("validação de política também mantém a pessoa na integração", async () => {
    const form = formulario({ contaBancariaId: id, aceite: "N", toleranciaPagamentoDias: "999", diasProtesto: "0" });
    await expect(atualizarPoliticaCobrancaSicoob(form)).rejects.toThrow("REDIRECT:/integracoes/sicoob?erro=");
    expect(mocks.atualizarPolitica).not.toHaveBeenCalled();
  });

  it("política salva não altera títulos ou habilitação da conta", async () => {
    const form = formulario({ contaBancariaId: id, aceite: "N", toleranciaPagamentoDias: "30", diasProtesto: "0", mensagensCobranca: "Obrigado" });
    await expect(atualizarPoliticaCobrancaSicoob(form)).rejects.toThrow("REDIRECT:/integracoes/sicoob?ok=");
    expect(mocks.atualizar).toHaveBeenCalledWith({ where: { id }, data: { atualizadoPorUsuarioId: "administrador" } });
    expect(mocks.atualizarPolitica).toHaveBeenCalledOnce();
  });
});
