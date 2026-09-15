import { describe, expect, it } from "vitest";

import {
  centavosParaValorApi,
  montarPayloadEmissaoBoleto,
  normalizarBoletoSicoob,
  normalizarSituacaoBoleto,
  normalizarSituacaoWebhook,
  reaisParaCentavos,
} from "./normalizacao";

describe("reaisParaCentavos", () => {
  it("aceita valores JSON e formatos monetários conhecidos sem float no resultado", () => {
    expect(reaisParaCentavos(137_433.76)).toBe(13_743_376);
    expect(reaisParaCentavos("R$ 137.433,76")).toBe(13_743_376);
    expect(reaisParaCentavos("137433.76")).toBe(13_743_376);
    expect(reaisParaCentavos("0,01")).toBe(1);
    expect(reaisParaCentavos("(10,50)")).toBe(-1_050);
  });

  it("rejeita ambiguidade, precisão indevida e overflow", () => {
    expect(reaisParaCentavos("1,234.56")).toBeNull();
    expect(reaisParaCentavos("10.999")).toBeNull();
    expect(reaisParaCentavos("999999999999999999999,00")).toBeNull();
    expect(reaisParaCentavos(Number.NaN)).toBeNull();
  });

  it("converte centavos para o número usado no JSON da API", () => {
    expect(centavosParaValorApi(15_623)).toBe(156.23);
    expect(() => centavosParaValorApi(1.2)).toThrow(/inteiros/);
  });
});

describe("situações Sicoob", () => {
  it("normaliza códigos e descrições de boleto", () => {
    expect(normalizarSituacaoBoleto(1)).toBe("REGISTRADO");
    expect(normalizarSituacaoBoleto("2")).toBe("BAIXADO");
    expect(normalizarSituacaoBoleto("Liquidado")).toBe("LIQUIDADO");
    expect(normalizarSituacaoBoleto("vencido")).toBe("VENCIDO");
    expect(normalizarSituacaoBoleto("algo novo")).toBe("DESCONHECIDO");
  });

  it("normaliza situações do webhook sem presumir desconhecidas", () => {
    expect(normalizarSituacaoWebhook(1)).toBe("AGUARDANDO_VALIDACAO");
    expect(normalizarSituacaoWebhook("Validado com sucesso")).toBe("VALIDADO");
    expect(normalizarSituacaoWebhook(3)).toBe("INATIVO");
    expect(normalizarSituacaoWebhook(99)).toBe("DESCONHECIDO");
  });
});

describe("normalizarBoletoSicoob", () => {
  it("reduz a resposta envelopada a um DTO seguro", () => {
    expect(
      normalizarBoletoSicoob({
        resultado: {
          nossoNumero: 123456,
          seuNumero: "REC-42",
          numeroCliente: 4567,
          numeroContaCorrente: 1180,
          codigoModalidade: 1,
          situacaoBoleto: "Liquidado",
          valor: 156.23,
          valorPago: "156,23",
          dataVencimento: "2026-09-25",
          dataPagamento: "2026-09-24T10:20:30-03:00",
          linhaDigitavel: "123",
          codigoBarras: "456",
          qrCode: "pix-payload",
          segredoInesperado: "não deve atravessar a fronteira",
        },
      }),
    ).toEqual({
      nossoNumero: "123456",
      seuNumero: "REC-42",
      numeroCliente: 4567,
      numeroContaCorrente: 1180,
      codigoModalidade: 1,
      numeroContratoCobranca: null,
      status: "LIQUIDADO",
      situacaoOriginal: "Liquidado",
      valorOriginalCentavos: 15_623,
      valorPagoCentavos: 15_623,
      dataEmissao: null,
      dataVencimento: "2026-09-25",
      dataLiquidacao: "2026-09-24",
      codigoBarras: "456",
      linhaDigitavel: "123",
      qrCode: "pix-payload",
      pdfBase64: null,
    });
  });
});

describe("montarPayloadEmissaoBoleto", () => {
  const entrada = {
    conta: {
      numeroCliente: 25546454,
      codigoModalidade: 1,
      numeroContaCorrente: 1180,
    },
    seuNumero: "REC-42",
    valorCentavos: 15_623,
    codigoEspecieDocumento: "RC",
    dataEmissao: "2026-09-15",
    dataVencimento: "2026-09-25",
    pagador: {
      numeroCpfCnpj: "111.222.333-00",
      nome: "Pessoa Pagadora",
      endereco: "Rua Um, 10",
      bairro: "Centro",
      cidade: "Brasília",
      cep: "70000-000",
      uf: "df",
    },
  } as const;

  it("aplica defaults conservadores e converte dinheiro", () => {
    expect(montarPayloadEmissaoBoleto(entrada)).toMatchObject({
      numeroCliente: 25546454,
      codigoModalidade: 1,
      numeroContaCorrente: 1180,
      codigoEspecieDocumento: "RC",
      identificacaoEmissaoBoleto: 1,
      identificacaoDistribuicaoBoleto: 1,
      seuNumero: "REC-42",
      valor: 156.23,
      tipoDesconto: 0,
      tipoMulta: 0,
      tipoJurosMora: 3,
      codigoProtesto: 3,
      codigoNegativacao: 3,
      pagador: {
        numeroCpfCnpj: "11122233300",
        cep: "70000000",
        uf: "DF",
      },
    });
  });

  it("bloqueia pagador incompleto e datas impossíveis antes da rede", () => {
    expect(() =>
      montarPayloadEmissaoBoleto({
        ...entrada,
        dataVencimento: "2026-02-30",
      }),
    ).toThrow(/inexistente/);
    expect(() =>
      montarPayloadEmissaoBoleto({
        ...entrada,
        pagador: { ...entrada.pagador, numeroCpfCnpj: "123" },
      }),
    ).toThrow(/CPF ou CNPJ/);
  });
});
