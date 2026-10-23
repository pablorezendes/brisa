"use server";
import { acessoAtual, exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { prisma } from "@/lib/db";
import { consultarResumoRateios, type ResumoRateios } from "@/lib/consultas/rateios";

export async function consultarCustosRateados(mes: string): Promise<{ resumo?: ResumoRateios; erro?: string }> {
  await exigirPermissaoAcesso("despesas.ver", { global: true });
  try { return { resumo: await consultarResumoRateios(prisma, await acessoAtual(), mes || undefined) }; }
  catch { return { erro: "Não foi possível consultar os custos. Confira a competência e tente novamente." }; }
}
