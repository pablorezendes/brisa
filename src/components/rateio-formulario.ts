import type { DespesaEditor, LinhaRateioEntrada } from "@/lib/despesas/tipos";
import { categoriaDespesa } from "@/lib/despesas/categorias";

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

export type ModoCustoDespesa = "ADMINISTRADORA" | "UM_EMPREENDIMENTO" | "VARIOS";

export function modoCustoInicial(documento: Pick<DespesaEditor["documento"], "destinoCusto" | "rateios" | "total"> & Partial<Pick<DespesaEditor["documento"], "descricao" | "categoriaCodigo">>): ModoCustoDespesa {
  if (documento.destinoCusto === "ADMINISTRADORA") return "ADMINISTRADORA";
  const linha = documento.rateios[0];
  const categoria = categoriaDespesa(documento.categoriaCodigo);
  // Abrir não pode completar uma parcela parcial nem apagar seu detalhamento.
  const detalheProprio = Boolean(linha && ((documento.descricao && linha.descricao.trim() !== documento.descricao.trim()) || (categoria && linha.categoria && linha.categoria !== categoria.rotulo)));
  return documento.rateios.length === 1 && linha.valor === documento.total && !detalheProprio ? "UM_EMPREENDIMENTO" : "VARIOS";
}

/** Uma escolha de destino gera somente a distribuição gerencial da mesma despesa. */
export function rateiosDoFormulario(entrada: {
  modo: ModoCustoDespesa;
  total: string;
  descricao: string;
  categoria: string | null;
  unico: Pick<RateioEditavel, "empreendimentoId" | "unidadeId" | "categoria">;
  linhas: RateioEditavel[];
}): LinhaRateioEntrada[] {
  if (entrada.modo === "ADMINISTRADORA") return [];
  const linhas = entrada.modo === "UM_EMPREENDIMENTO"
    ? [{ ...entrada.unico, descricao: entrada.descricao, categoria: entrada.categoria ?? entrada.unico.categoria, valor: entrada.total }]
    : entrada.linhas.filter(linha => linha.empreendimentoId || linha.unidadeId || linha.descricao.trim() || linha.categoria?.trim() || linha.valor.trim());
  return linhas.map(linha => {
    const valor = centavosRateio(linha.valor);
    if (!linha.empreendimentoId || !linha.descricao.trim() || valor === null || valor <= 0) {
      throw new Error("Informe o empreendimento, a descrição e um valor maior que zero em cada custo. Remova as linhas incompletas para salvar um rascunho.");
    }
    return { empreendimentoId: linha.empreendimentoId, unidadeId: linha.unidadeId || null, descricao: linha.descricao.trim(), categoria: linha.categoria || entrada.categoria || null, valor };
  });
}
