import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BASES_OFICIAIS_SICOOB,
  TOKEN_URL_OFICIAL_SICOOB,
  destinoHttpSicoobPermitido,
  validarBaseOficialSicoob,
  validarTokenUrlOficialSicoob,
} from "./destinos";

describe("destinos Sicoob — não encaminhar credenciais para outro servidor", () => {
  it("permite somente bases oficiais do ambiente correto", () => {
    expect(validarBaseOficialSicoob(`${BASES_OFICIAIS_SICOOB.producao}/`, "producao"))
      .toBe(BASES_OFICIAIS_SICOOB.producao);
    expect(validarBaseOficialSicoob(BASES_OFICIAIS_SICOOB.sandbox, "sandbox"))
      .toBe(BASES_OFICIAIS_SICOOB.sandbox);
    expect(validarTokenUrlOficialSicoob(TOKEN_URL_OFICIAL_SICOOB)).toBe(TOKEN_URL_OFICIAL_SICOOB);
    expect(() => validarBaseOficialSicoob(BASES_OFICIAIS_SICOOB.sandbox, "producao")).toThrow();
  });

  it("permite parâmetros de consulta apenas sob a base oficial da API", () => {
    expect(destinoHttpSicoobPermitido(new URL(`${BASES_OFICIAIS_SICOOB.producao}/boletos?nossoNumero=123`), "producao")).toBe(true);
    expect(destinoHttpSicoobPermitido(new URL(TOKEN_URL_OFICIAL_SICOOB), "producao")).toBe(true);
  });

  it.each([
    "http://api.sicoob.com.br/cobranca-bancaria/v3/boletos",
    "https://localhost/cobranca-bancaria/v3/boletos",
    "https://api.sicoob.com.br.example/cobranca-bancaria/v3/boletos",
    "https://api.sicoob.com.br:8443/cobranca-bancaria/v3/boletos",
    "https://segredo@api.sicoob.com.br/cobranca-bancaria/v3/boletos",
    "https://api.sicoob.com.br/cobranca-bancaria/v30/boletos",
    "https://api.sicoob.com.br/cobranca-bancaria/v3/../externo",
    "https://api.sicoob.com.br/cobranca-bancaria/v3/boletos#segredo",
    "https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token?outro=1",
    "https://sandbox.sicoob.com.br/sicoob/sandbox/cobranca-bancaria/v3/boletos",
  ])("rejeita requisição para %s", (url) => {
    expect(destinoHttpSicoobPermitido(new URL(url), "producao")).toBe(false);
  });
});
