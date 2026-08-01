/**
 * Consultas do PAINEL POR EMPREENDIMENTO (/paineis/empreendimentos).
 * Visões DERIVADAS dos recebimentos — nada é mantido à mão.
 * Toda comissão vem da regra canônica de "@/lib/dominio/comissao"
 * (base = recebido − IPTU − condomínio; repasses nunca entram).
 * Valores sempre em CENTAVOS (Int).
 *
 * A dimensão é uma JANELA de competências ("YYYY-MM", em ordem):
 *  - modo ano: as 12 competências do ano (painelEmpreendimentos/detalheEmpreendimento);
 *  - modo período: a lista vinda de parsePeriodo (…DoPeriodo).
 * Competências comparam certo como string, então a janela vira
 * { gte: meses[0], lte: meses[último] } no Prisma.
 */

import { prisma } from "@/lib/db";
import { calcularRecebimento } from "@/lib/dominio/comissao";
import { competencia } from "@/lib/dominio/normalizacao";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface OcupacaoEmpreendimento {
  /** unidades com cadastro ativo */
  ativas: number;
  /** com contrato vigente (ativo/acordo) e locatário */
  ocupadas: number;
  /** ativas sem locatário — não geram comissão */
  desocupadas: number;
}

export interface CartaoEmpreendimento {
  id: string;
  nome: string;
  /** comissão somada na janela (ano ou período) */
  comissaoJanela: number;
  /** recebido somado na janela */
  recebidoJanela: number;
  /** recebido ÷ nº de lançamentos pagos na janela; null sem pagamento */
  ticketMedio: number | null;
  lancamentosPagos: number;
  ocupacao: OcupacaoEmpreendimento;
  /**
   * comissão do sparkline — modo ano: JAN..último mês com dados (índice 0 =
   * JAN); modo período: uma posição por competência da janela.
   */
  serieComissao: number[];
}

export interface PainelEmpreendimentos {
  ano: number;
  /** 1..12 — último mês do ano com devido ou recebido em algum empreendimento */
  ultimoMesComDados: number;
  totalComissao: number;
  totalRecebido: number;
  cartoes: CartaoEmpreendimento[];
}

export interface PainelEmpreendimentosPeriodo {
  /** competências "YYYY-MM" da janela, em ordem (mesma das séries) */
  meses: string[];
  totalComissao: number;
  totalRecebido: number;
  cartoes: CartaoEmpreendimento[];
}

export interface UnidadeDoPainel {
  unidadeId: string;
  identificacao: string;
  tipo: string;
  ativa: boolean;
  /** null = desocupada (sem locatário no contrato vigente) */
  locatario: string | null;
  /** status do contrato vigente; null = nenhum contrato aberto */
  statusContrato: string | null;
  /** valorBase do contrato vigente (sem IPTU/cond — repasses); null sem contrato */
  aluguelContratado: number | null;
  mesReajuste: number | null;
  /** comissão que os lançamentos pagos da unidade geraram na janela */
  comissaoJanela: number;
}

export interface LocatarioDoPainel {
  nome: string;
  recebidoJanela: number;
  /** Σ totalDevido dos lançamentos da janela ainda sem recebido */
  pendenteJanela: number;
  lancamentosPendentes: number;
  /** maior dataPagamento registrada na janela ("YYYY-MM-DD"); null sem registro */
  ultimoPagamento: string | null;
}

/** Núcleo do detalhe, comum aos dois modos — séries alinhadas à janela. */
export interface DetalheEmpreendimentoJanela {
  id: string;
  nome: string;
  comissaoTotal: number;
  devidoTotal: number;
  recebidoTotal: number;
  /** Σ recebido ÷ Σ devido na janela (0..1); null sem cobrança */
  taxaRecebimento: number | null;
  /** Σ totalDevido dos lançamentos da janela sem recebido */
  pendenteAberto: number;
  pendentesQtde: number;
  ocupacao: OcupacaoEmpreendimento;
  /** modo ano: índice 0 = JAN, 12 posições; período: uma por competência */
  comissaoPorMes: number[];
  devidoPorMes: number[];
  recebidoPorMes: number[];
  unidades: UnidadeDoPainel[];
  locatarios: LocatarioDoPainel[];
}

export interface DetalheEmpreendimento extends DetalheEmpreendimentoJanela {
  ano: number;
  ultimoMesComDados: number;
}

