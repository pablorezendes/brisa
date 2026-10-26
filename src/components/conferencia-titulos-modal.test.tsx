import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviaConferenciaLote } from "@/lib/unificacao/tipos-conferencia-lote";

const mocks = vi.hoisted(() => ({ preparar: vi.fn(), confirmar: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/(app)/unificacao/conferencia-lote-actions", () => ({ prepararConferenciaSelecionados: mocks.preparar, conferirTitulosSelecionados: mocks.confirmar }));
vi.mock("@/components/botao-sigilo", () => ({ BotaoSigilo: () => <button>Ver valores</button>, useValoresVisiveis: () => true }));
vi.mock("@/components/ui", () => ({
  Dinheiro: ({ centavos }: { centavos: number | null }) => <span>{centavos}</span>,
  Sigilo: ({ children }: { children: ReactNode }) => <span data-sigilo="true">{children}</span>,
  btnPrimario: "btn", btnSecundario: "btn", inputBase: "input",
}));
import { ConferenciaTitulosModal, ResumoConferenciaLote } from "./conferencia-titulos-modal";

const previa: PreviaConferenciaLote = {
  dominio: "PAGAR", assinatura: "ASSINATURA_NAO_EXIBIR",
  resumo: { selecionados: 3, conferiveis: 1, jaConferidos: 1, bloqueados: 1 },
  impacto: { devido: 25000, pago: 10000, aberto: 15000 },
  itens: [
    { chave: "WIDESYS:PAGAR:a", titulo: "Despesa distinta", valor: 25000, pago: 10000, aberto: 15000, estado: "CONFERIR", motivo: "Passará a participar dos totais." },
    { chave: "WIDESYS:PAGAR:b", titulo: "Despesa confirmada", valor: 80000, pago: 0, aberto: 80000, estado: "JA_CONFERIDO", motivo: "Já conferido; sem nova inclusão." },
    { chave: "WIDESYS:PAGAR:c", titulo: "Cópia vinculada", valor: 30000, pago: 30000, aberto: 0, estado: "BLOQUEADO", motivo: "Vinculado ao principal; não soma novamente." },
  ],
};
beforeEach(() => vi.clearAllMocks());

describe("conferência única da seleção", () => {
  it("prepara antes de confirmar, sem gravação automática na abertura", () => {
    const html = renderToStaticMarkup(<ConferenciaTitulosModal dominio="PAGAR" chaves={previa.itens.map(item => item.chave)} aoFechar={vi.fn()} aoConcluir={vi.fn()} />);
    expect(html).toContain("Marcar selecionados como conferidos");
    expect(html).toContain("Preparando a seleção… Nenhum lançamento foi alterado.");
    expect(html).not.toContain('type="submit"');
    expect(mocks.confirmar).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("mostra impacto novo, já conferidos e bloqueados sem somar valores do lote no cliente", () => {
    const html = renderToStaticMarkup(<ResumoConferenciaLote previa={previa} />);
    expect(html).toContain("O que será acrescentado aos totais");
    expect(html).toContain("O que já está incluído não será somado novamente");
    expect(html).toContain("Preservados para revisão");
    expect(html).toContain("Já conferido · sem alteração");
    expect(html).toContain("Vinculado ao principal; não soma novamente");
    expect(html).not.toContain("ASSINATURA_NAO_EXIBIR");
    expect(html.match(/data-sigilo="true"/g)).toHaveLength(6);
    expect(html).toContain("Esta ação não cria títulos, pagamentos ou movimentos de caixa");
  });
  it("apresenta recebido no domínio receber e escapa conteúdo dos títulos", () => {
    const html = renderToStaticMarkup(<ResumoConferenciaLote previa={{ ...previa, dominio: "RECEBER", itens: [{ ...previa.itens[0], titulo: "<img src=x onerror=alert(1)>" }] }} />);
    expect(html).toContain("Recebido");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
