/**
 * Consultas dos relatórios gerenciais (references/05-relatorios-consolidacao.md).
 * Visões DERIVADAS dos recebimentos — nunca tabelas mantidas à mão.
 * Toda comissão/base/total vem das funções canônicas de "@/lib/dominio/comissao".
 * Valores sempre em CENTAVOS (Int).
 */

import { prisma } from "@/lib/db";
import {
  calcularRecebimento,
  comissaoPorEmpreendimento,
} from "@/lib/dominio/comissao";
import { competencia, parseCompetencia } from "@/lib/dominio/normalizacao";

// ---------------------------------------------------------------------------
// Matriz de comissão (aba COMISSÃO): empreendimento × mês
// ---------------------------------------------------------------------------

export interface LinhaMatrizComissao {
  empreendimentoId: string;
  empreendimento: string;
  /** índice 0..11 = JAN..DEZ, em centavos */
  porMes: number[];
  total: number;
}

export interface MatrizComissao {
  ano: number;
  linhas: LinhaMatrizComissao[];
  /** rodapé: total por mês (índice 0..11 = JAN..DEZ) */
  totalPorMes: number[];
  totalGeral: number;
}

export async function matrizComissao(ano: number): Promise<MatrizComissao> {
  const recebimentos = await prisma.recebimento.findMany({
    where: { mesLancamento: { startsWith: `${ano}-` } },
    select: {
      empreendimentoId: true,
      mesLancamento: true,
      valor: true,
      iptu: true,
      cond: true,
      recebido: true,
      taxaComissaoBps: true,
    },
  });

  // Agregação canônica (equivale ao SUMIF da aba COMISSÃO)
  const matriz = comissaoPorEmpreendimento(recebimentos);

  const empreendimentos = await prisma.empreendimento.findMany({
    where: { id: { in: [...matriz.keys()] } },
    select: { id: true, nome: true },
  });
  const nomePorId = new Map(empreendimentos.map((e) => [e.id, e.nome]));

  const linhas: LinhaMatrizComissao[] = [...matriz.entries()]
    .map(([empreendimentoId, porMesMap]) => {
      const porMes = Array.from(
        { length: 12 },
        (_, i) => porMesMap.get(competencia(ano, i + 1)) ?? 0
      );
      return {
        empreendimentoId,
        empreendimento: nomePorId.get(empreendimentoId) ?? "?",
        porMes,
        total: porMes.reduce((a, v) => a + v, 0),
      };
    })
    .sort((a, b) =>
      a.empreendimento.localeCompare(b.empreendimento, "pt-BR")
    );

  const totalPorMes = Array.from({ length: 12 }, (_, i) =>
    linhas.reduce((a, l) => a + l.porMes[i], 0)
  );

  return {
    ano,
    linhas,
    totalPorMes,
    totalGeral: totalPorMes.reduce((a, v) => a + v, 0),
  };
}

// ---------------------------------------------------------------------------
// Resultado consolidado (aba RESULTADO): totais do ano por unidade
// ---------------------------------------------------------------------------

export interface LinhaResultado {
  unidadeId: string;
  empreendimento: string;
  identificacao: string;
  locatario: string | null;
  recebidos: number;
  iptu: number;
  cond: number;
  /** Σ das bases derivadas por lançamento (só lançamentos recebidos) */
  base: number;
  /** Σ das comissões derivadas por lançamento */
  comissao: number;
}

export interface ResultadoConsolidado {
  ano: number;
  linhas: LinhaResultado[];
  totalGeral: Omit<
    LinhaResultado,
    "unidadeId" | "empreendimento" | "identificacao" | "locatario"
  >;
}

export async function resultadoConsolidado(
  ano: number
): Promise<ResultadoConsolidado> {
  const recebimentos = await prisma.recebimento.findMany({
    where: { mesLancamento: { startsWith: `${ano}-` } },
    include: {
      contrato: {
        include: {
          unidade: { include: { empreendimento: true } },
          locatario: true,
        },
      },
    },
    orderBy: { mesLancamento: "asc" },
  });

  const porUnidade = new Map<string, LinhaResultado>();
  for (const r of recebimentos) {
    const unidade = r.contrato.unidade;
    let linha = porUnidade.get(unidade.id);
    if (!linha) {
      porUnidade.set(
        unidade.id,
        (linha = {
          unidadeId: unidade.id,
          empreendimento: unidade.empreendimento.nome,
          identificacao: unidade.identificacao,
          locatario: null,
          recebidos: 0,
          iptu: 0,
          cond: 0,
          base: 0,
          comissao: 0,
        })
      );
    }
    // recebimentos vêm ordenados por mesLancamento: prevalece o locatário
    // mais recente com nome preenchido
    if (r.contrato.locatario) linha.locatario = r.contrato.locatario.nome;

    const { baseCalculo, comissao } = calcularRecebimento(r);
    linha.recebidos += r.recebido ?? 0;
    linha.iptu += r.iptu;
    linha.cond += r.cond;
    linha.base += baseCalculo ?? 0;
    linha.comissao += comissao ?? 0;
  }

  const linhas = [...porUnidade.values()].sort(
    (a, b) =>
      a.empreendimento.localeCompare(b.empreendimento, "pt-BR") ||
      a.identificacao.localeCompare(b.identificacao, "pt-BR", {
        numeric: true,
      })
  );

  const totalGeral = linhas.reduce(
    (acc, l) => ({
      recebidos: acc.recebidos + l.recebidos,
      iptu: acc.iptu + l.iptu,
      cond: acc.cond + l.cond,
      base: acc.base + l.base,
      comissao: acc.comissao + l.comissao,
    }),
    { recebidos: 0, iptu: 0, cond: 0, base: 0, comissao: 0 }
  );

  return { ano, linhas, totalGeral };
}