export interface DetalheEmpreendimentoPeriodo
  extends DetalheEmpreendimentoJanela {
  meses: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** As 12 competências de um ano — a "janela" do modo ano. */
function mesesDoAno(ano: number): string[] {
  return Array.from({ length: 12 }, (_, i) => competencia(ano, i + 1));
}

interface ContratoParaOcupacao {
  status: string;
  locatarioId: string | null;
  inicio: string | null;
}

/**
 * Contrato "vigente" de uma unidade: entre os não encerrados, prefere
 * ativo > acordo; empate decidido pelo início mais recente.
 */
function contratoVigente<T extends ContratoParaOcupacao>(
  contratos: T[]
): T | null {
  if (contratos.length === 0) return null;
  const peso = (s: string) => (s === "ativo" ? 2 : s === "acordo" ? 1 : 0);
  return [...contratos].sort(
    (a, b) =>
      peso(b.status) - peso(a.status) ||
      (b.inicio ?? "").localeCompare(a.inicio ?? "")
  )[0];
}

/** última posição (1..n) com devido ou recebido > 0; mínimo 1. */
function ultimoMesComMovimento(devido: number[], recebido: number[]): number {
  let ultimo = 1;
  for (let i = 0; i < devido.length; i++) {
    if ((devido[i] ?? 0) > 0 || (recebido[i] ?? 0) > 0) ultimo = i + 1;
  }
  return ultimo;
}

// ---------------------------------------------------------------------------
// Índice: um cartão por empreendimento com movimento na janela
// ---------------------------------------------------------------------------

interface AgregadoJanela {
  comissaoPorMes: number[];
  devidoPorMes: number[];
  recebidoPorMes: number[];
  recebidoTotal: number;
  lancamentosPagos: number;
}

/** Agrega os recebimentos da janela por empreendimento + ocupação + nomes. */
async function agregadosPorEmpreendimento(meses: string[]) {
  const [recebs, unidades, empreendimentos] = await Promise.all([
    prisma.recebimento.findMany({
      where: {
        mesLancamento: { gte: meses[0], lte: meses[meses.length - 1] },
      },
      select: {
        empreendimentoId: true,
        mesLancamento: true,
        valor: true,
        iptu: true,
        cond: true,
        recebido: true,
        taxaComissaoBps: true,
      },
    }),
    prisma.unidade.findMany({
      where: { ativo: true },
      select: {
        empreendimentoId: true,
        contratos: {
          where: { status: { not: "encerrado" } },
          select: { status: true, locatarioId: true, inicio: true },
        },
      },
    }),
    prisma.empreendimento.findMany({ select: { id: true, nome: true } }),
  ]);

  const idx = new Map(meses.map((m, i) => [m, i]));
  const porEmp = new Map<string, AgregadoJanela>();
  for (const r of recebs) {
    const i = idx.get(r.mesLancamento);
    if (i === undefined) continue; // gte/lte já filtra; guarda extra
    let agg = porEmp.get(r.empreendimentoId);
    if (!agg) {
      agg = {
        comissaoPorMes: Array(meses.length).fill(0),
        devidoPorMes: Array(meses.length).fill(0),
        recebidoPorMes: Array(meses.length).fill(0),
        recebidoTotal: 0,
        lancamentosPagos: 0,
      };
      porEmp.set(r.empreendimentoId, agg);
    }
    const calc = calcularRecebimento(r);
    agg.comissaoPorMes[i] += calc.comissao ?? 0;
    agg.devidoPorMes[i] += calc.totalDevido ?? 0;
    agg.recebidoPorMes[i] += r.recebido ?? 0;
    if (r.recebido !== null) {
      agg.recebidoTotal += r.recebido;
      agg.lancamentosPagos += 1;
    }
  }

  // ocupação por empreendimento (unidades ativas)
  const ocupPorEmp = new Map<string, OcupacaoEmpreendimento>();
  for (const u of unidades) {
    let o = ocupPorEmp.get(u.empreendimentoId);
    if (!o) {
      o = { ativas: 0, ocupadas: 0, desocupadas: 0 };
      ocupPorEmp.set(u.empreendimentoId, o);
    }
    o.ativas += 1;
    const vigente = contratoVigente(u.contratos);
    if (vigente?.locatarioId) o.ocupadas += 1;
    else o.desocupadas += 1;
  }

  const nomePorId = new Map(empreendimentos.map((e) => [e.id, e.nome]));
  return { porEmp, ocupPorEmp, nomePorId };
}

/** Monta e ordena os cartões; corteSerie = quantas posições vão ao sparkline. */
function montarCartoes(
  porEmp: Map<string, AgregadoJanela>,
  ocupPorEmp: Map<string, OcupacaoEmpreendimento>,
  nomePorId: Map<string, string>,
  corteSerie: number
): CartaoEmpreendimento[] {
  return [...porEmp.entries()]
    .map(([id, agg]) => ({
      id,
      nome: nomePorId.get(id) ?? "?",
      comissaoJanela: agg.comissaoPorMes.reduce((a, v) => a + v, 0),
      recebidoJanela: agg.recebidoTotal,
      ticketMedio:
        agg.lancamentosPagos > 0
          ? Math.round(agg.recebidoTotal / agg.lancamentosPagos)
          : null,
      lancamentosPagos: agg.lancamentosPagos,
      ocupacao:
        ocupPorEmp.get(id) ?? { ativas: 0, ocupadas: 0, desocupadas: 0 },
      serieComissao: agg.comissaoPorMes.slice(0, corteSerie),
    }))
    .sort(
      (a, b) =>
        b.comissaoJanela - a.comissaoJanela ||
        a.nome.localeCompare(b.nome, "pt-BR")
    );
}

/** Modo ano: janela = 12 competências; sparkline cortado no último mês com dados. */
export async function painelEmpreendimentos(
  ano: number
): Promise<PainelEmpreendimentos> {
  const meses = mesesDoAno(ano);
  const { porEmp, ocupPorEmp, nomePorId } =
    await agregadosPorEmpreendimento(meses);

  // último mês com movimento GLOBAL (mantém sparklines comparáveis entre cartões)
  const devidoGlobal = Array(12).fill(0) as number[];
  const recebidoGlobal = Array(12).fill(0) as number[];
  for (const agg of porEmp.values()) {
    for (let i = 0; i < 12; i++) {
      devidoGlobal[i] += agg.devidoPorMes[i];
      recebidoGlobal[i] += agg.recebidoPorMes[i];
    }
  }
  const ultimoMesComDados = ultimoMesComMovimento(devidoGlobal, recebidoGlobal);

  const cartoes = montarCartoes(
    porEmp,
    ocupPorEmp,
    nomePorId,
    ultimoMesComDados
  );

  return {
    ano,
    ultimoMesComDados,
    totalComissao: cartoes.reduce((a, c) => a + c.comissaoJanela, 0),
    totalRecebido: cartoes.reduce((a, c) => a + c.recebidoJanela, 0),
    cartoes,
  };
}

/** Modo período: janela = competências de parsePeriodo; série inteira no sparkline. */
export async function painelEmpreendimentosDoPeriodo(
  meses: string[]
): Promise<PainelEmpreendimentosPeriodo> {
  const { porEmp, ocupPorEmp, nomePorId } =
    await agregadosPorEmpreendimento(meses);
  const cartoes = montarCartoes(porEmp, ocupPorEmp, nomePorId, meses.length);

  return {
    meses,
    totalComissao: cartoes.reduce((a, c) => a + c.comissaoJanela, 0),
    totalRecebido: cartoes.reduce((a, c) => a + c.recebidoJanela, 0),
    cartoes,
  };
}

// ---------------------------------------------------------------------------
// Detalhe de um empreendimento na janela
// ---------------------------------------------------------------------------

async function detalheDaJanela(
  id: string,
  meses: string[]
): Promise<DetalheEmpreendimentoJanela | null> {
  const empreendimento = await prisma.empreendimento.findUnique({
    where: { id },
    select: { id: true, nome: true },
  });
  if (!empreendimento) return null;

  const [recebs, unidades] = await Promise.all([
    prisma.recebimento.findMany({
      where: {
        empreendimentoId: id,
        mesLancamento: { gte: meses[0], lte: meses[meses.length - 1] },
      },
      include: {
        contrato: { include: { unidade: true, locatario: true } },
      },
    }),
    prisma.unidade.findMany({
      where: { empreendimentoId: id },
      include: {
        contratos: {
          where: { status: { not: "encerrado" } },
          include: { locatario: true },
        },
      },
    }),
  ]);

  const idx = new Map(meses.map((m, i) => [m, i]));
  const comissaoPorMes = Array(meses.length).fill(0) as number[];
  const devidoPorMes = Array(meses.length).fill(0) as number[];
  const recebidoPorMes = Array(meses.length).fill(0) as number[];
  let pendenteAberto = 0;
  let pendentesQtde = 0;
  const comissaoPorUnidade = new Map<string, number>();

  const porLocatario = new Map<string, LocatarioDoPainel>();

  for (const r of recebs) {
    const i = idx.get(r.mesLancamento);
    if (i === undefined) continue; // gte/lte já filtra; guarda extra
    const calc = calcularRecebimento(r);
    comissaoPorMes[i] += calc.comissao ?? 0;
    devidoPorMes[i] += calc.totalDevido ?? 0;
    recebidoPorMes[i] += r.recebido ?? 0;

    const pendente = calc.totalDevido !== null && r.recebido === null;
    if (pendente) {
      pendenteAberto += calc.totalDevido ?? 0;
      pendentesQtde += 1;
    }

    const unidadeId = r.contrato.unidadeId;
    comissaoPorUnidade.set(
      unidadeId,
      (comissaoPorUnidade.get(unidadeId) ?? 0) + (calc.comissao ?? 0)
    );

    const chave = r.contrato.locatarioId ?? "__sem-locatario__";
    let loc = porLocatario.get(chave);
    if (!loc) {
      loc = {
        nome: r.contrato.locatario?.nome ?? "(sem locatário no contrato)",
        recebidoJanela: 0,
        pendenteJanela: 0,
        lancamentosPendentes: 0,
        ultimoPagamento: null,
      };
      porLocatario.set(chave, loc);
    }
    loc.recebidoJanela += r.recebido ?? 0;
    if (pendente) {
      loc.pendenteJanela += calc.totalDevido ?? 0;
      loc.lancamentosPendentes += 1;
    }
    if (
      r.dataPagamento &&
      (loc.ultimoPagamento === null || r.dataPagamento > loc.ultimoPagamento)
    ) {
      loc.ultimoPagamento = r.dataPagamento;
    }
  }

  // ---------- unidades: ativas sempre; inativas só se geraram comissão ----------
  const ocupacao: OcupacaoEmpreendimento = {
    ativas: 0,
    ocupadas: 0,
    desocupadas: 0,
  };
  const linhasUnidade: UnidadeDoPainel[] = [];
  for (const u of unidades) {
    const vigente = contratoVigente(u.contratos);
    const ocupada = !!vigente?.locatarioId;
    if (u.ativo) {
      ocupacao.ativas += 1;
      if (ocupada) ocupacao.ocupadas += 1;
      else ocupacao.desocupadas += 1;
    }
    const comissaoJanela = comissaoPorUnidade.get(u.id) ?? 0;
    if (!u.ativo && comissaoJanela === 0) continue; // inativa sem movimento na janela
    linhasUnidade.push({
      unidadeId: u.id,
      identificacao: u.identificacao,
      tipo: u.tipo,
      ativa: u.ativo,
      locatario: ocupada ? (vigente?.locatario?.nome ?? null) : null,
      statusContrato: vigente?.status ?? null,
      aluguelContratado: vigente ? vigente.valorBase : null,
      mesReajuste: vigente?.mesReajuste ?? null,
      comissaoJanela,
    });
  }
  linhasUnidade.sort((a, b) =>
    a.identificacao.localeCompare(b.identificacao, "pt-BR", { numeric: true })
  );

  const locatarios = [...porLocatario.values()].sort(
    (a, b) =>
      b.pendenteJanela - a.pendenteJanela ||
      b.recebidoJanela - a.recebidoJanela ||
      a.nome.localeCompare(b.nome, "pt-BR")
  );

  const devidoTotal = devidoPorMes.reduce((a, v) => a + v, 0);
  const recebidoTotal = recebidoPorMes.reduce((a, v) => a + v, 0);

  return {
    id: empreendimento.id,
    nome: empreendimento.nome,
    comissaoTotal: comissaoPorMes.reduce((a, v) => a + v, 0),
    devidoTotal,
    recebidoTotal,
    taxaRecebimento: devidoTotal > 0 ? recebidoTotal / devidoTotal : null,
    pendenteAberto,
    pendentesQtde,
    ocupacao,
    comissaoPorMes,
    devidoPorMes,
    recebidoPorMes,
    unidades: linhasUnidade,
    locatarios,
  };
}

/** Modo ano: séries JAN..DEZ (12 posições) + último mês com movimento. */
export async function detalheEmpreendimento(
  id: string,
  ano: number
): Promise<DetalheEmpreendimento | null> {
  const base = await detalheDaJanela(id, mesesDoAno(ano));
  if (!base) return null;
  return {
    ...base,
    ano,
    ultimoMesComDados: ultimoMesComMovimento(
      base.devidoPorMes,
      base.recebidoPorMes
    ),
  };
}

/** Modo período: séries alinhadas às competências de parsePeriodo. */
export async function detalheEmpreendimentoDoPeriodo(
  id: string,
  meses: string[]
): Promise<DetalheEmpreendimentoPeriodo | null> {
  const base = await detalheDaJanela(id, meses);
  if (!base) return null;
  return { ...base, meses };
}
