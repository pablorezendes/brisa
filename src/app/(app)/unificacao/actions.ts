"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirPermissaoFinanceira } from "@/lib/autorizacao";
import { prisma } from "@/lib/db";
import { analisarUnificacao, decidirUnificacao, ErroUnificacao } from "@/lib/unificacao/servico";

function atualizarTelas() { revalidatePath("/", "layout"); }

export async function sincronizarUnificacao(): Promise<void> {
  const usuario = await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
  await analisarUnificacao(prisma,usuario.sub);
  atualizarTelas();
  redirect("/unificacao?ok=analise-atualizada");
}

export async function resolverUnificacao(form: FormData): Promise<void> {
  const usuario = await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
  const chave = String(form.get("chave") ?? "");
  let erro: string | null = null;
  try {
    await decidirUnificacao(prisma, {
      chave, versao: Number(form.get("versao")), acao: String(form.get("acao")) as "VINCULAR" | "DISTINTO" | "REABRIR",
      destinoChave: String(form.get("destinoChave") ?? ""), hashFonte: String(form.get("hashFonte") ?? ""), hashDestino: String(form.get("hashDestino") ?? ""), justificativa: String(form.get("justificativa") ?? ""),
    },usuario.sub);
  } catch (e) { if (e instanceof ErroUnificacao) erro = e.message; else throw e; }
  atualizarTelas();
  redirect(`/unificacao/${encodeURIComponent(chave)}?${erro ? `erro=${encodeURIComponent(erro)}` : "ok=resolvido"}`);
}
