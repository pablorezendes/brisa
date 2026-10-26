"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { exigirPermissaoFinanceira } from "@/lib/autorizacao";
import { prisma } from "@/lib/db";
import { prepararConferenciaLote, concluirConferenciaLote } from "@/lib/unificacao/conferencia-lote";
import { ErroUnificacao } from "@/lib/unificacao/servico";
import type { DominioConferenciaLote, EntradaConferenciaLote, PreviaConferenciaLote, ResultadoConferenciaLote } from "@/lib/unificacao/tipos-conferencia-lote";

type Falha = { estado: "ERRO"; mensagem: string };
function falha(erro: unknown): Falha {
  return { estado: "ERRO", mensagem: erro instanceof ErroUnificacao ? erro.message
    : "Não foi possível confirmar o resultado. Atualize a seleção para consultar a situação antes de tentar novamente. Os registros já conferidos não serão somados novamente." };
}

async function autorizar() {
  await exigirPermissaoAcesso("unificacao.editar", { global: true });
  const acesso = await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
  return { id: acesso.sub };
}

export async function prepararConferenciaSelecionados(selecao: { dominio: DominioConferenciaLote; chaves: string[] }): Promise<{ estado: "PRONTO"; previa: PreviaConferenciaLote } | Falha> {
  const ator = await autorizar();
  try {
    return { estado: "PRONTO", previa: await prepararConferenciaLote(prisma, selecao, ator) };
  } catch (erro) { return falha(erro); }
}

export async function conferirTitulosSelecionados(entrada: EntradaConferenciaLote): Promise<{ estado: "CONCLUIDO"; resultado: ResultadoConferenciaLote } | Falha> {
  const ator = await autorizar();
  let resultado: ResultadoConferenciaLote;
  try {
    resultado = await concluirConferenciaLote(prisma, entrada, ator);
  } catch (erro) { return falha(erro); }
  // Uma resposta anterior pode ter se perdido após o commit. Mesmo no retorno
  // idempotente, a lista precisa refletir a conferência que já foi concluída.
  revalidatePath("/", "layout");
  return { estado: "CONCLUIDO", resultado };
}
