import { describe, expect, it } from "vitest";
import { montarPayloadEmissaoBoleto } from "../integracoes/sicoob/normalizacao";
import {
  ErroPoliticaCobrancaSicoob,
  assinaturaPoliticaEmissaoSicoob,
  resolverPoliticaEmissaoSicoob,
  type ConfiguracaoPoliticaCobrancaSicoob,
} from "./politica-cobranca-sicoob";

const configuracaoBase: ConfiguracaoPoliticaCobrancaSicoob = {
  aceite: "N",
  toleranciaPagamentoDias: 0,
  diasProtesto: 0,
  protestoEmDiasUteis: false,
  mensagens: "[]",
};

describe("resolverPoliticaEmissaoSicoob", () => {
  it("usa defaults conservadores quando a conta não possui configuração", () => {
    expect(resolverPoliticaEmissaoSicoob(null, "2026-09-30")).toEqual({
      aceite: false,
      politica: { codigoProtesto: 3 },
    });
  });

  it("traduz aceite, tolerância, mensagens e protesto em dias corridos", () => {
    expect(
      resolverPoliticaEmissaoSicoob(
        {
          aceite: " s ",
          toleranciaPagamentoDias: 60,
          diasProtesto: 12,
          protestoEmDiasUteis: false,
          mensagens: JSON.stringify(["  Não receber após o limite  ", "Use o Pix do boleto"]),
        },
        "2026-12-15",
      ),
    ).toEqual({
      aceite: true,
      dataLimitePagamento: "2027-02-13",
      mensagensInstrucao: ["Não receber após o limite", "Use o Pix do boleto"],
      politica: { codigoProtesto: 1, numeroDiasProtesto: 12 },
    });
  });

  it("usa o código 2 para protesto em dias úteis", () => {
    expect(
      resolverPoliticaEmissaoSicoob(
        { ...configuracaoBase, diasProtesto: 5, protestoEmDiasUteis: true },
        "2026-09-30",
      ).politica,
    ).toEqual({ codigoProtesto: 2, numeroDiasProtesto: 5 });
  });

  it("não envia número de dias quando o protesto está desativado", () => {
    expect(
      resolverPoliticaEmissaoSicoob(
        { ...configuracaoBase, protestoEmDiasUteis: true },
        "2026-09-30",
      ).politica,
    ).toEqual({ codigoProtesto: 3 });
  });

  it("soma a tolerância como data civil inclusive em ano bissexto", () => {
    expect(
      resolverPoliticaEmissaoSicoob(
        { ...configuracaoBase, toleranciaPagamentoDias: 2 },
        "2028-02-28",
      ).dataLimitePagamento,
    ).toBe("2028-03-01");
  });

  it.each([
    ["aceite desconhecido", { ...configuracaoBase, aceite: "X" }],
    ["tolerância negativa", { ...configuracaoBase, toleranciaPagamentoDias: -1 }],
    ["tolerância fracionada", { ...configuracaoBase, toleranciaPagamentoDias: 1.5 }],
    ["tolerância acima do contrato", { ...configuracaoBase, toleranciaPagamentoDias: 181 }],
    ["protesto negativo", { ...configuracaoBase, diasProtesto: -1 }],
    ["protesto acima do contrato", { ...configuracaoBase, diasProtesto: 100 }],
    ["indicador de dias úteis inválido", { ...configuracaoBase, protestoEmDiasUteis: 1 }],
  ])("rejeita %s", (_cenario, configuracao) => {
    expect(() =>
      resolverPoliticaEmissaoSicoob(configuracao, "2026-09-30"),
    ).toThrow(ErroPoliticaCobrancaSicoob);
  });

  it.each([
    ["JSON inválido", "["],
    ["valor que não é lista", "{}"],
    ["mais de cinco mensagens", JSON.stringify(["1", "2", "3", "4", "5", "6"])],
    ["mensagem não textual", JSON.stringify([1])],
    ["mensagem vazia", JSON.stringify(["   "])],
    ["mensagem longa", JSON.stringify(["x".repeat(41)])],
  ])("rejeita mensagens com %s", (_cenario, mensagens) => {
    expect(() =>
      resolverPoliticaEmissaoSicoob(
        { ...configuracaoBase, mensagens },
        "2026-09-30",
      ),
    ).toThrow(ErroPoliticaCobrancaSicoob);
  });

  it("rejeita uma data civil inexistente", () => {
    expect(() =>
      resolverPoliticaEmissaoSicoob(configuracaoBase, "2026-02-29"),
    ).toThrow("data inexistente");
  });

  it("produz assinatura estável após normalização semântica", () => {
    const primeira = resolverPoliticaEmissaoSicoob(
      { ...configuracaoBase, aceite: "S", mensagens: '["Aviso"]' },
      "2026-09-30",
    );
    const segunda = resolverPoliticaEmissaoSicoob(
      { ...configuracaoBase, aceite: " s ", mensagens: '[" Aviso "]' },
      "2026-09-30",
    );
    expect(assinaturaPoliticaEmissaoSicoob(primeira)).toBe(
      assinaturaPoliticaEmissaoSicoob(segunda),
    );
  });

  it("encaixa o snapshot validado diretamente no payload, sem efeitos externos", () => {
    const politica = resolverPoliticaEmissaoSicoob(
      {
        ...configuracaoBase,
        aceite: "S",
        toleranciaPagamentoDias: 60,
        diasProtesto: 5,
        protestoEmDiasUteis: true,
        mensagens: '["Pagar preferencialmente via Pix"]',
      },
      "2026-09-30",
    );
    const payload = montarPayloadEmissaoBoleto({
      conta: {
        numeroCliente: 20060,
        codigoModalidade: 1,
        numeroContaCorrente: 11800,
      },
      seuNumero: "BR1234567890",
      valorCentavos: 12_345,
      dataEmissao: "2026-09-15",
      dataVencimento: "2026-09-30",
      codigoEspecieDocumento: "DS",
      ...politica,
      pagador: {
        numeroCpfCnpj: "11122233300",
        nome: "Pessoa Pagadora",
        endereco: "Rua Um, 10",
        bairro: "Centro",
        cidade: "Salvador",
        cep: "40000000",
        uf: "BA",
      },
    });

    expect(payload).toMatchObject({
      aceite: true,
      dataLimitePagamento: "2026-11-29",
      mensagensInstrucao: ["Pagar preferencialmente via Pix"],
      codigoProtesto: 2,
      numeroDiasProtesto: 5,
    });
  });
});
