import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoriaDespesaCatalogo } from "@/lib/despesas/tipos-catalogo";

const actions = vi.hoisted(() => ({ carregar: vi.fn(), gravar: vi.fn() }));
vi.mock("@/app/(app)/financeiro/contas-a-pagar/categorias-actions", () => ({ carregarCategoriasDespesas: actions.carregar, gravarCategoriaDespesa: actions.gravar }));
import { EditorCategoriaDespesa } from "./editor-categoria-despesa";
import { CategoriasDespesaBotao } from "./categorias-despesa-botao";
import { GerenciadorCategoriasDespesa } from "./gerenciador-categorias-despesa";

const categoria: CategoriaDespesaCatalogo = { codigo: "IMPOSTOS", rotulo: "Impostos", restrita: false, ativa: true, versao: 0, padrao: true };
beforeEach(() => vi.clearAllMocks());

describe("cadastro de categorias na própria tela", () => {
  it("não carrega catálogo nem executa mutação ao renderizar botão fechado", () => {
    const html = renderToStaticMarkup(<CategoriasDespesaBotao />);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("href=");
    expect(actions.carregar).not.toHaveBeenCalled();
    expect(actions.gravar).not.toHaveBeenCalled();
  });
  it("abre estrutura acessível com estado imediato de carregamento", () => {
    const html = renderToStaticMarkup(<GerenciadorCategoriasDespesa aoFechar={vi.fn()} />);
    expect(html).toContain("<dialog");
    expect(html).toContain("aria-labelledby=");
    expect(html).toContain("Categorias de despesas");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Impostos");
    expect(actions.gravar).not.toHaveBeenCalled();
  });
  it("criação inline não aninha formulários nem submete a despesa principal", () => {
    const html = renderToStaticMarkup(<form><EditorCategoriaDespesa aoSalvar={vi.fn()} aoCancelar={vi.fn()} /></form>);
    expect(html.match(/<form/g)).toHaveLength(1);
    expect(html).not.toContain("<dialog");
    expect(html).not.toContain('type="submit"');
    expect(html).toContain('maxLength="120"');
    expect(html).toContain("Cadastrar categoria");
    expect(html).toContain("Restrita ao administrador");
    expect(actions.gravar).not.toHaveBeenCalled();
  });
  it("edição preserva nome inicial e torna explícita a proteção irreversível", () => {
    const html = renderToStaticMarkup(<EditorCategoriaDespesa inicial={{ ...categoria, restrita: true }} aoSalvar={vi.fn()} aoCancelar={vi.fn()} />);
    expect(html).toContain('value="Impostos"');
    expect(html).toMatch(/type="checkbox"[^>]*disabled=""[^>]*checked=""/);
    expect(html).toContain("essa proteção não poderá ser retirada");
    expect(html).toContain("Salvar categoria");
  });
});
