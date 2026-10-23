import type { DespesaEditor, LinhaRateioEntrada } from "@/lib/despesas/tipos";

/** Valores manuais: rejeita mais de dois decimais em vez de arredondar silenciosamente. */
export function centavosRateio(texto: string): number | null {
  const valor = texto.trim().replace(/^R\$\s*/i, "");
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(valor) && !/^\d+\.\d{1,2}$/.test(valor)) return null;
  const normalizado = valor.includes(",") ? valor.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(?:\.\d{3})+$/.test(valor) ? valor.replace(/\./g, "") : valor;
  const [inteiro, decimal = ""] = normalizado.split(".");
  const centavos = Number(inteiro) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(centavos) && centavos >= 0 ? centavos : null;
}
export const valorEditavel = (centavos: number) => (centavos / 100).toFixed(2).replace(".", ",");
export type RateioEditavel = Omit<LinhaRateioEntrada, "valor"> & { chave: string; valor: string };
export const linhaVazia = (): RateioEditavel => ({ chave: crypto.randomUUID(), empreendimentoId: "", unidadeId: "", descricao: "", categoria: "", valor: "" });
export function linhasEditaveis(editor: DespesaEditor): RateioEditavel[] {
  return editor.documento.rateios.length ? editor.documento.rateios.map(linha => ({ ...linha, chave: crypto.randomUUID(), valor: valorEditavel(linha.valor) })) : [linhaVazia()];
}
export function conferirValoresRateio(total: string, linhas: Pick<RateioEditavel, "valor">[]) {
  const totalCentavos = centavosRateio(total);
  const valores = linhas.map(linha => centavosRateio(linha.valor));
  const distribuido = valores.reduce<number>((soma, valor) => soma + (valor ?? 0), 0);
  return { total: totalCentavos, distribuido, restante: (totalCentavos ?? 0) - distribuido, completo: totalCentavos !== null && totalCentavos > 0 && valores.length > 0 && valores.every(valor => valor !== null && valor > 0) && totalCentavos === distribuido };
}
