import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RevisaoDespesa } from "@/lib/despesas/tipos-revisao";

const mocks = vi.hoisted(() => ({ carregar: vi.fn(), confirmar: vi.fn(), visiveis: true }));
vi.mock("@/app/(app)/financeiro/contas-a-pagar/rateio-actions", () => ({ carregarRevisaoDespesa: mocks.carregar, confirmarRevisaoDespesa: mocks.confirmar }));
vi.mock("@/components/botao-sigilo", () => ({ useValoresVisiveis: () => mocks.visiveis }));
import { ConteudoRevisaoDespesa } from "./revisao-despesa";

const revisao: RevisaoDespesa = {
  chave: "WIDESYS:PAGAR:t1", estado: "REVISAR", pendente: true, podeConcluir: true, incluidoNosTotais: false, candidatosIndisponiveis: 0, motivo: "A decisão anterior precisa ser conferida. Este registro está fora dos totais.", versao: 2, hashFonte: "hash-atual", assinatura: "contexto-atual",
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
  it("só apresenta revisão resolvida quando o servidor retorna ativo ou vinculado", () => {
    const ativo = render({ ...revisao, estado: "ATIVO", pendente: false, podeConcluir: false, incluidoNosTotais: true, motivo: "Lançamento disponível." });
    expect(ativo).toContain("Sem pendência de duplicidade");
    expect(ativo).toContain("incluído uma única vez nos totais");
    expect(ativo).not.toContain("Confirmar decisão e concluir");
    const vinculado = render({ ...revisao, estado: "VINCULADO", pendente: false, podeConcluir: false, motivo: "Vínculo confirmado." });
    expect(vinculado).toContain("não soma novamente");
    const ausente = render({ ...revisao, estado: "AUSENTE", pendente: false, podeConcluir: false });
    expect(ausente).not.toContain("Sem pendência de duplicidade");
  });
  it("não afirma inclusão de cancelados nem ausência de semelhantes indisponíveis", () => {
    const cancelado = render({ ...revisao, estado: "ATIVO", pendente: false, podeConcluir: false, incluidoNosTotais: false });
    expect(cancelado).toContain("permanece fora dos totais por sua situação financeira");
    expect(cancelado).not.toContain("está incluído uma única vez nos totais");
    const indisponiveis = render({ ...revisao, candidatos: [], candidatosIndisponiveis: 2 });
    expect(indisponiveis).toContain("Há 2 registro(s) semelhante(s)");
    expect(indisponiveis).not.toContain("Não foram encontrados possíveis repetidos");
    expect(indisponiveis).toContain("São lançamentos diferentes");
  });
});
