/** Identificação documental do caixa; não infere uma conta bancária. */
export function rotuloCaixaOrigem(origem: string | null | undefined): string {
  if (!origem) return "Operação Brisa";
  if (origem === "CONTA_ACAMARGO") return "CONTA ACAMARGO";
  if (origem.startsWith("GASTOS_BRISA:")) return `Brisa · ${origem.slice("GASTOS_BRISA:".length)}`;
  return origem;
}
