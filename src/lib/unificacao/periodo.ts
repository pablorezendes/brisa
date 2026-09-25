import type { FonteUnificacao } from "./tipos";

type FonteComPeriodo = Pick<FonteUnificacao, "dominio" | "competencia" | "vencimento" | "data">;

function dataValida(valor: string | null | undefined): string | null {
  if (!valor || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(valor)) return null;
  const instante = new Date(`${valor}T00:00:00.000Z`);
  return Number.isFinite(instante.getTime()) && instante.toISOString().slice(0, 10) === valor ? valor : null;
}

function inicioCompetencia(valor: string | null | undefined): string | null {
  return valor && /^\d{4}-(0[1-9]|1[0-2])$/.test(valor) ? `${valor}-01` : null;
}

/** Uma fonte tem um único período operacional, conforme a natureza do registro. */
export function dataOperacionalUnificada(fonte: FonteComPeriodo): string | null {
  const competencia = inicioCompetencia(fonte.competencia);
  const vencimento = dataValida(fonte.vencimento);
  const data = dataValida(fonte.data);
  return fonte.dominio === "RECEBER" || fonte.dominio === "PAGAR"
    ? competencia ?? vencimento ?? data
    : data ?? vencimento ?? competencia;
}

export function mesOperacionalUnificado(fonte: FonteComPeriodo): string | null {
  return dataOperacionalUnificada(fonte)?.slice(0, 7) ?? null;
}
