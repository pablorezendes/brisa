import "server-only";

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createSecureContext, type SecureContextOptions } from "node:tls";

import type { AmbienteSicoob } from "./tipos";
import {
  BASES_OFICIAIS_SICOOB,
  validarBaseOficialSicoob,
  validarTokenUrlOficialSicoob,
} from "./destinos";

const ESCOPO_PADRAO =
  "boletos_inclusao boletos_consulta boletos_alteracao";
const ESCOPOS_WEBHOOK = [
  "webhooks_inclusao",
  "webhooks_consulta",
  "webhooks_alteracao",
] as const;

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
  escoposWebhookConfigurados: boolean;
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

function possuiEscoposWebhookExplicitos(env: NodeJS.ProcessEnv): boolean {
  const escoposInformados = env.SICOOB_SCOPES?.trim();
  if (!escoposInformados) return false;
  const escopos = new Set(escoposInformados.split(/\s+/).filter(Boolean));
  return ESCOPOS_WEBHOOK.every((escopo) => escopos.has(escopo));
}

function validarMaterialMtls(tls: SecureContextOptions): boolean {
  try {
    // Abre o PFX/PEM e confere chave/senha localmente, sem conexão externa.
    // Não atesta vigência, autorização no banco ou titularidade do convênio.
    createSecureContext(tls);
    return true;
  } catch {
    return false;
  }
}

function caminhosMtls(env: NodeJS.ProcessEnv): {
  configurado: boolean;
  pendencias: string[];
  tls: SecureContextOptions;
} {
  const pfxPath = env.SICOOB_PFX_PATH?.trim();
  const pfxPassphrase = env.SICOOB_PFX_PASSPHRASE;
  const certPath = env.SICOOB_CERT_PATH?.trim();
  const keyPath = env.SICOOB_KEY_PATH?.trim();
  const pendencias: string[] = [];

  if (pfxPath && (certPath || keyPath || env.SICOOB_CERT_PASSPHRASE)) {
    return {
      configurado: false,
      pendencias: ["Configure somente PFX ou CERT + KEY, nunca os dois formatos"],
      tls: {},
    };
  }

  if (pfxPath) {
    if (!existsSync(pfxPath)) pendencias.push("SICOOB_PFX_PATH não encontrado");
    if (!pfxPassphrase?.trim()) pendencias.push("SICOOB_PFX_PASSPHRASE");
    let pfx: Buffer | undefined;
    if (pendencias.length === 0) {
      try {
        pfx = readFileSync(pfxPath);
      } catch {
        pendencias.push("SICOOB_PFX_PATH não pode ser lido");
      }
    }
    const tls = pfx ? { pfx, passphrase: pfxPassphrase } : {};
    if (pendencias.length === 0 && !validarMaterialMtls(tls)) {
      pendencias.push("Certificado PFX ou senha inválidos para mTLS");
    }
    return {
      configurado: pendencias.length === 0,
      pendencias,
      tls: pendencias.length ? {} : tls,
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
    const tls: SecureContextOptions = cert && key
      ? {
          cert,
          key,
          ...(env.SICOOB_CERT_PASSPHRASE
            ? { passphrase: env.SICOOB_CERT_PASSPHRASE }
            : {}),
        }
      : {};
    if (pendencias.length === 0 && !validarMaterialMtls(tls)) {
      pendencias.push("Certificado PEM, chave ou senha inválidos para mTLS");
    }
    return {
      configurado: pendencias.length === 0,
      pendencias,
      tls: pendencias.length ? {} : tls,
    };
  }

  return { configurado: false, pendencias: [], tls: {} };
}

function inspecionar(env: NodeJS.ProcessEnv): {
  estado: EstadoConfiguracaoSicoob;
  tls: SecureContextOptions;
} {
  const amb = ambiente(env);
  const baseInformada = env.SICOOB_API_BASE_URL?.trim() || BASES_OFICIAIS_SICOOB[amb];
  let baseUrl = BASES_OFICIAIS_SICOOB[amb];
  const clientId = env.SICOOB_CLIENT_ID?.trim();
  const tokenEstatico = env.SICOOB_ACCESS_TOKEN?.trim();
  const tokenUrl = env.SICOOB_TOKEN_URL?.trim();
  const mtls = caminhosMtls(env);
  const pendencias = [...mtls.pendencias];

  try {
    baseUrl = validarBaseOficialSicoob(baseInformada, amb);
  } catch {
    pendencias.push("SICOOB_API_BASE_URL deve usar o endereço oficial do ambiente selecionado");
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
      validarTokenUrlOficialSicoob(tokenUrl);
    } catch {
      pendencias.push("SICOOB_TOKEN_URL deve usar o endereço oficial de autenticação Sicoob");
    }
  }

  return {
    estado: {
      configurado: pendencias.length === 0,
      ambiente: amb,
      baseUrl,
      autenticacao: tokenEstatico ? "token_estatico" : "oauth_client_credentials",
      mtlsConfigurado: mtls.configurado,
      escoposWebhookConfigurados: possuiEscoposWebhookExplicitos(env),
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
    env.SICOOB_SCOPES?.trim() || ESCOPO_PADRAO;
  const clientSecret = env.SICOOB_CLIENT_SECRET?.trim() || null;
  const tokenAuth = env.SICOOB_TOKEN_AUTH?.trim().toLowerCase() === "basic" ? "basic" : "body";
  // Rotacionar certificado/chave/senha/segredo muda a identidade do cache.
  // Somente o hash permanece na chave em memória; nunca vai para o DTO da UI.
  const identidade = createHash("sha256")
    .update(JSON.stringify({
      ambiente: estado.ambiente,
      baseUrl: estado.baseUrl,
      clientId,
      clientSecret,
      tokenUrl,
      tokenAuth,
      scopes,
      tls,
    }))
    .digest("hex");

  return {
    ambiente: estado.ambiente,
    baseUrl: estado.baseUrl,
    tokenUrl: tokenUrl ? validarTokenUrlOficialSicoob(tokenUrl) : null,
    clientId,
    clientSecret,
    tokenAuth,
    scopes,
    accessTokenEstatico: env.SICOOB_ACCESS_TOKEN?.trim() || null,
    timeoutMs,
    tls,
    cacheTokenId: identidade,
  };
}
