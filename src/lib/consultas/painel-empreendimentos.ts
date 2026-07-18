/**
 * Consultas do PAINEL POR EMPREENDIMENTO (/paineis/empreendimentos).
 * Visões DERIVADAS dos recebimentos do ano — nada é mantido à mão.
 * Toda comissão vem da regra canônica de "@/lib/dominio/comissao"
 * (base = recebido − IPTU − condomínio; repasses nunca entram).
 * Valores sempre em CENTAVOS (Int); ano é a dimensão (mesLancamento "YYYY-MM").
 */

import { prisma } from "@/lib/db";
import { calcularRecebimento } from "@/lib/dominio/comissao";
import { parseCompetencia } from "@/lib/dominio/normalizacao";

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
  comissaoAno: number;
  recebidoAno: number;
  /** recebido ÷ nº de lançamentos pagos no ano; null sem pagamento */
  ticketMedio: number | null;
  lancamentosPagos: number;
  ocupacao: OcupacaoEmpreendimento;
  /** comissão JAN..último mês com dados do ano (índice 0 = JAN) */
  serieComissao: number[];
}

export interface PainelEmpreendimentos {
  ano: number;
  /** 1..12 — último mês do ano com devido ou recebido em algum empreendimento */
  ultimoMesComDados: number;
  totalComissaoAno: number;
  totalRecebidoAno: number;
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
  comissaoAno: number;
}

export interface LocatarioDoPainel {
  nome: string;
  recebidoAno: number;
  /** Σ totalDevido dos lançamentos do ano ainda sem recebido */
  pendenteAno: number;
  lancamentosPendentes: number;
  /** maior dataPagamento registrada no ano ("YYYY-MM-DD"); null sem registro */
  ultimoPagamento: string | null;
}

