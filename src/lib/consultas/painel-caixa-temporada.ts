/**
 * Consultas dos painéis analíticos /paineis/caixa e /paineis/temporada.
 *
 * Reutiliza as consultas canônicas já existentes — consolidacaoAnual e
 * mesMaisRecente (caixa), historicoTemporada (temporada) e comissaoTotal
 * (regra canônica de comissão) — e concentra aqui apenas as agregações
 * específicas dos painéis: despesas por categoria no ano, maiores saídas e
 * o comparativo anual de receita do Airbnb (histórico da planilha + linhas
 * agregadas do núcleo).
 *
 * Todos os valores em centavos (Int). Meses como "YYYY-MM".
 */
import { prisma } from "@/lib/db";
import type { LancamentoCaixa } from "@prisma/client";
import { comissaoTotal } from "@/lib/dominio/comissao";
import { parseCompetencia } from "@/lib/dominio/normalizacao";
import {
  consolidacaoAnual,
  mesMaisRecente,
  SEM_CATEGORIA,
  type ConsolidacaoAnual,
} from "@/lib/consultas/caixa";
import { historicoTemporada } from "@/lib/consultas/temporada";

// ---------------------------------------------------------------------------
// /paineis/caixa
// ---------------------------------------------------------------------------

export type CategoriaAnual = {
  categoria: string;
  /** Σ SAIDA da categoria no ano (AL + CH juntos). */
  total: number;
  al: number;
  ch: number;
};

export type PainelCaixa = {
  ano: number;
  /** 12 linhas mensais + totais — mesma consulta da página /caixa/ano. */
  resumo: ConsolidacaoAnual;
  /** Saídas do ano agrupadas por categoria, ordenadas da maior para a menor. */
  categorias: CategoriaAnual[];
  /** Top lançamentos de SAIDA do ano, por valor decrescente. */
  maioresSaidas: LancamentoCaixa[];
};

/** Ano default do painel: o do mês com lançamentos mais recente. */
export async function anoPadraoCaixa(): Promise<number> {
  return parseCompetencia(await mesMaisRecente()).ano;
}

export async function painelCaixa(ano: number): Promise<PainelCaixa> {
  const [resumo, porCategoria, maioresSaidas] = await Promise.all([
    consolidacaoAnual(ano),
    prisma.lancamentoCaixa.groupBy({
      by: ["categoria", "centroCusto"],
      where: { tipo: "SAIDA", mesReferencia: { startsWith: `${ano}-` } },
      _sum: { valor: true },
    }),
    prisma.lancamentoCaixa.findMany({
      where: { tipo: "SAIDA", mesReferencia: { startsWith: `${ano}-` } },
      orderBy: { valor: "desc" },
      take: 12,
    }),
  ]);

  const mapa = new Map<string, CategoriaAnual>();
  for (const g of porCategoria) {
    const nome = g.categoria ?? SEM_CATEGORIA;
    const soma = g._sum.valor ?? 0;
    let c = mapa.get(nome);
    if (!c) mapa.set(nome, (c = { categoria: nome, total: 0, al: 0, ch: 0 }));
    c.total += soma;
    if (g.centroCusto === "AL") c.al += soma;
    else if (g.centroCusto === "CH") c.ch += soma;
  }
  const categorias = [...mapa.values()].sort(
    (a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria, "pt-BR"),
  );

  return { ano, resumo, categorias, maioresSaidas };
}

// ---------------------------------------------------------------------------
// /paineis/temporada
// ---------------------------------------------------------------------------

export type OrigemAnoTemporada = "historico" | "nucleo";

export type AnoTemporada = {
  ano: number;
  /**
   * historico = apuracaoTemporadaHistorica (planilha AIRBNB importada);
   * nucleo = Σ recebido das linhas agregadas (recebimento.origemAgregada)
   * por mesLancamento — vale até o módulo Temporada assumir a apuração.
   */
  origem: OrigemAnoTemporada;
  /** índice 0 = JAN (centavos). */
  receitaPorMes: number[];
  totalReceita: number;
  /** null = despesa desconhecida (planilha sem rótulo, ex.: 2025; ou ano do núcleo). */
  totalDespesa: number | null;
  /** null quando a despesa é desconhecida. */
  totalLucro: number | null;
};

export type PainelTemporada = {
  /** Anos em ordem crescente (histórico + ano corrente do núcleo). */
  anos: AnoTemporada[];
  /** Ano corrente apurado pelo núcleo; null se não há linha agregada. */
  anoNucleo: number | null;
  /** Σ recebido das linhas agregadas do anoNucleo (receita "até agora"). */
  receitaAnoNucleo: number;
  /** Comissão do empreendimento AIRBNB no anoNucleo (regra canônica). */
  comissaoAirbnbAnoNucleo: number;
  /** Mês de maior receita entre todos os anos do comparativo. */
  melhorMes: { ano: number; mes: number; receita: number } | null;
  /** Lucro médio por mês nos anos com despesa conhecida (2023–2024). */
  lucroMedio: { valorMensal: number; anos: number[]; meses: number } | null;
};

