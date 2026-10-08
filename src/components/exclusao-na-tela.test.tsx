import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ acesso: vi.fn(), previa: vi.fn(), eventos: vi.fn(), executar: vi.fn(), executarNaTela: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/acesso/servidor", () => ({ exigirPermissaoAcesso: mocks.acesso }));
vi.mock("@/lib/db", () => ({ prisma: { eventoGovernanca: { findMany: mocks.eventos } } }));
vi.mock("@/lib/governanca/servico", () => ({ previaGovernanca: mocks.previa }));
vi.mock("@/app/(app)/cadastros/governanca/actions", () => ({ executarGovernanca: mocks.executar, executarGovernancaNaTela: mocks.executarNaTela }));
vi.mock("@/components/formulario-na-tela", () => ({ FormularioNaTela: ({ action, children, className }: { action: unknown; children: ReactNode; className?: string }) => <form data-inline-action={action === mocks.executarNaTela ? "governanca" : "outra"} className={className}>{children}</form> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));

import { TelaExclusao } from "@/app/(app)/cadastros/governanca/exclusao";
import { ErroGovernanca } from "@/lib/governanca/tipos";

const contexto = { retorno: "/financeiro/contas-a-pagar?origem=WIDESYS&mes=2026-06&pagina=3&registro=WIDESYS%3APAGAR%3At1&acaoRegistro=excluir" };
const previa = (status = "ATIVO") => ({ status, nome: "Fornecedor de teste", referencia: "Título quitado · junho", valor: 15000, assinatura: "a".repeat(64), vinculos: { pagamentos: 2, contratos: 1 } });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.acesso.mockResolvedValue({ usuarioId: "admin-teste", perfil: "ADMINISTRADOR" });
  mocks.previa.mockResolvedValue(previa());
  mocks.eventos.mockResolvedValue([{ id: "e1", acao: "RESTAURADO", motivo: "Conferido com o extrato", criadoEm: new Date("2026-10-01T12:00:00Z") }]);
});

describe("exclusão administrativa dentro da lista", () => {
  it("mantém identidade, assinatura, ciência e histórico sem navegação ou mutação no render", async () => {
    const html = renderToStaticMarkup(await TelaExclusao({ tipo: "TITULO", origemId: "WIDESYS:PAGAR:t1", contexto }));
    expect(html).toContain('data-inline-action="governanca"');
    expect(html).toContain('name="tipo" value="TITULO"');
    expect(html).toContain('name="origemId" value="WIDESYS:PAGAR:t1"');
    expect(html).toContain('name="assinaturaPrevia" value="' + "a".repeat(64) + '"');
    expect(html).toContain('name="confirmar" value="sim"');
    expect(html).toContain('name="cienciaExclusao"');
    expect(html).toContain('name="retornoContexto"');
    expect(html).toContain("pagina=3");
    expect(html).toMatch(/<button\b(?=[^>]*name="acao")(?=[^>]*value="excluir-plataforma")/);
    expect(html).toContain('minLength="5"');
    expect(html).toContain('maxLength="500"');
    expect(html).toContain("Confirmar exclusão");
    expect(html).toContain("pagamentos");
    expect(html).toContain("Conferido com o extrato");
    expect(html).toContain("não estorna pagamento");
    expect(html).toContain("feche esta janela");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("Ver lixeira");
    expect(html).not.toContain("<h1");
    expect(mocks.executar).not.toHaveBeenCalled();
    expect(mocks.executarNaTela).not.toHaveBeenCalled();
  });

  it("oferece restauração com a nova assinatura após exclusão, também na própria janela", async () => {
    mocks.previa.mockResolvedValue({ ...previa("EXCLUIDO"), assinatura: "b".repeat(64) });
    const html = renderToStaticMarkup(await TelaExclusao({ tipo: "TITULO", origemId: "WIDESYS:PAGAR:t1", contexto }));
    expect(html).toContain("Registro excluído da plataforma");
    expect(html).toContain("Por que restaurar?");
    expect(html).toMatch(/<button\b(?=[^>]*name="acao")(?=[^>]*value="restaurar")/);
    expect(html).toContain('name="assinaturaPrevia" value="' + "b".repeat(64) + '"');
    expect(html).toContain("sem emitir cobranças ou disparar mensagens");
    expect(html).not.toContain("Confirmar exclusão");
    expect(html).not.toContain("<a ");
  });

  it("preserva a navegação e formulário da tela independente", async () => {
    const html = renderToStaticMarkup(await TelaExclusao({ tipo: "TITULO", origemId: "WIDESYS:PAGAR:t1" }));
    expect(html).toContain('href="/cadastros/governanca?modo=lixeira"');
    expect(html).toContain('href="/financeiro/dados"');
    expect(html).toContain("Voltar sem alterar");
    expect(html).not.toContain('data-inline-action="governanca"');
    expect(html).not.toContain('name="retornoContexto"');
  });

  it("nega o popup ao financeiro antes de ler prévia e eventos", async () => {
    mocks.acesso.mockResolvedValue({ usuarioId: "financeiro-teste", perfil: "FINANCEIRO" });
    await expect(TelaExclusao({ tipo: "TITULO", origemId: "WIDESYS:PAGAR:t1", contexto })).rejects.toThrow("NOT_FOUND");
    expect(mocks.acesso).toHaveBeenCalledWith("governanca.editar", { global: true });
    expect(mocks.previa).not.toHaveBeenCalled();
    expect(mocks.eventos).not.toHaveBeenCalled();
  });

  it("não mostra formulário quando a identidade é inválida", async () => {
    mocks.previa.mockRejectedValue(new ErroGovernanca("IDENTIDADE_INVALIDA", "Identidade inválida"));
    await expect(TelaExclusao({ tipo: "TITULO", origemId: "", contexto })).rejects.toThrow("NOT_FOUND");
    expect(mocks.eventos).not.toHaveBeenCalled();
    expect(mocks.executarNaTela).not.toHaveBeenCalled();
  });

  it("escapa mensagens e dados recebidos sem interpretar HTML", async () => {
    mocks.previa.mockResolvedValue({ ...previa(), nome: "<script>nome</script>" });
    const html = renderToStaticMarkup(await TelaExclusao({ tipo: "TITULO", origemId: "WIDESYS:PAGAR:t1", contexto, erro: "<img src=x onerror=alert(1)>", ok: "<script>ok</script>" }));
    expect(html).toContain("&lt;script&gt;nome&lt;/script&gt;");
    expect(html).toContain('role="alert"');
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<script>nome");
    expect(html).not.toContain("<img src=x");
  });
});
