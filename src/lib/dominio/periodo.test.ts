import { describe, expect, it } from "vitest";
import {
  dataValida,
  mesesEntre,
  numerosDeMes,
  parsePeriodo,
  presetsPeriodo,
  rotulosCompetencias,
} from "./periodo";

describe("dataValida", () => {
  it("aceita datas reais", () => {
    expect(dataValida("2026-06-15")).toBe(true);
    expect(dataValida("2024-02-29")).toBe(true); // bissexto
  });
  it("rejeita formato e datas impossíveis", () => {
    expect(dataValida("2026-6-1")).toBe(false);
    expect(dataValida("2026-02-30")).toBe(false);
    expect(dataValida("2026-13-01")).toBe(false);
    expect(dataValida("")).toBe(false);
    expect(dataValida(undefined)).toBe(false);
  });
});

describe("mesesEntre", () => {
  it("mesmo mês → um item", () => {
    expect(mesesEntre("2026-06", "2026-06")).toEqual(["2026-06"]);
  });
  it("atravessa a virada do ano", () => {
    expect(mesesEntre("2025-11", "2026-02")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });
});

describe("parsePeriodo", () => {
  it("nenhuma data → null (página segue no modo mês)", () => {
    expect(parsePeriodo(undefined, undefined)).toBeNull();
    expect(parsePeriodo("lixo", "2026-99-99")).toBeNull();
  });
  it("datas parciais dentro dos meses cobrem os meses inteiros", () => {
    const p = parsePeriodo("2026-03-15", "2026-05-10")!;
    expect(p.meses).toEqual(["2026-03", "2026-04", "2026-05"]);
    expect(p.rotulo).toBe("15/03/2026 a 10/05/2026 · 3 meses");
  });
  it("só uma data válida → período de um mês", () => {
    const p = parsePeriodo("2026-06-05", undefined)!;
    expect(p.de).toBe("2026-06-05");
    expect(p.ate).toBe("2026-06-05");
    expect(p.meses).toEqual(["2026-06"]);
  });
  it("de > ate → troca", () => {
    const p = parsePeriodo("2026-07-31", "2026-06-01")!;
    expect(p.de).toBe("2026-06-01");
    expect(p.ate).toBe("2026-07-31");
  });
  it("período gigante é cortado no teto", () => {
    const p = parsePeriodo("2000-01-01", "2099-12-31")!;
    expect(p.meses.length).toBe(60);
    expect(p.ate).toBe("2004-12-31");
  });
});

describe("rotulosCompetencias", () => {
  it("um ano só → sem sufixo", () => {
    expect(rotulosCompetencias(["2026-01", "2026-02"])).toEqual(["JAN", "FEV"]);
  });
  it("virada de ano → sufixo /AA", () => {
    expect(rotulosCompetencias(["2025-12", "2026-01"])).toEqual([
      "DEZ/25",
      "JAN/26",
    ]);
  });
});

describe("numerosDeMes", () => {
  it("distintos, mesmo repetindo em anos diferentes", () => {
    expect(numerosDeMes(["2025-12", "2026-01", "2026-12"])).toEqual([12, 1]);
  });
});

describe("presetsPeriodo", () => {
  it("presets ancorados no dia informado", () => {
    const p = presetsPeriodo("2026-07-31");
    const porRotulo = Object.fromEntries(p.map((x) => [x.rotulo, x]));
    expect(porRotulo["Este mês"].de).toBe("2026-07-01");
    expect(porRotulo["Últimos 3 meses"].de).toBe("2026-05-01");
    expect(porRotulo["Este ano"].de).toBe("2026-01-01");
    expect(porRotulo["Ano passado"]).toMatchObject({
      de: "2025-01-01",
      ate: "2025-12-31",
    });
  });
  it("preset que cruza a virada do ano", () => {
    const p = presetsPeriodo("2026-02-10");
    const tres = p.find((x) => x.rotulo === "Últimos 3 meses")!;
    expect(tres.de).toBe("2025-12-01");
  });
});
