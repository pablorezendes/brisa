import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requisicao: vi.fn(),
  existe: vi.fn(),
  ler: vi.fn(),
  contexto: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("node:fs", () => ({ existsSync: mocks.existe, readFileSync: mocks.ler }));
vi.mock("node:tls", () => ({ createSecureContext: mocks.contexto }));
vi.mock("./http", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("./http")>();
  return { ...original, requisicaoHttpsJson: mocks.requisicao };
});

import { diagnosticarAutenticacaoSicoob } from "./diagnostico";
import { ErroApiSicoob } from "./http";
import { TOKEN_URL_OFICIAL_SICOOB } from "./destinos";

function envProducao(sobrescrever: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    SICOOB_AMBIENTE: "producao",
    SICOOB_CLIENT_ID: "id-restrito-de-teste",
    SICOOB_CLIENT_SECRET: "segredo-restrito-de-teste",
    SICOOB_TOKEN_URL: TOKEN_URL_OFICIAL_SICOOB,
    SICOOB_PFX_PATH: "/cofre/restrito/client.pfx",
    SICOOB_PFX_PASSPHRASE: "senha-restrita-de-teste",
    ...sobrescrever,
  };
}

describe("diagnóstico de autenticação sem movimentação financeira", () => {
  beforeEach(() => {
    mocks.requisicao.mockReset();
    mocks.existe.mockReset().mockReturnValue(true);
    mocks.ler.mockReset().mockReturnValue(Buffer.from("pfx-local-de-teste"));
    mocks.contexto.mockReset().mockReturnValue({});
  });

  it("autentica somente no OAuth e nunca trata autenticação como convênio homologado", async () => {
    mocks.requisicao.mockResolvedValue({ status: 200, corpo: { access_token: "token-nao-exibido", expires_in: 300 }, headers: {} });
    const resultado = await diagnosticarAutenticacaoSicoob(envProducao());
    expect(resultado).toMatchObject({
      status: "AUTENTICADO", configuracaoLocalValida: true,
      autenticacaoValidada: true, convenioValidado: false,
    });
    expect(mocks.requisicao).toHaveBeenCalledTimes(1);
    const [url, , requisicao] = mocks.requisicao.mock.calls[0];
    expect(url.toString()).toBe(TOKEN_URL_OFICIAL_SICOOB);
    expect(requisicao.metodo).toBe("POST");
    expect(new URLSearchParams(requisicao.corpo).get("grant_type")).toBe("client_credentials");
    const publico = JSON.stringify(resultado);
    for (const segredo of ["id-restrito-de-teste", "segredo-restrito-de-teste", "senha-restrita-de-teste", "/cofre/restrito", "token-nao-exibido"]) {
      expect(publico).not.toContain(segredo);
    }
  });

  it("força novo OAuth em cada teste em vez de usar um token antigo em cache", async () => {
    mocks.requisicao.mockResolvedValue({ status: 200, corpo: { access_token: "token-nao-exibido", expires_in: 3600 }, headers: {} });
    await diagnosticarAutenticacaoSicoob(envProducao());
    await diagnosticarAutenticacaoSicoob(envProducao());
    expect(mocks.requisicao).toHaveBeenCalledTimes(2);
  });

  it("não acessa a rede se arquivo ou senha não podem ser abertos localmente", async () => {
    mocks.contexto.mockImplementation(() => { throw new Error("senha-restrita-de-teste"); });
    expect(await diagnosticarAutenticacaoSicoob(envProducao())).toMatchObject({
      status: "CONFIGURACAO_PENDENTE", configuracaoLocalValida: false,
      autenticacaoValidada: false, convenioValidado: false,
    });
    expect(mocks.requisicao).not.toHaveBeenCalled();
  });

  it("não encaminha material de autenticação para URL alterada", async () => {
    const resultado = await diagnosticarAutenticacaoSicoob(envProducao({
      SICOOB_TOKEN_URL: "https://coletor.example/segredo-privado",
    }));
    expect(resultado.status).toBe("CONFIGURACAO_PENDENTE");
    expect(mocks.requisicao).not.toHaveBeenCalled();
    expect(JSON.stringify(resultado)).not.toContain("coletor");
    expect(JSON.stringify(resultado)).not.toContain("segredo-privado");
  });

  it("não alega que token estático do sandbox foi autenticado", async () => {
    const resultado = await diagnosticarAutenticacaoSicoob({
      NODE_ENV: "test", SICOOB_AMBIENTE: "sandbox", SICOOB_CLIENT_ID: "teste",
      SICOOB_ACCESS_TOKEN: "token-estatico",
    });
    expect(resultado).toMatchObject({
      status: "SANDBOX_NAO_TESTADO", configuracaoLocalValida: true,
      autenticacaoValidada: false, convenioValidado: false,
    });
    expect(mocks.requisicao).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 500])("sanitiza o erro OAuth HTTP %s", async (status) => {
    mocks.requisicao.mockRejectedValue(new ErroApiSicoob("token=segredo-restrito-de-teste certificado=/cofre/restrito", { status }));
    const resultado = await diagnosticarAutenticacaoSicoob(envProducao());
    expect(resultado).toMatchObject({ status: "FALHA_AUTENTICACAO", autenticacaoValidada: false, convenioValidado: false });
    expect(JSON.stringify(resultado)).not.toMatch(/segredo-restrito|\/cofre\/restrito/);
  });

  it("não aceita uma resposta OAuth sem access_token", async () => {
    mocks.requisicao.mockResolvedValue({ status: 200, corpo: {}, headers: {} });
    expect(await diagnosticarAutenticacaoSicoob(envProducao())).toMatchObject({ status: "FALHA_AUTENTICACAO", autenticacaoValidada: false });
  });
});
