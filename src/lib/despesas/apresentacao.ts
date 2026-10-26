export const ROTULOS_DOCUMENTO_DESPESA: Readonly<Record<string, string>> = {
  NOTA_FISCAL: "NF", BOLETO: "Boleto", GUIA: "Guia", RECIBO: "Recibo", OUTRO: "Outro documento", SEM_DOCUMENTO: "Sem documento",
};

export function referenciaDocumentoDespesa(d: { numero: string; tipoDocumento?: string; descricao?: string | null }) {
  const tipo = ROTULOS_DOCUMENTO_DESPESA[d.tipoDocumento ?? "NOTA_FISCAL"] ?? "Documento";
  return d.numero ? `${tipo} ${d.numero}` : d.descricao || "Despesa sem documento";
}
