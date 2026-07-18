/**
 * Consultas compartilhadas do módulo de LOCAÇÃO (/recebimentos e /contratos).
 * Somente leitura — mutações ficam nas server actions de cada rota.
 *
 * Valores em centavos (Int); meses "YYYY-MM"; datas "YYYY-MM-DD".
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

// ---------- validação de formatos ----------

export const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;
export const RE_DATA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Vias de pagamento aceitas (SERVICO existe nos dados migrados da planilha). */
export const VIAS_PAGAMENTO = ["BOLETO", "PIX", "DINHEIRO", "SERVICO"] as const;

export const TIPOS_UNIDADE = ["residencial", "comercial", "temporada"] as const;
export const STATUS_CONTRATO = ["ativo", "acordo", "encerrado"] as const;

/** "2026-01-05" → "05/01/2026" (string pura, sem Date/fuso). */
export function formatarDataBR(data: string | null | undefined): string {
  if (!data || !RE_DATA.test(data)) return data || "—";
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}

// ---------- recebimentos ----------

const incluirRelacoesRecebimento = {
  contrato: { include: { unidade: true, locatario: true } },
  empreendimento: true,
} satisfies Prisma.RecebimentoInclude;

export type RecebimentoComRelacoes = Prisma.RecebimentoGetPayload<{
  include: typeof incluirRelacoesRecebimento;
}>;

/** Todos os lançamentos de um mês operacional (aba RECEB), com relações. */
export async function recebimentosDoMes(
  mes: string
): Promise<RecebimentoComRelacoes[]> {
  return prisma.recebimento.findMany({
    where: { mesLancamento: mes },
    include: incluirRelacoesRecebimento,
    orderBy: [
      { empreendimento: { nome: "asc" } },
      { contrato: { unidade: { identificacao: "asc" } } },
    ],
  });
}

/** Histórico de lançamentos de um contrato (todas as abas/meses). */
export async function recebimentosDoContrato(
  contratoId: string
): Promise<RecebimentoComRelacoes[]> {
  return prisma.recebimento.findMany({
    where: { contratoId },
    include: incluirRelacoesRecebimento,
    orderBy: [{ mesLancamento: "asc" }, { competencia: "asc" }],
  });
}

/** Meses "YYYY-MM" que possuem lançamentos, em ordem crescente. */
export async function mesesComLancamento(): Promise<string[]> {
  const grupos = await prisma.recebimento.groupBy({
    by: ["mesLancamento"],
    orderBy: { mesLancamento: "asc" },
  });
  return grupos.map((g) => g.mesLancamento);
}

/**
 * Mês padrão da tela de recebimentos: o mais recente com algum recebimento
 * registrado (o mês "em operação"); se nada foi recebido ainda, o mês de
 * lançamento mais recente.
 */
export async function mesPadraoRecebimentos(): Promise<string | null> {
  const comRecebido = await prisma.recebimento.aggregate({
    _max: { mesLancamento: true },
    where: { recebido: { not: null } },
  });
  if (comRecebido._max.mesLancamento) return comRecebido._max.mesLancamento;
  const qualquer = await prisma.recebimento.aggregate({
    _max: { mesLancamento: true },
  });
  return qualquer._max.mesLancamento;
}

/** Fechamento do mês operacional, se houver (mês fechado = travado). */
export async function fechamentoDoMes(mes: string) {
  return prisma.fechamentoMensal.findUnique({ where: { mesLancamento: mes } });
}

/**
 * Taxa de comissão (bps) vigente para um mês: parâmetro com vigência exata,
 * senão o de vigência mais recente anterior, senão 1000 (10%).
 */
export async function taxaComissaoParaMes(mes: string): Promise<number> {
  const exata = await prisma.parametroComissao.findUnique({
    where: { vigencia: mes },
  });
  if (exata) return exata.taxaBps;
  const anterior = await prisma.parametroComissao.findFirst({
    where: { vigencia: { lt: mes } },
    orderBy: { vigencia: "desc" },
  });
  return anterior?.taxaBps ?? 1000;
}

// ---------- contratos ----------

const incluirRelacoesContrato = {
  unidade: { include: { empreendimento: true } },
  locatario: true,
} satisfies Prisma.ContratoInclude;

export type ContratoComRelacoes = Prisma.ContratoGetPayload<{
  include: typeof incluirRelacoesContrato;
}>;

const ordemContratos = [
  { unidade: { empreendimento: { nome: "asc" } } },
  { unidade: { identificacao: "asc" } },
] satisfies Prisma.ContratoOrderByWithRelationInput[];

/** Contratos com status "ativo" (base do "Gerar devidos do mês"). */
export async function contratosAtivos(): Promise<ContratoComRelacoes[]> {
  return prisma.contrato.findMany({
    where: { status: "ativo" },
    include: incluirRelacoesContrato,
    orderBy: ordemContratos,
  });
}

/** Rent roll: ativos + acordos (e encerrados, se pedido), agrupável por empreendimento. */
export async function contratosParaLista(
  incluirEncerrados: boolean
): Promise<ContratoComRelacoes[]> {
  return prisma.contrato.findMany({
    where: incluirEncerrados ? undefined : { status: { not: "encerrado" } },
    include: incluirRelacoesContrato,
    orderBy: ordemContratos,
  });
}

/** Todos os contratos, para selects (lançamento avulso aceita até encerrados — atrasos). */
export async function contratosParaSelecao(): Promise<ContratoComRelacoes[]> {
  return prisma.contrato.findMany({
    include: incluirRelacoesContrato,
    orderBy: ordemContratos,
  });
}

export async function contratoDetalhe(
  id: string
): Promise<ContratoComRelacoes | null> {
  return prisma.contrato.findUnique({
    where: { id },
    include: incluirRelacoesContrato,
  });
}

// ---------- cadastros auxiliares (selects de formulário) ----------

export async function empreendimentosAtivos() {
  return prisma.empreendimento.findMany({
    where: { ativo: true },
    orderBy: { nome: "asc" },
  });
}

export type UnidadeComEmpreendimento = Prisma.UnidadeGetPayload<{
  include: { empreendimento: true };
}>;

export async function unidadesParaSelecao(): Promise<UnidadeComEmpreendimento[]> {
  return prisma.unidade.findMany({
    where: { ativo: true },
    include: { empreendimento: true },
    orderBy: [{ empreendimento: { nome: "asc" } }, { identificacao: "asc" }],
  });
}

export async function locatariosParaSelecao() {
  return prisma.locatario.findMany({ orderBy: { nomeNorm: "asc" } });
}
