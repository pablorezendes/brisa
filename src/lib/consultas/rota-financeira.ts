import { parsePeriodo } from "@/lib/dominio/periodo";

type JanelaLegada = { mes?: string; ano?: string; de?: string; ate?: string };

/** Preserva o período de atalhos existentes, inclusive os que recebiam apenas um ano. */
export function hrefFinanceiroPeriodo(base: string, dados: JanelaLegada, filtros: Record<string, string> = {}) {
  const query = new URLSearchParams(filtros);
  const periodo = parsePeriodo(dados.de, dados.ate);
  if (periodo) {
    const primeiro = periodo.meses[0];
    const ultimo = periodo.meses.at(-1)!;
    const [ano, mes] = ultimo.split("-").map(Number);
    query.set("de", `${primeiro}-01`);
    query.set("ate", `${ultimo}-${new Date(Date.UTC(ano, mes, 0)).getUTCDate()}`);
  } else if (dados.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(dados.mes)) {
    query.set("mes", dados.mes);
  } else if (dados.ano && /^(20\d{2}|2100)$/.test(dados.ano)) {
    query.set("de", `${dados.ano}-01-01`);
    query.set("ate", `${dados.ano}-12-31`);
  }
  return query.size ? `${base}?${query}` : base;
}
