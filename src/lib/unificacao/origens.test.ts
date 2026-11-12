import { describe, expect, it } from "vitest";
import { correspondeOrigem, origensDoRegistro, resumirOrganizacaoFinanceira } from "./origens";
import type { LinhaUnificada } from "./tipos";

describe("origem apresentada ao usuário", () => {
  it("não presume inclusão manual de registros Brisa", () => {
    expect(origensDoRegistro({ origem: "BRISA" })).toEqual(["BRISA"]);
    expect(origensDoRegistro({ origem: "BRISA", proveniencia: {} })).toEqual(["BRISA"]);
  });
  it("apresenta as cargas arquivadas como Brisa, inclusive em registros vinculados", () => {
    expect(origensDoRegistro({ origem: "BRISA", proveniencia: { arquivo: "caixa.xlsx" } })).toEqual(["BRISA"]);
    expect(origensDoRegistro({ origem: "BRISA", origens: ["PLANILHA", "WIDESYS", "BRISA"] })).toEqual(["BRISA", "WIDESYS"]);
  });
  it("reconhece cadastro manual somente com evidência explícita, sem reclassificar carga antiga", () => {
    const manual = { origem: "BRISA" as const, proveniencia: { tipo: "CADASTRO_MANUAL" } };
    expect(origensDoRegistro(manual)).toEqual(["MANUAL"]);
    expect(correspondeOrigem(manual, "MANUAL")).toBe(true);
    expect(correspondeOrigem(manual, "BRISA")).toBe(false);
    expect(origensDoRegistro({ origem: "BRISA", proveniencia: { desconhecida: true } })).toEqual(["BRISA"]);
    expect(origensDoRegistro({ origem: "WIDESYS", proveniencia: { tipo: "CADASTRO_MANUAL" } })).toEqual(["WIDESYS"]);
  });
  it("filtra pelas origens visíveis e ignora o filtro antigo de planilha", () => {
    const registro = { origem: "BRISA" as const, origens: ["PLANILHA", "WIDESYS"] };
    expect(correspondeOrigem({ origem: "WIDESYS" }, "PLANILHA")).toBe(true);
    expect(correspondeOrigem(registro, "BRISA")).toBe(true);
    expect(correspondeOrigem(registro, "MANUAL")).toBe(false);
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
