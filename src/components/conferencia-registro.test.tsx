import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoliticaAcesso } from "@/lib/acesso/politica";
import type { LinhaUnificada } from "@/lib/unificacao/tipos";

const mocks = vi.hoisted(() => ({ perfil: vi.fn(), acesso: vi.fn(), pagina: vi.fn(), permissao: vi.fn(), detalhe: vi.fn(), resolver: vi.fn(), resolverNaTela: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/autorizacao", () => ({ perfilAtual: mocks.perfil }));
vi.mock("@/lib/acesso/servidor", () => ({ acessoAtual: mocks.acesso, exigirPaginaAcesso: mocks.pagina, exigirPermissaoAcesso: mocks.permissao }));
vi.mock("@/lib/consultas/unificacao", () => ({ detalheUnificado: mocks.detalhe }));
vi.mock("@/app/(app)/unificacao/actions", () => ({ resolverUnificacao: mocks.resolver, resolverUnificacaoNaTela: mocks.resolverNaTela }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next/form", () => ({ default: ({ children, action, scroll }: { children: ReactNode; action: string; scroll?: boolean }) => <form action={action} data-scroll={String(scroll)}>{children}</form> }));
vi.mock("@/components/formulario-na-tela", () => ({ FormularioNaTela: ({ children, action, className }: { children: ReactNode; action: unknown; className?: string }) => <form className={className} data-inline-action={action === mocks.resolverNaTela ? "resolver" : "outra"}>{children}</form> }));
vi.mock("@/components/excluir-registro-link", () => ({ ExcluirUnificadoLink: () => <a href="/cadastros/governanca?modo=excluir">Excluir da plataforma</a> }));

import { ConferenciaRegistro } from "./conferencia-registro";

function registro(extras: Partial<LinhaUnificada> = {}): LinhaUnificada {
  return { chave: "WIDESYS:PAGAR:t1", dominio: "PAGAR", origem: "WIDESYS", origemId: "t1", titulo: "Fornecedor de teste", descricao: "Despesa de teste", href: "/origem-separada", hash: "hash-1", qualidade: "OK", motivos: [], campos: { pessoa: { rotulo: "Pessoa", valor: "Pessoa permitida" } }, nomeNorm: "FORNECEDOR", estado: "PENDENTE", origens: ["WIDESYS"], fontes: ["WIDESYS:PAGAR:t1"], versao: 2, candidatos: [], avisos: [], contabiliza: false, divergencias: [], ...extras };
}
const politica = (): PoliticaAcesso => ({ usuarioId: "admin-teste", perfil: "ADMINISTRADOR", ativo: true, global: true, regras: [], permissoes: ["cadastros.sensiveis", "unificacao.editar", "pagamentos.conciliar", "governanca.editar"] });
const contexto = {
  retorno: "/financeiro/contas-a-pagar?origem=WIDESYS&mes=2026-06&pagina=3&q=teste&estado=PENDENTE&vencidos=1",
  hrefDetalhe: "/financeiro/contas-a-pagar?origem=WIDESYS&mes=2026-06&pagina=3&q=teste&estado=PENDENTE&vencidos=1&registro=WIDESYS%3APAGAR%3At1&destino=antigo&buscarDestino=antiga&erro=antigo",
  hrefExcluir: "/financeiro/contas-a-pagar?origem=WIDESYS&mes=2026-06&pagina=3&registro=WIDESYS%3APAGAR%3At1&acaoRegistro=excluir",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.perfil.mockResolvedValue("ADMINISTRADOR");
  mocks.acesso.mockResolvedValue(politica());
  const principal = registro();
  const candidato = registro({ chave: "BRISA:PAGAR:t2", origem: "BRISA", origemId: "t2", estado: "ATIVO", titulo: "Principal de teste", origens: ["BRISA"], hash: "hash-2" });
  mocks.detalhe.mockResolvedValue({ registro: principal, candidatos: [candidato], fontes: [principal], historico: [], baixas: [] });
});

describe("conferência dentro da lista financeira", () => {
  it("preserva filtros na busca, comparação, exclusão e retorno da decisão", async () => {
    const html = renderToStaticMarkup(await ConferenciaRegistro({ chave: "WIDESYS:PAGAR:t1", parametros: { buscarDestino: "fornecedor" }, contexto }));
    expect(html).toContain('action="/financeiro/contas-a-pagar"');
    expect(html).toContain('data-scroll="false"');
    for (const [nome, valor] of Object.entries({ origem: "WIDESYS", mes: "2026-06", pagina: "3", q: "teste", estado: "PENDENTE", vencidos: "1", registro: "WIDESYS:PAGAR:t1" })) {
      expect(html).toContain(`type="hidden" name="${nome}" value="${valor}"`);
    }
    expect(html).not.toContain('name="destino"');
    expect(html).not.toContain('name="erro"');
    const comparar = html.match(/<a\b[^>]*href="([^"]+)"[^>]*>Comparar lado a lado<\/a>/)?.[1].replaceAll("&amp;", "&");
    const url = new URL(comparar!, "http://teste.local");
    expect(url.pathname).toBe("/financeiro/contas-a-pagar");
    expect(url.searchParams.get("pagina")).toBe("3");
    expect(url.searchParams.get("registro")).toBe("WIDESYS:PAGAR:t1");
    expect(url.searchParams.get("destino")).toBe("BRISA:PAGAR:t2");
    expect(url.searchParams.get("buscarDestino")).toBe("fornecedor");
    expect(url.searchParams.has("erro")).toBe(false);
    expect(url.hash).toBe("#comparacao");
    expect(html).toContain('name="retornoContexto"');
    expect(html).toContain('data-inline-action="resolver"');
    expect(html).toContain("acaoRegistro=excluir");
    expect(html).not.toContain('href="/origem-separada"');
    expect(html).not.toContain('href="/unificacao');
    expect(mocks.resolver).not.toHaveBeenCalled();
    expect(mocks.resolverNaTela).not.toHaveBeenCalled();
  });

  it("mostra comparação responsiva, evidência de planilha e baixas sem sair da janela nem revelar comissões", async () => {
    const reservado = { taxa: { rotulo: "Taxa", valor: "SEGREDO_TAXA" }, administracao: { rotulo: "Administração", valor: "SEGREDO_ADMIN" }, composicao: { rotulo: "Composição", valor: "SEGREDO_COMPOSICAO" } };
    const principal = registro({ campos: { ...registro().campos, ...reservado } });
    const candidato = registro({ chave: "BRISA:PAGAR:t2", titulo: "Principal de teste", estado: "ATIVO", campos: { ...registro().campos, ...reservado } });
    const planilha = registro({ chave: "BRISA:PAGAR:planilha", proveniencia: { arquivo: "fixture.xlsx", aba: "Caixa distinto", linha: 12 }, campos: reservado });
    const baixa = registro({ chave: "WIDESYS:BAIXA_PAGAR:b1", dominio: "BAIXA_PAGAR", data: "2026-06-10", valor: 10000, campos: { documento: { rotulo: "Documento", valor: "RECIBO-TESTE" }, ...reservado } });
    mocks.detalhe.mockResolvedValue({ registro: principal, candidatos: [candidato], fontes: [principal, planilha], historico: [], baixas: [baixa] });
    const html = renderToStaticMarkup(await ConferenciaRegistro({ chave: principal.chave, parametros: { destino: candidato.chave }, contexto }));
    expect(html).toContain('id="comparacao"');
    expect(html).toContain('name="destinoChave" value="BRISA:PAGAR:t2"');
    expect(html).toContain("sm:grid-cols-2");
    expect(html).not.toContain("min-w-[230px]");
    expect(html).toContain("fixture.xlsx");
    expect(html).toContain("Caixa distinto");
    expect(html).toContain("Linha: 12");
    expect(html).toContain("RECIBO-TESTE");
    expect(html).toContain("Somente consulta");
    expect(html).not.toContain("WIDESYS%3ABAIXA_PAGAR%3Ab1");
    expect(html).not.toContain("SEGREDO_");
  });

  it("não oferece vínculo ou distinção para dado inconsistente", async () => {
    const principal = registro({ qualidade: "QUARENTENA", estado: "QUARENTENA" });
    mocks.detalhe.mockResolvedValue({ registro: principal, candidatos: [], fontes: [principal], historico: [], baixas: [] });
    const html = renderToStaticMarkup(await ConferenciaRegistro({ chave: principal.chave, contexto }));
    expect(html).toContain("inconsistência ou ausência na origem");
    expect(html).not.toContain('name="justificativa"');
    expect(html).toContain("Excluir da plataforma");
  });

  it("financeiro sem conciliação consulta mas não recebe ações reservadas de decisão e exclusão", async () => {
    mocks.perfil.mockResolvedValue("FINANCEIRO");
    mocks.acesso.mockResolvedValue({ ...politica(), perfil: "FINANCEIRO", permissoes: ["cadastros.sensiveis", "governanca.editar", "unificacao.editar"] });
    const html = renderToStaticMarkup(await ConferenciaRegistro({ chave: "WIDESYS:PAGAR:t1", contexto }));
    expect(html).toContain("Fornecedor de teste");
    expect(html).not.toContain('name="justificativa"');
    expect(html).not.toContain("Excluir da plataforma");
    expect(mocks.pagina).toHaveBeenCalledWith("/unificacao/[chave]");
    expect(mocks.permissao).toHaveBeenCalledWith("cadastros.sensiveis", { global: true });
  });

  it.each(["CONTABILIDADE", "SOCIO"])("nega dados ao perfil %s antes de consultar", async perfil => {
    mocks.perfil.mockResolvedValue(perfil);
    await expect(ConferenciaRegistro({ chave: "WIDESYS:PAGAR:t1", contexto })).rejects.toThrow("NOT_FOUND");
    expect(mocks.detalhe).not.toHaveBeenCalled();
  });

  it("não aceita usar o modal financeiro para abrir outros domínios", async () => {
    mocks.detalhe.mockResolvedValue({ registro: registro({ dominio: "PARAMETRO" }), candidatos: [], fontes: [], historico: [], baixas: [] });
    await expect(ConferenciaRegistro({ chave: "WIDESYS:PARAMETRO:p1", contexto })).rejects.toThrow("NOT_FOUND");
  });

  it("mantém a página avulsa e seus destinos tradicionais", async () => {
    const html = renderToStaticMarkup(await ConferenciaRegistro({ chave: "WIDESYS:PAGAR:t1" }));
    expect(html).toContain('href="/unificacao"');
    expect(html).toContain('href="/origem-separada"');
    expect(html).toContain('action="/unificacao/WIDESYS%3APAGAR%3At1"');
    expect(html).not.toContain('name="retornoContexto"');
    expect(html).not.toContain('data-inline-action="resolver"');
  });
});
