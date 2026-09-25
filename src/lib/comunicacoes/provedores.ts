// Somente no servidor/worker: nunca importar a partir de componente cliente.
import { normalizarEmail, normalizarTelefoneBR, valoresMensagem, VARIAVEIS_COBRANCA, type DadosMensagemCobranca } from "./dominio";

// Contratos oficiais: https://resend.com/docs/api-reference/emails/send-email
// https://resend.com/docs/dashboard/emails/idempotency-keys
// https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api

/** ACEITO não significa entregue/lido: essa confirmação pertence ao webhook. */
export type ResultadoEnvio =
  | { status: "ACEITO"; provedorId: string; codigo: "ACEITO" }
  | { status: "FALHA" | "INCERTO" | "REPETIR"; codigo: string; provedorId?: never };

type FetchProvedor = typeof fetch;
const LIMITE_RESPOSTA = 128 * 1024;

async function jsonLimitado(resposta: Response): Promise<Record<string, unknown>> {
  if (Number(resposta.headers.get("content-length")) > LIMITE_RESPOSTA) throw new Error("RESPOSTA_GRANDE");
  const reader = resposta.body?.getReader();
  if (!reader) return {};
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      tamanho += value.byteLength;
      if (tamanho > LIMITE_RESPOSTA) { await reader.cancel(); throw new Error("RESPOSTA_GRANDE"); }
      partes.push(value);
    }
  } finally { reader.releaseLock(); }
  const texto = Buffer.concat(partes).toString("utf8");
  const valor: unknown = texto ? JSON.parse(texto) : {};
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor as Record<string, unknown> : {};
}

function credencialValida(valor: string): boolean {
  return typeof valor === "string" && valor.length >= 10 && valor.length <= 16_384 && !/[\s\u0000-\u001f\u007f]/.test(valor);
}

export type EmailResend = {
  apiKey: string; remetente: string; resposta?: string; destinatario: string;
  assunto: string; texto: string; html: string; chaveIdempotencia: string;
};

/** Repetições são seguras APENAS com payload imutável e dentro das 24h do primeiro envio. */
export async function enviarEmailResend(entrada: EmailResend, requisitar: FetchProvedor = fetch): Promise<ResultadoEnvio> {
  let corpo: string;
  try {
    if (!credencialValida(entrada.apiKey) || !/^[A-Za-z0-9_:/.-]{1,256}$/.test(entrada.chaveIdempotencia) || !entrada.assunto || entrada.assunto.length > 400 || /[\r\n\u0000-\u001f]/.test(entrada.assunto) || !entrada.texto || entrada.texto.length > 10_000 || entrada.html.length > 100_000) throw new Error();
    corpo = JSON.stringify({ from: normalizarEmail(entrada.remetente), to: [normalizarEmail(entrada.destinatario)], subject: entrada.assunto, text: entrada.texto, html: entrada.html, ...(entrada.resposta ? { reply_to: normalizarEmail(entrada.resposta) } : {}) });
  } catch { return { status: "FALHA", codigo: "CONFIGURACAO_EMAIL_INVALIDA" }; }
  try {
    const resposta = await requisitar("https://api.resend.com/emails", {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${entrada.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": entrada.chaveIdempotencia }, body: corpo,
    });
    if (resposta.status === 429 || resposta.status === 408 || resposta.status >= 500) return { status: "REPETIR", codigo: `RESEND_HTTP_${resposta.status}` };
    if (!resposta.ok && resposta.status !== 409) return { status: "FALHA", codigo: `RESEND_HTTP_${resposta.status}` };
    const dados = await jsonLimitado(resposta);
    if (resposta.status === 409 && dados.name === "concurrent_idempotent_requests") return { status: "REPETIR", codigo: "RESEND_CONCORRENTE" };
    if (!resposta.ok) return { status: "FALHA", codigo: `RESEND_HTTP_${resposta.status}` };
    if (typeof dados.id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(dados.id)) return { status: "INCERTO", codigo: "RESEND_SEM_IDENTIFICADOR" };
    return { status: "ACEITO", provedorId: dados.id, codigo: "ACEITO" };
  } catch {
    // Nunca devolver mensagem/stack do provedor, que pode conter token ou endereço.
    return { status: "REPETIR", codigo: "RESEND_REDE_OU_RESPOSTA" };
  }
}

export function versaoApiWhatsApp(valor = process.env.WHATSAPP_API_VERSION): string {
  // Sem versão presumida: o administrador informa uma versão suportada pelo app Meta.
  if (!valor || !/^v[1-9]\d?\.0$/.test(valor)) throw new Error("Configure WHATSAPP_API_VERSION com a versão suportada do seu app Meta (vNN.0).");
  return valor;
}

export type WhatsAppMeta = {
  token: string; phoneNumberId: string; destinatario: string; template: string;
  idioma: "pt_BR"; dados: DadosMensagemCobranca;
};

export async function enviarWhatsAppMeta(entrada: WhatsAppMeta, requisitar: FetchProvedor = fetch, versao?: string): Promise<ResultadoEnvio> {
  let corpo: string;
  let endpoint: string;
  try {
    if (!credencialValida(entrada.token) || !/^\d{5,30}$/.test(entrada.phoneNumberId) || !/^[a-z0-9_]{1,512}$/.test(entrada.template) || entrada.idioma !== "pt_BR") throw new Error();
    const valores = valoresMensagem(entrada.dados);
    endpoint = `https://graph.facebook.com/${versaoApiWhatsApp(versao)}/${entrada.phoneNumberId}/messages`;
    corpo = JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: normalizarTelefoneBR(entrada.destinatario), type: "template", template: { name: entrada.template, language: { code: entrada.idioma }, components: [{ type: "body", parameters: VARIAVEIS_COBRANCA.map((chave) => ({ type: "text", text: valores[chave] })) }] } });
  } catch { return { status: "FALHA", codigo: "CONFIGURACAO_WHATSAPP_INVALIDA" }; }
  try {
    const resposta = await requisitar(endpoint, {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${entrada.token}`, "Content-Type": "application/json" }, body: corpo,
    });
    if (resposta.status >= 500 || resposta.status === 408) return { status: "INCERTO", codigo: `META_HTTP_${resposta.status}` };
    // Mesmo rate limit é terminal para esta tentativa; nenhum retry cego sem idempotência do provedor.
    if (!resposta.ok) return { status: "FALHA", codigo: `META_HTTP_${resposta.status}` };
    const dados = await jsonLimitado(resposta);
    const item = Array.isArray(dados.messages) ? dados.messages[0] as Record<string, unknown> | undefined : undefined;
    if (!item || typeof item.id !== "string" || !/^[a-zA-Z0-9._=+/-]{1,300}$/.test(item.id)) return { status: "INCERTO", codigo: "META_SEM_IDENTIFICADOR" };
    return { status: "ACEITO", provedorId: item.id, codigo: "ACEITO" };
  } catch { return { status: "INCERTO", codigo: "META_REDE_OU_RESPOSTA" }; }
}
