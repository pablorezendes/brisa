import { afterEach, describe, expect, it, vi } from "vitest";
import { chaveAutomacoesConfigurada, cifrarSegredo, decifrarSegredo } from "./segredos";

afterEach(() => vi.unstubAllEnvs());

describe("cofre de automações AES-256-GCM", () => {
  it("usa chave independente e falha fechado sem ela", () => {
    vi.stubEnv("AUTOMACOES_CHAVE", "");
    vi.stubEnv("AUTH_SECRET", "a".repeat(64));
    expect(chaveAutomacoesConfigurada()).toBe(false);
    expect(() => cifrarSegredo("credencial-de-teste")).toThrow(/AUTOMACOES_CHAVE/);
  });
  it("exige Base64 canônico com 32 bytes", () => {
    for (const chave of ["x", "x".repeat(43), Buffer.alloc(31).toString("base64"), " ".repeat(44)]) {
      vi.stubEnv("AUTOMACOES_CHAVE", chave);
      expect(chaveAutomacoesConfigurada()).toBe(false);
    }
  });
  it("randomiza o envelope e permite roundtrip sem revelar o segredo", () => {
    vi.stubEnv("AUTOMACOES_CHAVE", Buffer.alloc(32, 7).toString("base64"));
    const a = cifrarSegredo("token-ficticio-ç", "resend");
    const b = cifrarSegredo("token-ficticio-ç", "resend");
    expect(a).not.toBe(b);
    expect(a).not.toContain("token-ficticio");
    expect(decifrarSegredo(a, "resend")).toBe("token-ficticio-ç");
    expect(() => decifrarSegredo(a, "meta")).toThrow(/credencial protegida/);
  });
  it("rejeita adulteração, chave trocada e envelopes inválidos sem ecoar segredo", () => {
    vi.stubEnv("AUTOMACOES_CHAVE", Buffer.alloc(32, 7).toString("base64"));
    const a = cifrarSegredo("token-secreto");
    const partes = a.split(":");
    partes[3] = Buffer.from("adulterado").toString("base64url");
    expect(() => decifrarSegredo(partes.join(":"))).toThrow(/credencial protegida/);
    vi.stubEnv("AUTOMACOES_CHAVE", Buffer.alloc(32, 8).toString("base64"));
    expect(() => decifrarSegredo(a)).toThrow(/credencial protegida/);
    expect(() => decifrarSegredo("token-secreto")).not.toThrow(/token-secreto/);
  });
  it("limita tamanho do material secreto", () => {
    vi.stubEnv("AUTOMACOES_CHAVE", Buffer.alloc(32, 7).toString("base64"));
    expect(() => cifrarSegredo("")).toThrow();
    expect(() => cifrarSegredo("x".repeat(16_385))).toThrow();
  });
});
