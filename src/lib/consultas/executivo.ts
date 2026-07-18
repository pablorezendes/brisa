/**
 * Consultas do dashboard executivo (/executivo).
 * Reúne TODOS os KPIs de references/05-relatorios-consolidacao.md:
 * comissão mês/acumulada, inadimplência, taxa de recebimento, ticket médio
 * por empreendimento e evolução, lucro de temporada vs comissão AIRBNB,
 * saldo de caixa e contratos a reajustar.
 */
import { prisma } from "@/lib/db";
import { calcularRecebimento } from "@/lib/dominio/comissao";
import { competencia, parseCompetencia } from "@/lib/dominio/normalizacao";

export interface LinhaMensal {
  mes: string; // "YYYY-MM"
  devido: number;
  recebido: number;
  comissao: number;
  pendentes: number;
  pendenteValor: number;
}

export interface CaixaMensal {
  mes: string;
  receita: number;
  despesaAL: number;
  despesaCH: number;
  dinheiro: number;
  saldo: number;
}

export interface EmpreendimentoResumo {
  id: string;
  nome: string;
  comissaoMes: number;
  comissaoAno: number; // YTD até o mês selecionado
  recebidoMes: number;
  ticketMedioMes: number | null;
  serieComissao: number[]; // por mês, 1..último mês com dados
}

export interface Pendente {
  empreendimento: string;
  locatario: string;
  localizacao: string;
  totalDevido: number;
  diasAtraso: number | null;
}

export interface Reajuste {
  empreendimento: string;
  localizacao: string;
  locatario: string;
  valorBase: number;
}

export interface DadosExecutivo {
  mes: string;
  ano: number;
  ultimoMesComDados: number; // 1..12
  mesFechado: boolean;
  // KPIs do mês
  comissaoMes: number;
  comissaoAcumuladaAno: number; // YTD
  devidoMes: number;
  recebidoMes: number;
  taxaRecebimento: number | null; // 0..1
  inadimplentesQtde: number;
  inadimplentesValor: number;
  saldoCaixaMes: number;
  caixaMes: CaixaMensal | null;
  lucroTemporadaMes: number | null; // null = módulo sem lançamentos no mês
  receitaTemporadaMes: number;
  despesaTemporadaMes: number;
  comissaoAirbnbMes: number;
  // séries do ano
  porMes: LinhaMensal[];
  caixaPorMes: CaixaMensal[];
  porEmpreendimento: EmpreendimentoResumo[];
  pendentesDoMes: Pendente[];
  reajustesDoMes: Reajuste[];
}

/**
 * Mês default: o último mesLancamento com recebimento REGISTRADO (a planilha
 * pré-preenche devidos até dezembro; o mês operacional é o último com entrada).
 */
export async function mesPadrao(): Promise<string> {
  const ultimo = await prisma.recebimento.findFirst({
    where: { recebido: { not: null } },
    orderBy: { mesLancamento: "desc" },
    select: { mesLancamento: true },
  });
  if (ultimo) return ultimo.mesLancamento;
  const qualquer = await prisma.recebimento.findFirst({
    orderBy: { mesLancamento: "desc" },
    select: { mesLancamento: true },
  });
  if (qualquer) return qualquer.mesLancamento;
  const hoje = new Date();
  return competencia(hoje.getFullYear(), hoje.getMonth() + 1);
}

