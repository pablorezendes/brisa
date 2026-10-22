import { describe, expect, it } from "vitest";
import { criarIndiceCandidatos } from "./candidatos-indice";
import { avaliarFonte, candidatosPara } from "./reconciliacao";
import { DOMINIOS_UNIFICACAO, type FonteUnificacao } from "./tipos";

function fonte(dominio: FonteUnificacao["dominio"], id: number, extras: Partial<FonteUnificacao> = {}): FonteUnificacao {
  return {
    chave: `BRISA:${dominio}:${id}`, dominio, origem: "BRISA", origemId: String(id),
    titulo: `Registro sintético ${id}`, descricao: "Descrição sintética", hash: `h${id}`,
    href: null, nomeNorm: `NOME ${id}`, qualidade: "OK", motivos: [], campos: {}, ...extras,
  };
}

function conferir(fontes: FonteUnificacao[], destinos = new Map<string, string>()) {
  const fotografia = structuredClone(fontes);
  const indice = criarIndiceCandidatos(fontes, destinos);
  for (const f of fontes) {
    expect(candidatosPara(f, indice.para(f), destinos), f.chave).toEqual(candidatosPara(f, fontes, destinos));
  }
  expect(fontes).toEqual(fotografia);
  return indice;
}

describe("índice exato de candidatos", () => {
  it.each(DOMINIOS_UNIFICACAO)("preserva todas as regras e ordenação de %s", dominio => {
    const fontes = Array.from({ length: 100 }, (_, i) => fonte(dominio, i, {
      origem: i % 2 ? "WIDESYS" : "BRISA", nomeNorm: i % 7 === 0 ? "AB" : `NOME ${i % 4}`,
      qualidade: i % 13 === 0 ? "QUARENTENA" : i % 17 === 0 ? "AUSENTE" : "OK",
      documento: i % 6 === 0 ? null : i % 3 ? "00000000001" : "00000000002",
      pessoaChave: i % 5 ? `PESSOA:${i % 3}` : null,
      contratoChave: i % 6 ? `CONTRATO:${i % 4}` : undefined,
      imovelChave: i % 7 ? `IMOVEL:${i % 2}` : "",
      tituloChave: i % 4 ? `TITULO:${i % 2}` : null,
      competencia: i % 11 === 0 ? null : i % 13 === 0 ? undefined : `2026-${i % 3 + 1}`,
      data: i % 5 ? "2026-01-10" : i % 2 ? null : undefined,
      valor: i % 11 === 0 ? null : i % 7 === 0 ? undefined : [0, 100, -100, 300][i % 4],
      pago: i % 2 ? 0 : null, natureza: i % 5 ? "SAIDA" : null,
      caixaChave: i % 3 ? `CAIXA:${i % 2}` : null,
      campos: { endereco: { rotulo: "Endereço", valor: i % 5 ? "RUA SINTETICA" : null }, numero: { rotulo: "Número", valor: i % 3 ? "1" : 1 } },
    }));
    const destinos = new Map([["PESSOA:1", "PESSOA:0"], ["IMOVEL:1", "IMOVEL:0"], ["CONTRATO:1", "CONTRATO:0"], ["TITULO:1", "TITULO:0"]]);
    conferir(fontes, destinos);
    conferir(fontes);
  });

  it("não perde correspondências de valor zero nem mistura tipos de endereço", () => {
    const fontes = [
      fonte("RECEBER", 1, { nomeNorm: "NOME IGUAL", competencia: "2026-01", valor: 0 }),
      fonte("RECEBER", 2, { nomeNorm: "NOME IGUAL", competencia: "2026-01", valor: 0 }),
      fonte("IMOVEL", 3, { campos: { endereco: { rotulo: "Endereço", valor: "RUA" }, numero: { rotulo: "Número", valor: 1 } } }),
      fonte("IMOVEL", 4, { campos: { endereco: { rotulo: "Endereço", valor: "RUA" }, numero: { rotulo: "Número", valor: "1" } } }),
    ];
    const indice = conferir(fontes);
    expect(candidatosPara(fontes[0], indice.para(fontes[0]), new Map())[0].motivos).toEqual(["CONTEUDO_REPETIDO"]);
    expect(candidatosPara(fontes[2], indice.para(fontes[2]), new Map())).toEqual([]);
  });

  it("preserva null e undefined na regra de competência já existente", () => {
    for (const competencia of ["2026-01", null, undefined]) {
      const nativo = fonte("RECEBER", 1, { competencia });
      const legado = fonte("RECEBER", 2, { origem: "WIDESYS", competencia });
      const fontes = [nativo, legado];
      const mapa = new Map(fontes.map(f => [f.chave, f]));
      const indice = conferir(fontes);
      expect(avaliarFonte(legado, [], mapa, undefined, new Map(), indice.competenciasReceberBrisa)).toEqual(avaliarFonte(legado, [], mapa));
      expect(avaliarFonte(legado, [], mapa, undefined, new Map(), indice.competenciasReceberBrisa).motivos).toEqual(["PERIODO_JA_EXISTE_NA_PLANILHA"]);
    }
  });

  it("não compartilha candidatos nem competências entre fotografias", () => {
    const a = fonte("RECEBER", 1, { competencia: "2026-01", pessoaChave: "PESSOA:1" });
    const b = fonte("RECEBER", 2, { competencia: "2026-01", pessoaChave: "PESSOA:1" });
    const indiceA = criarIndiceCandidatos([a, b], new Map());
    const indiceB = criarIndiceCandidatos([], new Map());
    expect(indiceA.para(a)).toEqual([a, b]);
    expect(indiceB.para(a)).toEqual([]);
    expect(indiceB.competenciasReceberBrisa.size).toBe(0);
  });

  it("evita 25 milhões de comparações em 5 mil títulos sem correspondências", () => {
    const fontes = Array.from({ length: 5000 }, (_, i) => fonte("RECEBER", i, {
      competencia: "2026-01", valor: 10000 + i, pessoaChave: `PESSOA:${i}`,
    }));
    const indice = criarIndiceCandidatos(fontes, new Map());
    const candidatosExaminados = fontes.reduce((total, f) => total + indice.para(f).length, 0);
    expect(candidatosExaminados).toBe(5000);
    expect(candidatosExaminados).toBeLessThan(fontes.length ** 2 / 1000);
    for (const f of fontes.slice(0, 5)) expect(candidatosPara(f, indice.para(f), new Map())).toEqual(candidatosPara(f, fontes, new Map()));
  });

  it("preserva todos os candidatos em grupos densos, sem truncar", () => {
    const fontes = Array.from({ length: 150 }, (_, i) => fonte("PAGAR", i, { nomeNorm: "MESMO NOME", competencia: "2026-01", valor: 10000 }));
    const indice = conferir(fontes);
    expect(candidatosPara(fontes[0], indice.para(fontes[0]), new Map())).toHaveLength(149);
  });
});
