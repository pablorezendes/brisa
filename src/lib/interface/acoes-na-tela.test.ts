import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acesso: vi.fn(), financeiro: vi.fn(), decidir: vi.fn(), analisar: vi.fn(),
  excluirAdministrativamente: vi.fn(), excluir: vi.fn(), mesclar: vi.fn(), descartar: vi.fn(), inativar: vi.fn(), restaurar: vi.fn(),
  revalidar: vi.fn(), redirecionar: vi.fn(),
}));
vi.mock("@/lib/acesso/servidor", () => ({ exigirPermissaoAcesso: mocks.acesso }));
vi.mock("@/lib/autorizacao", () => ({ exigirPermissaoFinanceira: mocks.financeiro }));
vi.mock("@/lib/db", () => ({ prisma: { identificador: "mock-sem-conexao" } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidar }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirecionar }));
vi.mock("@/lib/unificacao/servico", () => ({
  analisarUnificacao: mocks.analisar,
  decidirUnificacao: mocks.decidir,
  ErroUnificacao: class ErroUnificacao extends Error {
    constructor(public codigo: string, mensagem: string) { super(mensagem); }
  },
}));
vi.mock("@/lib/governanca/servico", () => ({
  excluirAdministrativamente: mocks.excluirAdministrativamente,
  excluirRecurso: mocks.excluir, mesclarRecursos: mocks.mesclar, descartarTitulo: mocks.descartar, inativarConta: mocks.inativar, restaurarRecurso: mocks.restaurar,
}));

import { prisma } from "@/lib/db";
import { ErroUnificacao } from "@/lib/unificacao/servico";
import { ErroGovernanca } from "@/lib/governanca/tipos";
import { executarGovernancaNaTela } from "@/app/(app)/cadastros/governanca/actions";
import { resolverUnificacaoNaTela, sincronizarUnificacaoNaTela } from "@/app/(app)/unificacao/actions";
import type { ResultadoNaTela } from "./resultado-na-tela";

function formulario(extras: Record<string, string> = {}) {
  const form = new FormData();
  for (const [nome, valor] of Object.entries({
    chave: "WIDESYS:PAGAR:titulo-1", versao: "2", acao: "DISTINTO", hashFonte: "hash-original", justificativa: "Competência e contrato conferidos",
    tipo: "TITULO", origemId: "WIDESYS:PAGAR:titulo-1", confirmar: "sim", cienciaExclusao: "sim", assinaturaPrevia: "a".repeat(64), motivo: "Duplicata confirmada pelo administrador", modo: "excluir",
    retornoContexto: "/financeiro/contas-a-pagar?pagina=2&registro=WIDESYS%3APAGAR%3Atitulo-1&painel=detalhe", ...extras,
  })) form.set(nome, valor);
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.acesso.mockResolvedValue({ usuarioId: "usuario-da-sessao", perfil: "ADMINISTRADOR" });
  mocks.financeiro.mockResolvedValue({ sub: "usuario-financeiro-da-sessao" });
  mocks.decidir.mockResolvedValue(undefined);
  mocks.analisar.mockResolvedValue(undefined);
  mocks.excluirAdministrativamente.mockResolvedValue(undefined);
});

const ACOES = [
  ["resolver", resolverUnificacaoNaTela, "unificacao.editar"],
  ["reanalisar", sincronizarUnificacaoNaTela, "unificacao.editar"],
  ["governança", executarGovernancaNaTela, "governanca.editar"],
] as const;
const operacoes = [mocks.decidir, mocks.analisar, mocks.excluirAdministrativamente, mocks.excluir, mocks.mesclar, mocks.descartar, mocks.inativar, mocks.restaurar];