export async function dadosExecutivos(mes: string): Promise<DadosExecutivo> {
  const { ano, mes: mesNum } = parseCompetencia(mes);

  const [recebs, caixa, fechamento, reajustes, recebT, despT, limpT] =
    await Promise.all([
      prisma.recebimento.findMany({
        where: { mesLancamento: { startsWith: `${ano}-` } },
        include: {
          empreendimento: true,
          contrato: { include: { unidade: true, locatario: true } },
        },
      }),
      prisma.lancamentoCaixa.findMany({
        where: { mesReferencia: { startsWith: `${ano}-` } },
      }),
      prisma.fechamentoMensal.findUnique({ where: { mesLancamento: mes } }),
      prisma.contrato.findMany({
        where: { status: "ativo", mesReajuste: mesNum },
        include: {
          unidade: { include: { empreendimento: true } },
          locatario: true,
        },
      }),
      prisma.recebimentoTemporada.findMany({ where: { competencia: mes } }),
      prisma.despesaTemporada.findMany({ where: { competencia: mes } }),
      prisma.limpeza.findMany({ where: { competencia: mes } }),
    ]);

  // ---------- séries mensais do núcleo ----------
  const porMes: LinhaMensal[] = [];
  for (let m = 1; m <= 12; m++) {
    porMes.push({
      mes: competencia(ano, m),
      devido: 0,
      recebido: 0,
      comissao: 0,
      pendentes: 0,
      pendenteValor: 0,
    });
  }
  interface Agregado {
    id: string;
    nome: string;
    comissaoPorMes: number[]; // índice 0 = JAN
    recebidoMes: number;
    linhasRecebidasMes: number;
  }
  const porEmp = new Map<string, Agregado>();
  const pendentesDoMes: Pendente[] = [];
  const hoje = new Date();

  for (const r of recebs) {
    const { mes: m } = parseCompetencia(r.mesLancamento);
    const linha = porMes[m - 1];
    const calc = calcularRecebimento({
      valor: r.valor,
      iptu: r.iptu,
      cond: r.cond,
      recebido: r.recebido,
      taxaComissaoBps: r.taxaComissaoBps,
    });
    linha.devido += calc.totalDevido ?? 0;
    linha.recebido += r.recebido ?? 0;
    linha.comissao += calc.comissao ?? 0;

    let agg = porEmp.get(r.empreendimentoId);
    if (!agg) {
      agg = {
        id: r.empreendimentoId,
        nome: r.empreendimento.nome,
        comissaoPorMes: Array(12).fill(0),
        recebidoMes: 0,
        linhasRecebidasMes: 0,
      };
      porEmp.set(r.empreendimentoId, agg);
    }
    agg.comissaoPorMes[m - 1] += calc.comissao ?? 0;

    const pendente = calc.totalDevido !== null && r.recebido === null;
    if (pendente) {
      linha.pendentes += 1;
      linha.pendenteValor += calc.totalDevido ?? 0;
    }

    if (r.mesLancamento === mes) {
      if (r.recebido !== null) {
        agg.recebidoMes += r.recebido;
        agg.linhasRecebidasMes += 1;
      }
      if (pendente) {
        let diasAtraso: number | null = null;
        const diaVenc = r.contrato.diaVencimento;
        if (diaVenc) {
          const venc = new Date(ano, mesNum - 1, diaVenc);
          const dias = Math.floor(
            (hoje.getTime() - venc.getTime()) / 86_400_000
          );
          diasAtraso = dias > 0 ? dias : null;
        }
        pendentesDoMes.push({
          empreendimento: r.empreendimento.nome,
          locatario:
            r.contrato.locatario?.nome ?? "—",
          localizacao: r.contrato.unidade.identificacao,
          totalDevido: calc.totalDevido ?? 0,
          diasAtraso,
        });
      }
    }
  }
  pendentesDoMes.sort((a, b) => b.totalDevido - a.totalDevido);

  const ultimoMesComDados = Math.max(
    1,
    ...porMes.map((l, i) => (l.devido > 0 || l.recebido > 0 ? i + 1 : 0))
  );

  // ---------- caixa ----------
  const caixaPorMes: CaixaMensal[] = [];
  for (let m = 1; m <= 12; m++) {
    caixaPorMes.push({
      mes: competencia(ano, m),
      receita: 0,
      despesaAL: 0,
      despesaCH: 0,
      dinheiro: 0,
      saldo: 0,
    });
  }
  for (const l of caixa) {
    const { mes: m } = parseCompetencia(l.mesReferencia);
    const c = caixaPorMes[m - 1];
    if (l.tipo === "ENTRADA") c.receita += l.valor;
    else if (l.tipo === "RECEB_DINHEIRO") c.dinheiro += l.valor;
    else if (l.tipo === "SAIDA" && l.centroCusto === "AL") c.despesaAL += l.valor;
    else if (l.tipo === "SAIDA" && l.centroCusto === "CH") c.despesaCH += l.valor;
  }
  for (const c of caixaPorMes) c.saldo = c.receita - c.despesaAL - c.despesaCH;
  const caixaMes = caixaPorMes[mesNum - 1] ?? null;
  const temCaixaMes =
    !!caixaMes &&
    (caixaMes.receita > 0 || caixaMes.despesaAL > 0 || caixaMes.despesaCH > 0);

  // ---------- temporada (módulo operacional) ----------
  const receitaTemporadaMes = recebT.reduce((a, r) => a + r.valor, 0);
  const despesaLimpezas = limpT.reduce(
    (a, l) => a + l.quantidade * l.valorUnitario + l.extraPdl,
    0
  );
  const despesaTemporadaMes =
    despT.reduce((a, d) => a + d.valor, 0) + despesaLimpezas;
  const temMovimentoTemporada =
    recebT.length > 0 || despT.length > 0 || limpT.length > 0;

  // ---------- resumo por empreendimento ----------
  const porEmpreendimento: EmpreendimentoResumo[] = [...porEmp.values()]
    .map((a) => ({
      id: a.id,
      nome: a.nome,
      comissaoMes: a.comissaoPorMes[mesNum - 1] ?? 0,
      comissaoAno: a.comissaoPorMes
        .slice(0, mesNum)
        .reduce((x, y) => x + y, 0),
      recebidoMes: a.recebidoMes,
      ticketMedioMes:
        a.linhasRecebidasMes > 0
          ? Math.round(a.recebidoMes / a.linhasRecebidasMes)
          : null,
      serieComissao: a.comissaoPorMes.slice(0, ultimoMesComDados),
    }))
    .sort((a, b) => b.comissaoMes - a.comissaoMes || b.comissaoAno - a.comissaoAno);

  const airbnb = porEmpreendimento.find((e) => e.nome === "AIRBNB");
  const linhaMes = porMes[mesNum - 1];

  return {
    mes,
    ano,
    ultimoMesComDados,
    mesFechado: !!fechamento,
    comissaoMes: linhaMes?.comissao ?? 0,
    comissaoAcumuladaAno: porMes
      .slice(0, mesNum)
      .reduce((a, l) => a + l.comissao, 0),
    devidoMes: linhaMes?.devido ?? 0,
    recebidoMes: linhaMes?.recebido ?? 0,
    taxaRecebimento:
      linhaMes && linhaMes.devido > 0
        ? linhaMes.recebido / linhaMes.devido
        : null,
    inadimplentesQtde: linhaMes?.pendentes ?? 0,
    inadimplentesValor: linhaMes?.pendenteValor ?? 0,
    saldoCaixaMes: caixaMes?.saldo ?? 0,
    caixaMes: temCaixaMes ? caixaMes : null,
    lucroTemporadaMes: temMovimentoTemporada
      ? receitaTemporadaMes - despesaTemporadaMes
      : null,
    receitaTemporadaMes,
    despesaTemporadaMes,
    comissaoAirbnbMes: airbnb?.comissaoMes ?? 0,
    porMes,
    caixaPorMes,
    porEmpreendimento,
    pendentesDoMes,
    reajustesDoMes: reajustes.map((c) => ({
      empreendimento: c.unidade.empreendimento.nome,
      localizacao: c.unidade.identificacao,
      locatario: c.locatario?.nome ?? "Desocupado",
      valorBase: c.valorBase,
    })),
  };
}
