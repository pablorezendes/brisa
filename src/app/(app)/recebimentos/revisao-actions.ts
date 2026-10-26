"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { exigirPermissaoFinanceira } from "@/lib/autorizacao";
import { prisma } from "@/lib/db";
import { concluirRevisaoFinanceira, obterRevisaoFinanceira } from "@/lib/unificacao/revisao-financeira";
import { ErroUnificacao } from "@/lib/unificacao/servico";
import type { ConcluirRevisaoFinanceiraEntrada, RevisaoFinanceira } from "@/lib/unificacao/tipos-revisao-financeira";

type Resultado = { ok: true; revisao: RevisaoFinanceira } | { ok: false; mensagem: string };

function validarRecebimento(chave: string | undefined) {
  if (typeof chave !== "string" || !/^(BRISA|WIDESYS):RECEBER:[^\s:]{1,150}$/.test(chave)) {
    throw new ErroUnificacao("ORIGEM_INVALIDA", "Reabra uma conta a receber válida para conferir.");
  }
}

function falha(erro: unknown): Resultado {
  return { ok: false, mensagem: erro instanceof ErroUnificacao ? erro.message
    : "Não foi possível confirmar a conferência. Reabra o lançamento para consultar a situação atual antes de tentar novamente." };
}

export async function carregarRevisaoRecebimento(selecao: { chave: string }): Promise<Resultado> {
  const acesso = await exigirPermissaoAcesso("financeiro.ver", { global: true });
  await exigirPermissaoAcesso("unificacao.ver", { global: true });
  await exigirPermissaoAcesso("cadastros.sensiveis", { global: true });
  try {
    validarRecebimento(selecao?.chave);
    return { ok: true, revisao: await obterRevisaoFinanceira(prisma, selecao, { id: acesso.usuarioId }) };
  } catch (erro) { return falha(erro); }
}

export async function confirmarRevisaoRecebimento(entrada: ConcluirRevisaoFinanceiraEntrada): Promise<Resultado> {
  await exigirPermissaoAcesso("unificacao.editar", { global: true });
  const acesso = await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
  try {
    validarRecebimento(entrada?.chave);
    const resultado = await concluirRevisaoFinanceira(prisma, entrada, { id: acesso.sub });
    revalidatePath("/", "layout");
    return { ok: true, revisao: resultado.revisao };
  } catch (erro) { return falha(erro); }
}
