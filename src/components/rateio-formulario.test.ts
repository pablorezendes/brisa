import { describe, expect, it } from "vitest";
import { centavosRateio, conferirValoresRateio, valorEditavel } from "./rateio-formulario";

describe("valores manuais do rateio", () => {
  it.each([["2.560,00", 256000], ["2560", 256000], ["2.560", 256000], ["2560.00", 256000], ["R$ 430,00", 43000], ["0,01", 1], ["10,5", 1050], ["0", 0]])("converte %s em centavos sem arredondar", (entrada, esperado) => {
    expect(centavosRateio(String(entrada))).toBe(esperado);
  });
  it.each(["", " ", "-10", "1,234", "1.2345", "1,2,3", "abc", "1e5", "Infinity", "999999999999999999999999"])('rejeita "%s"', entrada => {
    expect(centavosRateio(entrada)).toBeNull();
  });
  it("fecha somente a soma exata, sem dividir valores automaticamente", () => {
    const valores = ["430,00", "950,00", "250,00", "930,00"].map(valor => ({ valor }));
    expect(conferirValoresRateio("2560,00", valores)).toEqual({ total: 256000, distribuido: 256000, restante: 0, completo: true });
    expect(valores[3].valor).toBe("930,00");
    expect(conferirValoresRateio("2560,00", valores.slice(0, 3))).toEqual({ total: 256000, distribuido: 163000, restante: 93000, completo: false });
  });
  it("não trata vazio, zero, centavo excedente ou total inválido como conferido", () => {
    expect(conferirValoresRateio("1,00", [{ valor: "1,01" }])).toMatchObject({ restante: -1, completo: false });
    expect(conferirValoresRateio("1,00", [{ valor: "1" }, { valor: "" }]).completo).toBe(false);
    expect(conferirValoresRateio("0", [{ valor: "0" }]).completo).toBe(false);
    expect(conferirValoresRateio("abc", []).completo).toBe(false);
    expect(conferirValoresRateio("1", []).completo).toBe(false);
  });
  it("conserva os centavos ao editar", () => {
    expect(valorEditavel(101)).toBe("1,01");
    expect(centavosRateio(valorEditavel(2147483647))).toBe(2147483647);
  });
});
