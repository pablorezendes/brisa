import "server-only";

import { existsSync, readFileSync } from "node:fs";
import type { SecureContextOptions } from "node:tls";

import type { AmbienteSicoob } from "./tipos";

const BASES_PADRAO: Record<AmbienteSicoob, string> = {
  sandbox: "https://sandbox.sicoob.com.br/sicoob/sandbox/cobranca-bancaria/v3",
  producao: "https://api.sicoob.com.br/cobranca-bancaria/v3",
};

export type ConfiguracaoSicoob = {
  ambiente: AmbienteSicoob;
  baseUrl: string;
  tokenUrl: string | null;
  clientId: string;
  clientSecret: string | null;
  tokenAuth: "body" | "basic";
  scopes: string;
  accessTokenEstatico: string | null;
  timeoutMs: number;
  tls: SecureContextOptions;
  cacheTokenId: string;
};

export type EstadoConfiguracaoSicoob = {
  configurado: boolean;
  ambiente: AmbienteSicoob;
  baseUrl: string;
  autenticacao: "token_estatico" | "oauth_client_credentials";
  mtlsConfigurado: boolean;
  pendencias: string[];
};

export class ErroConfiguracaoSicoob extends Error {
  readonly pendencias: string[];

  constructor(pendencias: string[]) {
    super(`Integração Sicoob incompleta: ${pendencias.join(", ")}.`);
    this.name = "ErroConfiguracaoSicoob";
    this.pendencias = pendencias;
  }
}

function ambiente(env: NodeJS.ProcessEnv): AmbienteSicoob {
  return env.SICOOB_AMBIENTE?.trim().toLowerCase() === "producao"
    ? "producao"
    : "sandbox";
}

function urlHttps(valor: string, nome: string): string {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new ErroConfiguracaoSicoob([`${nome} deve ser uma URL válida`]);
  }
  if (url.protocol !== "https:") {
    throw new ErroConfiguracaoSicoob([`${nome} deve usar HTTPS`]);
  }
  return url.toString().replace(/\/$/, "");
}

function caminhosMtls(env: NodeJS.ProcessEnv): {
  configurado: boolean;
  pendencias: string[];
  tls: SecureContextOptions;
} {
  const pfxPath = env.SICOOB_PFX_PATH?.trim();
  const certPath = env.SICOOB_CERT_PATH?.trim();
  const keyPath = env.SICOOB_KEY_PATH?.trim();
  const pendencias: string[] = [];

  if (pfxPath) {
    if (!existsSync(pfxPath)) pendencias.push("SICOOB_PFX_PATH não encontrado");
    let pfx: Buffer | undefined;
    if (pendencias.length === 0) {
      try {
        pfx = readFileSync(pfxPath);
      } catch {
        pendencias.push("SICOOB_PFX_PATH não pode ser lido");
      }
    }
    return {
      configurado: pendencias.length === 0,
      pendencias,
      tls: pendencias.length || !pfx
        ? {}
        : {
            pfx,
            ...(env.SICOOB_PFX_PASSPHRASE
              ? { passphrase: env.SICOOB_PFX_PASSPHRASE }
              : {}),
          },
    };
  }

  if (certPath || keyPath) {
    if (!certPath) pendencias.push("SICOOB_CERT_PATH");
    if (!keyPath) pendencias.push("SICOOB_KEY_PATH");
    if (certPath && !existsSync(certPath)) {
      pendencias.push("SICOOB_CERT_PATH não encontrado");
    }
    if (keyPath && !existsSync(keyPath)) {
      pendencias.push("SICOOB_KEY_PATH não encontrado");
    }
    let cert: Buffer | undefined;
    let key: Buffer | undefined;
    if (pendencias.length === 0 && certPath && keyPath) {
      try {
        cert = readFileSync(certPath);
        key = readFileSync(keyPath);
      } catch {
        pendencias.push("certificado mTLS não pode ser lido");
      }
    }
    return {
      configurado: pendencias.length === 0,
      pendencias,
      tls:
        pendencias.length || !cert || !key
          ? {}
          : {
              cert,
              key,
              ...(env.SICOOB_CERT_PASSPHRASE
                ? { passphrase: env.SICOOB_CERT_PASSPHRASE }
                : {}),
            },
    };
  }

  return { configurado: false, pendencias: [], tls: {} };
}

