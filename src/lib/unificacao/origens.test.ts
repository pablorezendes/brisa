import { describe, expect, it } from "vitest";
import { correspondeOrigem, origensDoRegistro, resumirOrganizacaoFinanceira } from "./origens";
import type { LinhaUnificada } from "./tipos";

describe("origem apresentada ao usuário", () => {
  it("não presume inclusão manual de registros Brisa", () => {
    expect(origensDoRegistro({ origem: "BRISA" })).toEqual(["BRISA"]);
    expect(origensDoRegistro({ origem: "BRISA", proveniencia: {} })).toEqual(["BRISA"]);
  });
  it("reconhece prova de arquivo e grupos com várias fontes", () => {
    expect(origensDoRegistro({ origem: "BRISA", proveniencia: { arquivo: "caixa.xlsx" } })).toEqual(["PLANILHA"]);
    expect(origensDoRegistro({ origem: "BRISA", origens: ["PLANILHA", "WIDESYS", "PLANILHA"] })).toEqual(["PLANILHA", "WIDESYS"]);
  });
  it("filtra por origem, inclusive nos grupos vinculados, sem ampliar por rótulo inventado", () => {
    const registro = { origem: "BRISA" as const, origens: ["PLANILHA", "WIDESYS"] };
    expect(correspondeOrigem(registro, "PLANILHA")).toBe(true);
    expect(correspondeOrigem(registro, "BRISA")).toBe(false);
    expect(correspondeOrigem(registro, "invalido")).toBe(true);
  });
  it("não trata ativo informativo como contabilizado nem soma títulos e baixas", () => {
    const linha = (dominio: string, estado: string, contabiliza = false) => ({ dominio, estado, contabiliza, origem: "WIDESYS" }) as LinhaUnificada;
    const r = resumirOrganizacaoFinanceira([
      linha("RECEBER", "ATIVO", true), linha("RECEBER", "PENDENTE"), linha("RECEBER", "VINCULADO"),
      linha("MOVIMENTO", "ATIVO"), linha("MOVIMENTO", "REVISAR"), linha("PAGAR", "QUARENTENA"), linha("BAIXA_RECEBER", "ATIVO", true),
    ]);
    expect(r.dominios[0]).toMatchObject({ total: 3, incluidos: 1, pendentes: 1, vinculados: 1 });
    expect(r.dominios[2]).toMatchObject({ total: 2, incluidos: 0, pendentes: 1, semEfeito: 1 });
    expect(r.pendentes).toBe(2); expect(r.inconsistentes).toBe(1);
    expect(r.origens.find(o => o.origem === "WIDESYS")?.quantidade).toBe(6);
  });
});
