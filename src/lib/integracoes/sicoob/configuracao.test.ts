import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("node:fs", () => fsMock);

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
});
