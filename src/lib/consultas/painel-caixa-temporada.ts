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
 * Cada painel tem também a variante por PERÍODO (janela de competências vinda
 * de parsePeriodo): competências "YYYY-MM" comparam certo como string, então a
 * janela é sempre { gte: meses[0], lte: meses[último] }.
 *
 * Todos os valores em centavos (Int). Meses como "YYYY-MM".
 */
import { prisma } from "@/lib/db";
import type { LancamentoCaixa } from "@prisma/client";
import { comissaoTotal } from "@/lib/dominio/comissao";
import { competencia, parseCompetencia } from "@/lib/dominio/normalizacao";
import {
  consolidacaoAnual,
  mesMaisRecente,
  SEM_CATEGORIA,
  type ConsolidacaoAnual,
  type ConsolidacaoMes,
  type LinhaAnual,
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

/** Agrega o groupBy categoria×centro no ranking de categorias (maior→menor). */
function agruparCategorias(
  porCategoria: {
    categoria: string | null;
    centroCusto: string;
    _sum: { valor: number | null };
  }[],
): CategoriaAnual[] {
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
  return [...mapa.values()].sort(
    (a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria, "pt-BR"),
  );
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

  return { ano, resumo, categorias: agruparCategorias(porCategoria), maioresSaidas };
}

// ---------------------------------------------------------------------------
// /paineis/caixa — modo PERÍODO
// ---------------------------------------------------------------------------

export type PainelCaixaPeriodo = {
  /** Competências da janela, em ordem crescente. */
  meses: string[];
  /** Uma linha por competência da janela, com saldo acumulado dentro dela. */
  linhas: LinhaAnual[];
  totais: ConsolidacaoMes;
  /** Saídas da janela agrupadas por categoria, da maior para a menor. */
  categorias: CategoriaAnual[];
  /** Top lançamentos de SAIDA da janela, por valor decrescente. */
  maioresSaidas: LancamentoCaixa[];
};

/** Mesmas agregações de painelCaixa, restritas à janela de competências. */
export async function painelCaixaPeriodo(
  meses: string[],
): Promise<PainelCaixaPeriodo> {
  const janela = { gte: meses[0], lte: meses[meses.length - 1] };
  const [grupos, porCategoria, maioresSaidas] = await Promise.all([
    prisma.lancamentoCaixa.groupBy({
      by: ["mesReferencia", "centroCusto", "tipo"],
      where: { mesReferencia: janela },
      _sum: { valor: true },
    }),
    prisma.lancamentoCaixa.groupBy({
      by: ["categoria", "centroCusto"],
      where: { tipo: "SAIDA", mesReferencia: janela },
      _sum: { valor: true },
    }),
    prisma.lancamentoCaixa.findMany({
      where: { tipo: "SAIDA", mesReferencia: janela },
      orderBy: { valor: "desc" },
      take: 12,
    }),
  ]);

  const porMes = new Map<
    string,
    { despesaAL: number; despesaCH: number; receita: number; recebDinheiro: number }
  >();
  for (const g of grupos) {
    let c = porMes.get(g.mesReferencia);
    if (!c) {
      porMes.set(
        g.mesReferencia,
        (c = { despesaAL: 0, despesaCH: 0, receita: 0, recebDinheiro: 0 }),
      );
    }
    const soma = g._sum.valor ?? 0;
    if (g.tipo === "SAIDA" && g.centroCusto === "AL") c.despesaAL += soma;
    else if (g.tipo === "SAIDA" && g.centroCusto === "CH") c.despesaCH += soma;
    else if (g.tipo === "ENTRADA") c.receita += soma;
    else if (g.tipo === "RECEB_DINHEIRO") c.recebDinheiro += soma;
  }

  let acumulado = 0;
  const linhas: LinhaAnual[] = meses.map((mes) => {
    const c = porMes.get(mes);
    const saldo = (c?.receita ?? 0) - (c?.despesaAL ?? 0) - (c?.despesaCH ?? 0);
    acumulado += saldo;
    return {
      mes,
      temLancamentos: c !== undefined,
      despesaAL: c?.despesaAL ?? 0,
      despesaCH: c?.despesaCH ?? 0,
      receita: c?.receita ?? 0,
      recebDinheiro: c?.recebDinheiro ?? 0,
      saldo,
      acumulado,
    };
  });

  const totais = linhas.reduce<ConsolidacaoMes>(
    (acc, l) => ({
      despesaAL: acc.despesaAL + l.despesaAL,
      despesaCH: acc.despesaCH + l.despesaCH,
      receita: acc.receita + l.receita,
      recebDinheiro: acc.recebDinheiro + l.recebDinheiro,
      saldo: acc.saldo + l.saldo,
    }),
    { despesaAL: 0, despesaCH: 0, receita: 0, recebDinheiro: 0, saldo: 0 },
  );

  return {
    meses,
    linhas,
    totais,
    categorias: agruparCategorias(porCategoria),
    maioresSaidas,
  };
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

// ---------------------------------------------------------------------------
// /paineis/temporada — modo PERÍODO
// ---------------------------------------------------------------------------

export type MesTemporadaPeriodo = {
  /** Competência "YYYY-MM". */
  mes: string;
  /**
   * De onde veio o número do mês: historico = planilha AIRBNB importada
   * (ApuracaoTemporadaHistorica); nucleo = linhas agregadas de Recebimentos;
   * null = nenhuma fonte tem o mês (entra como zero na soma).
   * Quando as duas fontes têm o mesmo mês, vale a planilha (ano fechado).
   */
  origem: OrigemAnoTemporada | null;
  receita: number;
  /** null = despesa desconhecida (núcleo, ou planilha sem rótulo, ex.: 2025). */
  despesa: number | null;
  /** null quando a despesa é desconhecida. */
  lucro: number | null;
};

export type PainelTemporadaPeriodo = {
  meses: string[];
  /** Uma linha por competência da janela, na ordem de `meses`. */
  linhas: MesTemporadaPeriodo[];
  totalReceita: number;
  /** Σ dos meses com despesa conhecida; null se nenhum mês da janela tem. */
  totalDespesa: number | null;
  /** Σ receita − despesa SÓ dos meses com despesa conhecida; null se nenhum. */
  totalLucro: number | null;
  /** Contagens por origem — para o "i" explicar a mistura de fontes. */
  mesesHistorico: number;
  mesesNucleo: number;
  mesesSemDado: number;
  mesesComDespesa: number;
  /**
   * Comissão do empreendimento AIRBNB na janela (regra canônica), calculada
   * SÓ sobre os recebimentos lançados no núcleo — a planilha histórica não
   * tem recebimentos individuais para aplicar a regra.
   */
  comissaoAirbnb: number;
  /** Mês de maior receita dentro da janela. */
  melhorMes: { mes: string; receita: number } | null;
};

/**
 * Recorte da temporada à janela de competências, combinando histórico da
 * planilha e núcleo mês a mês: cada competência usa a melhor fonte disponível
 * (planilha vence quando as duas têm o mês — ano fechado é mais confiável).
 */
export async function painelTemporadaPeriodo(
  meses: string[],
): Promise<PainelTemporadaPeriodo> {
  const janela = { gte: meses[0], lte: meses[meses.length - 1] };
  const anosJanela = [...new Set(meses.map((m) => parseCompetencia(m).ano))];

  const [historicoLinhas, agregadas, recebsAirbnb] = await Promise.all([
    prisma.apuracaoTemporadaHistorica.findMany({
      where: { ano: { in: anosJanela } },
      select: { ano: true, mes: true, receita: true, despesa: true },
    }),
    prisma.recebimento.findMany({
      where: { origemAgregada: true, mesLancamento: janela },
      select: { mesLancamento: true, recebido: true },
    }),
    prisma.recebimento.findMany({
      where: { mesLancamento: janela, empreendimento: { nome: "AIRBNB" } },
      select: {
        valor: true,
        iptu: true,
        cond: true,
        recebido: true,
        taxaComissaoBps: true,
      },
    }),
  ]);

  const hist = new Map<string, { receita: number; despesa: number | null }>();
  for (const l of historicoLinhas) {
    hist.set(competencia(l.ano, l.mes), { receita: l.receita, despesa: l.despesa });
  }
  const nucleo = new Map<string, number>();
  for (const r of agregadas) {
    nucleo.set(r.mesLancamento, (nucleo.get(r.mesLancamento) ?? 0) + (r.recebido ?? 0));
  }

  const linhas: MesTemporadaPeriodo[] = meses.map((mes) => {
    const h = hist.get(mes);
    if (h) {
      return {
        mes,
        origem: "historico" as const,
        receita: h.receita,
        despesa: h.despesa,
        lucro: h.despesa !== null ? h.receita - h.despesa : null,
      };
    }
    const n = nucleo.get(mes);
    if (n !== undefined) {
      return { mes, origem: "nucleo" as const, receita: n, despesa: null, lucro: null };
    }
    return { mes, origem: null, receita: 0, despesa: null, lucro: null };
  });

  const comDespesa = linhas.filter((l) => l.despesa !== null);
  let melhorMes: PainelTemporadaPeriodo["melhorMes"] = null;
  for (const l of linhas) {
    if (l.receita > 0 && (melhorMes === null || l.receita > melhorMes.receita)) {
      melhorMes = { mes: l.mes, receita: l.receita };
    }
  }

  return {
    meses,
    linhas,
    totalReceita: linhas.reduce((s, l) => s + l.receita, 0),
    totalDespesa:
      comDespesa.length > 0
        ? comDespesa.reduce((s, l) => s + (l.despesa ?? 0), 0)
        : null,
    totalLucro:
      comDespesa.length > 0
        ? comDespesa.reduce((s, l) => s + (l.lucro ?? 0), 0)
        : null,
    mesesHistorico: linhas.filter((l) => l.origem === "historico").length,
    mesesNucleo: linhas.filter((l) => l.origem === "nucleo").length,
    mesesSemDado: linhas.filter((l) => l.origem === null).length,
    mesesComDespesa: comDespesa.length,
    comissaoAirbnb: comissaoTotal(recebsAirbnb),
    melhorMes,
  };
}
