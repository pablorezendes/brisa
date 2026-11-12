import { exigirPaginaAcesso } from "@/lib/acesso/servidor";
import { OperacaoUnificada, podeAcessarUnificacao, type ParametrosUnificacao } from "@/components/operacao-unificada";
import { hrefFinanceiroPeriodo } from "@/lib/consultas/rota-financeira";
import { redirect } from "next/navigation";

export default async function PaginaRecebimentos({ searchParams }: { searchParams: Promise<ParametrosUnificacao> }) {
  await exigirPaginaAcesso("/recebimentos");
  const parametros = await searchParams;
  if (!await podeAcessarUnificacao()) {
    redirect(hrefFinanceiroPeriodo("/carteira", { mes: typeof parametros.mes === "string" ? parametros.mes : undefined }, { aba: "financeiro" }));
  }
  return <OperacaoUnificada dominio="RECEBER" titulo="Contas a receber" base="/recebimentos" parametros={parametros} />;
}
