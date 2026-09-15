import { describe, expect, it } from "vitest";

import {
  canonicalizarEventoSicoob,
  chaveIdempotenciaEventoSicoob,
  extrairIdentificadoresEventoSicoob,
  hashCanonicoEventoSicoob,
} from "./eventos";

describe("eventos Sicoob", () => {
  it("gera a mesma chave para objetos semanticamente iguais", () => {
    const a = { z: 2, a: { y: true, x: [1, "dois"] } };
    const b = { a: { x: [1, "dois"], y: true }, z: 2 };
    expect(canonicalizarEventoSicoob(a)).toBe(canonicalizarEventoSicoob(b));
    expect(hashCanonicoEventoSicoob(a)).toBe(hashCanonicoEventoSicoob(b));
    expect(hashCanonicoEventoSicoob({ itens: [1, 2] })).not.toBe(
      hashCanonicoEventoSicoob({ itens: [2, 1] }),
    );
  });

  it("rejeita estruturas circulares", () => {
    const circular: Record<string, unknown> = {};
    circular.proprio = circular;
    expect(() => canonicalizarEventoSicoob(circular)).toThrow(/circular/);
  });

  it("extrai somente identificadores permitidos, aninhados e sem PII", () => {
    expect(
      extrairIdentificadoresEventoSicoob({
        idWebhook: 44,
        dados: [
          { nossoNumero: 123, seu_numero: "REC-9", nome: "Não retornar" },
          {
            numeroTitulo: "456",
            codigoBarras: "75690000000000000000000000000000000000000000",
            codigoSolicitacao: "evt-1",
            numeroIdentificadorBaixa: "baixa-9",
            cpf: "11122233300",
          },
          { nossoNumero: 123 },
        ],
      }),
    ).toEqual({
      nossosNumeros: ["123", "456"],
      seusNumeros: ["REC-9"],
      codigosBarras: ["75690000000000000000000000000000000000000000"],
      numerosCliente: [],
      numerosIdentificadorBaixa: ["baixa-9"],
      idsWebhook: ["44"],
      idsEvento: ["evt-1"],
    });
  });

  it("prioriza numeroIdentificadorBaixa na idempotência", () => {
    expect(
      chaveIdempotenciaEventoSicoob({
        numeroIdentificadorBaixa: "BX-42",
        nossoNumero: 1,
      }),
    ).toBe("sicoob:baixa:BX-42:informada");
    expect(
      chaveIdempotenciaEventoSicoob({
        numeroIdentificadorBaixa: "BX-42",
        cancelamentoBaixa: true,
      }),
    ).toBe("sicoob:baixa:BX-42:cancelada");
    expect(chaveIdempotenciaEventoSicoob({ nossoNumero: 1 })).toMatch(
      /^sicoob:sha256:[a-f0-9]{64}$/,
    );
  });
});
