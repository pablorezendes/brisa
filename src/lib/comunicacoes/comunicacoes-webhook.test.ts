import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { lerEventosMeta, lerOptOutsMeta, LIMITE_WEBHOOK_BYTES, podeAvancarStatus, verificarAssinaturaMeta, verificarTokenWebhook } from "./webhook";

const segredo = "app-secret-apenas-teste";
const evento = (statuses: unknown[], messages: unknown[] = []) => JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "123456789" }, statuses, messages } }] }] });

describe("webhook autenticado de cobrança", () => {
  it("verifica HMAC do corpo bruto e rejeita adulteração", () => {
    const corpo = '{"teste":true}';
    const assinatura = `sha256=${createHmac("sha256", segredo).update(corpo).digest("hex")}`;
    expect(verificarAssinaturaMeta(corpo, assinatura, segredo)).toBe(true);
    expect(verificarAssinaturaMeta('{"teste": true}', assinatura, segredo)).toBe(false);
    expect(verificarAssinaturaMeta(corpo, assinatura, "outro")).toBe(false);
  });
  it("recusa assinatura ausente, truncada, algoritmo errado e corpo grande", () => {
    for (const assinatura of [null, "sha256=00", `sha1=${"a".repeat(64)}`, `sha256=${"z".repeat(64)}`]) expect(verificarAssinaturaMeta("{}", assinatura, segredo)).toBe(false);
    expect(verificarAssinaturaMeta("x".repeat(LIMITE_WEBHOOK_BYTES + 1), `sha256=${"a".repeat(64)}`, segredo)).toBe(false);
  });
  it("verifica token de handshake sem aceitar vazio", () => {
    expect(verificarTokenWebhook("abc", "abc")).toBe(true);
    expect(verificarTokenWebhook("abc", "abcd")).toBe(false);
    expect(verificarTokenWebhook(null, "abc")).toBe(false);
    expect(verificarTokenWebhook("", "")).toBe(false);
  });
  it("extrai somente identificadores e estados, sem texto ou telefone do cliente", () => {
    const dados = lerEventosMeta(evento([{ id: "wamid.123", status: "delivered", timestamp: "1790334000", recipient_id: "5562999990000", texto: "confidencial" }]));
    expect(dados).toEqual([{ provedorId: "wamid.123", phoneNumberId: "123456789", status: "ENTREGUE", ocorridoEm: new Date(1790334000000), codigoErro: null }]);
    expect(JSON.stringify(dados)).not.toContain("5562999990000");
  });
  it("não aceita estados inválidos, prototype keys ou IDs ausentes", () => {
    expect(lerEventosMeta(evento([{ id: "wamid.123", status: "__proto__", timestamp: "1790334000" }, { status: "read", timestamp: "1790334000" }]))).toEqual([]);
    expect(lerEventosMeta('{"object":"outro","entry":[]}')).toEqual([]);
  });
  it("falha de entrega guarda apenas código e não detalhes pessoais", () => {
    const dados = lerEventosMeta(evento([{ id: "wamid.123", status: "failed", timestamp: "1790334000", errors: [{ code: 131026, message: "Informação privada" }] }]));
    expect(dados[0].codigoErro).toBe("META_131026");
    expect(JSON.stringify(dados)).not.toContain("Informação");
  });
  it("limita tamanho sem perder a cauda de um lote com mais de 100 eventos", () => {
    expect(lerEventosMeta(evento(Array.from({ length: 150 }, (_, n) => ({ id: `wamid.${n}`, status: "read", timestamp: "1790334000" }))))).toHaveLength(150);
    expect(() => lerEventosMeta("x".repeat(LIMITE_WEBHOOK_BYTES + 1))).toThrow(/limite/);
    expect(() => lerEventosMeta("not-json")).toThrow(/JSON/);
  });
  it("extrai opt-out somente explícito e validado", () => {
    const mensagens = [" sair ", "PARAR", "cancelar", "Olá, tenho uma dúvida"].map((body, n) => ({ id: `wamid.${n}`, timestamp: "1790334000", from: "5562999990000", type: "text", text: { body } }));
    const eventos = lerOptOutsMeta(evento([], mensagens));
    expect(eventos).toHaveLength(3);
    expect(eventos[0].destinatario).toBe("5562999990000");
    expect(eventos[0].phoneNumberId).toBe("123456789");
    expect(JSON.stringify(eventos)).not.toContain("body");
  });
  it("não perde revogações após o centésimo item nem IDs Base64 com sinal de mais", () => {
    const mensagens = Array.from({ length: 101 }, (_, n) => ({ id: `wamid.${n}+=`, timestamp: "1790334000", from: "5562999990000", type: "text", text: { body: "SAIR" } }));
    expect(lerOptOutsMeta(evento([], mensagens))).toHaveLength(101);
    expect(lerEventosMeta(evento([{ id: "wamid.abc+=", timestamp: "1790334000", status: "read" }]))[0].provedorId).toBe("wamid.abc+=");
  });
  it("aceita confirmação após resultado incerto e não regride entrega/leitura", () => {
    expect(podeAvancarStatus("INCERTO", "ENTREGUE")).toBe(true);
    expect(podeAvancarStatus("ACEITO", "ENVIADO")).toBe(true);
    expect(podeAvancarStatus("ENTREGUE", "LIDO")).toBe(true);
    expect(podeAvancarStatus("LIDO", "ENVIADO")).toBe(false);
    expect(podeAvancarStatus("ENTREGUE", "FALHA")).toBe(false);
    expect(podeAvancarStatus("ENTREGUE", "ENTREGUE")).toBe(false);
    expect(podeAvancarStatus("__proto__", "ENTREGUE")).toBe(false);
  });
});
