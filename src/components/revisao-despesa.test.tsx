import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RevisaoDespesa } from "@/lib/despesas/tipos-revisao";

const mocks = vi.hoisted(() => ({ carregar: vi.fn(), confirmar: vi.fn(), visiveis: true }));
vi.mock("@/app/(app)/financeiro/contas-a-pagar/rateio-actions", () => ({ carregarRevisaoDespesa: mocks.carregar, confirmarRevisaoDespesa: mocks.confirmar }));
vi.mock("@/app/(app)/recebimentos/revisao-actions", () => ({ carregarRevisaoRecebimento: vi.fn(), confirmarRevisaoRecebimento: vi.fn() }));
vi.mock("@/components/botao-sigilo", () => ({ useValoresVisiveis: () => mocks.visiveis }));
import { ConteudoRevisaoDespesa } from "./revisao-despesa";

const revisao: RevisaoDespesa = {
  chave: "WIDESYS:PAGAR:t1", dominio: "PAGAR", conferidoManualmente: false, estado: "REVISAR", pendente: true, podeConcluir: true, incluidoNosTotais: false, candidatosIndisponiveis: 0, motivo: "A decisão anterior precisa ser conferida. Este registro está fora dos totais.", versao: 2, hashFonte: "hash-atual", assinatura: "contexto-atual",
  registro: { chave: "WIDESYS:PAGAR:t1", hash: "hash-atual", titulo: "Fornecedor teste", descricao: "Honorários contábeis", origem: "WIDESYS", competencia: "2026-04", data: "2026-04-17", valor: 162100, pago: 162100, aberto: 0 },
  candidatos: [{ chave: "BRISA:PAGAR:d1", hash: "hash-destino", titulo: "Fornecedor teste", descricao: "Serviço contábil", origem: "BRISA", competencia: "2026-04", data: "2026-04-17", valor: 162100, pago: 162100, aberto: 0 }],
};
function render(dados = revisao, props: { alterado?: boolean; bloqueado?: boolean } = {}) { return renderToStaticMarkup(<ConteudoRevisaoDespesa revisao={dados} alterado={props.alterado ?? false} bloqueado={props.bloqueado ?? false} aoConfirmar={mocks.confirmar} />); }
beforeEach(() => { vi.clearAllMocks(); mocks.visiveis = true; });

describe("conferência financeira na janela da despesa", () => {
  it("mantém pendência explícita até comparar e escolher a decisão, sem seleção automática", () => {
    const html = render();
    expect(html).toContain("Ainda precisa de uma decisão");
    expect(html).toContain("fora dos totais");
    expect(html).toContain("Compare os possíveis repetidos");
    expect(html).toContain("Mesmo lançamento");
    expect(html).toContain("São lançamentos diferentes");
    expect(html).not.toMatch(/<input[^>]*checked/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirmar decisão e concluir<\/button>/);
    expect(html).not.toContain("href=");
    expect(mocks.confirmar).not.toHaveBeenCalled();
  });
  it("ausência de sugestão não resolve automaticamente o registro", () => {
    const html = render({ ...revisao, candidatos: [] });
    expect(html).toContain("Não foram encontrados possíveis repetidos");
    expect(html).toContain("Conferi: este lançamento é único");
    expect(html).not.toContain("Sem pendência de duplicidade");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirmar decisão e concluir<\/button>/);
    expect(mocks.confirmar).not.toHaveBeenCalled();
  });
  it("exige salvar alterações antes de decidir e mantém valores protegidos", () => {
    mocks.visiveis = false;
    const html = render(revisao, { alterado: true });
    expect(html).toContain("Você alterou os dados");
    expect(html).toContain("Salvar dados da despesa");
    expect(html).toContain("Revele os valores");
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toContain('class="sigilo"');
  });
  it("quarentena ou falta de permissão não oferecem confirmação", () => {
    const html = render({ ...revisao, estado: "QUARENTENA", podeConcluir: false, motivo: "Confira os dados inconsistentes na origem." });
    expect(html).toContain("Dados inconsistentes: ainda fora dos totais");
    expect(html).not.toContain("Confirmar decisão e concluir");
    expect(render({ ...revisao, podeConcluir: false })).not.toContain("Confirmar decisão e concluir");
  });
  it("apresenta revisão humana resolvida com decisão manual válida retornada pelo servidor", () => {
    const ativo = render({ ...revisao, estado: "ATIVO", conferidoManualmente: true, pendente: false, podeConcluir: false, incluidoNosTotais: true, motivo: "Lançamento disponível." });
    expect(ativo).toContain(">Conferido</p>");
    expect(ativo).toContain("incluído uma única vez nos totais");
    expect(ativo).not.toContain("Confirmar decisão e concluir");
    const vinculado = render({ ...revisao, estado: "VINCULADO", conferidoManualmente: true, pendente: false, podeConcluir: false, motivo: "Vínculo confirmado." });
    expect(vinculado).toContain("não soma novamente");
    const ausente = render({ ...revisao, estado: "AUSENTE", pendente: false, podeConcluir: false });
    expect(ausente).not.toContain(">Conferido</p>");
  });
  it.each(["PAGAR", "RECEBER"] as const)("apresenta %s conferido pela regra, sem nova confirmação nem comparação", dominio => {
    const html = render({ ...revisao, dominio, estado: "ATIVO", conferidoPorRegra: true, pendente: false, podeConcluir: false, incluidoNosTotais: true, motivo: "Conferido pela regra: valores totais diferentes. São lançamentos separados; a regra não cria títulos nem pagamentos." });
    expect(html).toContain("Conferido pela regra de valores diferentes");
    expect(html).toContain("border-emerald-200");
    expect(html).toContain("incluído uma única vez nos totais");
    expect(html).not.toContain("Ainda não conferido manualmente");
    expect(html).not.toContain("Confirmar decisão e concluir");
    expect(html).not.toContain("Compare os possíveis repetidos");
    expect(html).not.toContain("A conclusão exige permissão");
    expect(mocks.confirmar).not.toHaveBeenCalled();
  });
  it("não mantém o selo de conferido pela regra quando a origem voltou para revisão", () => {
    const html = render({ ...revisao, conferidoPorRegra: true });
    expect(html).toContain("Ainda precisa de uma decisão");
    expect(html).not.toContain("Conferido pela regra de valores diferentes");
    expect(html).toContain("Confirmar decisão e concluir");
  });
  it("não afirma inclusão de cancelados nem ausência de semelhantes indisponíveis", () => {
    const cancelado = render({ ...revisao, estado: "ATIVO", conferidoManualmente: true, pendente: false, podeConcluir: false, incluidoNosTotais: false });
    expect(cancelado).toContain("permanece fora dos totais por sua situação financeira");
    expect(cancelado).not.toContain("está incluído uma única vez nos totais");
    const indisponiveis = render({ ...revisao, candidatos: [], candidatosIndisponiveis: 2 });
    expect(indisponiveis).toContain("Há 2 registro(s) semelhante(s)");
    expect(indisponiveis).not.toContain("Não foram encontrados possíveis repetidos");
    expect(indisponiveis).toContain("São lançamentos diferentes");
  });
  it("ativo automático permite conferência sem alegar revisão manual nem criar novo valor", () => {
    const html = render({ ...revisao, estado: "ATIVO", pendente: false, podeConcluir: true, conferidoManualmente: false, incluidoNosTotais: true, candidatos: [] });
    expect(html).toContain("Ainda não conferido manualmente");
    expect(html).toContain("Conferir não soma seu valor de novo");
    expect(html).toContain("Confirmar decisão e concluir");
    expect(html).not.toContain(">Conferido</p>");
  });
});
