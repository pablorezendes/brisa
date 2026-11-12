import { acessoAtual, exigirPaginaAcesso } from "@/lib/acesso/servidor";
import { podeAbrirRota } from "@/lib/acesso/politica";
import { hrefFinanceiroPeriodo } from "@/lib/consultas/rota-financeira";
import { redirect } from "next/navigation";

export default async function PaginaPainelEmpreendimentos({ searchParams }: { searchParams: Promise<{ mes?: string; ano?: string; de?: string; ate?: string }> }) {
  await exigirPaginaAcesso("/paineis/empreendimentos");
  if (!podeAbrirRota(await acessoAtual(), "/executivo")) redirect("/carteira?aba=financeiro");
  redirect(hrefFinanceiroPeriodo("/executivo", await searchParams));
}
