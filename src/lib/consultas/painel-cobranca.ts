/**
 * Consultas do PAINEL DE COBRANÇA (/paineis/cobranca).
 *
 * Objetivo: dizer EXATAMENTE quem cobrar hoje e o que registrar depois.
 * Complementa "@/lib/consultas/executivo" (que traz caixa/temporada/reajustes)
 * com o recorte de pendências: lista de cobrança com vencimento e observação,
 * aging por faixa de atraso, pendências acumuladas e ranking de devedores.
 *
 * Regras fiéis ao domínio:
 * - Pendente = lançamento com totalDevido != null e recebido == null no
 *   mesLancamento (regra canônica de calcularRecebimento).
 * - Taxa de recebimento = Σrecebido / Σdevido (pode passar de 100% quando
 *   atrasos de outros meses são quitados).
 * - "Mês com operação" = mês de lançamento com ao menos um recebido
 *   registrado. Meses pré-lançados (devidos gerados de antemão, sem nenhum
 *   pagamento ainda) NÃO contam no acumulado nem no ranking de devedores.
 * - Dias de atraso comparados ao diaVencimento do contrato dentro do mês
 *   selecionado; contrato sem diaVencimento cai na faixa "no prazo".
 *
 * Valores sempre em CENTAVOS (Int). Meses "YYYY-MM".
 */
import { prisma } from "@/lib/db";
import { calcularRecebimento } from "@/lib/dominio/comissao";
import {
  competencia,
  NOME_MES_ABREV,
  parseCompetencia,
} from "@/lib/dominio/normalizacao";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface ItemCobranca {
  recebimentoId: string;
  empreendimento: string;
  locatario: string | null;
  localizacao: string;
  totalDevido: number;
  diaVencimento: number | null;
  /**
   * Dias corridos desde o vencimento (hoje − vencimento no mês selecionado).
   * Negativo/zero = ainda no prazo; null = contrato sem diaVencimento.
   */
  diasDesdeVencimento: number | null;
  observacao: string | null;
}

export const FAIXAS_AGING = [
  "No prazo",
  "1–15 dias",
  "16–30 dias",
  "31–60 dias",
  "Mais de 60 dias",
] as const;

export interface FaixaAging {
  faixa: (typeof FAIXAS_AGING)[number];
  quantidade: number;
  valor: number;
}

export interface PendenciaMensal {
  mes: string; // "YYYY-MM"
  mesNum: number; // 1..12
  devido: number;
  recebido: number;
  pendentes: number;
  pendenteValor: number;
  /** Σrecebido / Σdevido (null quando nada devido no mês) */
  taxaRecebimento: number | null;
  /** true = mês com ao menos um recebimento registrado ("mês com operação") */
  operacional: boolean;
}

export interface DevedorAno {
  locatario: string;
  valor: number;
  quantidade: number;
  /** meses (abreviados, em ordem) em que o locatário tem pendência */
  meses: string[];
}

