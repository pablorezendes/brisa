import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { montarPolitica, navegacaoAcesso, type DadosPolitica } from "@/lib/acesso/politica";

const mocks = vi.hoisted(() => ({ pathname: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: mocks.pathname }));

import AppShell from "./app-shell";

function renderizar(ajustes: Partial<DadosPolitica> = {}) {
  const acesso = montarPolitica({
    id: "usuario-teste", perfil: "ADMINISTRADOR", ativo: true, acessoGlobal: true,
    permissoesExtras: "[]", permissoesNegadas: "[]", regrasAcesso: [], ...ajustes,
  });
  return renderToStaticMarkup(<AppShell nome="Pessoa de teste" perfil={acesso.perfil} acesso={navegacaoAcesso(acesso)} sair={async () => {}}>Conteúdo</AppShell>);
}

function grupo(html: string, id: string) {
  return html.match(new RegExp(`<details\\b[^>]*id="submenu-financeiro-${id}"[^>]*>[\\s\\S]*?<\\/details>`))?.[0];
}

beforeEach(() => {
  mocks.pathname.mockReturnValue("/financeiro");
});

describe("menu financeiro por tarefa", () => {
  it("destaca seis caminhos do dia a dia e mantém comissões próprias para o administrador", () => {
    const html = renderizar();
    const financeiro = html.slice(html.indexOf('id="submenu-financeiro"'));
    const principais = financeiro.slice(0, financeiro.indexOf("<details"));
    expect([...principais.matchAll(/href="([^"]+)"/g)].map((link) => link[1])).toEqual([
      "/financeiro", "/financeiro/dados", "/recebimentos", "/financeiro/contas-a-pagar",
      "/caixa", "/paineis/cobranca", "/financeiro/comissoes",
    ]);
    expect(principais).toContain("Resumo financeiro");
    expect(principais).toContain("Conferir dados");
    expect(principais).toContain("Entradas e saídas");
    expect(principais).toContain("Cobranças");
    expect(grupo(html, "banco")).toContain("Banco e serviços");
    expect(grupo(html, "importacoes")).toContain("Importações e histórico");
    expect(grupo(html, "banco")).not.toMatch(/^<details[^>]*\bopen=/);
    expect(grupo(html, "importacoes")).not.toMatch(/^<details[^>]*\bopen=/);
  });

  it("preserva os oito destinos secundários dentro dos dois grupos", () => {
    const html = renderizar();
    expect([...grupo(html, "banco")!.matchAll(/href="([^"]+)"/g)].map((link) => link[1])).toEqual([
      "/financeiro/boletos", "/financeiro/conciliacao", "/financeiro/contas-bancarias",
      "/financeiro/automacoes", "/financeiro/notas-fiscais",
    ]);
    expect([...grupo(html, "importacoes")!.matchAll(/href="([^"]+)"/g)].map((link) => link[1])).toEqual([
      "/financeiro/importacoes", "/financeiro/migracao-widesys", "/unificacao",
    ]);
  });

  it.each([
    ["/financeiro/conciliacao", "banco", "Conferir pagamentos"],
    ["/financeiro/importacoes/lote-1", "importacoes", "Planilhas importadas"],
  ])("abre o grupo da rota %s e mantém o link e o breadcrumb reconhecíveis", (pathname, id, rotulo) => {
    mocks.pathname.mockReturnValue(pathname);
    const html = renderizar();
    expect(html).toContain('aria-expanded="true" aria-controls="submenu-financeiro"');
    expect(html).toContain('id="submenu-financeiro" aria-hidden="false"');
    expect(grupo(html, id)).toMatch(/^<details[^>]*\bopen=""/);
    expect(grupo(html, id)).toMatch(new RegExp(`<a\\b[^>]*aria-current="page"[^>]*>[\\s\\S]*?${rotulo}`));
    expect(html).toContain(`<span class="font-semibold text-[#25383b]">${rotulo}</span>`);
  });

  it.each([
    ["/financeiro/contas-a-receber", "/recebimentos", "Contas a receber"],
    ["/financeiro/movimentacoes", "/caixa", "Entradas e saídas"],
  ])("reconhece o alias %s sem acrescentar outro link ao menu", (pathname, href, rotulo) => {
    mocks.pathname.mockReturnValue(pathname);
    const html = renderizar();
    expect(html).toContain('aria-expanded="true" aria-controls="submenu-financeiro"');
    const linkAtivo = html.match(new RegExp(`<a\\b[^>]*href="${href}"[^>]*>`))?.[0];
    expect(linkAtivo).toContain('aria-current="page"');
    expect(html).not.toContain(`href="${pathname}"`);
    expect(html).toContain(`<span class="font-semibold text-[#25383b]">${rotulo}</span>`);
  });

  it("financeiro sem concessões não recebe atalhos sensíveis ou administrativos", () => {
    const html = renderizar({ perfil: "FINANCEIRO" });
    expect(html).toContain('href="/recebimentos"');
    expect(html).toContain('href="/financeiro/boletos"');
    for (const href of ["/financeiro/dados", "/financeiro/contas-a-pagar", "/financeiro/comissoes", "/financeiro/importacoes", "/financeiro/automacoes", "/financeiro/notas-fiscais", "/financeiro/conciliacao"]) {
      expect(html).not.toContain(`href="${href}"`);
    }
    expect(grupo(html, "importacoes")).toBeUndefined();
  });

  it("filtra antes de agrupar e elimina grupos vazios sem dar comissões por exceção", () => {
    const html = renderizar({
      perfil: "FINANCEIRO", permissoesExtras: '["unificacao.ver","cadastros.sensiveis","comissoes.ver"]',
      permissoesNegadas: '["boletos.ver","contas.ver"]',
    });
    expect(html).toContain('href="/financeiro/dados"');
    expect(html).toContain('href="/financeiro/contas-a-pagar"');
    expect(grupo(html, "banco")).toBeUndefined();
    expect(grupo(html, "importacoes")).toContain('href="/unificacao"');
    expect(html).not.toContain('href="/financeiro/comissoes"');
    expect(html).not.toContain('href="/financeiro/importacoes"');
  });

  it("carteira restrita não recebe o módulo financeiro nem grupos secundários", () => {
    const html = renderizar({ perfil: "FINANCEIRO", acessoGlobal: false, permissoesExtras: '["unificacao.ver","cadastros.sensiveis"]' });
    expect(html).toContain('href="/carteira"');
    expect(html).not.toContain('id="submenu-financeiro"');
    expect(grupo(html, "banco")).toBeUndefined();
    expect(grupo(html, "importacoes")).toBeUndefined();
  });
});