// ---------------------------------------------------------------------------
// Pendências (inadimplência) do mês de lançamento
// ---------------------------------------------------------------------------

export interface PendenciaDoMes {
  recebimentoId: string;
  empreendimento: string;
  locatario: string | null;
  identificacao: string;
  totalDevido: number;
  diaVencimento: number | null;
  /** dias corridos desde o vencimento (negativo = ainda a vencer); null sem dia */
  diasDesdeVencimento: number | null;
}

/** Lançamentos com totalDevido e sem recebido no mesLancamento, por valor desc. */
export async function pendentesDoMes(mes: string): Promise<PendenciaDoMes[]> {
  const { ano, mes: mesNum } = parseCompetencia(mes);
  const recebimentos = await prisma.recebimento.findMany({
    where: { mesLancamento: mes, recebido: null },
    include: {
      empreendimento: true,
      contrato: { include: { unidade: true, locatario: true } },
    },
  });

  const hoje = new Date();
  const hojeUTC = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());

  const pendencias: PendenciaDoMes[] = [];
  for (const r of recebimentos) {
    const { totalDevido } = calcularRecebimento(r);
    if (totalDevido === null) continue; // nada a cobrar no mês
    const dia = r.contrato.diaVencimento;
    pendencias.push({
      recebimentoId: r.id,
      empreendimento: r.empreendimento.nome,
      locatario: r.contrato.locatario?.nome ?? null,
      identificacao: r.contrato.unidade.identificacao,
      totalDevido,
      diaVencimento: dia,
      diasDesdeVencimento:
        dia === null
          ? null
          : Math.floor((hojeUTC - Date.UTC(ano, mesNum - 1, dia)) / 86400000),
    });
  }
  return pendencias.sort((a, b) => b.totalDevido - a.totalDevido);
}

// ---------------------------------------------------------------------------
// Reajustes do mês
// ---------------------------------------------------------------------------

export interface ContratoAReajustar {
  contratoId: string;
  empreendimento: string;
  identificacao: string;
  locatario: string | null;
  indiceReajuste: string | null;
  valorBase: number;
}

/** Contratos não encerrados cujo mesReajuste é o mês informado. */
export async function contratosAReajustarDoMes(
  mes: string
): Promise<ContratoAReajustar[]> {
  const { mes: mesNum } = parseCompetencia(mes);
  const contratos = await prisma.contrato.findMany({
    where: { mesReajuste: mesNum, status: { not: "encerrado" } },
    include: {
      unidade: { include: { empreendimento: true } },
      locatario: true,
    },
  });
  return contratos
    .map((c) => ({
      contratoId: c.id,
      empreendimento: c.unidade.empreendimento.nome,
      identificacao: c.unidade.identificacao,
      locatario: c.locatario?.nome ?? null,
      indiceReajuste: c.indiceReajuste,
      valorBase: c.valorBase,
    }))
    .sort(
      (a, b) =>
        a.empreendimento.localeCompare(b.empreendimento, "pt-BR") ||
        a.identificacao.localeCompare(b.identificacao, "pt-BR", {
          numeric: true,
        })
    );
}

// ---------------------------------------------------------------------------
// Comissão do mês por empreendimento (tabela compacta do dashboard)
// ---------------------------------------------------------------------------

export interface ComissaoEmpreendimentoMes {
  empreendimentoId: string;
  empreendimento: string;
  comissao: number;
}

export async function comissaoDoMesPorEmpreendimento(
  mes: string
): Promise<ComissaoEmpreendimentoMes[]> {
  const recebimentos = await prisma.recebimento.findMany({
    where: { mesLancamento: mes },
    select: {
      empreendimentoId: true,
      mesLancamento: true,
      valor: true,
      iptu: true,
      cond: true,
      recebido: true,
      taxaComissaoBps: true,
    },
  });
  const matriz = comissaoPorEmpreendimento(recebimentos);
  const empreendimentos = await prisma.empreendimento.findMany({
    where: { id: { in: [...matriz.keys()] } },
    select: { id: true, nome: true },
  });
  const nomePorId = new Map(empreendimentos.map((e) => [e.id, e.nome]));
  return [...matriz.entries()]
    .map(([empreendimentoId, porMes]) => ({
      empreendimentoId,
      empreendimento: nomePorId.get(empreendimentoId) ?? "?",
      comissao: porMes.get(mes) ?? 0,
    }))
    .sort((a, b) => b.comissao - a.comissao);
}

