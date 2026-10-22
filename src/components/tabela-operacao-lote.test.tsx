import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviaExclusaoTitulos } from "@/lib/governanca/exclusao-titulos-lote-tipos";

const actions = vi.hoisted(() => ({ previa: vi.fn(), excluir: vi.fn() }));
vi.mock("@/app/(app)/cadastros/governanca/lote-actions", () => ({ prepararExclusaoTitulos: actions.previa, excluirTitulosSelecionados: actions.excluir }));
vi.mock("@/components/ui", () => ({
  Dinheiro: ({ centavos }: { centavos: number | null }) => <span>{centavos}</span>,
  Sigilo: ({ children }: { children: ReactNode }) => <span data-sigilo="true">{children}</span>,
  btnSecundario: "btn", inputBase: "input",
}));
vi.mock("@/components/unificacao-visual", () => ({ EstadoUnificado: () => <span>Disponível</span>, OrigensUnificadas: () => <span>Origem</span> }));

import { TabelaOperacaoUnificada, type LinhaTabelaOperacao } from "./tabela-operacao-unificada";
import { ExclusaoTitulosModal, ResumoPreviaExclusao } from "./exclusao-titulos-modal";

const linha: LinhaTabelaOperacao = {
  chave: "WIDESYS:PAGAR:1", dominio: "PAGAR", titulo: "Fornecedor de teste", descricao: "Parcela 1",
  origens: ["WIDESYS"], papeis: [], estado: "ATIVO", contabiliza: true, correspondencias: 0,
  aviso: null, impacto: "Incluído", data: "22/10/2026", competencia: "2026-10", valor: 123456,
  pago: 0, aberto: 123456, natureza: null, hrefDetalhe: "/financeiro/contas-a-pagar?registro=1&painel=detalhe",
  hrefCadastro: null, exclusao: { href: "/financeiro/contas-a-pagar?registro=1&painel=excluir", rotulo: "Excluir da plataforma" },
};
const props = { itens: [linha], financeiro: true, exibirDominio: false, exibirValor: false, contextual: true };
const previa: PreviaExclusaoTitulos = { dominio: "PAGAR", total: 1, itens: [{
  chave: linha.chave, nome: linha.titulo, referencia: "Parcela de teste", valor: linha.valor,
  status: "ATIVO", assinatura: "assinatura-nao-exibir", vinculos: { pagamentos: 1, boletos: 0, baixas: 2 },
}] };

beforeEach(() => vi.clearAllMocks());

describe("exclusão financeira na própria lista", () => {
  it("mantém links antigos e não mostra seleção sem habilitação administrativa", () => {
    const html = renderToStaticMarkup(<TabelaOperacaoUnificada {...props} />);
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("Excluir selecionados");
    expect(html).toContain("painel=excluir");
  });

  it("mostra seleção por página e botão individual local sem navegar para excluir", () => {
    const html = renderToStaticMarkup(<TabelaOperacaoUnificada {...props} exclusaoLote={{ dominio: "PAGAR", contexto: "/pagar?pagina=1" }} />);
    expect(html).toContain("Selecionar todos os registros desta página");
    expect(html).toContain("Selecionar Fornecedor de teste");
    expect(html).toContain("Seleção somente desta página");
    expect(html).toContain("Excluir selecionados");
    expect(html).toMatch(/<button[^>]*title="Conferir e excluir nesta tela"[^>]*>Excluir da plataforma<\/button>/);
    expect(html).not.toContain("painel=excluir");
    expect(html).toContain("painel=detalhe");
    expect(actions.previa).not.toHaveBeenCalled();
    expect(actions.excluir).not.toHaveBeenCalled();
  });

  it("isola o estado de seleção com a chave de filtros/paginação", () => {
    const primeiro = TabelaOperacaoUnificada({ ...props, exclusaoLote: { dominio: "PAGAR", contexto: "/pagar?pagina=1" } });
    const segundo = TabelaOperacaoUnificada({ ...props, exclusaoLote: { dominio: "PAGAR", contexto: "/pagar?pagina=2" } });
    expect(isValidElement(primeiro) && primeiro.key).toBe("/pagar?pagina=1");
    expect(isValidElement(segundo) && segundo.key).toBe("/pagar?pagina=2");
  });

  it.each([{ financeiro: false }, { contextual: false }, { exibirDominio: true }])("não habilita lote fora da lista financeira contextual: %j", opcoes => {
    const html = renderToStaticMarkup(<TabelaOperacaoUnificada {...props} {...opcoes} exclusaoLote={{ dominio: "PAGAR", contexto: "/qualquer" }} />);
    expect(html).not.toContain("Excluir selecionados");
  });

  it("não permite selecionar item sem ação autorizada", () => {
    const html = renderToStaticMarkup(<TabelaOperacaoUnificada {...props} itens={[{ ...linha, exclusao: null }]} exclusaoLote={{ dominio: "PAGAR", contexto: "/pagar" }} />);
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*aria-label="Selecionar Fornecedor de teste"/);
    expect(html).not.toContain("Conferir e excluir nesta tela");
  });

  it("inicia modal em conferência, sem botão de confirmar antes da prévia", () => {
    const html = renderToStaticMarkup(<ExclusaoTitulosModal dominio="PAGAR" chaves={[linha.chave]} aoFechar={vi.fn()} aoConcluir={vi.fn()} />);
    expect(html).toContain("Excluir lançamento");
    expect(html).toContain("Conferindo seleção… Nenhum registro foi excluído.");
    expect(html).not.toContain("Confirmar exclusão");
    expect(actions.excluir).not.toHaveBeenCalled();
  });

  it("prévia mantém valores sob sigilo e explica vínculos e restauração", () => {
    const html = renderToStaticMarkup(<ResumoPreviaExclusao previa={previa} />);
    expect(html).toContain('data-sigilo="true"');
    expect(html).toContain("Vínculos preservados");
    expect(html).toContain("restauração na lixeira");
    expect(html).toContain("Não cancela boletos");
    expect(html).not.toContain("assinatura-nao-exibir");
  });

  it("nomes da prévia são texto escapado; já excluído é explicado", () => {
    const html = renderToStaticMarkup(<ResumoPreviaExclusao previa={{ ...previa, itens: [{ ...previa.itens[0], nome: "<img src=x onerror=alert(1)>", status: "EXCLUIDO" }] }} />);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("já excluído; não será excluído novamente");
  });
});