describe("autorização antes de qualquer processamento inline", () => {
  it.each(ACOES)("%s exige permissão global antes de ler formulário ou executar serviço", async (_nome, acao, permissao) => {
    const negado = new Error("ACESSO_NEGADO");
    mocks.acesso.mockRejectedValue(negado);
    const form = formulario();
    const ler = vi.spyOn(form, "get");
    await expect(acao({}, form)).rejects.toBe(negado);
    expect(mocks.acesso).toHaveBeenCalledExactlyOnceWith(permissao, { global: true });
    expect(ler).not.toHaveBeenCalled();
    expect(mocks.financeiro).not.toHaveBeenCalled();
    for (const operacao of operacoes) expect(operacao).not.toHaveBeenCalled();
    expect(mocks.revalidar).not.toHaveBeenCalled();
    expect(mocks.redirecionar).not.toHaveBeenCalled();
  });

  it.each(ACOES.slice(0, 2))("%s também exige a autorização financeira antes de acessar os dados", async (_nome, acao) => {
    const negado = new Error("PERFIL_FINANCEIRO_NEGADO");
    mocks.financeiro.mockRejectedValue(negado);
    const form = formulario();
    const ler = vi.spyOn(form, "get");
    await expect(acao({}, form)).rejects.toBe(negado);
    expect(mocks.financeiro).toHaveBeenCalledExactlyOnceWith("CONCILIAR_PAGAMENTOS");
    expect(mocks.acesso.mock.invocationCallOrder[0]).toBeLessThan(mocks.financeiro.mock.invocationCallOrder[0]);
    expect(ler).not.toHaveBeenCalled();
    expect(mocks.decidir).not.toHaveBeenCalled(); expect(mocks.analisar).not.toHaveBeenCalled();
    expect(mocks.revalidar).not.toHaveBeenCalled(); expect(mocks.redirecionar).not.toHaveBeenCalled();
  });

  it("excluir conta mantém a exigência adicional de contas.editar", async () => {
    const negado = new Error("CONTA_NEGADA");
    mocks.acesso.mockResolvedValueOnce({ usuarioId: "usuario-da-sessao", perfil: "ADMINISTRADOR" }).mockRejectedValueOnce(negado);
    await expect(executarGovernancaNaTela({}, formulario({ tipo: "CONTA", origemId: "c1", acao: "excluir-plataforma" }))).rejects.toBe(negado);
    expect(mocks.acesso).toHaveBeenNthCalledWith(2, "contas.editar", { global: true });
    expect(mocks.excluirAdministrativamente).not.toHaveBeenCalled();
    expect(mocks.revalidar).not.toHaveBeenCalled(); expect(mocks.redirecionar).not.toHaveBeenCalled();
  });
});

describe("decisão e reanálise permanecem na tela", () => {
  it("resolução revalida lista e totais, retorna sucesso e ignora retorno/ator forjados", async () => {
    const resultado = await resolverUnificacaoNaTela({ erro: "aviso anterior" }, formulario({
      destinoChave: "BRISA:PAGAR:principal", hashDestino: "hash-destino", retornoContexto: "https://externo.test", usuarioId: "outro", administrador: "true",
    }));
    expect(mocks.decidir).toHaveBeenCalledExactlyOnceWith(prisma, {
      chave: "WIDESYS:PAGAR:titulo-1", versao: 2, acao: "DISTINTO", hashFonte: "hash-original", justificativa: "Competência e contrato conferidos", destinoChave: "BRISA:PAGAR:principal", hashDestino: "hash-destino",
    }, "usuario-financeiro-da-sessao");
    expect(resultado).toEqual({ ok: expect.stringContaining("lista e os totais") });
    expect(mocks.revalidar).toHaveBeenCalledExactlyOnceWith("/", "layout");
    expect(mocks.redirecionar).not.toHaveBeenCalled();
  });

  it("erro de concorrência é um estado do próprio formulário, sem redirecionamento", async () => {
    mocks.decidir.mockRejectedValue(new ErroUnificacao("VERSAO", "Este registro mudou. Confira novamente."));
    expect(await resolverUnificacaoNaTela({ ok: "antigo" }, formulario())).toEqual({ erro: "Este registro mudou. Confira novamente." });
    expect(mocks.revalidar).toHaveBeenCalledExactlyOnceWith("/", "layout");
    expect(mocks.redirecionar).not.toHaveBeenCalled();
  });

  it("reanálise usa o usuário autenticado e não muda de página", async () => {
    const resultado = await sincronizarUnificacaoNaTela({ erro: "antigo" }, formulario({ usuarioId: "forjado", retornoContexto: "//externo.test" }));
    expect(mocks.analisar).toHaveBeenCalledExactlyOnceWith(prisma, "usuario-financeiro-da-sessao");
    expect(resultado).toEqual({ ok: expect.stringContaining("Nenhum dado novo foi buscado no Widesys") });
    expect(mocks.revalidar).toHaveBeenCalledExactlyOnceWith("/", "layout");
    expect(mocks.redirecionar).not.toHaveBeenCalled();
  });

  it("reanálise apresenta erro esperado no próprio formulário", async () => {
    mocks.analisar.mockRejectedValue(new ErroUnificacao("CONFLITO", "Outra análise está em andamento."));
    expect(await sincronizarUnificacaoNaTela({}, formulario())).toEqual({ erro: "Outra análise está em andamento." });
    expect(mocks.redirecionar).not.toHaveBeenCalled();
  });
});

