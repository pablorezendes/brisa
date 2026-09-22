import { describe, expect, it } from "vitest";

import { interpretarResumoLoteOperacao } from "./auditoria-widesys";

describe("interpretarResumoLoteOperacao", () => {
  it("retorna estrutura vazia para JSON ausente ou inválido", () => {
    expect(interpretarResumoLoteOperacao(null)).toEqual({
      processados: 0,
      escoposCobertos: [],
      reconciliacao: {},
    });
    expect(interpretarResumoLoteOperacao("{invalido")).toEqual({
      processados: 0,
      escoposCobertos: [],
      reconciliacao: {},
    });
  });

  it("permite somente escopos e números conhecidos", () => {
    const resumo = interpretarResumoLoteOperacao(JSON.stringify({
      processados: 12,
      escoposCobertos: ["TITULO_RECEBER", "DESCONHECIDO"],
      reconciliacao: {
        TITULO_RECEBER: {
          quantidade: 7,
          quarentena: 1,
          somaFonte: 123_45,
          somaAceita: 100_00,
          somaQuarentena: 23_45,
          somaValorOriginal: 120_00,
          somaValorDevido: 123_45,
          somaValorAberto: 80_00,
          somaValorPago: 43_45,
          somaMovimentos: 0,
          somaBaixas: 43_45,
          campoPrivado: "não deve atravessar",
        },
        DESCONHECIDO: { quantidade: 999 },
      },
      segredo: "ignorado",
    }));

    expect(resumo.processados).toBe(12);
    expect(resumo.escoposCobertos).toEqual(["TITULO_RECEBER"]);
    expect(resumo.reconciliacao).toEqual({
      TITULO_RECEBER: {
        quantidade: 7,
        quarentena: 1,
        somaFonte: 123_45,
        somaAceita: 100_00,
        somaQuarentena: 23_45,
        somaValorOriginal: 120_00,
        somaValorDevido: 123_45,
        somaValorAberto: 80_00,
        somaValorPago: 43_45,
        somaMovimentos: 0,
        somaBaixas: 43_45,
      },
    });
  });

  it("neutraliza valores não inteiros ou fora do domínio", () => {
    const resumo = interpretarResumoLoteOperacao(JSON.stringify({
      processados: -1,
      escoposCobertos: ["MOVIMENTO"],
      reconciliacao: {
        MOVIMENTO: {
          quantidade: -4,
          quarentena: 1.5,
          somaFonte: "100",
          somaAceita: Number.MAX_SAFE_INTEGER + 1,
          somaQuarentena: 0,
          somaValorOriginal: 0,
          somaValorDevido: 0,
          somaValorAberto: 0,
          somaValorPago: 0,
          somaMovimentos: -500,
          somaBaixas: 0,
        },
      },
    }));

    expect(resumo.processados).toBe(0);
    expect(resumo.reconciliacao.MOVIMENTO).toMatchObject({
      quantidade: 0,
      quarentena: 0,
      somaFonte: 0,
      somaAceita: 0,
      somaMovimentos: -500,
    });
  });
});
