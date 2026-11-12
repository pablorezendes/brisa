import "server-only";

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AmbienteSicoob } from "./tipos";

export const LIMITE_CERTIFICADO_SICOOB = 512 * 1024;
const CONTEXTO = "brisa:sicoob:credenciais:v1";
const LIMITE_ENVELOPE = 1024 * 1024;

export type CredenciaisPainelSicoob = {
  pfx: Buffer;
  senha: string;
  clientId: string;
  ambiente: AmbienteSicoob;
};

function diretorio(env: NodeJS.ProcessEnv): string | undefined {
  const configurado = env.SICOOB_CREDENCIAIS_DIR?.trim();
  return configurado ? resolve(configurado) : env === process.env ? resolve("dados/sicoob") : undefined;
}

function chave(env: NodeJS.ProcessEnv): Buffer {
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
    throw new Error("Proteção das credenciais do Sicoob indisponível.");
  }
  return Buffer.from(hkdfSync("sha256", env.AUTH_SECRET, "brisa:sicoob", CONTEXTO, 32));
}

export function clientIdPainelValido(clientId: string): boolean {
  return /^[\x21-\x7e]{1,200}$/.test(clientId);
}

export function lerCredenciaisPainelSicoob(env: NodeJS.ProcessEnv): CredenciaisPainelSicoob | null {
  const pasta = diretorio(env);
  if (!pasta) return null;
  const caminho = resolve(pasta, "credenciais-v1.enc");
  let dados: Buffer;
  try {
    const arquivo = lstatSync(caminho);
    if (!arquivo.isFile() || arquivo.size > LIMITE_ENVELOPE) throw new Error();
    dados = readFileSync(caminho);
    if (dados.length < 29 || dados.length > LIMITE_ENVELOPE) throw new Error();
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Credenciais protegidas do Sicoob indisponíveis.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", chave(env), dados.subarray(0, 12));
    decipher.setAAD(Buffer.from(CONTEXTO));
    decipher.setAuthTag(dados.subarray(12, 28));
    const decifrado = Buffer.concat([decipher.update(dados.subarray(28)), decipher.final()]);
    const info = JSON.parse(decifrado.toString("utf8")) as Record<string, unknown>;
    if (typeof info.pfx !== "string" || typeof info.senha !== "string" ||
        !info.senha || Buffer.byteLength(info.senha) > 512 ||
        typeof info.clientId !== "string" || !clientIdPainelValido(info.clientId) ||
        (info.ambiente !== "producao" && info.ambiente !== "sandbox")) throw new Error();
    const pfx = Buffer.from(info.pfx, "base64");
    if (!pfx.length || pfx.length > LIMITE_CERTIFICADO_SICOOB) throw new Error();
    return { pfx, senha: info.senha, clientId: info.clientId, ambiente: info.ambiente };
  } catch {
    throw new Error("Credenciais protegidas do Sicoob indisponíveis.");
  }
}

export function salvarCredenciaisPainelSicoob(
  credenciais: CredenciaisPainelSicoob,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const pasta = diretorio(env);
  if (!pasta) throw new Error("Armazenamento das credenciais do Sicoob indisponível.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", chave(env), iv);
  cipher.setAAD(Buffer.from(CONTEXTO));
  const conteudo = JSON.stringify({ ...credenciais, pfx: credenciais.pfx.toString("base64") });
  const cifrado = Buffer.concat([cipher.update(conteudo, "utf8"), cipher.final()]);
  const envelope = Buffer.concat([iv, cipher.getAuthTag(), cifrado]);
  mkdirSync(pasta, { recursive: true, mode: 0o700 });
  const temporario = resolve(pasta, `credenciais-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporario, envelope, { flag: "wx", mode: 0o600, flush: true });
    renameSync(temporario, resolve(pasta, "credenciais-v1.enc"));
  } finally {
    rmSync(temporario, { force: true });
  }
}