describe("governança inline mantém confirmação, identidade e histórico", () => {
  it("exclusão retorna sucesso usando identidade da sessão e revalida sem sair da lista", async () => {
    const resultado = await executarGovernancaNaTela({ erro: "antigo" }, formulario({ acao: "excluir-plataforma", usuarioId: "forjado", administrador: "false", retornoContexto: "https://externo.test" }));
    expect(mocks.excluirAdministrativamente).toHaveBeenCalledExactlyOnceWith(prisma, "TITULO", "WIDESYS:PAGAR:titulo-1", "Duplicata confirmada pelo administrador", {
      id: "usuario-da-sessao", administrador: true, assinaturaPrevia: "a".repeat(64),
    });
    expect(resultado).toEqual({ ok: expect.stringContaining("nenhum registro foi apagado fisicamente") });
    expect(mocks.revalidar).toHaveBeenCalledExactlyOnceWith("/", "layout"); expect(mocks.redirecionar).not.toHaveBeenCalled();
  });

  it.each([
    ["confirmar", ""], ["cienciaExclusao", ""], ["assinaturaPrevia", ""], ["assinaturaPrevia", "assinatura-forjada"],
  ])("não executa exclusão com %s inválido e devolve orientação na tela", async (campo, valor) => {
    const resultado = await executarGovernancaNaTela({}, formulario({ acao: "excluir-plataforma", [campo]: valor }));
    expect(resultado).toEqual({ erro: expect.any(String) });
    expect(mocks.excluirAdministrativamente).not.toHaveBeenCalled(); expect(mocks.redirecionar).not.toHaveBeenCalled();
  });

  it("não promove financeiro a administrador pelos campos enviados", async () => {
    mocks.acesso.mockResolvedValue({ usuarioId: "financeiro-real", perfil: "FINANCEIRO" });
    mocks.excluirAdministrativamente.mockRejectedValue(new ErroGovernanca("ADMIN", "Somente um administrador pode excluir."));
    expect(await executarGovernancaNaTela({}, formulario({ acao: "excluir-plataforma", administrador: "true", perfil: "ADMINISTRADOR" }))).toEqual({ erro: "Somente um administrador pode excluir." });
    expect(mocks.excluirAdministrativamente).toHaveBeenCalledWith(prisma, "TITULO", "WIDESYS:PAGAR:titulo-1", expect.any(String), expect.objectContaining({ id: "financeiro-real", administrador: false }));
    expect(mocks.redirecionar).not.toHaveBeenCalled();
  });

  it("restaurar mantém ciência obrigatória e usa o serviço reversível", async () => {
    const invalido = await executarGovernancaNaTela({}, formulario({ acao: "restaurar", cienciaExclusao: "" }));
    expect(invalido).toEqual({ erro: expect.stringContaining("ciência") });
    expect(mocks.restaurar).not.toHaveBeenCalled();
    const valido = await executarGovernancaNaTela({}, formulario({ acao: "restaurar" }));
    expect(valido).toEqual({ ok: expect.any(String) });
    expect(mocks.restaurar).toHaveBeenCalledExactlyOnceWith(prisma, "TITULO", "WIDESYS:PAGAR:titulo-1", expect.any(String), expect.objectContaining({ id: "usuario-da-sessao" }));
    expect(mocks.redirecionar).not.toHaveBeenCalled();
  });
});

describe("falhas inesperadas não viram mensagens sensíveis do formulário", () => {
  it.each([
    ["resolver", resolverUnificacaoNaTela, mocks.decidir, "DISTINTO"],
    ["reanalisar", sincronizarUnificacaoNaTela, mocks.analisar, "DISTINTO"],
    ["governança", executarGovernancaNaTela, mocks.excluirAdministrativamente, "excluir-plataforma"],
  ] as const)("%s delega exceção ao tratamento do servidor em vez de serializar detalhes", async (_nome, acao, servico, nomeAcao) => {
    const segredo = new Error("SQL internals; token=nao-pode-ir-para-o-formulario");
    servico.mockRejectedValue(segredo);
    let estado: ResultadoNaTela | undefined;
    await expect(acao({}, formulario({ acao: nomeAcao })).then(resultado => { estado = resultado; })).rejects.toBe(segredo);
    expect(estado).toBeUndefined();
    expect(mocks.revalidar).not.toHaveBeenCalled(); expect(mocks.redirecionar).not.toHaveBeenCalled();
  });
});
