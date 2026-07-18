/**
 * Proxy (Next 16): barreira otimista de autenticação.
 * Verifica a ASSINATURA e a VALIDADE do cookie de sessão (HMAC-SHA256 via
 * Web Crypto — sem banco no edge) e redireciona para /login quando inválido.
 * A verificação definitiva acontece de novo no layout do grupo (app).
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_SESSAO = "brisa_sessao";

function b64urlParaBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function tokenValido(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const secret = process.env.AUTH_SECRET;
  if (!secret) return false;
  const [corpo, assinatura] = token.split(".");
  if (!corpo || !assinatura) return false;
  try {
    const chave = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const ok = await crypto.subtle.verify(
      "HMAC",
      chave,
      b64urlParaBytes(assinatura),
      new TextEncoder().encode(corpo)
    );
    if (!ok) return false;
    const payload = JSON.parse(
      new TextDecoder().decode(b64urlParaBytes(corpo))
    ) as { exp?: number };
    return typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(COOKIE_SESSAO)?.value;
  if (await tokenValido(token)) return NextResponse.next();

  const url = new URL("/login", request.url);
  return NextResponse.redirect(url);
}

export const config = {
  // tudo, exceto login, assets do Next e arquivos públicos
  matcher: ["/((?!login|_next/static|_next/image|favicon\\.ico|.*\\.svg$).*)"],
};
