import { describe, expect, it } from "vitest";

import { dataOperacionalUnificada, mesOperacionalUnificado } from "./periodo";

describe("período operacional único por fonte", () => {
  it.each(["RECEBER", "PAGAR"] as const)("%s pertence à competência mesmo com vencimento e pagamento em outros meses", dominio => {
    const fonte = { dominio, competencia: "2026-04", vencimento: "2026-05-10", data: "2026-06-15" };
    expect(dataOperacionalUnificada(fonte)).toBe("2026-04-01");
    expect(mesOperacionalUnificado(fonte)).toBe("2026-04");
  });

  it("título sem competência usa vencimento e só depois data", () => {
    expect(dataOperacionalUnificada({ dominio: "RECEBER", vencimento: "2026-05-10", data: "2026-06-15" })).toBe("2026-05-10");
    expect(mesOperacionalUnificado({ dominio: "PAGAR", data: "2026-06-15" })).toBe("2026-06");
  });

  it.each(["BAIXA_RECEBER", "BAIXA_PAGAR", "MOVIMENTO"] as const)("%s usa a data efetiva e não a competência do título", dominio => {
    const fonte = { dominio, competencia: "2026-04", vencimento: "2026-05-10", data: "2026-06-15" };
    expect(dataOperacionalUnificada(fonte)).toBe("2026-06-15");
    expect(mesOperacionalUnificado(fonte)).toBe("2026-06");
  });

  it("demais fontes usam vencimento e competência como alternativas ordenadas", () => {
    expect(mesOperacionalUnificado({ dominio: "CONTRATO", vencimento: "2026-05-10", competencia: "2026-04" })).toBe("2026-05");
    expect(dataOperacionalUnificada({ dominio: "MOVIMENTO", competencia: "2026-04" })).toBe("2026-04-01");
  });

  it("datas ausentes ou inválidas não criam um mês e não ocultam alternativa válida", () => {
    expect(dataOperacionalUnificada({ dominio: "RECEBER" })).toBeNull();
    expect(mesOperacionalUnificado({ dominio: "MOVIMENTO", data: "2026-02-30", vencimento: "2026-13-01", competencia: "2026-00" })).toBeNull();
    expect(dataOperacionalUnificada({ dominio: "RECEBER", competencia: "2026-13", vencimento: "2026-02-30", data: "2026-03-02" })).toBe("2026-03-02");
    expect(dataOperacionalUnificada({ dominio: "MOVIMENTO", data: "2028-02-29" })).toBe("2028-02-29");
  });
});
