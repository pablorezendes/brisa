import { describe, expect, it } from "vitest";
import {
  CONFIG_COBRANCA_PADRAO, dataLocalCobranca, dentroJanelaEnvio, diasDesdeVencimento,
  normalizarEmail, normalizarTelefoneBR, renderizarEmail, renderizarMensagem,
  validarConfigCobranca, validarDataCobranca, validarTemplateWhatsApp,
} from "./dominio";

const dados = { nome: "Cliente exemplo", documento: "REC-123", vencimento: "2026-09-25", valorCentavos: 12345, empresa: "Brisa" };

describe("configuração e mensagens de cobrança", () => {
  it("nasce sem autorização para disparos", () => {
    expect(validarConfigCobranca({})).toEqual(CONFIG_COBRANCA_PADRAO);
    expect(CONFIG_COBRANCA_PADRAO.emailAtivo).toBe(false);
    expect(CONFIG_COBRANCA_PADRAO.whatsappAtivo).toBe(false);
    expect(CONFIG_COBRANCA_PADRAO.automacaoAtiva).toBe(false);
  });
  it("normaliza etapas e ignora campos não permitidos", () => {
    const config = validarConfigCobranca({ diasRelativos: [3, 0, -3, 3], senha: "nunca propagar" });
    expect(config.diasRelativos).toEqual([-3, 0, 3]);
    expect(config).not.toHaveProperty("senha");
  });
  it.each([
    { limiteDiario: 501 }, { limiteDiario: 1.5 }, { horaInicio: 7 }, { horaFim: 21 },
    { horaInicio: 18, horaFim: 18 }, { emailAtivo: "false" }, { diasRelativos: [] },
    { diasRelativos: [91] }, { diasRelativos: ["3"] }, { automacaoAtiva: true },
    { emailAtivo: true }, { whatsappAtivo: true }, { emailAssunto: "Título\nBcc: terceiro" },
    { whatsappIdioma: "en_US" },
  ])("rejeita configuração inválida %#", (config) => {
    expect(() => validarConfigCobranca(config)).toThrow();
  });
  it("exige declaração de modelo aprovado para ativar WhatsApp", () => {
    const config = { whatsappAtivo: true, whatsappNumero: "62999990000", whatsappPhoneNumberId: "123456789", whatsappTemplate: "cobranca_utilidade" };
    expect(() => validarConfigCobranca(config)).toThrow(/aprovados/);
    expect(validarConfigCobranca({ ...config, whatsappTemplateAprovado: true }).whatsappNumero).toBe("5562999990000");
  });
  it("converte telefone nacional e internacional sem adivinhar DDD", () => {
    expect(normalizarTelefoneBR("(62) 99999-0000")).toBe("5562999990000");
    expect(normalizarTelefoneBR("+55 62 3333-0000")).toBe("556233330000");
    expect(normalizarTelefoneBR("5562999990000")).toBe("5562999990000");
  });
  it.each(["999990000", "+1 202 555 0000", "62 99999-0000 ramal 1", "0062999990000", "62 99999-0000;62 99999-0001", "20 99999-0000", "62 89999-0000", "+62 99999-0000"])("rejeita telefone ambíguo %s", (v) => expect(() => normalizarTelefoneBR(v)).toThrow());
  it("normaliza um único e-mail", () => expect(normalizarEmail(" CobranCA@EXEMPLO.com.br ")).toBe("cobranca@exemplo.com.br"));
  it.each(["a@example.com,b@example.com", "a@example.com\r\nBcc: b@example.com", "Nome <a@example.com>", "a..b@example.com", ".a@example.com", "a@localhost", "a@-example.com"])("rejeita e-mail inválido %s", (v) => expect(() => normalizarEmail(v)).toThrow());
  it.each(["2026-02-30", "2026-9-25", "2026-13-01", "2026-09-25T10:00:00Z", "1899-01-01"])("rejeita datas inválidas %s", (v) => expect(() => validarDataCobranca(v)).toThrow());
  it("renderiza saldo exato em centavos e data brasileira", () => {
    expect(renderizarMensagem("{nome}: {documento}, {vencimento}, {valor}, {empresa}", dados).replace(/\u00a0/g, " ")).toBe("Cliente exemplo: REC-123, 25/09/2026, R$ 123,45, Brisa");
  });
  it("não aceita campos de comissão ou expressão de template", () => {
    expect(() => renderizarMensagem("{comissao}", dados)).toThrow(/Use apenas/);
    expect(() => renderizarMensagem("{{constructor}}", dados)).toThrow();
  });
  it("não reinterpreta placeholders presentes em dados e escapa HTML inteiro", () => {
    const mensagem = renderizarEmail("Olá {nome}", "{nome}\n{documento}", { ...dados, nome: "<img src=x onerror=alert(1)> {valor}", documento: "<script>alert('x')</script>" });
    expect(mensagem.texto).toContain("{valor}");
    expect(mensagem.html).not.toContain("<img");
    expect(mensagem.html).not.toContain("<script");
    expect(mensagem.html).toContain("&lt;script&gt;");
  });
  it("rejeita saldo zero, negativo ou fracionário", () => {
    for (const valorCentavos of [0, -1, 1.1, NaN]) expect(() => renderizarMensagem("{valor}", { ...dados, valorCentavos })).toThrow();
  });
  it("preserva ordem posicional exata do modelo Meta", () => {
    expect(validarTemplateWhatsApp(CONFIG_COBRANCA_PADRAO.whatsappCorpo)).toBe(CONFIG_COBRANCA_PADRAO.whatsappCorpo);
    expect(() => validarTemplateWhatsApp("{empresa} {nome} {documento} {vencimento} {valor}")).toThrow(/ordem/);
    expect(() => validarTemplateWhatsApp("{nome} {documento} {vencimento} {valor} {empresa} {nome}")).toThrow();
  });
  it("usa calendário de São Paulo e não o dia UTC", () => {
    const agora = new Date("2026-09-26T01:00:00Z");
    expect(dataLocalCobranca(agora)).toBe("2026-09-25");
    expect(diasDesdeVencimento("2026-09-25", agora)).toBe(0);
    expect(diasDesdeVencimento("2026-09-28", agora)).toBe(-3);
  });
  it("limita horários e fins de semana no fuso definido", () => {
    expect(dentroJanelaEnvio(CONFIG_COBRANCA_PADRAO, new Date("2026-09-25T12:00:00Z"))).toBe(true);
    expect(dentroJanelaEnvio(CONFIG_COBRANCA_PADRAO, new Date("2026-09-25T21:00:00Z"))).toBe(false);
    expect(dentroJanelaEnvio(CONFIG_COBRANCA_PADRAO, new Date("2026-09-26T12:00:00Z"))).toBe(false);
  });
});
