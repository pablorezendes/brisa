import { OperacaoUnificada, type ParametrosUnificacao } from "@/components/operacao-unificada";
export const metadata = { title: "Contas a pagar — Brisa" };
export const dynamic = "force-dynamic";
export default async function Pagina({ searchParams }: { searchParams: Promise<ParametrosUnificacao> }) {
  return <OperacaoUnificada dominio="PAGAR" titulo="Contas a pagar" base="/financeiro/contas-a-pagar" parametros={await searchParams} />;
}
