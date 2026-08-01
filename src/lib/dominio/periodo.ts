/**
 * Período de análise — datas de início e fim escolhidas num calendário.
 *
 * O sistema inteiro trabalha por competência mensal ("YYYY-MM"): comissão,
 * inadimplência, caixa e temporada são apurados por mês. Por isso o período
 * selecionado no calendário é traduzido para a LISTA DE COMPETÊNCIAS que as
 * datas cobrem — escolher 15/03 a 10/05 analisa MAR, ABR e MAI inteiros.
 * Essa regra vai explicada no "i" do seletor.
 *
 * Querystring: ?de=YYYY-MM-DD&ate=YYYY-MM-DD. Quando o período está presente
 * e válido, ele vence o ?mes/?ano da página.
 */

import {
  NOME_MES_ABREV,
  competencia,
  parseCompetencia,
} from "./normalizacao";

export interface Periodo {
  /** "YYYY-MM-DD" — início (sempre ≤ ate) */
  de: string;
  /** "YYYY-MM-DD" — fim */
  ate: string;
  /** competências "YYYY-MM" cobertas pelas datas, em ordem crescente */
  meses: string[];
  /** "01/06/2026 a 31/07/2026 · 2 meses" */
  rotulo: string;
}

/** Teto de segurança: nenhuma análise precisa de mais que 5 anos de meses. */
export const MAX_MESES_PERIODO = 60;

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Valida "YYYY-MM-DD" como data real do calendário (rejeita 2026-02-31). */
export function dataValida(s: string | null | undefined): s is string {
  if (!s || !RE_DATA.test(s)) return false;
  const [ano, mes, dia] = s.split("-").map(Number);
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return dia <= ultimoDia;
}

/** "YYYY-MM-DD" → "DD/MM/AAAA" (assume já validada). */
export function formatarDataCurta(d: string): string {
  const [ano, mes, dia] = d.split("-");
  return `${dia}/${mes}/${ano}`;
}

/** Competências de mesA até mesB, inclusivas ("2025-11".."2026-02" → 4 itens). */
export function mesesEntre(mesA: string, mesB: string): string[] {
  const a = parseCompetencia(mesA);
  const b = parseCompetencia(mesB);
  const saida: string[] = [];
  let { ano, mes } = a;
  while (ano < b.ano || (ano === b.ano && mes <= b.mes)) {
    saida.push(competencia(ano, mes));
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return saida;
}

/**
 * Interpreta ?de/?ate. Regras de tolerância (URLs editadas à mão):
 *  - nenhuma data válida → null (página segue no modo mês/ano normal);
 *  - só uma data válida → período daquele único dia (o mês dela);
 *  - de > ate → troca;
 *  - mais de MAX_MESES_PERIODO meses → corta o fim.
 */
export function parsePeriodo(
  deRaw: string | undefined,
  ateRaw: string | undefined
): Periodo | null {
  const deOk = dataValida(deRaw) ? deRaw : null;
  const ateOk = dataValida(ateRaw) ? ateRaw : null;
  if (!deOk && !ateOk) return null;

  let de = deOk ?? (ateOk as string);
  let ate = ateOk ?? (deOk as string);
  if (de > ate) [de, ate] = [ate, de]; // ISO compara certo como string

  let meses = mesesEntre(de.slice(0, 7), ate.slice(0, 7));
  if (meses.length > MAX_MESES_PERIODO) {
    meses = meses.slice(0, MAX_MESES_PERIODO);
    const { ano, mes } = parseCompetencia(meses[meses.length - 1]);
    const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    ate = `${meses[meses.length - 1]}-${String(ultimoDia).padStart(2, "0")}`;
  }

  const n = meses.length;
  return {
    de,
    ate,
    meses,
    rotulo: `${formatarDataCurta(de)} a ${formatarDataCurta(ate)} · ${n} ${n === 1 ? "mês" : "meses"}`,
  };
}

/**
 * Rótulos de eixo para uma lista de competências: "JAN" quando todas são do
 * mesmo ano, "JAN/26" quando o período atravessa a virada.
 */
export function rotulosCompetencias(meses: string[]): string[] {
  const anos = new Set(meses.map((m) => m.slice(0, 4)));
  return meses.map((m) => {
    const { ano, mes } = parseCompetencia(m);
    return anos.size > 1
      ? `${NOME_MES_ABREV[mes]}/${String(ano).slice(2)}`
      : NOME_MES_ABREV[mes];
  });
}

/** Números de mês (1..12) distintos cobertos — para regras como mesReajuste. */
export function numerosDeMes(meses: string[]): number[] {
  return [...new Set(meses.map((m) => parseCompetencia(m).mes))];
}

/**
 * "YYYY-MM-DD" de hoje no fuso do negócio (America/Sao_Paulo). O servidor
 * roda em UTC; sem a âncora de fuso, entre 21h e 23h59 no Brasil os presets
 * ("Este mês", "Este ano"...) apontariam para o dia seguinte — na virada do
 * mês, para um mês vazio. O locale en-CA formata exatamente como YYYY-MM-DD.
 */
export function hojeISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}

/** Presets do seletor: rótulo + querystring pronta (?de=...&ate=...). */
export function presetsPeriodo(
  hoje = hojeISO()
): { rotulo: string; de: string; ate: string }[] {
  const { ano, mes } = parseCompetencia(hoje.slice(0, 7));
  const inicioMes = (a: number, m: number) => {
    // normaliza meses fora de 1..12 (ex.: mes -2)
    const total = a * 12 + (m - 1);
    const na = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    return `${competencia(na, nm)}-01`;
  };
  return [
    { rotulo: "Este mês", de: inicioMes(ano, mes), ate: hoje },
    { rotulo: "Últimos 3 meses", de: inicioMes(ano, mes - 2), ate: hoje },
    { rotulo: "Últimos 6 meses", de: inicioMes(ano, mes - 5), ate: hoje },
    { rotulo: "Últimos 12 meses", de: inicioMes(ano, mes - 11), ate: hoje },
    { rotulo: "Este ano", de: `${ano}-01-01`, ate: hoje },
    { rotulo: "Ano passado", de: `${ano - 1}-01-01`, ate: `${ano - 1}-12-31` },
  ];
}
