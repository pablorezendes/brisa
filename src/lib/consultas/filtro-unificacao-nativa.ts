import type { Prisma } from "@prisma/client";
import { cache } from "react";
import { prisma } from "../db";
import { operacaoNaRequisicao } from "./operacao-na-requisicao";
import { idsGovernadosInativos } from "../governanca/filtros";

/**
 * As apurações de aluguel preservam seus insumos e a fórmula de comissão.
 * Somente uma cópia Brisa confirmada e atualmente válida é suprimida; fontes
 * Widesys e decisões pendentes nunca retiram uma linha da apuração nativa.
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
  select: { mesLancamento: true, unificacaoExcluidos: true },
}));

function exclusoesCongeladas(snapshot: string): string[] {
  // Um snapshot malformado não autoriza ocultar lançamentos históricos.
  try {
    const ids: unknown = JSON.parse(snapshot);
    return Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))] : [];
  } catch { return []; }
}

export async function filtroRecebimentosUnificados(): Promise<Prisma.RecebimentoWhereInput> {
  const [{ recebimentos }, mesesFechados] = await Promise.all([idsSuprimidos(), fechamentos()]);
  if (!mesesFechados.length) return recebimentos.length ? { id: { notIn: recebimentos } } : {};

  const congelados = mesesFechados.map(f => ({ mes: f.mesLancamento, ids: exclusoesCongeladas(f.unificacaoExcluidos) }));
  if (!recebimentos.length && congelados.every(f => !f.ids.length)) return {};
  // Alterações cadastrais podem invalidar hashes atuais, mas não reabrem uma
  // apuração fechada. Fechamentos antigos (snapshot []) mantêm todos os insumos.
  return { OR: [
    {
      mesLancamento: { notIn: congelados.map(f => f.mes) },
      ...(recebimentos.length ? { id: { notIn: recebimentos } } : {}),
    },
    ...congelados.map(f => ({ mesLancamento: f.mes, ...(f.ids.length ? { id: { notIn: f.ids } } : {}) })),
  ] };
}

export async function filtroCaixaUnificado(): Promise<Prisma.LancamentoCaixaWhereInput> {
  const { caixa } = await idsSuprimidos();
  return caixa.length ? { id: { notIn: caixa } } : {};
}
