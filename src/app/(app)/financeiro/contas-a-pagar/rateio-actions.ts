"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { prisma } from "@/lib/db";
import { obterEditorDespesa, salvarDespesa } from "@/lib/despesas/servico";
import { ErroDespesa, type DespesaEditor, type SalvarDespesaEntrada, type ResultadoSalvarDespesa } from "@/lib/despesas/tipos";

type Falha = { ok: false; mensagem: string };
function falha(erro: unknown): Falha {
  return { ok: false, mensagem: erro instanceof ErroDespesa ? erro.message : "Não foi possível concluir. Confira sua conexão e tente novamente; nenhum sucesso foi confirmado." };
}

export async function carregarRateioDespesa(selecao: { id?: string; origemChave?: string }): Promise<{ ok: true; editor: DespesaEditor } | Falha> {
  const acesso = await exigirPermissaoAcesso("despesas.ver", { global: true });
  if (typeof selecao?.origemChave !== "string" || !/^WIDESYS:PAGAR:[^\s:]+$/.test(selecao.origemChave)) return { ok: false, mensagem: "Selecione uma conta a pagar do Widesys." };
  try { return { ok: true, editor: await obterEditorDespesa(prisma, selecao, { id: acesso.usuarioId }) }; }
  catch (erro) { return falha(erro); }
}

export async function salvarRateioDespesa(entrada: SalvarDespesaEntrada): Promise<{ ok: true; resultado: ResultadoSalvarDespesa } | Falha> {
  const acesso = await exigirPermissaoAcesso("despesas.editar", { global: true });
  if (typeof entrada?.origemChave !== "string" || !/^WIDESYS:PAGAR:[^\s:]+$/.test(entrada.origemChave) || entrada.pagamento?.modo !== "MANTER") {
    return { ok: false, mensagem: "O rateio deve estar vinculado a uma conta a pagar do Widesys." };
  }
  let resultado: ResultadoSalvarDespesa;
  try { resultado = await salvarDespesa(prisma, entrada, { id: acesso.usuarioId }); }
  catch (erro) { return falha(erro); }
  revalidatePath("/", "layout");
  return { ok: true, resultado };
}
