/**
 * Consultas do módulo Caixa (livro-caixa CONTA_AC).
 *
 * Modelo: LancamentoCaixa — tipo SAIDA (centro AL|CH, com categoria),
 * ENTRADA (GERAL) e RECEB_DINHEIRO (GERAL; registro paralelo de espécie,
 * que NÃO entra no saldo do mês).
 *
 * Todos os valores em centavos (Int). Meses como "YYYY-MM".
 * Além das visões por mês e por ano, há variantes por PERÍODO (lista de
 * competências vinda de parsePeriodo) na seção ao fim do arquivo.
 */
import { prisma } from "@/lib/db";
import type { LancamentoCaixa } from "@prisma/client";
import { competencia } from "@/lib/dominio/normalizacao";

export const SEM_CATEGORIA = "SEM CATEGORIA";

export type GrupoCategoria = {
  categoria: string;
  lancamentos: LancamentoCaixa[];
  subtotal: number;
};

export type BlocoSaidas = {
  grupos: GrupoCategoria[];
  total: number;
};

export type BlocoLista = {
  lancamentos: LancamentoCaixa[];
  total: number;
};

export type LancamentosDoMes = {
  saidasAL: BlocoSaidas;
  saidasCH: BlocoSaidas;
  entradas: BlocoLista;
  recebimentosDinheiro: BlocoLista;
};

export type ConsolidacaoMes = {
  despesaAL: number;
  despesaCH: number;
  receita: number;
  recebDinheiro: number; // informativo — não entra no saldo
  saldo: number; // receita − despesaAL − despesaCH
};

export type LinhaAnual = {
  mes: string; // "YYYY-MM"
  temLancamentos: boolean;
  despesaAL: number;
  despesaCH: number;
  receita: number;
  recebDinheiro: number;
  saldo: number;
  acumulado: number;
};

export type ConsolidacaoAnual = {
  ano: number;
  linhas: LinhaAnual[]; // sempre 12 linhas (JAN..DEZ)
  totais: ConsolidacaoMes;
};

/** Mês (YYYY-MM) com lançamentos mais recente; fallback: mês corrente (só quando a tabela está vazia). */
export async function mesMaisRecente(): Promise<string> {
  const ultimo = await prisma.lancamentoCaixa.findFirst({
    orderBy: { mesReferencia: "desc" },
    select: { mesReferencia: true },
  });
  if (ultimo) return ultimo.mesReferencia;
  const hoje = new Date();
  return competencia(hoje.getFullYear(), hoje.getMonth() + 1);
}

function somar(ls: LancamentoCaixa[]): number {
  return ls.reduce((acc, l) => acc + l.valor, 0);
}

