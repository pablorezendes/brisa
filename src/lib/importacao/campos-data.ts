type Campos = Record<string, string | string[]>;
const primeiro = (v?: string | string[]) => (Array.isArray(v) ? v.find(s => s.trim()) : v)?.trim() || null;

/** Rótulos genéricos, como pagamento, nunca casam com tipo_de_pagamento. */
export function buscarCampoData(campos: Campos, aliases: string[]): string | null {
  for (const alias of aliases) {
    const valor = primeiro(campos[alias]);
    if (valor) return valor;
  }
  for (const alias of aliases.filter(a => a.startsWith("data_"))) {
    const valor = Object.entries(campos).filter(([chave]) => chave.endsWith(`_${alias}`))
      .sort(([a], [b]) => a.length - b.length).map(([, v]) => primeiro(v)).find(Boolean);
    if (valor) return valor;
  }
  return null;
}

export const ALIASES_DATA_PAGAMENTO = ["data_pagamento", "pagamento", "data_baixa"];
export function falsoErroTipoPagamento(campos: Campos): boolean {
  return !buscarCampoData(campos, ALIASES_DATA_PAGAMENTO)
    && Object.entries(campos).some(([k, v]) => /^(tipo|forma)(_de)?_pagamento$/.test(k) && !!primeiro(v));
}
