import type { Prisma } from "@prisma/client";
import { cache } from "react";
import { prisma } from "../db";
import { operacaoNaRequisicao } from "./operacao-na-requisicao";
import { idsGovernadosInativos } from "../governanca/filtros";

/**
 * As apurações de aluguel preservam seus insumos e a fórmula de comissão.
 * Suprime cópias Brisa confirmadas e válidas ou exclusões administrativas
 * explícitas, sem alterar os fatos originais nem os snapshots de fechamento.
 * Fontes Widesys e decisões pendentes não retiram linhas da apuração nativa.
 */
const idsSuprimidos = cache(async (): Promise<{ recebimentos: string[]; caixa: string[] }> => {
  const [titulosInativos, caixaInativo] = await Promise.all([idsGovernadosInativos(prisma, "TITULO"), idsGovernadosInativos(prisma, "CAIXA")]);
  const recebimentosGovernados = titulosInativos.filter(id => id.startsWith("BRISA:RECEBER:")).map(id => id.slice("BRISA:RECEBER:".length));
  const candidato = await prisma.unificacaoRegistro.findFirst({
    where: {
      origem: "BRISA", status: "VINCULADO", dominio: { in: ["RECEBER", "MOVIMENTO"] },
      destinoChave: { startsWith: "BRISA:" },
    },
    select: { chave: true },
  });
  if (!candidato) return { recebimentos: recebimentosGovernados, caixa: caixaInativo };

  const { linhas, decisoes } = await operacaoNaRequisicao();
  const porChave = new Map(linhas.map(linha => [linha.chave, linha]));
  const recebimentos = new Set<string>(recebimentosGovernados);
  const caixa = new Set<string>(caixaInativo);
  for (const decisao of decisoes) {
    const fonte = porChave.get(decisao.chave);
    const principal = decisao.destinoChave ? porChave.get(decisao.destinoChave) : null;
    if (!fonte || fonte.origem !== "BRISA" || fonte.estado !== "VINCULADO" ||
        !principal || principal.origem !== "BRISA" || principal.estado !== "ATIVO" ||
        principal.dominio !== fonte.dominio) continue;
    if (fonte.dominio === "RECEBER") recebimentos.add(fonte.origemId);
    if (fonte.dominio === "MOVIMENTO") caixa.add(fonte.origemId);
  }
  return { recebimentos: [...recebimentos], caixa: [...caixa] };
});

const fechamentos = cache(() => prisma.fechamentoMensal.findMany({
  select: { mesLancamento: true, unificacaoExcluidos: true, fechadoEm: true },
}));

function exclusoesCongeladas(snapshot: string): string[] {
  // Um snapshot malformado não autoriza ocultar lançamentos históricos.
  try {
    const ids: unknown = JSON.parse(snapshot);
    return Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))] : [];
  } catch { return []; }
}

type TransicaoGovernanca = { acao: string; estadoAnterior: string; estadoNovo: string; criadoEm: Date };

function restauracaoComprovadaAposFechamento(eventosDecrescentes: TransicaoGovernanca[], fechadoEm: Date): boolean {
  if (!(fechadoEm instanceof Date) || !Number.isFinite(fechadoEm.getTime()) ||
      eventosDecrescentes.some(e => !(e.criadoEm instanceof Date) || !Number.isFinite(e.criadoEm.getTime()))) return false;
  // O último evento até o fechamento deve comprovar a exclusão administrativa
  // naquele instante. Excluir/restaurar depois não libera uma cópia congelada.
  const indiceExclusao = eventosDecrescentes.findIndex(e => e.criadoEm.getTime() <= fechadoEm.getTime());
  const exclusao = eventosDecrescentes[indiceExclusao];
  if (!exclusao || exclusao.acao !== "EXCLUIDO" || exclusao.estadoAnterior !== "ATIVO" || exclusao.estadoNovo !== "EXCLUIDO") return false;

  // Valida a cadeia completa, não só o último par: podem existir vários ciclos
  // excluir/restaurar depois do fechamento. Lacunas ou outras decisões mantêm
  // a supressão congelada, sem inferir uma restauração apenas pelo estado atual.
  let estado = "EXCLUIDO";
  for (const evento of eventosDecrescentes.slice(0, indiceExclusao).reverse()) {
    const proximo = estado === "EXCLUIDO" ? "ATIVO" : "EXCLUIDO";
    if (evento.estadoAnterior !== estado || evento.estadoNovo !== proximo || evento.acao !== proximo) return false;
    estado = proximo;
  }
  return estado === "ATIVO";
}

export async function filtroRecebimentosUnificados(): Promise<Prisma.RecebimentoWhereInput> {
  const [{ recebimentos }, mesesFechados, titulosInativos] = await Promise.all([idsSuprimidos(), fechamentos(), idsGovernadosInativos(prisma, "TITULO")]);
  const exclusoesExplicitas = titulosInativos.filter(id => id.startsWith("BRISA:RECEBER:")).map(id => id.slice("BRISA:RECEBER:".length));
  if (!mesesFechados.length) return recebimentos.length ? { id: { notIn: recebimentos } } : {};

  const snapshots = mesesFechados.map(f => ({ mes: f.mesLancamento, fechadoEm: f.fechadoEm, ids: exclusoesCongeladas(f.unificacaoExcluidos) }));
  const idsSnapshot = [...new Set(snapshots.flatMap(f => f.ids))];
  const restaurados = idsSnapshot.length ? await prisma.recursoGovernado.findMany({
    where: { tipo: "TITULO", status: "ATIVO", origemId: { in: idsSnapshot.map(id => `BRISA:RECEBER:${id}`) } },
    select: { origemId: true, status: true, eventos: {
      orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
      select: { acao: true, estadoAnterior: true, estadoNovo: true, criadoEm: true },
    } },
  }) : [];
  const historicosAtivos = new Map(restaurados.filter(r => r.status === "ATIVO")
    .map(r => [r.origemId.slice("BRISA:RECEBER:".length), r.eventos ?? []]));
  const suprimidosAtuais = new Set(recebimentos);
  const congelados = snapshots.map(f => ({ mes: f.mes, ids: f.ids.filter(id => {
    const historico = historicosAtivos.get(id);
    // Só retira do filtro operacional a exclusão restaurada DEPOIS de fechar.
    // Cópias atualmente vinculadas continuam suprimidas; o snapshot é imutável.
    return !historico || suprimidosAtuais.has(id) || !restauracaoComprovadaAposFechamento(historico, f.fechadoEm);
  }) }));
  if (!recebimentos.length && congelados.every(f => !f.ids.length)) return {};
  // A exclusão administrativa explícita retira o registro da visão operacional,
  // inclusive em mês fechado. O snapshot e seus valores originais não são reescritos.
  return { OR: [
    {
      mesLancamento: { notIn: congelados.map(f => f.mes) },
      ...(recebimentos.length ? { id: { notIn: recebimentos } } : {}),
    },
    ...congelados.map(f => ({ mesLancamento: f.mes, ...((f.ids.length || exclusoesExplicitas.length) ? { id: { notIn: [...new Set([...f.ids, ...exclusoesExplicitas])] } } : {}) })),
  ] };
}

export async function filtroCaixaUnificado(): Promise<Prisma.LancamentoCaixaWhereInput> {
  const { caixa } = await idsSuprimidos();
  return caixa.length ? { id: { notIn: caixa } } : {};
}
