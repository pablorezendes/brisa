import { describe, expect, it } from "vitest";
import { contextoFinanceiro, retornoFinanceiroComMensagem, validarRetornoFinanceiro } from "./contexto-financeiro";

const BASE = "/financeiro/contas-a-pagar";
const REGISTRO = "WIDESYS:PAGAR:550e8400-e29b-41d4-a716-446655440000";
const DESTINO = "BRISA:PAGAR:recebimento_1";
function parametros(href: string) { return new URLSearchParams(href.split("?")[1] ?? ""); }

describe("contexto financeiro da lista", () => {
  it.each([BASE, "/financeiro/contas-a-receber", "/recebimentos"])("abre detalhe e exclusão na mesma base %s", base => {
    const contexto = contextoFinanceiro(base, { mes: "2026-06", pagina: "3" })!;
    expect(contexto.retorno).toBe(`${base}?mes=2026-06&pagina=3`);
    for (const [link, painel] of [[contexto.hrefDetalhe(REGISTRO), "detalhe"], [contexto.hrefExcluir(REGISTRO), "excluir"]]) {
      expect(link.startsWith(`${base}?`)).toBe(true);
      expect(parametros(link).get("registro")).toBe(REGISTRO);
      expect(parametros(link).get("painel")).toBe(painel);
      expect(parametros(link).get("pagina")).toBe("3");
    }
  });

  it("preserva filtros, não propaga popup anterior, mensagens ou parâmetros de outros formulários", () => {
    const contexto = contextoFinanceiro(BASE, {
      q: "João & filhos", origem: "PLANILHA", estado: "PENDENTE", mes: "2026-06", de: "2026-01-01", ate: "2026-06-30", pagina: "2", vencidos: "1",
      registro: "BRISA:RECEBER:antigo", painel: "excluir", destino: DESTINO, buscarDestino: "velho", erro: "anterior", ok: "anterior", papel: "ADMINISTRADOR", token: "segredo", dominio: "PESSOA",
    })!;
    expect(Object.fromEntries(parametros(contexto.retorno))).toEqual({
      q: "João & filhos", origem: "PLANILHA", estado: "PENDENTE", mes: "2026-06", de: "2026-01-01", ate: "2026-06-30", pagina: "2", vencidos: "1",
    });
    expect(Object.fromEntries(parametros(contexto.hrefDetalhe(REGISTRO, { destino: DESTINO, buscarDestino: "Conta & João" })))).toMatchObject({ registro: REGISTRO, painel: "detalhe", destino: DESTINO, buscarDestino: "Conta & João" });
    expect(parametros(contexto.hrefExcluir(REGISTRO)).has("destino")).toBe(false);
  });

  it("filtra valores inválidos, arrays ambíguos e excesso de tamanho", () => {
    expect(contextoFinanceiro(BASE, { q: "x".repeat(121), origem: "ADMINISTRADOR", estado: "DESCONHECIDO", mes: "2026-13", de: "ontem", ate: "2026-01-32", pagina: "-1", vencidos: "true" })?.retorno).toBe(BASE);
    expect(contextoFinanceiro(BASE, { q: ["a", "b"], origem: ["BRISA"], estado: ["ATIVO"], mes: ["2026-01"], pagina: "0" })?.retorno).toBe(BASE);
    expect(contextoFinanceiro(BASE, { pagina: "99999999", q: "a\nb" })?.retorno).toBe(BASE);
  });

  it.each(["/caixa", "/unificacao", "/recebimentos/", "//malicioso.test", "https://malicioso.test/financeiro/contas-a-pagar", `${BASE}?mes=2026-01`])("recusa base não permitida %s", base => {
    expect(contextoFinanceiro(base, {})).toBeNull();
  });

  it("não converte a visão nativa de locação em popup unificado", () => {
    expect(contextoFinanceiro("/recebimentos", { visao: "locacao" })).toBeNull();
    expect(contextoFinanceiro("/recebimentos", { visao: ["unificada", "locacao"] })).toBeNull();
    expect(contextoFinanceiro("/recebimentos", { visao: "unificada" })?.retorno).toBe("/recebimentos");
  });

  it.each(["BRISA:PESSOA:1", "WIDESYS:BAIXA_PAGAR:1", "EXCEL:PAGAR:1", "WIDESYS:PAGAR:", "WIDESYS:PAGAR:id/123", "WIDESYS:PAGAR:id:123", "WIDESYS:PAGAR:id?painel=excluir", `WIDESYS:PAGAR:${"x".repeat(161)}`])("chave inválida volta à lista sem inventar outro alvo: %s", chave => {
    const contexto = contextoFinanceiro(BASE, { pagina: "2" })!;
    expect(contexto.hrefDetalhe(chave)).toBe(contexto.retorno);
    expect(contexto.hrefExcluir(chave)).toBe(contexto.retorno);
  });
});

