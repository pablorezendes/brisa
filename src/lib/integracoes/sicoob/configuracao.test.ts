import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));
const createSecureContext = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("node:fs", () => fsMock);
vi.mock("node:tls", () => ({ createSecureContext }));

import {
  carregarConfiguracaoSicoob,
  ErroConfiguracaoSicoob,
  obterEstadoConfiguracaoSicoob,
} from "./configuracao";

const ESCOPO_RUNTIME_PADRAO =
  "boletos_inclusao boletos_consulta boletos_alteracao";
const ESCOPOS_WEBHOOK =
  "webhooks_inclusao webhooks_consulta webhooks_alteracao";

function envProducao(
  sobrescrever: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    SICOOB_AMBIENTE: "producao",
    SICOOB_CLIENT_ID: "client-id-de-teste",
    SICOOB_TOKEN_URL:
      "https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token",
    SICOOB_PFX_PATH: "/run/secrets/sicoob/client.pfx",
    SICOOB_PFX_PASSPHRASE: "senha-apenas-de-teste",
    ...sobrescrever,
  };
}

describe("configuração segura do Sicoob", () => {
  beforeEach(() => {
    fsMock.existsSync.mockReset().mockReturnValue(true);
    fsMock.readFileSync.mockReset().mockReturnValue(Buffer.from("pfx-de-teste"));
    createSecureContext.mockReset().mockReturnValue({});
  });

  it("carrega produção com PFX usando somente os três escopos legados por padrão", () => {
    const configuracao = carregarConfiguracaoSicoob(envProducao());
    const estado = obterEstadoConfiguracaoSicoob(envProducao());

    expect(configuracao.ambiente).toBe("producao");
    expect(configuracao.scopes).toBe(ESCOPO_RUNTIME_PADRAO);
    expect(estado.escoposWebhookConfigurados).toBe(false);
    expect(configuracao.tls.pfx).toEqual(Buffer.from("pfx-de-teste"));
    expect(configuracao.tls.passphrase).toBe("senha-apenas-de-teste");
    expect(fsMock.readFileSync).toHaveBeenCalledWith(
      "/run/secrets/sicoob/client.pfx",
    );
  });

  it("só libera o webhook quando os três escopos opcionais são explícitos", () => {
    const completo = envProducao({
      SICOOB_SCOPES: `${ESCOPO_RUNTIME_PADRAO} ${ESCOPOS_WEBHOOK}`,
    });
    const incompleto = envProducao({
      SICOOB_SCOPES: `${ESCOPO_RUNTIME_PADRAO} webhooks_inclusao webhooks_consulta`,
    });

    expect(obterEstadoConfiguracaoSicoob(completo).escoposWebhookConfigurados).toBe(true);
    expect(obterEstadoConfiguracaoSicoob(incompleto).escoposWebhookConfigurados).toBe(false);
    expect(carregarConfiguracaoSicoob(completo).scopes).toBe(
      `${ESCOPO_RUNTIME_PADRAO} ${ESCOPOS_WEBHOOK}`,
    );
  });

  it("mantém produção pendente enquanto a senha do PFX estiver vazia", () => {
    const env = envProducao({ SICOOB_PFX_PASSPHRASE: "   " });
    const estado = obterEstadoConfiguracaoSicoob(env);

    expect(estado.configurado).toBe(false);
    expect(estado.mtlsConfigurado).toBe(false);
    expect(estado.pendencias).toContain("SICOOB_PFX_PASSPHRASE");
    expect(fsMock.readFileSync).not.toHaveBeenCalled();
    expect(() => carregarConfiguracaoSicoob(env)).toThrow(
      ErroConfiguracaoSicoob,
    );
  });

  it("não revela caminho nem senha no estado ou no erro de configuração", () => {
    const caminhoPrivado = "/segredo/clientes/brisa/client.pfx";
    const senhaPrivada = "nao-deve-aparecer-no-diagnostico";
    fsMock.existsSync.mockReturnValue(false);
    const env = envProducao({
      SICOOB_PFX_PATH: caminhoPrivado,
      SICOOB_PFX_PASSPHRASE: senhaPrivada,
    });

    const estadoSerializado = JSON.stringify(obterEstadoConfiguracaoSicoob(env));
    expect(estadoSerializado).toContain("SICOOB_PFX_PATH não encontrado");
    expect(estadoSerializado).not.toContain(caminhoPrivado);
    expect(estadoSerializado).not.toContain(senhaPrivada);

    try {
      carregarConfiguracaoSicoob(env);
      throw new Error("era esperado erro de configuração");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroConfiguracaoSicoob);
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      expect(mensagem).not.toContain(caminhoPrivado);
      expect(mensagem).not.toContain(senhaPrivada);
    }
  });

  it("abre o certificado localmente e recusa senha incorreta sem expor erro TLS", () => {
    createSecureContext.mockImplementation(() => {
      throw new Error("TLS detalhado com caminho /cofre/cliente.pfx e senha-privada");
    });
    const estado = obterEstadoConfiguracaoSicoob(envProducao());
    expect(estado.configurado).toBe(false);
    expect(estado.mtlsConfigurado).toBe(false);
    expect(estado.pendencias).toContain("Certificado PFX ou senha inválidos para mTLS");
    expect(JSON.stringify(estado)).not.toMatch(/senha-privada|\/cofre\/cliente/);
  });

  it("rejeita PFX combinado com PEM sem tentar abrir nenhum material", () => {
    const estado = obterEstadoConfiguracaoSicoob(envProducao({
      SICOOB_CERT_PATH: "/cofre/cliente.pem",
      SICOOB_KEY_PATH: "/cofre/chave.pem",
    }));
    expect(estado.configurado).toBe(false);
    expect(estado.pendencias).toContain("Configure somente PFX ou CERT + KEY, nunca os dois formatos");
    expect(fsMock.readFileSync).not.toHaveBeenCalled();
  });

  it("valida certificado e chave PEM antes de dizer que mTLS está configurado", () => {
    const env = envProducao({
      SICOOB_PFX_PATH: "",
      SICOOB_PFX_PASSPHRASE: "",
      SICOOB_CERT_PATH: "/cofre/cliente.pem",
      SICOOB_KEY_PATH: "/cofre/chave.pem",
    });
    expect(obterEstadoConfiguracaoSicoob(env).mtlsConfigurado).toBe(true);
    expect(createSecureContext).toHaveBeenCalledWith({
      cert: Buffer.from("pfx-de-teste"), key: Buffer.from("pfx-de-teste"),
    });
    createSecureContext.mockImplementation(() => { throw new Error("chave incompatível"); });
    expect(obterEstadoConfiguracaoSicoob(env).pendencias).toContain("Certificado PEM, chave ou senha inválidos para mTLS");
  });

  it.each([
    ["SICOOB_API_BASE_URL", "https://coletor.example/receber"],
    ["SICOOB_API_BASE_URL", "https://api.sicoob.com.br.example/cobranca-bancaria/v3"],
    ["SICOOB_API_BASE_URL", "https://api.sicoob.com.br:8443/cobranca-bancaria/v3"],
    ["SICOOB_API_BASE_URL", "https://privado:segredo@api.sicoob.com.br/cobranca-bancaria/v3"],
    ["SICOOB_API_BASE_URL", "https://sandbox.sicoob.com.br/sicoob/sandbox/cobranca-bancaria/v3"],
    ["SICOOB_TOKEN_URL", "https://coletor.example/token"],
    ["SICOOB_TOKEN_URL", "https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token?segredo=privado"],
  ])("bloqueia destino não oficial em %s", (campo, valor) => {
    const estado = obterEstadoConfiguracaoSicoob(envProducao({ [campo]: valor }));
    expect(estado.configurado).toBe(false);
    expect(estado.pendencias.some((pendencia) => pendencia.startsWith(campo))).toBe(true);
    expect(JSON.stringify(estado)).not.toContain(valor);
    expect(() => carregarConfiguracaoSicoob(envProducao({ [campo]: valor }))).toThrow(ErroConfiguracaoSicoob);
  });

  it("renova a identidade do cache quando certificado, senha, segredo ou modo mudam", () => {
    const base = carregarConfiguracaoSicoob(envProducao()).cacheTokenId;
    expect(base).toMatch(/^[a-f0-9]{64}$/);
    expect(carregarConfiguracaoSicoob(envProducao()).cacheTokenId).toBe(base);
    for (const alteracao of [
      { SICOOB_PFX_PASSPHRASE: "outra-senha" },
      { SICOOB_CLIENT_SECRET: "outro-segredo" },
      { SICOOB_TOKEN_AUTH: "basic" },
      { SICOOB_SCOPES: "boletos_consulta" },
    ]) {
      expect(carregarConfiguracaoSicoob(envProducao(alteracao)).cacheTokenId).not.toBe(base);
    }
    fsMock.readFileSync.mockReturnValue(Buffer.from("pfx-rotacionado"));
    expect(carregarConfiguracaoSicoob(envProducao()).cacheTokenId).not.toBe(base);
  });

  it("sandbox estático continua sem exigir nem abrir certificado", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test", SICOOB_AMBIENTE: "sandbox", SICOOB_CLIENT_ID: "teste",
      SICOOB_ACCESS_TOKEN: "token-de-teste",
    };
    expect(obterEstadoConfiguracaoSicoob(env)).toMatchObject({
      configurado: true, autenticacao: "token_estatico", mtlsConfigurado: false,
    });
    expect(createSecureContext).not.toHaveBeenCalled();
  });
});
