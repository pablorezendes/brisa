import { prisma } from "@/lib/db";
import { LIMITE_WEBHOOK_BYTES, verificarAssinaturaMeta, verificarTokenWebhook } from "@/lib/comunicacoes/webhook";
import { receberRetornoMeta } from "@/lib/comunicacoes/retornos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const token = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "";
  if (token.length < 32 || p.get("hub.mode") !== "subscribe" || !verificarTokenWebhook(p.get("hub.verify_token"), token)) return new Response("Acesso negado", { status: 403 });
  const challenge = p.get("hub.challenge");
  if (!challenge || !/^\d{1,100}$/.test(challenge)) return new Response("Inválido", { status: 400 });
  return new Response(challenge, { headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" } });
}

export async function POST(req: Request) {
  const segredo = process.env.WHATSAPP_APP_SECRET;
  if (!segredo) return new Response("Indisponível", { status: 503 });
  if (!req.headers.get("x-hub-signature-256")) return new Response("Acesso negado", { status: 403 });
  if (Number(req.headers.get("content-length")) > LIMITE_WEBHOOK_BYTES) return new Response("Limite excedido", { status: 413 });
  const reader = req.body?.getReader();
  if (!reader) return new Response("Inválido", { status: 400 });
  let tamanho = 0; const partes: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      tamanho += value.byteLength;
      if (tamanho > LIMITE_WEBHOOK_BYTES) { await reader.cancel(); return new Response("Limite excedido", { status: 413 }); }
      partes.push(value);
    }
  } finally { reader.releaseLock(); }
  const raw = Buffer.concat(partes);
  if (!verificarAssinaturaMeta(raw, req.headers.get("x-hub-signature-256"), segredo)) return new Response("Acesso negado", { status: 403 });
  try { JSON.parse(raw.toString("utf8")); } catch { return new Response("JSON inválido", { status: 400 }); }
  try { await receberRetornoMeta(prisma, raw.toString("utf8")); }
  catch { return new Response("Tente novamente", { status: 503 }); }
  return new Response("OK", { headers: { "Cache-Control": "no-store" } });
}
