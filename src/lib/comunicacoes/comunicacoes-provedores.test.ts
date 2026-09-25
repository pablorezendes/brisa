import { describe, expect, it, vi } from "vitest";
import { enviarEmailResend, enviarWhatsAppMeta, versaoApiWhatsApp, type EmailResend, type WhatsAppMeta } from "./provedores";

const email: EmailResend = { apiKey: "re_apenas_teste", remetente: "financeiro@empresa.example", destinatario: "cliente@destino.example", assunto: "Lembrete", texto: "Texto seguro", html: "<p>Texto seguro</p>", chaveIdempotencia: "cobranca/job-123" };
const whatsapp: WhatsAppMeta = { token: "meta_apenas_teste", phoneNumberId: "123456789", destinatario: "62999990000", template: "lembrete_cobranca", idioma: "pt_BR", dados: { nome: "Cliente", documento: "REC-1", vencimento: "2026-09-25", valorCentavos: 10000, empresa: "Empresa" } };
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

describe("adaptadores sem envios reais", () => {
  it("envia e-mail a destino único, domínio fixo e chave idempotente", async () => {
    const requisitar = vi.fn<typeof fetch>().mockResolvedValue(json({ id: "email-123" }));
    expect(await enviarEmailResend(email, requisitar)).toEqual({ status: "ACEITO", codigo: "ACEITO", provedorId: "email-123" });
    expect(requisitar.mock.calls[0][0]).toBe("https://api.resend.com/emails");
    const req = requisitar.mock.calls[0][1]!;
    expect(req.redirect).toBe("error");
    expect(req.headers).toMatchObject({ "Idempotency-Key": "cobranca/job-123" });
    expect(JSON.parse(req.body as string).to).toEqual([email.destinatario]);
  });
  it("valida antes da rede e não aceita injeção de destinatário", async () => {
    const requisitar = vi.fn<typeof fetch>();
    expect((await enviarEmailResend({ ...email, destinatario: "a@test.example,b@test.example" }, requisitar)).status).toBe("FALHA");
    expect((await enviarEmailResend({ ...email, assunto: "Teste\r\nBcc: outro" }, requisitar)).status).toBe("FALHA");
    expect(requisitar).not.toHaveBeenCalled();
  });
  it.each([429, 408, 500, 503])("permite repetição idempotente Resend em HTTP %s", async (status) => {
    const requisitar = vi.fn<typeof fetch>().mockResolvedValue(json({}, status));
    expect((await enviarEmailResend(email, requisitar)).status).toBe("REPETIR");
  });
  it("não repete conflito de conteúdo; concorrência permite reconsulta idempotente", async () => {
    const requisitar = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ name: "invalid_idempotent_request" }, 409)).mockResolvedValueOnce(json({ name: "concurrent_idempotent_requests" }, 409));
    expect((await enviarEmailResend(email, requisitar)).status).toBe("FALHA");
    expect((await enviarEmailResend(email, requisitar)).status).toBe("REPETIR");
  });
  it("erro terminal de e-mail continua terminal mesmo com resposta não JSON", async () => {
    expect((await enviarEmailResend(email, vi.fn<typeof fetch>().mockResolvedValue(new Response("invalid", { status: 400 })))).status).toBe("FALHA");
  });
  it("não propaga erro com token/PII e retry de e-mail preserva chave", async () => {
    const resultado = await enviarEmailResend(email, vi.fn<typeof fetch>().mockRejectedValue(new Error("token PRIVADO email cliente@destino.example")));
    expect(resultado).toEqual({ status: "REPETIR", codigo: "RESEND_REDE_OU_RESPOSTA" });
  });
  it("nunca presume entrega sem identificador", async () => {
    expect((await enviarEmailResend(email, vi.fn<typeof fetch>().mockResolvedValue(json({})))).status).toBe("INCERTO");
  });
  it("exige versão Meta explícita sem permitir URL/segmento arbitrário", () => {
    expect(versaoApiWhatsApp("v25.0")).toBe("v25.0");
    expect(() => versaoApiWhatsApp("../attacker")).toThrow();
    expect(() => versaoApiWhatsApp("")).toThrow();
  });
  it("usa somente modelo aprovado e cinco parâmetros na ordem definida", async () => {
    const requisitar = vi.fn<typeof fetch>().mockResolvedValue(json({ messages: [{ id: "wamid.123=" }] }));
    expect(await enviarWhatsAppMeta(whatsapp, requisitar, "v25.0")).toEqual({ status: "ACEITO", provedorId: "wamid.123=", codigo: "ACEITO" });
    expect(requisitar.mock.calls[0][0]).toBe("https://graph.facebook.com/v25.0/123456789/messages");
    const corpo = JSON.parse(requisitar.mock.calls[0][1]!.body as string);
    expect(corpo.type).toBe("template");
    expect(corpo.to).toBe("5562999990000");
    expect(corpo.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(["Cliente", "REC-1", "25/09/2026", expect.stringMatching(/100,00/), "Empresa"]);
    expect(corpo).not.toHaveProperty("text");
  });
  it.each([500, 502, 503, 408])("NÃO repete automaticamente WhatsApp incerto HTTP %s", async (status) => {
    expect((await enviarWhatsAppMeta(whatsapp, vi.fn<typeof fetch>().mockResolvedValue(json({}, status)), "v25.0")).status).toBe("INCERTO");
  });
  it("não repete WhatsApp em timeout, resposta inválida ou aceite sem ID", async () => {
    for (const requisitar of [vi.fn<typeof fetch>().mockRejectedValue(new Error("timeout secreto")), vi.fn<typeof fetch>().mockResolvedValue(new Response("invalid")), vi.fn<typeof fetch>().mockResolvedValue(json({}))]) {
      expect((await enviarWhatsAppMeta(whatsapp, requisitar, "v25.0")).status).toBe("INCERTO");
    }
  });
  it("trata rejeição Meta como terminal e não chama rede com ID inválido", async () => {
    expect((await enviarWhatsAppMeta(whatsapp, vi.fn<typeof fetch>().mockResolvedValue(json({}, 400)), "v25.0")).status).toBe("FALHA");
    const requisitar = vi.fn<typeof fetch>();
    expect((await enviarWhatsAppMeta({ ...whatsapp, phoneNumberId: "../../" }, requisitar, "v25.0")).status).toBe("FALHA");
    expect(requisitar).not.toHaveBeenCalled();
  });
  it("limita resposta do provedor sem armazenar conteúdo", async () => {
    const resposta = new Response("x".repeat(140_000));
    const resultado = await enviarWhatsAppMeta(whatsapp, vi.fn<typeof fetch>().mockResolvedValue(resposta), "v25.0");
    expect(resultado).toEqual({ status: "INCERTO", codigo: "META_REDE_OU_RESPOSTA" });
  });
});
