export const ESCOPOS_OPERACAO_WIDESYS = [
  "CONTRATO",
  "CONTRATO_PARTE",
  "TITULO_RECEBER",
  "TITULO_PAGAR",
  "BAIXA_RECEBER",
  "BAIXA_PAGAR",
  "MOVIMENTO",
] as const;

export type EscopoOperacaoWidesys = (typeof ESCOPOS_OPERACAO_WIDESYS)[number];

export type ReconciliacaoEscopoWidesys = {
  quantidade: number;
  quarentena: number;
  somaFonte: number;
  somaAceita: number;
  somaQuarentena: number;
  somaValorOriginal: number;
  somaValorDevido: number;
  somaValorAberto: number;
  somaValorPago: number;
  somaMovimentos: number;
  somaBaixas: number;
};

export type ResumoLoteOperacaoWidesys = {
  processados: number;
  escoposCobertos: EscopoOperacaoWidesys[];
  reconciliacao: Partial<Record<EscopoOperacaoWidesys, ReconciliacaoEscopoWidesys>>;
};

const CAMPOS_RECONCILIACAO = [
  "quantidade",
  "quarentena",
  "somaFonte",
  "somaAceita",
  "somaQuarentena",
  "somaValorOriginal",
  "somaValorDevido",
  "somaValorAberto",
  "somaValorPago",
  "somaMovimentos",
  "somaBaixas",
] as const satisfies readonly (keyof ReconciliacaoEscopoWidesys)[];

function objeto(valor: unknown): Record<string, unknown> | null {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

function inteiroNaoNegativo(valor: unknown): number {
  return typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 0 ? valor : 0;
}

function numeroSeguro(valor: unknown): number {
  return typeof valor === "number" && Number.isSafeInteger(valor) ? valor : 0;
}

function escopoValido(valor: unknown): valor is EscopoOperacaoWidesys {
  return (ESCOPOS_OPERACAO_WIDESYS as readonly unknown[]).includes(valor);
}

/**
 * O resumo do lote é JSON persistido pelo importador. A apresentação nunca
 * recebe esse JSON bruto: somente números conhecidos e escopos permitidos
 * atravessam esta fronteira.
 */
export function interpretarResumoLoteOperacao(
  resumo: string | null | undefined,
): ResumoLoteOperacaoWidesys {
  let raiz: Record<string, unknown> | null = null;
  try {
    raiz = objeto(JSON.parse(resumo ?? "{}"));
  } catch {
    raiz = null;
  }

  const escoposCobertos = Array.isArray(raiz?.escoposCobertos)
    ? raiz.escoposCobertos.filter(escopoValido)
    : [];
  const reconciliacaoBruta = objeto(raiz?.reconciliacao);
  const reconciliacao: ResumoLoteOperacaoWidesys["reconciliacao"] = {};

  for (const escopo of ESCOPOS_OPERACAO_WIDESYS) {
    const item = objeto(reconciliacaoBruta?.[escopo]);
    if (!item) continue;
    const seguro = {} as ReconciliacaoEscopoWidesys;
    for (const campo of CAMPOS_RECONCILIACAO) {
      seguro[campo] = campo === "quantidade" || campo === "quarentena"
        ? inteiroNaoNegativo(item[campo])
        : numeroSeguro(item[campo]);
    }
    reconciliacao[escopo] = seguro;
  }

  return {
    processados: inteiroNaoNegativo(raiz?.processados),
    escoposCobertos,
    reconciliacao,
  };
}
