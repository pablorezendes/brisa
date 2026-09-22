import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  ESCOPOS_OPERACAO_WIDESYS,
  interpretarResumoLoteOperacao,
  type EscopoOperacaoWidesys,
} from "@/lib/dominio/auditoria-widesys";
import { ORIGEM_CADASTROS_WIDESYS } from "@/lib/widesys";

export type EstadoTitulosAuditoria = "todos" | "quarentena" | "inadimplentes" | "ausentes";
export type NaturezaTitulosAuditoria = "todos" | "RECEBER" | "PAGAR";

export type LinhaEscopoAuditoria = {
  escopo: EscopoOperacaoWidesys;
  totalAtual: number;
  staging: number;
  quarentena: number;
  ausentes: number;
  reconciliados: number;
  promovidos: number;
  quantidadeFonte: number;
  somaFonte: number;
  somaAceita: number;
  somaQuarentena: number;
  somaAberto: number;
};

type LinhaMutavel = LinhaEscopoAuditoria;

function linhaVazia(escopo: EscopoOperacaoWidesys): LinhaMutavel {
  return {
    escopo,
    totalAtual: 0,
    staging: 0,
    quarentena: 0,
    ausentes: 0,
    reconciliados: 0,
    promovidos: 0,
    quantidadeFonte: 0,
    somaFonte: 0,
    somaAceita: 0,
    somaQuarentena: 0,
    somaAberto: 0,
  };
}

function registrarStatus(linha: LinhaMutavel, status: string, quantidade: number): void {
  linha.totalAtual += quantidade;
  if (status === "STAGING") linha.staging += quantidade;
  else if (status === "QUARENTENA") linha.quarentena += quantidade;
  else if (status === "AUSENTE_NA_FONTE") linha.ausentes += quantidade;
  else if (status === "RECONCILIADO") linha.reconciliados += quantidade;
  else if (status === "PROMOVIDO") linha.promovidos += quantidade;
}

function estadoSeguro(valor?: string): EstadoTitulosAuditoria {
  return ["quarentena", "inadimplentes", "ausentes"].includes(valor ?? "")
    ? (valor as EstadoTitulosAuditoria)
    : "todos";
}

function naturezaSegura(valor?: string): NaturezaTitulosAuditoria {
  return valor === "RECEBER" || valor === "PAGAR" ? valor : "todos";
}

function paginaSegura(valor?: number): number {
  return Number.isSafeInteger(valor) && valor! > 0 ? valor! : 1;
}

function whereTitulos(
  estado: EstadoTitulosAuditoria,
  natureza: NaturezaTitulosAuditoria,
): Prisma.TituloFinanceiroLegadoWhereInput {
  return {
    origem: ORIGEM_CADASTROS_WIDESYS,
    ...(natureza === "todos" ? {} : { natureza }),
    ...(estado === "quarentena"
      ? { statusImportacao: "QUARENTENA" }
      : estado === "ausentes"
        ? { statusImportacao: "AUSENTE_NA_FONTE" }
        : estado === "inadimplentes"
          ? {
              inadimplente: true,
              statusImportacao: { not: "AUSENTE_NA_FONTE" },
            }
          : {}),
  };
}

export async function resumoAtalhoMigracaoWidesys() {
  const lote = await prisma.importacaoLegadoLote.findFirst({
    where: { origem: ORIGEM_CADASTROS_WIDESYS },
    orderBy: [{ capturadoEm: "desc" }, { iniciadoEm: "desc" }],
    select: {
      status: true,
      totalProcessado: true,
      totalQuarentena: true,
      capturadoEm: true,
    },
  });

  return lote;
}