function inspecionar(env: NodeJS.ProcessEnv): {
  estado: EstadoConfiguracaoSicoob;
  tls: SecureContextOptions;
} {
  const amb = ambiente(env);
  const baseInformada = env.SICOOB_API_BASE_URL?.trim() || BASES_PADRAO[amb];
  let baseUrl = BASES_PADRAO[amb];
  const clientId = env.SICOOB_CLIENT_ID?.trim();
  const tokenEstatico = env.SICOOB_ACCESS_TOKEN?.trim();
  const tokenUrl = env.SICOOB_TOKEN_URL?.trim();
  const mtls = caminhosMtls(env);
  const pendencias = [...mtls.pendencias];

  try {
    baseUrl = urlHttps(baseInformada, "SICOOB_API_BASE_URL");
  } catch (erro) {
    if (erro instanceof ErroConfiguracaoSicoob) pendencias.push(...erro.pendencias);
    else pendencias.push("SICOOB_API_BASE_URL inválida");
  }

  if (!clientId) pendencias.push("SICOOB_CLIENT_ID");
  if (amb === "producao" && tokenEstatico) {
    pendencias.push("SICOOB_ACCESS_TOKEN é permitido somente no sandbox");
  }
  if (!tokenEstatico && !tokenUrl) pendencias.push("SICOOB_TOKEN_URL");
  // O sandbox oficial aceita o token estático disponibilizado no portal sem
  // certificado. OAuth/produção continuam obrigatoriamente protegidos por mTLS.
  if (!mtls.configurado && (amb === "producao" || !tokenEstatico)) {
    pendencias.push("certificado mTLS (PFX ou CERT + KEY)");
  }
  if (tokenUrl) {
    try {
      urlHttps(tokenUrl, "SICOOB_TOKEN_URL");
    } catch (erro) {
      if (erro instanceof ErroConfiguracaoSicoob) pendencias.push(...erro.pendencias);
      else pendencias.push("SICOOB_TOKEN_URL inválida");
    }
  }

  return {
    estado: {
      configurado: pendencias.length === 0,
      ambiente: amb,
      baseUrl,
      autenticacao: tokenEstatico ? "token_estatico" : "oauth_client_credentials",
      mtlsConfigurado: mtls.configurado,
      pendencias: [...new Set(pendencias)],
    },
    tls: mtls.tls,
  };
}

/** Estado seguro para UI/diagnóstico: nunca retorna token, segredo, senha ou paths. */
export function obterEstadoConfiguracaoSicoob(
  env: NodeJS.ProcessEnv = process.env,
): EstadoConfiguracaoSicoob {
  return inspecionar(env).estado;
}

export function carregarConfiguracaoSicoob(
  env: NodeJS.ProcessEnv = process.env,
): ConfiguracaoSicoob {
  const { estado, tls } = inspecionar(env);
  if (!estado.configurado) throw new ErroConfiguracaoSicoob(estado.pendencias);

  const timeoutInformado = Number(env.SICOOB_TIMEOUT_MS ?? 15_000);
  const timeoutMs =
    Number.isFinite(timeoutInformado) && timeoutInformado >= 1_000 && timeoutInformado <= 120_000
      ? Math.trunc(timeoutInformado)
      : 15_000;
  const tokenUrl = env.SICOOB_TOKEN_URL?.trim() || null;
  const clientId = env.SICOOB_CLIENT_ID!.trim();
  const scopes =
    env.SICOOB_SCOPES?.trim() ||
    "boletos_inclusao boletos_consulta webhooks_inclusao webhooks_consulta";

  return {
    ambiente: estado.ambiente,
    baseUrl: estado.baseUrl,
    tokenUrl: tokenUrl ? urlHttps(tokenUrl, "SICOOB_TOKEN_URL") : null,
    clientId,
    clientSecret: env.SICOOB_CLIENT_SECRET?.trim() || null,
    tokenAuth: env.SICOOB_TOKEN_AUTH?.trim().toLowerCase() === "basic" ? "basic" : "body",
    scopes,
    accessTokenEstatico: env.SICOOB_ACCESS_TOKEN?.trim() || null,
    timeoutMs,
    tls,
    cacheTokenId: `${estado.ambiente}:${clientId}:${tokenUrl ?? "estatico"}:${scopes}`,
  };
}
