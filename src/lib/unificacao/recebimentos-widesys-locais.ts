import { normalizar } from "../dominio/normalizacao";

export const BAIXA_ORIGEM_APOS_BRISA = "BAIXA_ORIGEM_APOS_BRISA";
export const MOVIMENTO_WIDESYS_BAIXA_BRISA = "MOVIMENTO_WIDESYS_BAIXA_BRISA";

type BaixaLocal = {
  id: string;
  tituloId: string;
  lancamentoCaixaId: string;
  valor: number;
  dataPagamento: string;
  via: string;
  criadoEm: Date;
  valorDevidoOrigemNaBaixa: number;
  valorPagoOrigemNaBaixa: number;
  valorAbertoOrigemNaBaixa: number;
};

type BaixaImportada = {
  id: string;
  escopo: string;
  tituloEscopo: string;
  tituloLegadoId: string;
  movimentoLegadoId: string | null;
  importadoEm: Date;
  statusImportacao: string;
  estornada: boolean;
  valor: number | null;
  dataPagamento: string | null;
  forma: string | null;
};

type MovimentoImportado = {
  legadoId: string;
  tituloEscopo: string | null;
  tituloLegadoId: string | null;
  importadoEm: Date;
  natureza: string;
  statusImportacao: string;
  dataMovimento: string | null;
  valor: number | null;
};

type TituloImportado = {
  id: string;
  legadoId: string;
  escopo: string;
  valorDevido: number | null;
  valorPago: number | null;
  valorAberto: number | null;
  situacaoNormalizada: string;
  statusImportacao: string;
};

function chaveTitulo(escopo: string, id: string) {
  return `${escopo}:${id}`;
}

function formaReconhecida(forma: string | null) {
  return normalizar(forma ?? "").match(/\b(PIX|BOLETO|DINHEIRO|TRANSFERENCIA)\b/)?.[0];
}

function chaveComparacao(valor: number | null, data: string | null, forma: string | null) {
  const via = formaReconhecida(forma);
  return valor && data && via ? `${valor}:${data}:${via}` : null;
}

function importacaoValida(status: string) {
  return status !== "AUSENTE_NA_FONTE" && status !== "QUARENTENA";
}

/** A primeira baixa fixa a base conhecida. Pagamentos posteriores no legado
 * são evidência da origem e precisam de conferência antes de entrar no Brisa. */