// ---------------------------------------------------------------------------
// KPIs do mês (dashboard)
// ---------------------------------------------------------------------------

export interface KpisDoMes {
  mes: string;
  comissaoMes: number;
  /** comissão acumulada de JAN até o mês, no mesmo ano */
  comissaoAcumuladaAno: number;
  inadimplencia: { quantidade: number; valorDevido: number };
  /** Σ recebido / Σ totalDevido no mês (fração 0..1); null sem cobrança */
  taxaRecebimento: number | null;
  contratosAReajustar: number;
  /** entradas GERAL − saídas AL − saídas CH no mesReferencia */
  saldoCaixaMes: number;
  /** Σ recebimentos − Σ despesas − Σ limpezas de temporada na competência */
  lucroTemporadaMes: number;
}

export async function kpisDoMes(mes: string): Promise<KpisDoMes> {
  const { ano, mes: mesNum } = parseCompetencia(mes);

  const [
    recebimentosAno,
    contratosAReajustar,
    caixa,
    recebTemporada,
    despTemporada,
    limpezas,
  ] = await Promise.all([
    prisma.recebimento.findMany({
      where: { mesLancamento: { gte: competencia(ano, 1), lte: mes } },
      select: {
        mesLancamento: true,
        valor: true,
        iptu: true,
        cond: true,
        recebido: true,
        taxaComissaoBps: true,
      },
    }),
    prisma.contrato.count({
      where: { mesReajuste: mesNum, status: { not: "encerrado" } },
    }),
    prisma.lancamentoCaixa.groupBy({
      by: ["centroCusto", "tipo"],
      where: { mesReferencia: mes },
      _sum: { valor: true },
    }),
    prisma.recebimentoTemporada.aggregate({
      where: { competencia: mes },
      _sum: { valor: true },
    }),
    prisma.despesaTemporada.aggregate({
      where: { competencia: mes },
      _sum: { valor: true },
    }),
    prisma.limpeza.findMany({
      where: { competencia: mes },
      select: { quantidade: true, valorUnitario: true, extraPdl: true },
    }),
  ]);

  let comissaoMes = 0;
  let comissaoAcumuladaAno = 0;
  let pendentes = 0;
  let valorPendente = 0;
  let somaRecebido = 0;
  let somaDevido = 0;

  for (const r of recebimentosAno) {
    const { totalDevido, comissao } = calcularRecebimento(r);
    comissaoAcumuladaAno += comissao ?? 0;
    if (r.mesLancamento !== mes) continue;
    comissaoMes += comissao ?? 0;
    somaDevido += totalDevido ?? 0;
    somaRecebido += r.recebido ?? 0;
    if (totalDevido !== null && r.recebido === null) {
      pendentes += 1;
      valorPendente += totalDevido;
    }
  }

  const somaCaixa = (centroCusto: string, tipo: string) =>
    caixa.find((c) => c.centroCusto === centroCusto && c.tipo === tipo)?._sum
      .valor ?? 0;
  const saldoCaixaMes =
    somaCaixa("GERAL", "ENTRADA") -
    somaCaixa("AL", "SAIDA") -
    somaCaixa("CH", "SAIDA");

  const custoLimpezas = limpezas.reduce(
    (a, l) => a + l.quantidade * l.valorUnitario + l.extraPdl,
    0
  );
  const lucroTemporadaMes =
    (recebTemporada._sum.valor ?? 0) -
    (despTemporada._sum.valor ?? 0) -
    custoLimpezas;

  return {
    mes,
    comissaoMes,
    comissaoAcumuladaAno,
    inadimplencia: { quantidade: pendentes, valorDevido: valorPendente },
    taxaRecebimento: somaDevido > 0 ? somaRecebido / somaDevido : null,
    contratosAReajustar,
    saldoCaixaMes,
    lucroTemporadaMes,
  };
}

// ---------------------------------------------------------------------------
// Mês de referência default (mais recente com lançamentos recebidos)
// ---------------------------------------------------------------------------

export async function mesMaisRecenteComLancamentos(): Promise<string> {
  const comRecebido = await prisma.recebimento.findFirst({
    where: { recebido: { not: null } },
    orderBy: { mesLancamento: "desc" },
    select: { mesLancamento: true },
  });
  if (comRecebido) return comRecebido.mesLancamento;

  const qualquer = await prisma.recebimento.findFirst({
    orderBy: { mesLancamento: "desc" },
    select: { mesLancamento: true },
  });
  if (qualquer) return qualquer.mesLancamento;

  const hoje = new Date();
  return competencia(hoje.getFullYear(), hoje.getMonth() + 1);
}