describe("retorno seguro de ações financeiras", () => {
  it("aceita só navegação local e mantém os filtros e o popup", () => {
    const original = contextoFinanceiro(BASE, { q: "Água & luz", origem: "WIDESYS", pagina: "4" })!.hrefDetalhe(REGISTRO, { destino: DESTINO, buscarDestino: "Água" });
    expect(validarRetornoFinanceiro(original)).toBe(original);
    expect(validarRetornoFinanceiro(`${original}&auth=ADMINISTRADOR&dominio=PESSOA`)).toBe(original);
  });

  it.each([
    null, undefined, 123, {}, [BASE], "", "/", "https://example.test", `https://example.test${BASE}`, `//example.test${BASE}`, `///example.test${BASE}`, `\\example.test${BASE}`,
    `${BASE}/`, `${BASE}/../contas-a-receber`, `/financeiro/%63ontas-a-pagar`, `${BASE}#outra`, `${BASE}\n`, `${BASE}?q=%0a`, `${BASE}?q=%0d`, `${BASE}?q=%00`, `${BASE}?q=%7f`, `${BASE}?q=%5c`, `${BASE}?q=%2f%2fexample.test`, `${BASE}?q=%`, `${BASE}?q=%C3`, `${BASE}?q=${"x".repeat(4096)}`,
    "/recebimentos?visao=locacao", "/recebimentos?visao=unificada&visao=locacao", `${BASE}?pagina=1&pagina=2`, `${BASE}?q=1&%71=2`,
  ])("recusa destino inválido sem resolver host: %s", valor => {
    expect(validarRetornoFinanceiro(valor)).toBeNull();
    expect(retornoFinanceiroComMensagem(valor, { ok: "feito" })).toBeNull();
  });

  it.each([
    `registro=${encodeURIComponent(REGISTRO)}`, "painel=detalhe", `registro=${encodeURIComponent(REGISTRO)}&painel=arbitrario`, "registro=BRISA%3APESSOA%3A1&painel=detalhe", `registro=${encodeURIComponent(REGISTRO)}&painel=detalhe&destino=WIDESYS%3APESSOA%3A2`,
  ])("recusa popup parcial ou alvo fora do domínio financeiro: %s", query => {
    expect(validarRetornoFinanceiro(`${BASE}?${query}`)).toBeNull();
  });

  it("elimina destino e busca fora do painel de revisão", () => {
    const original = contextoFinanceiro(BASE, {})!.hrefExcluir(REGISTRO);
    expect(validarRetornoFinanceiro(`${original}&destino=${encodeURIComponent(DESTINO)}&buscarDestino=texto`)).toBe(original);
    expect(validarRetornoFinanceiro(`${BASE}?destino=${encodeURIComponent(DESTINO)}&buscarDestino=texto`)).toBe(BASE);
  });

  it("substitui avisos anteriores e mantém exatamente o registro que estava sendo resolvido", () => {
    const original = contextoFinanceiro(BASE, { origem: "PLANILHA", estado: "PENDENTE", pagina: "3" })!.hrefDetalhe(REGISTRO, { destino: DESTINO, buscarDestino: "água" });
    const retorno = retornoFinanceiroComMensagem(`${original}&erro=antigo&ok=antigo`, { ok: "resolvido" })!;
    expect(retorno).toBe(`${original}&ok=resolvido`);
    const erro = retornoFinanceiroComMensagem(retorno, { erro: "O registro mudou. Confira novamente.", ok: "ignorado" })!;
    expect(parametros(erro).get("erro")).toBe("O registro mudou. Confira novamente.");
    expect(parametros(erro).has("ok")).toBe(false);
    expect(parametros(erro).get("registro")).toBe(REGISTRO);
    expect(parametros(erro).get("destino")).toBe(DESTINO);
    expect(parametros(erro).get("pagina")).toBe("3");
  });

  it("não coloca avisos excessivos ou caracteres de controle na URL", () => {
    expect(retornoFinanceiroComMensagem(`${BASE}?ok=velho`, { ok: "x".repeat(501) })).toBe(BASE);
    expect(retornoFinanceiroComMensagem(BASE, { erro: "falha\nLocal" })).toBe(BASE);
  });

  it("não interpreta origem como permissão nem parâmetros desconhecidos como instruções", () => {
    expect(validarRetornoFinanceiro(`${BASE}?origem=ADMINISTRADOR&__proto__=qualquer&constructor=outro&retorno=https%3A%2F%2Fexample.test`)).toBeNull();
    expect(validarRetornoFinanceiro(`${BASE}?origem=ADMINISTRADOR&__proto__=qualquer&constructor=outro&perfil=ADMINISTRADOR`)).toBe(BASE);
    expect({}.toString).toBe(Object.prototype.toString);
  });
});
