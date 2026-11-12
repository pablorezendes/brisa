"use server";

import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirPermissaoFinanceira } from "@/lib/autorizacao";
import { prisma } from "@/lib/db";
import { analisarUnificacao, decidirUnificacao, ErroUnificacao } from "@/lib/unificacao/servico";
import { dominioFinanceiroUnificacao } from "@/lib/unificacao/projecao-widesys";
import type { ResultadoNaTela } from "@/lib/interface/resultado-na-tela";

function atualizarTelas() { revalidatePath("/", "layout"); }

function exigirConferenciaCadastral(chave: string) {
  if (dominioFinanceiroUnificacao(chave.split(":")[1] ?? "")) {
    throw new ErroUnificacao("FONTE_FINANCEIRA_WIDESYS", "Os lançamentos financeiros são atualizados pelo Widesys.");
  }
}

export async function resolverUnificacaoNaTela(_estado: ResultadoNaTela, form: FormData): Promise<ResultadoNaTela> {
  await exigirPermissaoAcesso("unificacao.editar", { global: true });
  const usuario = await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
  let resultado: ResultadoNaTela;
  try {
    exigirConferenciaCadastral(String(form.get("chave") ?? ""));
    await decidirUnificacao(prisma, {
      chave: String(form.get("chave") ?? ""), versao: Number(form.get("versao")),
      acao: String(form.get("acao")) as "VINCULAR" | "DISTINTO" | "REABRIR",
      destinoChave: String(form.get("destinoChave") ?? ""), hashFonte: String(form.get("hashFonte") ?? ""),
      hashDestino: String(form.get("hashDestino") ?? ""), justificativa: String(form.get("justificativa") ?? ""),
    }, usuario.sub);
    resultado = { ok: "Decisão registrada. A lista e os totais foram atualizados." };
  } catch (erro) {
    if (!(erro instanceof ErroUnificacao)) throw erro;
    resultado = { erro: erro.message };
  }
  atualizarTelas();
  return resultado;
}

export async function sincronizarUnificacaoNaTela(estado: ResultadoNaTela, form: FormData): Promise<ResultadoNaTela> {
  await exigirPermissaoAcesso("unificacao.editar", { global: true });
  void estado; void form;
  const usuario = await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
  try { await analisarUnificacao(prisma, usuario.sub, false, true); }
  catch (erro) {
    if (!(erro instanceof ErroUnificacao)) throw erro;
    return { erro: erro.message };
  }
  atualizarTelas();
  return { ok: "Correspondências atualizadas nesta lista. Nenhum dado novo foi buscado no Widesys." };
}

export async function sincronizarUnificacao(): Promise<void> {
  await exigirPermissaoAcesso("unificacao.editar", { global: true });
  const usuario = await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
  await analisarUnificacao(prisma, usuario.sub, false, true);
  atualizarTelas();
  redirect("/unificacao?ok=analise-atualizada");
}

export async function resolverUnificacao(form: FormData): Promise<void> {
  await exigirPermissaoAcesso("unificacao.editar", { global: true });
  const usuario = await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
  const chave = String(form.get("chave") ?? "");
  let erro: string | null = null;
  try {
    exigirConferenciaCadastral(chave);
    await decidirUnificacao(prisma, {
      chave, versao: Number(form.get("versao")), acao: String(form.get("acao")) as "VINCULAR" | "DISTINTO" | "REABRIR",
      destinoChave: String(form.get("destinoChave") ?? ""), hashFonte: String(form.get("hashFonte") ?? ""), hashDestino: String(form.get("hashDestino") ?? ""), justificativa: String(form.get("justificativa") ?? ""),
    },usuario.sub);
  } catch (e) { if (e instanceof ErroUnificacao) erro = e.message; else throw e; }
  atualizarTelas();
  redirect(`/unificacao/${encodeURIComponent(chave)}?${erro ? `erro=${encodeURIComponent(erro)}` : "ok=resolvido"}`);
}
