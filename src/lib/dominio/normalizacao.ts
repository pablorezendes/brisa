/**
 * Normalização de identidade textual (references/01, seção "Chaves e identidade").
 * A origem não tem IDs estáveis — nomes variam em espaços, caixa e acento.
 */

/** trim + upper + colapsa espaços + remove acentos. Chave de matching. */
export function normalizar(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** CPF/CNPJ: mantém só dígitos; vazio → null. */
export function normalizarCpfCnpj(s: string | null | undefined): string | null {
  const digitos = (s ?? "").replace(/\D/g, "");
  return digitos.length > 0 ? digitos : null;
}

const MESES_NOME: Record<string, number> = {
  JANEIRO: 1, FEVEREIRO: 2, MARCO: 3, ABRIL: 4, MAIO: 5, JUNHO: 6,
  JULHO: 7, AGOSTO: 8, SETEMBRO: 9, OUTUBRO: 10, NOVEMBRO: 11, DEZEMBRO: 12,
};

const MESES_ABREV: Record<string, number> = {
  JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6,
  JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12,
};

/** "JULHO" → 7, "MARC 2026" → 3, "jan" → 1. Não reconhecido → null. */
export function mesParaNumero(s: string | null | undefined): number | null {
  const n = normalizar(s);
  if (!n) return null;
  const primeira = n.split(" ")[0];
  if (MESES_NOME[primeira] !== undefined) return MESES_NOME[primeira];
  const abrev = primeira.slice(0, 3);
  return MESES_ABREV[abrev] ?? null;
}

export const NOME_MES_ABREV = [
  "", "JAN", "FEV", "MAR", "ABR", "MAI", "JUN",
  "JUL", "AGO", "SET", "OUT", "NOV", "DEZ",
];

export const NOME_MES_COMPLETO = [
  "", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** (2026, 1) → "2026-01" */
export function competencia(ano: number, mes: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

/** "2026-01" → { ano: 2026, mes: 1 } */
export function parseCompetencia(c: string): { ano: number; mes: number } {
  const [ano, mes] = c.split("-").map(Number);
  return { ano, mes };
}

/** "2026-01" → "JAN/2026" */
export function formatarCompetencia(c: string): string {
  const { ano, mes } = parseCompetencia(c);
  return `${NOME_MES_ABREV[mes]}/${ano}`;
}