export interface DetalheEmpreendimento {
  id: string;
  nome: string;
  ano: number;
  ultimoMesComDados: number;
  comissaoAno: number;
  devidoAno: number;
  recebidoAno: number;
  /** Σ recebido ÷ Σ devido no ano (0..1); null sem cobrança */
  taxaRecebimento: number | null;
  /** Σ totalDevido dos lançamentos do ano sem recebido */
  pendenteAberto: number;
  pendentesQtde: number;
  ocupacao: OcupacaoEmpreendimento;
  /** índice 0 = JAN, sempre 12 posições */
  comissaoPorMes: number[];
  devidoPorMes: number[];
  recebidoPorMes: number[];
  unidades: UnidadeDoPainel[];
  locatarios: LocatarioDoPainel[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** último índice (1..12) com devido ou recebido > 0; mínimo 1. */
function ultimoMesComMovimento(devido: number[], recebido: number[]): number {
  let ultimo = 1;
  for (let i = 0; i < 12; i++) {
    if ((devido[i] ?? 0) > 0 || (recebido[i] ?? 0) > 0) ultimo = i + 1;
  }
  return ultimo;
}

// ---------------------------------------------------------------------------
// Índice: um cartão por empreendimento com movimento no ano
// ---------------------------------------------------------------------------

export async function painelEmpreendimentos(
  ano: number
): Promise<PainelEmpreendimentos> {
  const [recebs, unidades, empreendimentos] = await Promise.all([
    prisma.recebimento.findMany({
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

  const nomePorId = new Map(empreendimentos.map((e) => [e.id, e.nome]));

  interface Agregado {
    comissaoPorMes: number[];
    devidoPorMes: number[];
    recebidoPorMes: number[];
    recebidoAno: number;
    lancamentosPagos: number;
  }
  const porEmp = new Map<string, Agregado>();
  for (const r of recebs) {
    const { mes } = parseCompetencia(r.mesLancamento);
    let agg = porEmp.get(r.empreendimentoId);
    if (!agg) {
      agg = {
        comissaoPorMes: Array(12).fill(0),
        devidoPorMes: Array(12).fill(0),
        recebidoPorMes: Array(12).fill(0),
        recebidoAno: 0,
        lancamentosPagos: 0,
      };
      porEmp.set(r.empreendimentoId, agg);
    }
    const calc = calcularRecebimento(r);
    agg.comissaoPorMes[mes - 1] += calc.comissao ?? 0;
    agg.devidoPorMes[mes - 1] += calc.totalDevido ?? 0;
    agg.recebidoPorMes[mes - 1] += r.recebido ?? 0;
    if (r.recebido !== null) {
      agg.recebidoAno += r.recebido;
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

  // último mês com movimento GLOBAL (mantém sparklines comparáveis entre cartões)
  const devidoGlobal = Array(12).fill(0);
  const recebidoGlobal = Array(12).fill(0);
  for (const agg of porEmp.values()) {
    for (let i = 0; i < 12; i++) {
      devidoGlobal[i] += agg.devidoPorMes[i];
      recebidoGlobal[i] += agg.recebidoPorMes[i];
    }
  }
  const ultimoMesComDados = ultimoMesComMovimento(devidoGlobal, recebidoGlobal);

  const cartoes: CartaoEmpreendimento[] = [...porEmp.entries()]
    .map(([id, agg]) => ({
      id,
      nome: nomePorId.get(id) ?? "?",
      comissaoAno: agg.comissaoPorMes.reduce((a, v) => a + v, 0),
      recebidoAno: agg.recebidoAno,
      ticketMedio:
        agg.lancamentosPagos > 0
          ? Math.round(agg.recebidoAno / agg.lancamentosPagos)
          : null,
      lancamentosPagos: agg.lancamentosPagos,
      ocupacao:
        ocupPorEmp.get(id) ?? { ativas: 0, ocupadas: 0, desocupadas: 0 },
      serieComissao: agg.comissaoPorMes.slice(0, ultimoMesComDados),
    }))
    .sort(
      (a, b) =>
        b.comissaoAno - a.comissaoAno ||
        a.nome.localeCompare(b.nome, "pt-BR")
    );

  return {
    ano,
    ultimoMesComDados,
    totalComissaoAno: cartoes.reduce((a, c) => a + c.comissaoAno, 0),
    totalRecebidoAno: cartoes.reduce((a, c) => a + c.recebidoAno, 0),
    cartoes,
  };
}

// ---------------------------------------------------------------------------
// Detalhe de um empreendimento no ano
// ---------------------------------------------------------------------------

export async function detalheEmpreendimento(
  id: string,
  ano: number
): Promise<DetalheEmpreendimento | null> {
  const empreendimento = await prisma.empreendimento.findUnique({
    where: { id },
    select: { id: true, nome: true },
  });
  if (!empreendimento) return null;

  const [recebs, unidades] = await Promise.all([
    prisma.recebimento.findMany({
      where: { empreendimentoId: id, mesLancamento: { startsWith: `${ano}-` } },
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

  const comissaoPorMes = Array(12).fill(0) as number[];
  const devidoPorMes = Array(12).fill(0) as number[];
  const recebidoPorMes = Array(12).fill(0) as number[];
  let pendenteAberto = 0;
  let pendentesQtde = 0;
  const comissaoPorUnidade = new Map<string, number>();

  interface AggLocatario {
    nome: string;
    recebidoAno: number;
    pendenteAno: number;
    lancamentosPendentes: number;
    ultimoPagamento: string | null;
  }
  const porLocatario = new Map<string, AggLocatario>();

  for (const r of recebs) {
    const { mes } = parseCompetencia(r.mesLancamento);
    const calc = calcularRecebimento(r);
    comissaoPorMes[mes - 1] += calc.comissao ?? 0;
    devidoPorMes[mes - 1] += calc.totalDevido ?? 0;
    recebidoPorMes[mes - 1] += r.recebido ?? 0;

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
        recebidoAno: 0,
        pendenteAno: 0,
        lancamentosPendentes: 0,
        ultimoPagamento: null,
      };
      porLocatario.set(chave, loc);
    }
    loc.recebidoAno += r.recebido ?? 0;
    if (pendente) {
      loc.pendenteAno += calc.totalDevido ?? 0;
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
    const comissaoAno = comissaoPorUnidade.get(u.id) ?? 0;
    if (!u.ativo && comissaoAno === 0) continue; // inativa sem movimento no ano
    linhasUnidade.push({
      unidadeId: u.id,
      identificacao: u.identificacao,
      tipo: u.tipo,
      ativa: u.ativo,
      locatario: ocupada ? (vigente?.locatario?.nome ?? null) : null,
      statusContrato: vigente?.status ?? null,
      aluguelContratado: vigente ? vigente.valorBase : null,
      mesReajuste: vigente?.mesReajuste ?? null,
      comissaoAno,
    });
  }
  linhasUnidade.sort((a, b) =>
    a.identificacao.localeCompare(b.identificacao, "pt-BR", { numeric: true })
  );

  const locatarios = [...porLocatario.values()].sort(
    (a, b) =>
      b.pendenteAno - a.pendenteAno ||
      b.recebidoAno - a.recebidoAno ||
      a.nome.localeCompare(b.nome, "pt-BR")
  );

  const devidoAno = devidoPorMes.reduce((a, v) => a + v, 0);
  const recebidoAno = recebidoPorMes.reduce((a, v) => a + v, 0);

  return {
    id: empreendimento.id,
    nome: empreendimento.nome,
    ano,
    ultimoMesComDados: ultimoMesComMovimento(devidoPorMes, recebidoPorMes),
    comissaoAno: comissaoPorMes.reduce((a, v) => a + v, 0),
    devidoAno,
    recebidoAno,
    taxaRecebimento: devidoAno > 0 ? recebidoAno / devidoAno : null,
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
