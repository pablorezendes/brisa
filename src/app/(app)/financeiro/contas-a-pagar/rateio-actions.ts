"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { prisma } from "@/lib/db";
import { buscarPagamentosDisponiveis, obterEditorDespesa, salvarDespesa } from "@/lib/despesas/servico";
import { ErroDespesa, type DespesaEditor, type PagamentoDisponivel, type SalvarDespesaEntrada, type ResultadoSalvarDespesa } from "@/lib/despesas/tipos";
import { obterRevisaoDespesa, concluirRevisaoDespesa } from "@/lib/despesas/revisao";
import type { RevisaoDespesa, ConcluirRevisaoDespesaEntrada } from "@/lib/despesas/tipos-revisao";
import { exigirPermissaoFinanceira } from "@/lib/autorizacao";
import { ErroUnificacao } from "@/lib/unificacao/servico";

type Falha = { ok: false; mensagem: string };
function falha(erro: unknown): Falha {
  return { ok: false, mensagem: erro instanceof ErroDespesa || erro instanceof ErroUnificacao ? erro.message : "Não foi possível concluir. Confira sua conexão e tente novamente; nenhum sucesso foi confirmado." };
}

export async function carregarRevisaoDespesa(selecao: { id?: string; origemChave?: string }): Promise<{ ok: true; revisao: RevisaoDespesa | null } | Falha> {
  const acesso = await exigirPermissaoAcesso("despesas.ver", { global: true });
  await exigirPermissaoAcesso("cadastros.sensiveis", { global: true });
  try { return { ok: true, revisao: await obterRevisaoDespesa(prisma, selecao, { id: acesso.usuarioId }) }; }
  catch (erro) { return falha(erro); }
}

export async function confirmarRevisaoDespesa(entrada: ConcluirRevisaoDespesaEntrada): Promise<{ ok: true; revisao: RevisaoDespesa | null } | Falha> {
  await exigirPermissaoAcesso("unificacao.editar", { global: true });
  const acesso = await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
  try {
    const resultado = await concluirRevisaoDespesa(prisma, entrada, { id: acesso.sub });
    revalidatePath("/", "layout");
    return { ok: true, revisao: resultado.revisao };
  } catch (erro) { return falha(erro); }
}

export async function carregarRateioDespesa(selecao: { id?: string; origemChave?: string }): Promise<{ ok: true; editor: DespesaEditor } | Falha> {
  const acesso = await exigirPermissaoAcesso("despesas.ver", { global: true });
  try { return { ok: true, editor: await obterEditorDespesa(prisma, selecao, { id: acesso.usuarioId }) }; }
  catch (erro) { return falha(erro); }
}

export async function salvarRateioDespesa(entrada: SalvarDespesaEntrada): Promise<{ ok: true; resultado: ResultadoSalvarDespesa } | Falha> {
  const acesso = await exigirPermissaoAcesso("despesas.editar", { global: true });
  let resultado: ResultadoSalvarDespesa;
  try { resultado = await salvarDespesa(prisma, entrada, { id: acesso.usuarioId }); }
  catch (erro) { return falha(erro); }
  revalidatePath("/", "layout");
  return { ok: true, resultado };
}

export async function procurarPagamentoDespesa(consulta: { termo?: string; total: number }): Promise<{ ok: true; pagamentos: PagamentoDisponivel[] } | Falha> {
  const acesso = await exigirPermissaoAcesso("despesas.editar", { global: true });
  try { return { ok: true, pagamentos: await buscarPagamentosDisponiveis(prisma, consulta, { id: acesso.usuarioId }) }; }
  catch (erro) { return falha(erro); }
}
