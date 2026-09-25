// Somente no servidor/worker: nunca importar a partir de componente cliente.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function chaveAutomacoes(): Buffer {
  const valor = process.env.AUTOMACOES_CHAVE ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(valor)) throw new Error("Configure AUTOMACOES_CHAVE com uma chave Base64 de 32 bytes.");
  const chave = Buffer.from(valor, "base64");
  if (chave.length !== 32 || chave.toString("base64") !== valor) throw new Error("AUTOMACOES_CHAVE inválida.");
  return chave;
}

export function chaveAutomacoesConfigurada(): boolean {
  try { chaveAutomacoes(); return true; } catch { return false; }
}

function aad(contexto: string): Buffer {
  if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(contexto)) throw new Error("Contexto de proteção inválido.");
  return Buffer.from(`brisa:automacoes:v1:${contexto}`, "utf8");
}

/** A chave fica SOMENTE no ambiente; preservar o backup da chave fora do banco/Git. */
export function cifrarSegredo(segredo: string, contexto = "automacoes"): string {
  if (typeof segredo !== "string" || !segredo.trim() || Buffer.byteLength(segredo, "utf8") > 16_384) throw new Error("Segredo vazio ou acima do limite.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", chaveAutomacoes(), iv);
  cipher.setAAD(aad(contexto));
  const corpo = Buffer.concat([cipher.update(segredo, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), corpo.toString("base64url")].join(":");
}

export function decifrarSegredo(envelope: string, contexto = "automacoes"): string {
  const chave = chaveAutomacoes();
  try {
    if (typeof envelope !== "string" || envelope.length > 23_000) throw new Error();
    const partes = envelope.split(":");
    if (partes.length !== 4 || partes[0] !== "v1" || partes.slice(1).some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) throw new Error();
    const [iv, tag, corpo] = partes.slice(1).map((p) => Buffer.from(p, "base64url"));
    if (iv.length !== 12 || tag.length !== 16 || corpo.length > 16_384) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", chave, iv);
    decipher.setAAD(aad(contexto));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(corpo), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Não foi possível abrir a credencial protegida. Confira a chave do ambiente.");
  }
}