export interface DadosPainelCobranca {
  mes: string;
  ano: number;
  // ---- KPIs ----
  pendentesMesQtde: number;
  pendentesMesValor: number;
  devidoMes: number;
  recebidoMes: number;
  taxaRecebimentoMes: number | null;
  /** pendências de meses com operação ≤ mês selecionado */
  pendentesAnoQtde: number;
  pendentesAnoValor: number;
  mesesOperacionaisConsiderados: number;
  maiorDevedor: DevedorAno | null;
  // ---- seções ----
  /** pendentes do mês selecionado, por valor desc */
  listaCobranca: ItemCobranca[];
  /** valor pendente do mês por faixa de atraso (5 faixas, na ordem) */
  aging: FaixaAging[];
  /** 12 meses do ano (índice 0 = JAN) */
  porMes: PendenciaMensal[];
  /** top 8 locatários por Σ pendente no ano (meses com operação ≤ mês) */
  topDevedores: DevedorAno[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Índice da faixa de aging (0..4) para dias desde o vencimento. */
export function indiceFaixaAging(dias: number | null): number {
  if (dias === null || dias <= 0) return 0; // sem diaVencimento ou a vencer
  if (dias <= 15) return 1;
  if (dias <= 30) return 2;
  if (dias <= 60) return 3;
  return 4;
}

// ---------------------------------------------------------------------------
// Consulta principal
// ---------------------------------------------------------------------------

export async function dadosPainelCobranca(
  mes: string
): Promise<DadosPainelCobranca> {
  const { ano, mes: mesNum } = parseCompetencia(mes);

  // Um único fetch do ano: alimenta lista, aging, série e ranking.
  const recebimentos = await prisma.recebimento.findMany({
    where: { mesLancamento: { startsWith: `${ano}-` } },
    include: {
      empreendimento: true,
      contrato: { include: { unidade: true, locatario: true } },
    },
  });

  // "Hoje" em UTC — as datas do domínio são strings, só contamos dias corridos.
  const agora = new Date();
  const hojeUTC = Date.UTC(
    agora.getFullYear(),
    agora.getMonth(),
    agora.getDate()
  );

  const porMes: PendenciaMensal[] = Array.from({ length: 12 }, (_, i) => ({
    mes: competencia(ano, i + 1),
    mesNum: i + 1,
    devido: 0,
    recebido: 0,
    pendentes: 0,
    pendenteValor: 0,
    taxaRecebimento: null,
    operacional: false,
  }));

  const listaCobranca: ItemCobranca[] = [];
  const aging: FaixaAging[] = FAIXAS_AGING.map((faixa) => ({
    faixa,
    quantidade: 0,
    valor: 0,
  }));

  // Pendências do ano (meses ≤ selecionado); filtramos por mês operacional
  // depois, quando já soubermos quais meses tiveram operação.
  interface PendenciaAno {
    mesNum: number;
    locatario: string;
    totalDevido: number;
  }
  const pendenciasAno: PendenciaAno[] = [];

  for (const r of recebimentos) {
    const { mes: m } = parseCompetencia(r.mesLancamento);
    const linha = porMes[m - 1];
    if (!linha) continue; // defensivo contra mesLancamento fora de 01..12

    const calc = calcularRecebimento(r);
    linha.devido += calc.totalDevido ?? 0;
    if (r.recebido !== null) {
      linha.recebido += r.recebido;
      linha.operacional = true;
    }

    const pendente = calc.totalDevido !== null && r.recebido === null;
    if (!pendente) continue;
    const devido = calc.totalDevido ?? 0;

    linha.pendentes += 1;
    linha.pendenteValor += devido;

    if (m <= mesNum) {
      pendenciasAno.push({
        mesNum: m,
        locatario: r.contrato.locatario?.nome ?? "(sem locatário)",
        totalDevido: devido,
      });
    }

    if (r.mesLancamento === mes) {
      const dia = r.contrato.diaVencimento;
      const diasDesdeVencimento =
        dia === null
          ? null
          : Math.floor(
              (hojeUTC - Date.UTC(ano, mesNum - 1, dia)) / 86_400_000
            );
      listaCobranca.push({
        recebimentoId: r.id,
        empreendimento: r.empreendimento.nome,
        locatario: r.contrato.locatario?.nome ?? null,
        localizacao: r.contrato.unidade.identificacao,
        totalDevido: devido,
        diaVencimento: dia,
        diasDesdeVencimento,
        observacao: r.observacao,
      });
      const faixa = aging[indiceFaixaAging(diasDesdeVencimento)];
      faixa.quantidade += 1;
      faixa.valor += devido;
    }
  }

  for (const linha of porMes) {
    linha.taxaRecebimento =
      linha.devido > 0 ? linha.recebido / linha.devido : null;
  }

  listaCobranca.sort((a, b) => b.totalDevido - a.totalDevido);

  // ---- acumulado do ano: só meses com operação ≤ mês selecionado ----
  const consideradas = pendenciasAno.filter(
    (p) => porMes[p.mesNum - 1].operacional
  );
  const pendentesAnoValor = consideradas.reduce(
    (acc, p) => acc + p.totalDevido,
    0
  );
  const mesesOperacionaisConsiderados = porMes.filter(
    (l) => l.mesNum <= mesNum && l.operacional
  ).length;

  // ---- ranking de devedores do ano ----
  const porLocatario = new Map<
    string,
    { valor: number; quantidade: number; meses: Set<number> }
  >();
  for (const p of consideradas) {
    let d = porLocatario.get(p.locatario);
    if (!d) {
      porLocatario.set(
        p.locatario,
        (d = { valor: 0, quantidade: 0, meses: new Set() })
      );
    }
    d.valor += p.totalDevido;
    d.quantidade += 1;
    d.meses.add(p.mesNum);
  }
  const devedores: DevedorAno[] = [...porLocatario.entries()]
    .map(([locatario, d]) => ({
      locatario,
      valor: d.valor,
      quantidade: d.quantidade,
      meses: [...d.meses].sort((a, b) => a - b).map((m) => NOME_MES_ABREV[m]),
    }))
    .sort((a, b) => b.valor - a.valor);

  const linhaMes = porMes[mesNum - 1];

  return {
    mes,
    ano,
    pendentesMesQtde: linhaMes?.pendentes ?? 0,
    pendentesMesValor: linhaMes?.pendenteValor ?? 0,
    devidoMes: linhaMes?.devido ?? 0,
    recebidoMes: linhaMes?.recebido ?? 0,
    taxaRecebimentoMes: linhaMes?.taxaRecebimento ?? null,
    pendentesAnoQtde: consideradas.length,
    pendentesAnoValor,
    mesesOperacionaisConsiderados,
    maiorDevedor: devedores[0] ?? null,
    listaCobranca,
    aging,
    porMes,
    topDevedores: devedores.slice(0, 8),
  };
}