function agruparPorCategoria(ls: LancamentoCaixa[]): BlocoSaidas {
  const mapa = new Map<string, LancamentoCaixa[]>();
  for (const l of ls) {
    const cat = l.categoria ?? SEM_CATEGORIA;
    const lista = mapa.get(cat);
    if (lista) lista.push(l);
    else mapa.set(cat, [l]);
  }
  const grupos: GrupoCategoria[] = [...mapa.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
    .map(([categoria, lancamentos]) => ({
      categoria,
      lancamentos,
      subtotal: somar(lancamentos),
    }));
  return { grupos, total: somar(ls) };
}

function montarBlocos(todos: LancamentoCaixa[]): LancamentosDoMes {
  const saidasAL = todos.filter((l) => l.tipo === "SAIDA" && l.centroCusto === "AL");
  const saidasCH = todos.filter((l) => l.tipo === "SAIDA" && l.centroCusto === "CH");
  const entradas = todos.filter((l) => l.tipo === "ENTRADA");
  const recebDinheiro = todos.filter((l) => l.tipo === "RECEB_DINHEIRO");
  return {
    saidasAL: agruparPorCategoria(saidasAL),
    saidasCH: agruparPorCategoria(saidasCH),
    entradas: { lancamentos: entradas, total: somar(entradas) },
    recebimentosDinheiro: { lancamentos: recebDinheiro, total: somar(recebDinheiro) },
  };
}

/** Lançamentos do mês agrupados nos 4 blocos do livro-caixa. */
export async function lancamentosDoMes(mes: string): Promise<LancamentosDoMes> {
  const todos = await prisma.lancamentoCaixa.findMany({
    where: { mesReferencia: mes },
    orderBy: [{ data: "asc" }],
  });
  return montarBlocos(todos);
}

type SomaPorGrupo = {
  centroCusto: string;
  tipo: string;
  soma: number;
};

function consolidar(grupos: SomaPorGrupo[]): ConsolidacaoMes {
  let despesaAL = 0;
  let despesaCH = 0;
  let receita = 0;
  let recebDinheiro = 0;
  for (const g of grupos) {
    if (g.tipo === "SAIDA" && g.centroCusto === "AL") despesaAL += g.soma;
    else if (g.tipo === "SAIDA" && g.centroCusto === "CH") despesaCH += g.soma;
    else if (g.tipo === "ENTRADA") receita += g.soma;
    else if (g.tipo === "RECEB_DINHEIRO") recebDinheiro += g.soma;
  }
  return {
    despesaAL,
    despesaCH,
    receita,
    recebDinheiro,
    saldo: receita - despesaAL - despesaCH,
  };
}

/** Consolidação do mês: despesa AL, despesa CH, receita e saldo (receita − despesas). */
export async function consolidacaoDoMes(mes: string): Promise<ConsolidacaoMes> {
  const grupos = await prisma.lancamentoCaixa.groupBy({
    by: ["centroCusto", "tipo"],
    where: { mesReferencia: mes },
    _sum: { valor: true },
  });
  return consolidar(
    grupos.map((g) => ({
      centroCusto: g.centroCusto,
      tipo: g.tipo,
      soma: g._sum.valor ?? 0,
    })),
  );
}

type GrupoMensal = {
  mesReferencia: string;
  centroCusto: string;
  tipo: string;
  _sum: { valor: number | null };
};

function mapaPorMes(grupos: GrupoMensal[]): Map<string, SomaPorGrupo[]> {
  const porMes = new Map<string, SomaPorGrupo[]>();
  for (const g of grupos) {
    const lista = porMes.get(g.mesReferencia) ?? [];
    lista.push({ centroCusto: g.centroCusto, tipo: g.tipo, soma: g._sum.valor ?? 0 });
    porMes.set(g.mesReferencia, lista);
  }
  return porMes;
}

/** Uma linha por competência de `meses`, com saldo acumulado do 1º ao último. */
function linhasComAcumulado(
  meses: string[],
  porMes: Map<string, SomaPorGrupo[]>,
): LinhaAnual[] {
  const linhas: LinhaAnual[] = [];
  let acumulado = 0;
  for (const mes of meses) {
    const doMes = porMes.get(mes);
    const c = consolidar(doMes ?? []);
    acumulado += c.saldo;
    linhas.push({
      mes,
      temLancamentos: doMes !== undefined,
      ...c,
      acumulado,
    });
  }
  return linhas;
}

function somarTotais(linhas: LinhaAnual[]): ConsolidacaoMes {
  return linhas.reduce<ConsolidacaoMes>(
    (acc, l) => ({
      despesaAL: acc.despesaAL + l.despesaAL,
      despesaCH: acc.despesaCH + l.despesaCH,
      receita: acc.receita + l.receita,
      recebDinheiro: acc.recebDinheiro + l.recebDinheiro,
      saldo: acc.saldo + l.saldo,
    }),
    { despesaAL: 0, despesaCH: 0, receita: 0, recebDinheiro: 0, saldo: 0 },
  );
}

/** Resumo anual mês a mês (12 linhas), com saldo acumulado e totais do ano. */
export async function consolidacaoAnual(ano: number): Promise<ConsolidacaoAnual> {
  const grupos = await prisma.lancamentoCaixa.groupBy({
    by: ["mesReferencia", "centroCusto", "tipo"],
    where: { mesReferencia: { startsWith: `${ano}-` } },
    _sum: { valor: true },
  });
  const meses = Array.from({ length: 12 }, (_, i) => competencia(ano, i + 1));
  const linhas = linhasComAcumulado(meses, mapaPorMes(grupos));
  return { ano, linhas, totais: somarTotais(linhas) };
}

// ---------------------------------------------------------------------------
// Consultas por PERÍODO (lista de competências "YYYY-MM" vinda de parsePeriodo)
// ---------------------------------------------------------------------------
// Competências comparam certo como string, então a janela [meses[0], último]
// vira mesReferencia: { gte, lte }. Mesmas regras canônicas do modo mensal,
// agregadas sobre a janela inteira. Valores em centavos.

export type ConsolidacaoPeriodo = {
  /** competências da janela, em ordem crescente (linhas alinhadas a elas) */
  meses: string[];
  linhas: LinhaAnual[];
  totais: ConsolidacaoMes;
};

function janela(meses: string[]): { gte: string; lte: string } {
  return { gte: meses[0], lte: meses[meses.length - 1] };
}

/** Lançamentos da janela inteira nos 4 blocos (ordem: competência, depois data). */
export async function lancamentosDoPeriodo(
  meses: string[],
): Promise<LancamentosDoMes> {
  const todos = await prisma.lancamentoCaixa.findMany({
    where: { mesReferencia: janela(meses) },
    orderBy: [{ mesReferencia: "asc" }, { data: "asc" }],
  });
  return montarBlocos(todos);
}

/** Consolidação agregada da janela: despesa AL, despesa CH, receita e saldo. */
export async function consolidacaoDoPeriodo(
  meses: string[],
): Promise<ConsolidacaoMes> {
  const grupos = await prisma.lancamentoCaixa.groupBy({
    by: ["centroCusto", "tipo"],
    where: { mesReferencia: janela(meses) },
    _sum: { valor: true },
  });
  return consolidar(
    grupos.map((g) => ({
      centroCusto: g.centroCusto,
      tipo: g.tipo,
      soma: g._sum.valor ?? 0,
    })),
  );
}

/**
 * Resumo mês a mês da janela (uma linha por competência, mesmo cruzando anos),
 * com saldo acumulado DENTRO da janela e totais do período.
 */
export async function consolidacaoMensalDoPeriodo(
  meses: string[],
): Promise<ConsolidacaoPeriodo> {
  const grupos = await prisma.lancamentoCaixa.groupBy({
    by: ["mesReferencia", "centroCusto", "tipo"],
    where: { mesReferencia: janela(meses) },
    _sum: { valor: true },
  });
  const linhas = linhasComAcumulado(meses, mapaPorMes(grupos));
  return { meses, linhas, totais: somarTotais(linhas) };
}

/**
 * Categorias de saída por centro de custo, para o select do formulário:
 * legenda (CategoriaCentroCusto) ∪ categorias já usadas em lançamentos do
 * centro (os dados migrados usam nomes que nem sempre constam na legenda —
 * a união garante que editar um lançamento antigo preserve a categoria).
 */
export async function categoriasPorCentro(): Promise<{ AL: string[]; CH: string[] }> {
  const [legenda, usadas] = await Promise.all([
    prisma.categoriaCentroCusto.findMany({
      select: { centroCusto: true, nome: true },
    }),
    prisma.lancamentoCaixa.findMany({
      where: { tipo: "SAIDA", categoria: { not: null } },
      distinct: ["centroCusto", "categoria"],
      select: { centroCusto: true, categoria: true },
    }),
  ]);
  const AL = new Set<string>();
  const CH = new Set<string>();
  for (const c of legenda) {
    if (c.centroCusto === "AL") AL.add(c.nome);
    else if (c.centroCusto === "CH") CH.add(c.nome);
  }
  for (const u of usadas) {
    if (!u.categoria) continue;
    if (u.centroCusto === "AL") AL.add(u.categoria);
    else if (u.centroCusto === "CH") CH.add(u.categoria);
  }
  const ordenar = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return { AL: ordenar(AL), CH: ordenar(CH) };
}

/** Busca um lançamento pelo id (para a tela de edição). */
export async function buscarLancamento(id: string): Promise<LancamentoCaixa | null> {
  return prisma.lancamentoCaixa.findUnique({ where: { id } });
}
