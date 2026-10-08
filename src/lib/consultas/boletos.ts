import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { boletoEstaAtivo, totalDevido } from "@/lib/dominio/boletos";
import { filtroRecebimentosUnificados } from "@/lib/consultas/filtro-unificacao-nativa";
import { filtroGovernanca } from "@/lib/governanca/filtros";

const LIMITE_BOLETOS_EXIBIDOS = 150;
const LIMITE_PAGAMENTOS_EXIBIDOS = 150;
const LIMITE_EVENTOS_EXIBIDOS = 100;

const STATUS_ABERTOS = [
  "REGISTRADO",
  "VENCIDO",
  "PAGAMENTO_REPORTADO",
  "CANCELAMENTO_REPORTADO",
];
const STATUS_ATENCAO = [
  "ERRO",
  "RESULTADO_DESCONHECIDO",
  "PAGAMENTO_REPORTADO",
  "CANCELAMENTO_REPORTADO",
];

export type FiltroBoletos = "todos" | "abertos" | "atencao" | "pagos";

const incluirBoleto = {
  contaBancaria: true,
  recebimento: {
    include: {
      empreendimento: true,
      contrato: { include: { unidade: true, locatario: true } },
    },
  },
  eventos: { orderBy: { recebidoEm: "desc" as const }, take: 3 },
  pagamentos: { orderBy: { criadoEm: "desc" as const } },
} satisfies Prisma.BoletoInclude;

export type BoletoComRelacoes = Prisma.BoletoGetPayload<{
  include: typeof incluirBoleto;
}>;

const incluirRecebimentoParaBoleto = {
  empreendimento: true,
  contrato: { include: { unidade: true, locatario: true } },
  boletos: {
    select: {
      id: true,
      status: true,
      nossoNumero: true,
      contaBancariaId: true,
      atualizadoEm: true,
    },
    orderBy: { criadoEm: "desc" as const },
  },
} satisfies Prisma.RecebimentoInclude;

export type RecebimentoParaBoleto = Prisma.RecebimentoGetPayload<{
  include: typeof incluirRecebimentoParaBoleto;
}>;

const incluirPagamentoConciliacao = {
  contaBancaria: true,
  eventoBoleto: true,
  boleto: true,
  recebimento: {
    include: {
      empreendimento: true,
      contrato: { include: { unidade: true, locatario: true } },
    },
  },
} satisfies Prisma.PagamentoRecebimentoInclude;

function criterioAtencao(): Prisma.BoletoWhereInput {
  return {
    OR: [
      { status: { in: STATUS_ATENCAO } },
      { conciliacaoStatus: "DIVERGENTE" },
    ],
  };
}

function criterioFiltroBoletos(
  mes: string,
  filtro: FiltroBoletos,
  ativos: Prisma.BoletoWhereInput,
): Prisma.BoletoWhereInput {
  const competencia: Prisma.BoletoWhereInput = {
    AND: [{ recebimento: { mesLancamento: mes } }, ativos],
  };

  if (filtro === "abertos") {
    return { AND: [competencia, { status: { in: STATUS_ABERTOS } }] };
  }
  if (filtro === "atencao") {
    return { AND: [competencia, criterioAtencao()] };
  }
  if (filtro === "pagos") {
    return { AND: [competencia, { status: "LIQUIDADO" }] };
  }
  return competencia;
}

async function listarBoletosPriorizados(mes: string, filtro: FiltroBoletos, ativos: Prisma.BoletoWhereInput) {
  const where = criterioFiltroBoletos(mes, filtro, ativos);

  if (filtro !== "todos") {
    const [boletos, total] = await Promise.all([
      prisma.boleto.findMany({
        where,
        include: incluirBoleto,
        orderBy: { atualizadoEm: "desc" },
        take: LIMITE_BOLETOS_EXIBIDOS,
      }),
      prisma.boleto.count({ where }),
    ]);
    return { boletos, total };
  }

  const competencia = criterioFiltroBoletos(mes, "todos", ativos);
  const atencao = {
    AND: [competencia, criterioAtencao()],
  } satisfies Prisma.BoletoWhereInput;
  const [prioritarios, total] = await Promise.all([
    prisma.boleto.findMany({
      where: atencao,
      include: incluirBoleto,
      orderBy: { atualizadoEm: "desc" },
      take: LIMITE_BOLETOS_EXIBIDOS,
    }),
    prisma.boleto.count({ where: competencia }),
  ]);

  if (prioritarios.length >= LIMITE_BOLETOS_EXIBIDOS) {
    return { boletos: prioritarios, total };
  }

  const demais = await prisma.boleto.findMany({
    where: { AND: [competencia, { NOT: criterioAtencao() }] },
    include: incluirBoleto,
    orderBy: { atualizadoEm: "desc" },
    take: LIMITE_BOLETOS_EXIBIDOS - prioritarios.length,
  });

  return { boletos: [...prioritarios, ...demais], total };
}

