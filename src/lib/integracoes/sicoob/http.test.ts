import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("node:https", () => ({ request }));

import { requisicaoHttpsJson } from "./http";
import type { ConfiguracaoSicoob } from "./configuracao";

const configuracao: ConfiguracaoSicoob = {
  ambiente: "producao",
  baseUrl: "https://api.sicoob.com.br/cobranca-bancaria/v3",
  tokenUrl: "https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token",
  clientId: "id-de-teste", clientSecret: "segredo-de-teste", tokenAuth: "body",
  scopes: "boletos_consulta", accessTokenEstatico: null, timeoutMs: 1000,
  tls: { pfx: Buffer.from("material-privado-de-teste"), passphrase: "senha-de-teste" },
  cacheTokenId: "teste-http",
};

describe("barreira HTTPS imediatamente antes do envio de credenciais", () => {
  beforeEach(() => request.mockReset());

  it.each([
    "https://coletor.example/token",
    "https://api.sicoob.com.br.example/cobranca-bancaria/v3/boletos",
    "https://sandbox.sicoob.com.br/sicoob/sandbox/cobranca-bancaria/v3/boletos",
    "https://usuario:senha@auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token",
  ])("recusa %s sem criar requisição ou enviar PFX/token", async (url) => {
    await expect(requisicaoHttpsJson(new URL(url), configuracao, {
      metodo: "POST",
      headers: { Authorization: "Bearer token-de-teste" },
      corpo: "client_secret=segredo-de-teste",
    })).rejects.toMatchObject({ codigo: "SICOOB_URL_INSEGURA" });
    expect(request).not.toHaveBeenCalled();
  });
});
