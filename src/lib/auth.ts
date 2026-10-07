/**
 * Autenticação própria do sistema (sem dependências externas):
 *  - senha: scrypt (crypto nativo), formato "salt:hash" em hex;
 *  - sessão: token assinado HMAC-SHA256 (payload.assinatura, base64url),
 *    verificável também no proxy (edge) via Web Crypto;
 *  - cookie httpOnly "brisa_sessao".
 */
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { prisma } from "./db";

export const COOKIE_SESSAO = "brisa_sessao";

export function segredo(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "AUTH_SECRET ausente ou curto demais — defina no .env (openssl rand -hex 32)"
    );
  }
  return s;
}

// ---------- senha ----------

export function gerarHashSenha(senha: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(senha, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verificarSenha(senha: string, senhaHash: string): boolean {
  const [salt, hash] = senhaHash.split(":");
  if (!salt || !hash) return false;
  const calculado = scryptSync(senha, salt, 64);
  const esperado = Buffer.from(hash, "hex");
  return (
    calculado.length === esperado.length && timingSafeEqual(calculado, esperado)
  );
}

// ---------- token de sessão ----------

export interface SessaoPayload {
  sub: string; // id do usuário
  nome: string;
  exp: number; // epoch ms
  sv?: number; // versão de revogação, 0 para sessões anteriores ao RBAC
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function criarToken(payload: SessaoPayload): string {
  const corpo = b64url(Buffer.from(JSON.stringify(payload), "utf-8"));
  const assinatura = createHmac("sha256", segredo()).update(corpo).digest();
  return `${corpo}.${b64url(assinatura)}`;
}

export function verificarToken(token: string | undefined): SessaoPayload | null {
  if (!token) return null;
  const partes = token.split(".");
  if (partes.length !== 2) return null;
  const [corpo, assinatura] = partes;
  if (!corpo || !assinatura) return null;
  const esperada = createHmac("sha256", segredo()).update(corpo).digest();
  const recebida = Buffer.from(assinatura, "base64url");
  if (
    esperada.length !== recebida.length ||
    !timingSafeEqual(esperada, recebida)
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(corpo, "base64url").toString("utf-8")
    ) as SessaoPayload;
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= Date.now() || typeof payload.sub !== "string" || !payload.sub || (payload.sv !== undefined && (!Number.isSafeInteger(payload.sv) || payload.sv < 0))) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------- helpers de sessão (server components / actions) ----------

export const sessaoAtual = cache(async (): Promise<SessaoPayload | null> => {
  const jar = await cookies();
  const sessao = verificarToken(jar.get(COOKIE_SESSAO)?.value);
  if (!sessao) return null;
  const usuario = await prisma.usuario.findUnique({ where: { id: sessao.sub }, select: { ativo: true, sessaoVersao: true, nome: true } });
  if (!usuario?.ativo || (sessao.sv ?? 0) !== usuario.sessaoVersao) return null;
  return { ...sessao, nome: usuario.nome };
});

/** Guarda de página/layout: redireciona para /login sem sessão válida. */
export async function exigirSessao(): Promise<SessaoPayload> {
  const sessao = await sessaoAtual();
  if (!sessao) redirect("/login");
  return sessao;
}

export async function abrirSessao(
  usuario: { id: string; nome: string; sessaoVersao: number },
  lembrar: boolean
): Promise<void> {
  const dias = lembrar ? 30 : 1;
  const exp = Date.now() + dias * 24 * 60 * 60 * 1000;
  const atual = await prisma.usuario.findUnique({ where: { id: usuario.id }, select: { ativo: true, sessaoVersao: true } });
  // A versão vem do mesmo registro cuja senha foi validada. Não elevar uma
  // autenticação antiga para a nova versão após um reset concorrente.
  if (!atual?.ativo || atual.sessaoVersao !== usuario.sessaoVersao) redirect("/login?erro=credenciais");
  const token = criarToken({ sub: usuario.id, nome: usuario.nome, exp, sv: atual.sessaoVersao });
  const jar = await cookies();
  jar.set(COOKIE_SESSAO, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    ...(lembrar ? { maxAge: dias * 24 * 60 * 60 } : {}),
  });
}

export async function encerrarSessao(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_SESSAO);
}
