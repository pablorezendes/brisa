import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DOMINIOS_UNIFICACAO, type LinhaUnificada } from "@/lib/unificacao/tipos";
import { EstadoUnificado } from "./unificacao-visual";
import { explicarConsolidacao } from "./situacao-consolidacao";

const item = (extra: Partial<LinhaUnificada> = {}) => ({ estado: "ATIVO" as const, dominio: "PAGAR" as const, contabiliza: true, conferidoManualmente: false, ...extra });
describe("conferência visível sem confundir inclusão e pagamento", () => {
  it.each(DOMINIOS_UNIFICACAO)("mostra conferência manual em %s", dominio => {
    const registro = item({ dominio, conferidoManualmente: true });
    const html = renderToStaticMarkup(<EstadoUnificado item={registro} />);
    expect(html).toContain("Conferido");
    expect(html).not.toContain("automaticamente");
    expect(explicarConsolidacao(registro)).toMatch(/(?:Conferido|conferido)/);
    if (["PAGAR", "RECEBER", "MOVIMENTO"].includes(dominio)) expect(explicarConsolidacao(registro)).toBe("Conferido e incluído nos totais.");
    else expect(explicarConsolidacao(registro)).not.toContain("nos totais");
  });
  it("separa inclusão automática de confirmação humana", () => {
    expect(renderToStaticMarkup(<EstadoUnificado item={item()} />)).toContain("Incluído automaticamente");
    expect(explicarConsolidacao(item())).toContain("Ainda não foi conferido manualmente");
    expect(renderToStaticMarkup(<EstadoUnificado item={item({ dominio: "PESSOA" })} />)).toContain("Disponível");
  });
  it("vínculo conferido explica que não soma uma segunda vez", () => {
    const vinculado = item({ estado: "VINCULADO", contabiliza: false, conferidoManualmente: true });
    expect(renderToStaticMarkup(<EstadoUnificado item={vinculado} />)).toContain("Conferido · vinculado");
    expect(explicarConsolidacao(vinculado)).toBe("Conferido e vinculado ao registro principal. Não soma novamente.");
    expect(renderToStaticMarkup(<EstadoUnificado item={{ ...vinculado, conferidoManualmente: false }} />)).not.toContain("Conferido");
  });
  it.each(["PENDENTE", "REVISAR", "QUARENTENA", "AUSENTE"] as const)("%s prevalece mesmo sobre flag de conferência indevida", estado => {
    const pendente = item({ estado, contabiliza: false, conferidoManualmente: true });
    expect(renderToStaticMarkup(<EstadoUnificado item={pendente} />)).not.toContain("Conferido");
    expect(explicarConsolidacao(pendente)).toContain("Fora dos totais");
  });
  it("cancelado e informativo não alegam inclusão nos totais", () => {
    const cancelado = item({ cancelado: true, contabiliza: false, conferidoManualmente: true });
    expect(renderToStaticMarkup(<EstadoUnificado item={cancelado} />)).toContain("Cancelado");
    expect(explicarConsolidacao(cancelado)).toBe("Registro cancelado. Não entra nos totais.");
    const informativo = item({ informativo: true, contabiliza: false, conferidoManualmente: true });
    expect(renderToStaticMarkup(<EstadoUnificado item={informativo} />)).toContain("Conferido · informativo");
    expect(explicarConsolidacao(informativo)).toBe("Conferido para consulta. Não soma valores novamente.");
  });
});