export async function dadosAuditoriaOperacaoWidesys(entrada: {
  pagina?: number;
  estado?: string;
  natureza?: string;
  porPagina?: number;
} = {}) {
  const estado = estadoSeguro(entrada.estado);
  const natureza = naturezaSegura(entrada.natureza);
  const porPagina = Number.isSafeInteger(entrada.porPagina) && entrada.porPagina! > 0
    ? Math.min(entrada.porPagina!, 100)
    : 25;
  const paginaSolicitada = paginaSegura(entrada.pagina);
  const filtroTitulos = whereTitulos(estado, natureza);
  const origem = ORIGEM_CADASTROS_WIDESYS;

  const [
    loteBruto,
    totalLotes,
    contratosPorStatus,
    partesPorStatus,
    titulosPorStatus,
    baixasPorStatus,
    movimentosPorStatus,
    inadimplencia,
    inadimplentesEmQuarentena,
    pagamentosVencidos,
    pagamentosVencidosEmQuarentena,
    totalTitulos,
    totalItensQuarentena,
    quarentenasRecentes,
    contratosPlataforma,
    recebimentosPlataforma,
    recebimentosComValorRecebido,
    pagamentosPlataforma,
    movimentosPlataforma,
    pessoasWidesys,
    imoveisWidesys,
    catalogosWidesys,
    empreendimentosPlataforma,
    unidadesPlataforma,
    locatariosPlataforma,
    locatariosVinculadosWidesys,
  ] = await Promise.all([
    prisma.importacaoLegadoLote.findFirst({
      where: { origem },
      orderBy: [{ capturadoEm: "desc" }, { iniciadoEm: "desc" }],
      select: {
        id: true,
        capturaId: true,
        esquemaVersao: true,
        capturadoEm: true,
        status: true,
        totalEsperado: true,
        totalProcessado: true,
        totalQuarentena: true,
        erroCodigo: true,
        iniciadoEm: true,
        concluidoEm: true,
        atualizadoEm: true,
        resumo: true,
      },
    }),
    prisma.importacaoLegadoLote.count({ where: { origem } }),
    prisma.contratoLegado.groupBy({
      by: ["statusImportacao"],
      where: { origem },
      _count: { _all: true },
    }),
    prisma.contratoParteLegado.groupBy({
      by: ["statusImportacao"],
      where: { origem },
      _count: { _all: true },
    }),
    prisma.tituloFinanceiroLegado.groupBy({
      by: ["escopo", "statusImportacao"],
      where: { origem },
      _count: { _all: true },
      _sum: { valorAberto: true },
    }),
    prisma.baixaFinanceiraLegado.groupBy({
      by: ["escopo", "statusImportacao"],
      where: { origem },
      _count: { _all: true },
    }),
    prisma.movimentoFinanceiroLegado.groupBy({
      by: ["statusImportacao"],
      where: { origem },
      _count: { _all: true },
    }),
    prisma.tituloFinanceiroLegado.aggregate({
      where: {
        origem,
        natureza: "RECEBER",
        inadimplente: true,
        statusImportacao: { in: ["STAGING", "RECONCILIADO", "PROMOVIDO"] },
      },
      _count: { _all: true },
      _sum: { valorAberto: true },
    }),
    prisma.tituloFinanceiroLegado.aggregate({
      where: {
        origem,
        natureza: "RECEBER",
        inadimplente: true,
        statusImportacao: "QUARENTENA",
      },
      _count: { _all: true },
      _sum: { valorAberto: true },
    }),
    prisma.tituloFinanceiroLegado.aggregate({
      where: {
        origem,
        natureza: "PAGAR",
        inadimplente: true,
        statusImportacao: { in: ["STAGING", "RECONCILIADO", "PROMOVIDO"] },
      },
      _count: { _all: true },
      _sum: { valorAberto: true },
    }),
    prisma.tituloFinanceiroLegado.aggregate({
      where: {
        origem,
        natureza: "PAGAR",
        inadimplente: true,
        statusImportacao: "QUARENTENA",
      },
      _count: { _all: true },
      _sum: { valorAberto: true },
    }),
    prisma.tituloFinanceiroLegado.count({ where: filtroTitulos }),
    prisma.importacaoLegadoItem.count({ where: { origem, status: "QUARENTENA" } }),
    prisma.importacaoLegadoItem.findMany({
      where: { origem, status: "QUARENTENA" },
      orderBy: [{ processadoEm: "desc" }, { id: "desc" }],
      take: 12,
      select: {
        id: true,
        escopo: true,
        legadoId: true,
        acao: true,
        quarentenaMotivo: true,
        processadoEm: true,
        lote: { select: { capturaId: true } },
      },
    }),
    prisma.contrato.count(),
    prisma.recebimento.count(),
    prisma.recebimento.count({ where: { recebido: { gt: 0 } } }),
    prisma.pagamentoRecebimento.count(),
    prisma.lancamentoCaixa.count(),
    prisma.pessoa.count({ where: { origem } }),
    prisma.imovelLegado.count({ where: { origem } }),
    prisma.catalogoLegadoRegistro.count({
      where: { origem },
    }),
    prisma.empreendimento.count(),
    prisma.unidade.count(),
    prisma.locatario.count(),
    prisma.locatario.count({
      where: { pessoa: { is: { origem } } },
    }),
  ]);

  const totalPaginas = Math.max(1, Math.ceil(totalTitulos / porPagina));
  const pagina = Math.min(paginaSolicitada, totalPaginas);
  const titulos = await prisma.tituloFinanceiroLegado.findMany({
    where: filtroTitulos,
    orderBy: [{ vencimento: "desc" }, { legadoId: "asc" }],
    skip: (pagina - 1) * porPagina,
    take: porPagina,
    select: {
      id: true,
      legadoId: true,
      natureza: true,
      numeroDocumento: true,
      parcela: true,
      vencimento: true,
      valorDevido: true,
      valorAberto: true,
      valorPago: true,
      situacaoNormalizada: true,
      pagamentoParcial: true,
      inadimplente: true,
      statusImportacao: true,
      quarentenaMotivo: true,
      capturadoEm: true,
    },
  });

  const linhas = new Map(
    ESCOPOS_OPERACAO_WIDESYS.map((escopo) => [escopo, linhaVazia(escopo)]),
  );
  for (const grupo of contratosPorStatus) {
    registrarStatus(linhas.get("CONTRATO")!, grupo.statusImportacao, grupo._count._all);
  }
  for (const grupo of partesPorStatus) {
    registrarStatus(linhas.get("CONTRATO_PARTE")!, grupo.statusImportacao, grupo._count._all);
  }
  for (const grupo of titulosPorStatus) {
    if (!ESCOPOS_OPERACAO_WIDESYS.includes(grupo.escopo as EscopoOperacaoWidesys)) continue;
    const linha = linhas.get(grupo.escopo as EscopoOperacaoWidesys)!;
    registrarStatus(linha, grupo.statusImportacao, grupo._count._all);
    if (grupo.statusImportacao !== "AUSENTE_NA_FONTE") {
      linha.somaAberto += grupo._sum.valorAberto ?? 0;
    }
  }
  for (const grupo of baixasPorStatus) {
    if (!ESCOPOS_OPERACAO_WIDESYS.includes(grupo.escopo as EscopoOperacaoWidesys)) continue;
    registrarStatus(
      linhas.get(grupo.escopo as EscopoOperacaoWidesys)!,
      grupo.statusImportacao,
      grupo._count._all,
    );
  }
  for (const grupo of movimentosPorStatus) {
    registrarStatus(linhas.get("MOVIMENTO")!, grupo.statusImportacao, grupo._count._all);
  }

  const resumoLote = interpretarResumoLoteOperacao(loteBruto?.resumo);
  for (const escopo of ESCOPOS_OPERACAO_WIDESYS) {
    const reconciliacao = resumoLote.reconciliacao[escopo];
    if (!reconciliacao) continue;
    const linha = linhas.get(escopo)!;
    linha.quantidadeFonte = reconciliacao.quantidade;
    linha.somaFonte = reconciliacao.somaFonte;
    linha.somaAceita = reconciliacao.somaAceita;
    linha.somaQuarentena = reconciliacao.somaQuarentena;
  }

  const lote = loteBruto
    ? {
        id: loteBruto.id,
        capturaId: loteBruto.capturaId,
        esquemaVersao: loteBruto.esquemaVersao,
        capturadoEm: loteBruto.capturadoEm,
        status: loteBruto.status,
        totalEsperado: loteBruto.totalEsperado,
        totalProcessado: loteBruto.totalProcessado,
        totalQuarentena: loteBruto.totalQuarentena,
        erroCodigo: loteBruto.erroCodigo,
        iniciadoEm: loteBruto.iniciadoEm,
        concluidoEm: loteBruto.concluidoEm,
        atualizadoEm: loteBruto.atualizadoEm,
        escoposCobertos: resumoLote.escoposCobertos,
      }
    : null;

  return {
    lote,
    totalLotes,
    escopos: ESCOPOS_OPERACAO_WIDESYS.map((escopo) => linhas.get(escopo)!),
    totais: {
      registrosAtuais: [...linhas.values()].reduce((total, linha) => total + linha.totalAtual, 0),
      staging: [...linhas.values()].reduce((total, linha) => total + linha.staging, 0),
      quarentena: [...linhas.values()].reduce((total, linha) => total + linha.quarentena, 0),
      ausentes: [...linhas.values()].reduce((total, linha) => total + linha.ausentes, 0),
    },
    inadimplencia: {
      quantidade: inadimplencia._count._all,
      valorAberto: inadimplencia._sum.valorAberto ?? 0,
      emQuarentena: inadimplentesEmQuarentena._count._all,
      valorEmQuarentena: inadimplentesEmQuarentena._sum.valorAberto ?? 0,
    },
    pagamentosVencidos: {
      quantidade: pagamentosVencidos._count._all,
      valorAberto: pagamentosVencidos._sum.valorAberto ?? 0,
      emQuarentena: pagamentosVencidosEmQuarentena._count._all,
      valorEmQuarentena: pagamentosVencidosEmQuarentena._sum.valorAberto ?? 0,
    },
    titulos: {
      itens: titulos,
      total: totalTitulos,
      pagina,
      porPagina,
      totalPaginas,
      estado,
      natureza,
    },
    quarentenas: {
      total: totalItensQuarentena,
      recentes: quarentenasRecentes.map((item) => ({
        id: item.id,
        escopo: item.escopo,
        legadoId: item.legadoId,
        acao: item.acao,
        motivo: item.quarentenaMotivo,
        processadoEm: item.processadoEm,
        capturaId: item.lote.capturaId,
      })),
    },
    origens: {
      /** Núcleo operacional nativo. Nenhuma destas contagens lê o staging. */
      plataforma: {
        contratos: contratosPlataforma,
        titulosReceber: recebimentosPlataforma,
        titulosReceberComValorPago: recebimentosComValorRecebido,
        baixasReceber: pagamentosPlataforma,
        movimentos: movimentosPlataforma,
      },
      /** Cadastros cuja origem externa já está explicitamente gravada. */
      widesysJaImportado: {
        pessoas: pessoasWidesys,
        imoveis: imoveisWidesys,
        catalogos: catalogosWidesys,
      },
      plataformaCadastros: {
        empreendimentos: empreendimentosPlataforma,
        unidades: unidadesPlataforma,
        locatarios: locatariosPlataforma,
        locatariosVinculadosWidesys,
      },
    },
  };
}
