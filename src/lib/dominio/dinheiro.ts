/** Helpers de dinheiro: centavos (Int) ↔ exibição BRL. */

/** Converte reais (float da planilha) para centavos inteiros. */
export function paraCentavos(reais: number | null | undefined): number | null {
  if (reais === null || reais === undefined) return null;
  return Math.round(reais * 100);
}

export function paraCentavosOuZero(reais: number | null | undefined): number {
  return paraCentavos(reais) ?? 0;
}

const fmtBRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Formata centavos como "R$ 1.234,56". null/undefined → "—". */
export function formatarBRL(centavos: number | null | undefined): string {
  if (centavos === null || centavos === undefined) return "—";
  return fmtBRL.format(centavos / 100);
}

/**
 * Formato curto para eixos e rótulos apertados de gráfico:
 * 1.234.500 centavos → "12,3 mil" · 250.000.000 → "2,5 mi" · 4.500 → "45".
 * Sem "R$" — o eixo já diz que é dinheiro e a repetição só rouba espaço.
 */
export function abreviarBRL(centavos: number | null | undefined): string {
  if (centavos === null || centavos === undefined) return "—";
  const reais = centavos / 100;
  const abs = Math.abs(reais);
  const sinal = reais < 0 ? "-" : "";
  const um = (v: number) =>
    (Math.round(v * 10) / 10).toString().replace(".", ",");
  if (abs >= 1_000_000) return `${sinal}${um(abs / 1_000_000)} mi`;
  if (abs >= 1_000) return `${sinal}${um(abs / 1_000)} mil`;
  return `${sinal}${Math.round(abs)}`;
}

/** "1.234,56" | "1234.56" | "1234" → centavos. Vazio/inválido → null. */
export function parseBRL(texto: string | null | undefined): number | null {
  if (!texto) return null;
  const s = texto.trim().replace(/^R\$\s*/i, "");
  if (!s) return null;
  // formato brasileiro: ponto = milhar, vírgula = decimal
  const normalizado = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : s;
  const n = Number(normalizado);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}
