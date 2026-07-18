/**
 * Consultas do módulo Temporada (Airbnb).
 *
 * A apuração do mês é SEMPRE derivada (nunca persistida):
 *   receita = Σ recebimentoTemporada.valor
 *   despesa = Σ despesaTemporada.valor + Σ totais de limpeza (derivados)
 *   lucro   = receita − despesa
 *
 * O tipo de despesa LIMPEZA é derivado do bloco de limpezas
 * (quantidade × valor unitário + extra/PDL) — o formulário de despesas não
 * oferece esse tipo, evitando digitação dupla e dupla contagem.
 *
 * Todos os valores em centavos (Int). Competências como "YYYY-MM".
 */
import { prisma } from "@/lib/db";
import type {
  DespesaTemporada,
  Limpeza,
  RecebimentoTemporada,
  UnidadeTemporada,
} from "@prisma/client";

/** Total de uma limpeza: quantidade × valor unitário + extra/PDL (centavos). */
export function totalLimpeza(l: {
  quantidade: number;
  valorUnitario: number;
  extraPdl: number;
}): number {
  return l.quantidade * l.valorUnitario + l.extraPdl;
}

export type ApuracaoTemporada = {
  receita: number;
  /** Despesas persistidas (ENERGIA, CONDO, IPTU, EXTRA e eventuais legadas). */
  despesasLancadas: number;
  /** Total derivado do bloco de limpezas (pagamento da diarista). */
  totalLimpezas: number;
  /** despesasLancadas + totalLimpezas. */
  despesa: number;
  /** receita − despesa. */
  lucro: number;
};

/** Regra única da apuração — usada tanto pela página quanto por apuracaoDoMes. */
export function calcularApuracao(dados: {
  limpezas: { quantidade: number; valorUnitario: number; extraPdl: number }[];
  despesas: { valor: number }[];
  recebimentos: { valor: number }[];
}): ApuracaoTemporada {
  const receita = dados.recebimentos.reduce((s, r) => s + r.valor, 0);
  const despesasLancadas = dados.despesas.reduce((s, d) => s + d.valor, 0);
  const totalLimpezas = dados.limpezas.reduce((s, l) => s + totalLimpeza(l), 0);
  const despesa = despesasLancadas + totalLimpezas;
  return { receita, despesasLancadas, totalLimpezas, despesa, lucro: receita - despesa };
}

export type CodigoUnidade = { codigo: string } | null;

export type DadosTemporadaDoMes = {
  unidades: UnidadeTemporada[];
  limpezas: (Limpeza & { unidadeTemporada: { codigo: string } })[];
  despesas: (DespesaTemporada & { unidadeTemporada: CodigoUnidade })[];
  recebimentos: (RecebimentoTemporada & { unidadeTemporada: CodigoUnidade })[];
};

/** Unidades ativas + limpezas, despesas e recebimentos da competência. */
export async function dadosTemporadaDoMes(mes: string): Promise<DadosTemporadaDoMes> {
  const [unidades, limpezas, despesas, recebimentos] = await Promise.all([
    prisma.unidadeTemporada.findMany({
      where: { ativo: true },
      orderBy: { codigo: "asc" },
    }),
    prisma.limpeza.findMany({
      where: { competencia: mes },
      include: { unidadeTemporada: { select: { codigo: true } } },
    }),
    prisma.despesaTemporada.findMany({
      where: { competencia: mes },
      include: { unidadeTemporada: { select: { codigo: true } } },
      orderBy: [{ tipo: "asc" }],
    }),
    prisma.recebimentoTemporada.findMany({
      where: { competencia: mes },
      include: { unidadeTemporada: { select: { codigo: true } } },
    }),
  ]);
  return { unidades, limpezas, despesas, recebimentos };
}

/** Apuração derivada do mês (nunca persistida). */
export async function apuracaoDoMes(mes: string): Promise<ApuracaoTemporada> {
  const { limpezas, despesas, recebimentos } = await dadosTemporadaDoMes(mes);
  return calcularApuracao({ limpezas, despesas, recebimentos });
}

export type ConciliacaoNucleo = {
  /** Existe recebimento agregado (AIRBNB/TODOS) no núcleo para o mês? */
  existeLinhaNucleo: boolean;
  /** Soma do "recebido" das linhas agregadas; null = núcleo ainda sem valor. */
  recebidoNucleo: number | null;
  receitaModulo: number;
  /** recebidoNucleo − receitaModulo; null quando o núcleo não tem valor. */
  diferenca: number | null;
  /** true quando |diferença| ≤ 1 centavo. */
  conciliado: boolean;
};

/**
 * Conciliação com o núcleo: a linha agregada AIRBNB/TODOS
 * (recebimento.origemAgregada = true, mesLancamento = mes) deve refletir a
 * receita da temporada do mesmo mês.
 */
export async function conciliacaoComNucleo(
  mes: string,
  receitaModulo: number,
): Promise<ConciliacaoNucleo> {
  const linhas = await prisma.recebimento.findMany({
    where: { origemAgregada: true, mesLancamento: mes },
    select: { recebido: true },
  });
  const comValor = linhas.filter((l) => l.recebido !== null);
  const recebidoNucleo =
    comValor.length > 0 ? comValor.reduce((s, l) => s + (l.recebido ?? 0), 0) : null;
  const diferenca = recebidoNucleo === null ? null : recebidoNucleo - receitaModulo;
  return {
    existeLinhaNucleo: linhas.length > 0,
    recebidoNucleo,
    receitaModulo,
    diferenca,
    conciliado: diferenca !== null && Math.abs(diferenca) <= 1,
  };
}

export type MesHistorico = {
  mes: number; // 1..12
  receita: number;
  /** null = a planilha do ano não tem total de despesa rotulado (ex.: 2025) */
  despesa: number | null;
  /** null quando a despesa é desconhecida */
  lucro: number | null;
};

export type AnoHistorico = {
  ano: number;
  meses: MesHistorico[];
  totalReceita: number;
  /** null se nenhum mês do ano tem despesa conhecida */
  totalDespesa: number | null;
  totalLucro: number | null;
};

/** Apuração histórica importada da planilha (somente leitura), por ano×mês. */
export async function historicoTemporada(): Promise<AnoHistorico[]> {
  const linhas = await prisma.apuracaoTemporadaHistorica.findMany({
    orderBy: [{ ano: "asc" }, { mes: "asc" }],
  });
  const porAno = new Map<number, MesHistorico[]>();
  for (const l of linhas) {
    const meses = porAno.get(l.ano) ?? [];
    meses.push({
      mes: l.mes,
      receita: l.receita,
      despesa: l.despesa,
      lucro: l.despesa !== null ? l.receita - l.despesa : null,
    });
    porAno.set(l.ano, meses);
  }
  return [...porAno.entries()].map(([ano, meses]) => {
    const comDespesa = meses.filter((m) => m.despesa !== null);
    return {
      ano,
      meses,
      totalReceita: meses.reduce((s, m) => s + m.receita, 0),
      totalDespesa:
        comDespesa.length > 0
          ? comDespesa.reduce((s, m) => s + (m.despesa ?? 0), 0)
          : null,
      totalLucro:
        comDespesa.length > 0
          ? comDespesa.reduce((s, m) => s + (m.lucro ?? 0), 0)
          : null,
    };
  });
}
