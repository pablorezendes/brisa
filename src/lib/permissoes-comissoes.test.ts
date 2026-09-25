import { describe, expect, it } from "vitest";
import { PERFIS_COMISSOES, perfilPodeVerComissoes } from "./permissoes-comissoes";

describe("acesso reservado às comissões", () => {
  it("permite somente o perfil administrador", () => {
    expect(PERFIS_COMISSOES).toEqual(["ADMINISTRADOR"]);
    expect(perfilPodeVerComissoes("ADMINISTRADOR")).toBe(true);
    for (const perfil of ["FINANCEIRO", "OPERADOR", "CONSULTA", "", "administrador"]) {
      expect(perfilPodeVerComissoes(perfil)).toBe(false);
    }
  });
});
