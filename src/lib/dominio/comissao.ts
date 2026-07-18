/**
 * Regra canônica de recebimento/comissão (references/02-locacao-e-recebimentos.md).
 * ÚNICA fonte da regra no sistema — todo relatório/tela deriva daqui.
 *
 * Todos os valores em CENTAVOS (inteiros). Taxa em basis points (1000 = 10%).
 */

export interface InsumosRecebimento {
  valor: number; // aluguel-base
  iptu: number; // repasse — NÃO entra na comissão
  cond: number; // repasse — NÃO entra na comissão
  recebido: number | null; // null = não recebido
  taxaComissaoBps: number;
}

export interface ResultadoRecebimento {
  totalDevido: number | null; // null quando nada a cobrar no mês
  baseCalculo: number | null; // recebido − iptu − cond (só quando há recebido)
  comissao: number | null; // baseCalculo × taxa, arredondado ao centavo
}

export function calcularRecebimento(i: InsumosRecebimento): ResultadoRecebimento {
  const soma = i.valor + i.iptu + i.cond;
  // TOTAL vazio (não zero) quando não há nada a cobrar — distingue
  // "sem cobrança no mês" de "cobrança de R$0" (fórmula H da planilha).
  const totalDevido = soma > 0 ? soma : null;

  if (i.recebido === null || i.recebido === undefined) {
    return { totalDevido, baseCalculo: null, comissao: null };
  }
  const baseCalculo = i.recebido - i.iptu - i.cond;
  // taxa em bps mantém a multiplicação em inteiros; arredonda só no final
  const comissao = Math.round((baseCalculo * i.taxaComissaoBps) / 10000);
  return { totalDevido, baseCalculo, comissao };
}

export interface RecebimentoParaAgregacao extends InsumosRecebimento {
  empreendimentoId: string;
  mesLancamento: string; // "YYYY-MM" — dimensão da matriz COMISSÃO (mês da aba/lançamento)
}

/** Σ comissão dos recebimentos (equivale ao SUBTOTAL da coluna K). */
export function comissaoTotal(recebimentos: InsumosRecebimento[]): number {
  return recebimentos.reduce(
    (acc, r) => acc + (calcularRecebimento(r).comissao ?? 0),
    0
  );
}

/** Matriz empreendimento×mês (equivale ao SUMIF da aba COMISSÃO). */
export function comissaoPorEmpreendimento(
  recebimentos: RecebimentoParaAgregacao[]
): Map<string, Map<string, number>> {
  const matriz = new Map<string, Map<string, number>>();
  for (const r of recebimentos) {
    const { comissao } = calcularRecebimento(r);
    if (comissao === null) continue;
    let porMes = matriz.get(r.empreendimentoId);
    if (!porMes) matriz.set(r.empreendimentoId, (porMes = new Map()));
    porMes.set(r.mesLancamento, (porMes.get(r.mesLancamento) ?? 0) + comissao);
  }
  return matriz;
}
