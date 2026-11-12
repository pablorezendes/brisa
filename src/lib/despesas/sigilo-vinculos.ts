import type { Prisma } from "@prisma/client";
import { carregarDadosFontesUnificacao, derivarFontesUnificacao } from "../unificacao/fontes";
import { chavesRestritasUnificacao } from "../unificacao/privacidade";

/** Um vínculo antigo pode identificar o mesmo documento já marcado como restrito. */
export async function despesaRestritaPorVinculo(db: Prisma.TransactionClient, chave: string) {
  const vinculos = await db.unificacaoRegistro.findMany({
    where: { dominio: "PAGAR", destinoChave: { not: null } },
    select: { chave: true, destinoChave: true },
  });
  if (!vinculos.some(d => d.chave === chave || d.destinoChave === chave)) return false;
  const fontes = await derivarFontesUnificacao(await carregarDadosFontesUnificacao(db, "PAGAR", false), false);
  return chavesRestritasUnificacao(fontes, vinculos).has(chave);
}
