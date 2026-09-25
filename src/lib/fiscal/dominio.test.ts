import { describe, expect, it } from "vitest";
import { ambienteFiscal, chaveFiscal, documentoFiscal, hashConfiguracaoFiscal, lerParametrosFiscais, montarPayloadFiscal, validarParametrosFiscais, valorFiscal, type ConfigFiscalBase, type ParametrosFiscais, type RascunhoFiscal } from "./dominio";

export const parametrosTeste: ParametrosFiscais = {
  codigoTributacaoNacional: "010701", codigoTributacaoMunicipal: "001", codigoNbs: "115022000", opcaoSimples: "1", regimeApuracao: "", regimeEspecial: "0",
  codigoIndicadorOperacao: "100301", cstIbsCbs: "000", classificacaoIbsCbs: "000001", tributosModo: "NAO_INFORMAR", tributosFederal: "", tributosEstadual: "", tributosMunicipal: "", tributosSimples: "", serieDps: "1", proximoDps: "12",
};
export const configTeste: ConfigFiscalBase = { ambiente: "HOMOLOGACAO", emitenteCnpj: "11222333000181", inscricaoMunicipal: "123", razaoSocial: "EMITENTE FICTÍCIO", codigoMunicipio: "5208707", parametros: JSON.stringify(parametrosTeste) };
export const rascunhoTeste: RascunhoFiscal = { origemChave: "SERVICO-TESTE-001", competencia: "2026-09-10", tomadorNome: "TOMADOR FICTÍCIO", tomadorDocumento: "52998224725", valorServico: "125,31", descricao: "Serviço fictício utilizado somente em testes automatizados.", municipioTomador: "5208707", cepTomador: "74000000", logradouroTomador: "Rua de teste", numeroTomador: "10", bairroTomador: "Centro", complementoTomador: "", consumidorFinal: "0" };

describe("domínio fiscal Goiânia", () => {
  it("converte valores exatos em centavos sem arredondar silenciosamente", () => {
    expect(valorFiscal("125,31")).toBe(12531); expect(valorFiscal("0.01")).toBe(1); expect(valorFiscal("2")).toBe(200);
  });
  it.each(["1.000,00", "1e3", "1,001", "0", "-1", "21474836.48", "NaN"])("rejeita valor ambíguo/inválido %s", (v) => expect(() => valorFiscal(v)).toThrow());
  it("valida CPF/CNPJ e não aceita documentos repetidos", () => {
    expect(documentoFiscal("11.222.333/0001-81", true)).toBe("11222333000181");
    expect(documentoFiscal("529.982.247-25")).toBe("52998224725");
    expect(() => documentoFiscal("52998224724")).toThrow(); expect(() => documentoFiscal("11111111111")).toThrow();
    expect(() => documentoFiscal("52998224725", true)).toThrow(); expect(() => documentoFiscal("AA222333000181", true)).toThrow();
  });
  it("não inventa configuração para campos ausentes", () => {
    expect(lerParametrosFiscais("{}").codigoTributacaoNacional).toBe(""); expect(() => validarParametrosFiscais(lerParametrosFiscais("{}"))).toThrow();
  });
  it("gera payload nacional municipal com DPS e valor exclusivamente informado", () => {
    const payload = montarPayloadFiscal(configTeste, rascunhoTeste, new Date("2026-09-25T12:00:00Z"));
    expect(payload.valor_servico).toBe(125.31); expect(payload.cpf_tomador).toBe("52998224725"); expect(payload.numero_dps).toBe(12);
    expect(payload.codigo_municipio_emissora).toBe(5208707); expect(payload.tipo_retencao_iss).toBe(1); expect(payload).not.toHaveProperty("cnpj_tomador"); expect(payload).not.toHaveProperty("email_tomador");
  });
  it("rejeita data inexistente, futura e outro município emissor", () => {
    expect(() => montarPayloadFiscal(configTeste, { ...rascunhoTeste, competencia: "2026-02-31" })).toThrow();
    expect(() => montarPayloadFiscal(configTeste, { ...rascunhoTeste, competencia: "2099-01-01" })).toThrow();
    expect(() => montarPayloadFiscal({ ...configTeste, codigoMunicipio: "3550308" }, rascunhoTeste)).toThrow();
  });
  it("segrega ambiente e normaliza a identidade da mesma prestação", () => {
    expect(chaveFiscal(configTeste,"  prestação  01 ")).toBe(chaveFiscal(configTeste,"PRESTAÇÃO 01"));
    expect(chaveFiscal(configTeste,"PRESTACAO 1")).not.toBe(chaveFiscal({ ...configTeste, ambiente:"PRODUCAO" },"PRESTACAO 1"));
  });
  it("reserva de outro DPS não muda hash, mas trocar enquadramento muda", () => {
    expect(hashConfiguracaoFiscal(configTeste)).toBe(hashConfiguracaoFiscal({ ...configTeste, parametros: JSON.stringify({ ...parametrosTeste, proximoDps: "999" }) }));
    expect(hashConfiguracaoFiscal(configTeste)).not.toBe(hashConfiguracaoFiscal({ ...configTeste, parametros: JSON.stringify({ ...parametrosTeste, codigoNbs: "115023000" }) }));
  });
  it("não permite MEI/regime especial neste adaptador nem DPS sem faixa", () => {
    expect(() => validarParametrosFiscais({ ...parametrosTeste, opcaoSimples:"2" })).toThrow();
    expect(() => validarParametrosFiscais({ ...parametrosTeste, regimeEspecial:"9" })).toThrow();
    expect(() => validarParametrosFiscais({ ...parametrosTeste, serieDps:"50000" })).toThrow();
  });
  it("Simples exige regime de apuração explícito e percentual válido", () => {
    expect(() => validarParametrosFiscais({ ...parametrosTeste, opcaoSimples:"3" })).toThrow();
    expect(validarParametrosFiscais({ ...parametrosTeste, opcaoSimples:"3", regimeApuracao:"1", tributosModo:"SIMPLES", tributosSimples:"6,5" }).percentual_total_tributos_simples_nacional).toBe(6.5);
    expect(() => validarParametrosFiscais({ ...parametrosTeste, tributosModo:"SIMPLES", tributosSimples:"6" })).toThrow();
  });
  it("ambiente desconhecido nunca aponta para produção por fallback", () => expect(() => ambienteFiscal("PROD")).toThrow());
});