export function apurarRecebimentosWidesysLocais(
  titulos: TituloImportado[], locais: BaixaLocal[], importadas: BaixaImportada[], movimentos: MovimentoImportado[],
) {
  const porTitulo = new Map<string, {
    devido: number;
    pago: number;
    aberto: number;
    data: string;
    revisarOrigem: boolean;
  }>();
  const baixasOrigemRepetidas = new Set<string>();
  const baixasOrigemPosteriores = new Set<string>();
  const valorRetidoPorMovimento = new Map<string, number>();
  if (!locais.length) return { porTitulo, baixasOrigemRepetidas, baixasOrigemPosteriores, valorRetidoPorMovimento };

  const locaisPorTitulo = Map.groupBy(locais, baixa => baixa.tituloId);
  const importadasPorTitulo = Map.groupBy(importadas.filter(baixa => baixa.escopo === "BAIXA_RECEBER"),
    baixa => chaveTitulo(baixa.tituloEscopo, baixa.tituloLegadoId));
  const titulosMigrados = new Map<string, Date>();
  const movimentosComBaixa = new Set(importadas.filter(baixa => baixa.movimentoLegadoId
    && baixa.statusImportacao !== "QUARENTENA").map(baixa => baixa.movimentoLegadoId));

  for (const titulo of titulos) {
    const baixasLocais = locaisPorTitulo.get(titulo.id);
    if (!baixasLocais?.length) continue;
    const primeira = baixasLocais.reduce((maisAntiga, atual) => atual.criadoEm < maisAntiga.criadoEm
      || (atual.criadoEm.getTime() === maisAntiga.criadoEm.getTime() && atual.id < maisAntiga.id) ? atual : maisAntiga);
    const identidade = chaveTitulo(titulo.escopo, titulo.legadoId);
    titulosMigrados.set(identidade, primeira.criadoEm);

    const novas = (importadasPorTitulo.get(identidade) ?? []).filter(baixa => baixa.importadoEm > primeira.criadoEm);
    const ativas = novas.filter(baixa => !baixa.estornada && importacaoValida(baixa.statusImportacao));
    const candidatasLocais = Map.groupBy(baixasLocais, baixa => chaveComparacao(baixa.valor, baixa.dataPagamento, baixa.via));
    const candidatasOrigem = Map.groupBy(ativas, baixa => chaveComparacao(baixa.valor, baixa.dataPagamento, baixa.forma));
    let somaEspelhada = 0;
    for (const baixa of novas) {
      // O valor/ID preservado na baixa ausente ou estornada continua ligando
      // o movimento antigo. A entrada registrada no Brisa não é estornada na origem.
      if (baixa.movimentoLegadoId && baixa.valor && baixa.valor > 0 && (baixa.statusImportacao !== "QUARENTENA" || baixa.estornada)) {
        valorRetidoPorMovimento.set(baixa.movimentoLegadoId, (valorRetidoPorMovimento.get(baixa.movimentoLegadoId) ?? 0) + baixa.valor);
      }
    }
    for (const baixa of ativas) {
      const comparacao = chaveComparacao(baixa.valor, baixa.dataPagamento, baixa.forma);
      const par = baixa.movimentoLegadoId && comparacao && candidatasLocais.get(comparacao)?.length === 1 && candidatasOrigem.get(comparacao)?.length === 1;
      if (par) {
        baixasOrigemRepetidas.add(baixa.id);
        somaEspelhada += baixa.valor ?? 0;
      } else baixasOrigemPosteriores.add(baixa.id);
    }

    const totalLocal = baixasLocais.reduce((total, baixa) => total + baixa.valor, 0);
    const pagoNaOrigem = titulo.valorPago ?? (titulo.valorDevido !== null && titulo.valorAberto !== null
      ? titulo.valorDevido - titulo.valorAberto : null);
    const revisarOrigem = novas.some(baixa => !baixasOrigemRepetidas.has(baixa.id))
      || (pagoNaOrigem !== null && pagoNaOrigem !== primeira.valorPagoOrigemNaBaixa + somaEspelhada)
      || (titulo.valorDevido !== null && titulo.valorDevido !== primeira.valorDevidoOrigemNaBaixa)
      || (titulo.valorAberto !== null && titulo.valorAberto !== Math.max(0, primeira.valorAbertoOrigemNaBaixa - somaEspelhada))
      || titulo.situacaoNormalizada === "CANCELADO" || !importacaoValida(titulo.statusImportacao);
    porTitulo.set(titulo.id, {
      devido: primeira.valorDevidoOrigemNaBaixa,
      pago: primeira.valorPagoOrigemNaBaixa + totalLocal,
      aberto: Math.max(0, primeira.valorAbertoOrigemNaBaixa - totalLocal),
      data: baixasLocais.reduce((data, baixa) => baixa.dataPagamento > data ? baixa.dataPagamento : data, primeira.dataPagamento),
      revisarOrigem,
    });
  }

  // Sem baixa detalhada, só uma referência explícita ao título sustenta
  // a retenção. Data e valor, sozinhos, não identificam uma entrada no caixa.
  for (const movimento of movimentos) {
    if (movimento.natureza !== "ENTRADA" || !movimento.tituloEscopo || !movimento.tituloLegadoId
      || movimentosComBaixa.has(movimento.legadoId) || !importacaoValida(movimento.statusImportacao)) continue;
    const corte = titulosMigrados.get(chaveTitulo(movimento.tituloEscopo, movimento.tituloLegadoId));
    if (corte && movimento.importadoEm > corte && movimento.valor) valorRetidoPorMovimento.set(movimento.legadoId, Math.abs(movimento.valor));
  }
  return { porTitulo, baixasOrigemRepetidas, baixasOrigemPosteriores, valorRetidoPorMovimento };
}