/** Ano mais recente com linha agregada do Airbnb no núcleo (prefere as já recebidas). */
async function anoNucleoTemporada(): Promise<number | null> {
  const comRecebido = await prisma.recebimento.findFirst({
    where: { origemAgregada: true, recebido: { not: null } },
    orderBy: { mesLancamento: "desc" },
    select: { mesLancamento: true },
  });
  if (comRecebido) return parseCompetencia(comRecebido.mesLancamento).ano;
  const qualquer = await prisma.recebimento.findFirst({
    where: { origemAgregada: true },
    orderBy: { mesLancamento: "desc" },
    select: { mesLancamento: true },
  });
  return qualquer ? parseCompetencia(qualquer.mesLancamento).ano : null;
}

export async function painelTemporada(): Promise<PainelTemporada> {
  const [historico, anoNucleo] = await Promise.all([
    historicoTemporada(),
    anoNucleoTemporada(),
  ]);

  // Anos do histórico da planilha (2023–2025)
  const anos: AnoTemporada[] = historico.map((a) => {
    const receitaPorMes = Array<number>(12).fill(0);
    for (const m of a.meses) receitaPorMes[m.mes - 1] = m.receita;
    return {
      ano: a.ano,
      origem: "historico" as const,
      receitaPorMes,
      totalReceita: a.totalReceita,
      totalDespesa: a.totalDespesa,
      totalLucro: a.totalLucro,
    };
  });

  // Ano corrente: linhas agregadas AIRBNB/TODOS do núcleo (Σ recebido por mês)
  let receitaAnoNucleo = 0;
  let comissaoAirbnbAnoNucleo = 0;
  if (anoNucleo !== null) {
    const [agregadas, recebsAirbnb] = await Promise.all([
      prisma.recebimento.findMany({
        where: {
          origemAgregada: true,
          mesLancamento: { startsWith: `${anoNucleo}-` },
        },
        select: { mesLancamento: true, recebido: true },
      }),
      prisma.recebimento.findMany({
        where: {
          mesLancamento: { startsWith: `${anoNucleo}-` },
          empreendimento: { nome: "AIRBNB" },
        },
        select: {
          valor: true,
          iptu: true,
          cond: true,
          recebido: true,
          taxaComissaoBps: true,
        },
      }),
    ]);

    const receitaPorMes = Array<number>(12).fill(0);
    for (const r of agregadas) {
      const { mes } = parseCompetencia(r.mesLancamento);
      receitaPorMes[mes - 1] += r.recebido ?? 0;
    }
    receitaAnoNucleo = receitaPorMes.reduce((a, v) => a + v, 0);
    comissaoAirbnbAnoNucleo = comissaoTotal(recebsAirbnb);

    // só acrescenta se o ano ainda não veio do histórico (não duplica)
    if (!anos.some((a) => a.ano === anoNucleo)) {
      anos.push({
        ano: anoNucleo,
        origem: "nucleo",
        receitaPorMes,
        totalReceita: receitaAnoNucleo,
        totalDespesa: null,
        totalLucro: null,
      });
    }
  }
  anos.sort((a, b) => a.ano - b.ano);

  // Melhor mês (receita) entre todos os anos do comparativo
  let melhorMes: PainelTemporada["melhorMes"] = null;
  for (const a of anos) {
    a.receitaPorMes.forEach((receita, i) => {
      if (receita > 0 && (melhorMes === null || receita > melhorMes.receita)) {
        melhorMes = { ano: a.ano, mes: i + 1, receita };
      }
    });
  }

  // Lucro médio mensal dos anos com despesa conhecida (2023–2024)
  let somaLucro = 0;
  let mesesComLucro = 0;
  const anosComDespesa: number[] = [];
  for (const a of historico) {
    if (a.totalLucro === null) continue;
    anosComDespesa.push(a.ano);
    for (const m of a.meses) {
      if (m.lucro !== null) {
        somaLucro += m.lucro;
        mesesComLucro += 1;
      }
    }
  }
  const lucroMedio =
    mesesComLucro > 0
      ? {
          valorMensal: Math.round(somaLucro / mesesComLucro),
          anos: anosComDespesa,
          meses: mesesComLucro,
        }
      : null;

  return {
    anos,
    anoNucleo,
    receitaAnoNucleo,
    comissaoAirbnbAnoNucleo,
    melhorMes,
    lucroMedio,
  };
}
