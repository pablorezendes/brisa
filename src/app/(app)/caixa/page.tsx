import { exigirPaginaAcesso } from "@/lib/acesso/servidor";
import { OperacaoUnificada, podeAcessarUnificacao, type ParametrosUnificacao } from "@/components/operacao-unificada";
import { redirect } from "next/navigation";

export default async function PaginaCaixa({ searchParams }: { searchParams: Promise<ParametrosUnificacao> }) {
  await exigirPaginaAcesso("/caixa");
  if (!await podeAcessarUnificacao()) redirect("/carteira?aba=financeiro");
  return <OperacaoUnificada dominio="MOVIMENTO" titulo="Entradas e saídas" base="/caixa" parametros={await searchParams} />;
}
