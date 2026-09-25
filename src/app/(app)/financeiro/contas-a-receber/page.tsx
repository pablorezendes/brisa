import { OperacaoUnificada, type ParametrosUnificacao } from "@/components/operacao-unificada";
export const metadata = { title: "Contas a receber — Brisa" };
export const dynamic = "force-dynamic";
export default async function Pagina({ searchParams }: { searchParams: Promise<ParametrosUnificacao> }) {
  return <OperacaoUnificada dominio="RECEBER" titulo="Contas a receber" base="/financeiro/contas-a-receber" parametros={await searchParams} nativo={{ href: "/recebimentos?visao=locacao", rotulo: "Lançamentos de locação" }} />;
}
