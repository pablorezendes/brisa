// Somente no servidor/worker: nunca importar a partir de componente cliente.
import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizarTelefoneBR } from "./dominio";

// https://developers.facebook.com/docs/graph-api/webhooks/getting-started
// Exemplo oficial: https://github.com/fbsamples/whatsapp-api-examples/blob/main/signature-validation-with-webhooks-payloads/app.py
// O HMAC cobre o corpo ORIGINAL, não JSON serializado novamente.
export const LIMITE_WEBHOOK_BYTES = 256 * 1024;

export function verificarAssinaturaMeta(corpo: string | Buffer, assinatura: string | null, appSecret: string): boolean {
  if (!appSecret || appSecret.length > 16_384 || !assinatura || !/^sha256=[a-fA-F0-9]{64}$/.test(assinatura) || Buffer.byteLength(corpo) > LIMITE_WEBHOOK_BYTES) return false;
  const esperada = createHmac("sha256", appSecret).update(corpo).digest();
  const recebida = Buffer.from(assinatura.slice(7), "hex");
  return recebida.length === esperada.length && timingSafeEqual(esperada, recebida);
}

export function verificarTokenWebhook(recebido: string | null, esperado: string): boolean {
  if (!recebido || !esperado || recebido.length > 512 || esperado.length > 512) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type EventoStatusMeta = {
  provedorId: string;
  phoneNumberId: string;
  status: "ENVIADO" | "ENTREGUE" | "LIDO" | "FALHA";
  ocorridoEm: Date;
  codigoErro: string | null;
};

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor as Record<string, unknown> : {};
}

/** Chamar apenas DEPOIS da assinatura válida. Extrai status, nunca mensagem/telefone de cliente. */
export function lerEventosMeta(corpo: string | Buffer): EventoStatusMeta[] {
  if (Buffer.byteLength(corpo) > LIMITE_WEBHOOK_BYTES) throw new Error("Webhook acima do limite.");
  let raiz: Record<string, unknown>;
  try { raiz = objeto(JSON.parse(corpo.toString())); } catch { throw new Error("Webhook JSON inválido."); }
  if (raiz.object !== "whatsapp_business_account" || !Array.isArray(raiz.entry)) return [];
  const eventos: EventoStatusMeta[] = [];
  // O limite do corpo já limita trabalho/memória. Nunca descartar silenciosamente o fim de um lote assinado.
  for (const entry of raiz.entry) {
    const changes = objeto(entry).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const alteracao = objeto(change);
      if (alteracao.field !== "messages") continue;
      const valor = objeto(alteracao.value);
      const phoneNumberId = objeto(valor.metadata).phone_number_id;
      if (typeof phoneNumberId !== "string" || !/^\d{5,30}$/.test(phoneNumberId) || !Array.isArray(valor.statuses)) continue;
      for (const raw of valor.statuses) {
        const item = objeto(raw);
        const estados: Record<string, EventoStatusMeta["status"]> = { sent: "ENVIADO", delivered: "ENTREGUE", read: "LIDO", failed: "FALHA" };
        const status = typeof item.status === "string" && Object.hasOwn(estados, item.status) ? estados[item.status] : undefined;
        if (!status || typeof item.id !== "string" || !/^[a-zA-Z0-9._=+/-]{1,300}$/.test(item.id) || typeof item.timestamp !== "string" || !/^\d{10,11}$/.test(item.timestamp)) continue;
        const ocorridoEm = new Date(Number(item.timestamp) * 1000);
        if (!Number.isFinite(ocorridoEm.getTime())) continue;
        const erro = Array.isArray(item.errors) ? objeto(item.errors[0]).code : undefined;
        eventos.push({ provedorId: item.id, phoneNumberId, status, ocorridoEm, codigoErro: typeof erro === "number" && Number.isSafeInteger(erro) ? `META_${erro}` : null });
      }
    }
  }
  return eventos;
}

/** Webhooks podem chegar repetidos e fora de ordem; entregue/lido não podem regredir. */
export function podeAvancarStatus(atual: string, proximo: EventoStatusMeta["status"]): boolean {
  const ordem: Record<string, number> = { INCERTO: -1, ACEITO: 0, ENVIADO: 1, ENTREGUE: 2, LIDO: 3 };
  if (atual === "FALHA") return false;
  if (proximo === "FALHA") return atual === "INCERTO" || atual === "ACEITO" || atual === "ENVIADO";
  return Object.hasOwn(ordem, atual) && ordem[proximo] > ordem[atual];
}

export type EventoOptOutMeta = { provedorId: string; phoneNumberId: string; destinatario: string; ocorridoEm: Date };

/** Retorna apenas pedidos explícitos de saída; outros textos não são armazenados. */
export function lerOptOutsMeta(corpo: string | Buffer): EventoOptOutMeta[] {
  if (Buffer.byteLength(corpo) > LIMITE_WEBHOOK_BYTES) throw new Error("Webhook acima do limite.");
  let raiz: Record<string, unknown>;
  try { raiz = objeto(JSON.parse(corpo.toString())); } catch { throw new Error("Webhook JSON inválido."); }
  if (raiz.object !== "whatsapp_business_account" || !Array.isArray(raiz.entry)) return [];
  const eventos: EventoOptOutMeta[] = [];
  for (const entry of raiz.entry) {
    const changes = objeto(entry).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const alteracao = objeto(change);
      if (alteracao.field !== "messages") continue;
      const valor = objeto(alteracao.value);
      const phoneNumberId = objeto(valor.metadata).phone_number_id;
      if (typeof phoneNumberId !== "string" || !/^\d{5,30}$/.test(phoneNumberId) || !Array.isArray(valor.messages)) continue;
      for (const raw of valor.messages) {
        const item = objeto(raw);
        const corpoMensagem = objeto(item.text).body;
        if (item.type !== "text" || typeof corpoMensagem !== "string" || !/^(SAIR|PARAR|CANCELAR)$/.test(corpoMensagem.trim().toUpperCase()) || typeof item.from !== "string" || typeof item.id !== "string" || !/^[a-zA-Z0-9._=+/-]{1,300}$/.test(item.id) || typeof item.timestamp !== "string" || !/^\d{10,11}$/.test(item.timestamp)) continue;
        let destinatario: string;
        try { destinatario = normalizarTelefoneBR(item.from); } catch { continue; }
        eventos.push({ provedorId: item.id, phoneNumberId, destinatario, ocorridoEm: new Date(Number(item.timestamp) * 1000) });
      }
    }
  }
  return eventos;
}