export async function dadosPaginaBoletos(
  mes: string,
  filtro: FiltroBoletos = "todos",
) {
  const ativos: Prisma.BoletoWhereInput = { ...await filtroGovernanca(prisma, "BOLETO"), recebimento: await filtroRecebimentosUnificados() };
  const competencia: Prisma.BoletoWhereInput = {
    AND: [{ recebimento: { mesLancamento: mes } }, ativos],
  };
  const [listagem, recebimentos, contas, fechamento, statusAgrupados, totalAtencao] =
    await Promise.all([
      listarBoletosPriorizados(mes, filtro, ativos),
      prisma.recebimento.findMany({
        where: { AND: [{ mesLancamento: mes, recebido: null, origemAgregada: false }, await filtroRecebimentosUnificados()] },
        include: incluirRecebimentoParaBoleto,
        orderBy: [
          { empreendimento: { nome: "asc" } },
          { contrato: { unidade: { identificacao: "asc" } } },
        ],
      }),
      prisma.contaBancaria.findMany({
        where: { ativa: true, ...await filtroGovernanca(prisma, "CONTA") },
        orderBy: [{ padrao: "desc" }, { apelido: "asc" }],
      }),
      prisma.fechamentoMensal.findUnique({
        where: { mesLancamento: mes },
        select: { id: true },
      }),
      prisma.boleto.groupBy({
        by: ["status"],
        where: competencia,
        _count: { _all: true },
      }),
      prisma.boleto.count({
        where: { AND: [competencia, criterioAtencao()] },
      }),
    ]);

  const aEmitir = recebimentos.filter(
    (recebimento) =>
      totalDevido(recebimento) > 0 &&
      !recebimento.boletos.some((boleto) => boletoEstaAtivo(boleto.status)),
  );
  const porStatus = new Map(
    statusAgrupados.map((grupo) => [grupo.status, grupo._count._all]),
  );
  const contar = (...status: string[]) =>
    status.reduce((total, item) => total + (porStatus.get(item) ?? 0), 0);
  const totalBoletos = statusAgrupados.reduce(
    (total, grupo) => total + grupo._count._all,
    0,
  );

  return {
    boletos: listagem.boletos,
    totalBoletosFiltro: listagem.total,
    recebimentos,
    aEmitir,
    contas,
    fechado: Boolean(fechamento),
    contagensFiltro: {
      todos: totalBoletos,
      abertos: contar(...STATUS_ABERTOS),
      atencao: totalAtencao,
      pagos: contar("LIQUIDADO"),
    },
    kpis: {
      aEmitir: aEmitir.length,
      emAberto: contar(...STATUS_ABERTOS),
      pagamentosReportados: contar("PAGAMENTO_REPORTADO"),
      liquidados: contar("LIQUIDADO"),
      falhas: contar("ERRO", "RESULTADO_DESCONHECIDO"),
    },
  };
}

async function listarPagamentosPriorizados(ativos: Prisma.PagamentoRecebimentoWhereInput) {
  const pendentes = await prisma.pagamentoRecebimento.findMany({
    where: { AND: [{ conciliadoEm: null }, ativos] },
    include: incluirPagamentoConciliacao,
    orderBy: { criadoEm: "desc" },
    take: LIMITE_PAGAMENTOS_EXIBIDOS,
  });
  if (pendentes.length >= LIMITE_PAGAMENTOS_EXIBIDOS) return pendentes;

  const conciliados = await prisma.pagamentoRecebimento.findMany({
    where: { AND: [{ conciliadoEm: { not: null } }, ativos] },
    include: incluirPagamentoConciliacao,
    orderBy: { criadoEm: "desc" },
    take: LIMITE_PAGAMENTOS_EXIBIDOS - pendentes.length,
  });
  return [...pendentes, ...conciliados];
}

export async function dadosPaginaConciliacao() {
  const boletosAtivos: Prisma.BoletoWhereInput = { ...await filtroGovernanca(prisma, "BOLETO"), recebimento: await filtroRecebimentosUnificados() };
  const pagamentosAtivos: Prisma.PagamentoRecebimentoWhereInput = {
    recebimento: await filtroRecebimentosUnificados(), OR: [{ boletoId: null }, { boleto: boletosAtivos }],
  };
  const eventoPendente: Prisma.EventoBoletoWhereInput = {
    statusProcessamento: { in: ["PENDENTE", "ERRO"] },
  };
  const [
    pagamentos,
    eventosPendentes,
    sincronizacoes,
    pagamentosReportados,
    pagamentosPendentes,
    pagamentosConciliados,
    totalEventosPendentes,
    eventosSemCorrespondencia,
  ] = await Promise.all([
    listarPagamentosPriorizados(pagamentosAtivos),
    prisma.eventoBoleto.findMany({
      where: eventoPendente,
      include: { boleto: true },
      orderBy: [
        { statusProcessamento: "asc" },
        { recebidoEm: "desc" },
      ],
      take: LIMITE_EVENTOS_EXIBIDOS,
    }),
    prisma.sincronizacaoBancaria.findMany({
      include: { contaBancaria: true },
      orderBy: { iniciadaEm: "desc" },
      take: 10,
    }),
    prisma.boleto.count({
      where: { AND: [{ status: { in: ["PAGAMENTO_REPORTADO", "CANCELAMENTO_REPORTADO"] } }, boletosAtivos] },
    }),
    prisma.pagamentoRecebimento.count({ where: { AND: [{ conciliadoEm: null }, pagamentosAtivos] } }),
    prisma.pagamentoRecebimento.count({ where: { AND: [{ conciliadoEm: { not: null } }, pagamentosAtivos] } }),
    prisma.eventoBoleto.count({ where: eventoPendente }),
    prisma.eventoBoleto.count({
      where: { AND: [eventoPendente, { boletoId: null }] },
    }),
  ]);

  return {
    pagamentos,
    eventosPendentes,
    sincronizacoes,
    pagamentosReportados,
    totais: {
      pagamentos: pagamentosPendentes + pagamentosConciliados,
      pagamentosPendentes,
      pagamentosConciliados,
      eventosPendentes: totalEventosPendentes,
      eventosSemCorrespondencia,
    },
  };
}
