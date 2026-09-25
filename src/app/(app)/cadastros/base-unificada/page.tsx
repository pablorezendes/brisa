import { OperacaoUnificada, primeiroParametro, type ParametrosUnificacao } from "@/components/operacao-unificada";
export const metadata = { title: "Base cadastral unificada — Brisa" };
export const dynamic = "force-dynamic";
export default async function Pagina({ searchParams }: { searchParams: Promise<ParametrosUnificacao> }) {
  const sp = await searchParams;
  const dominio = primeiroParametro(sp.dominio) ?? "PESSOA";
  return <OperacaoUnificada titulo="Base cadastral unificada" base="/cadastros/base-unificada" parametros={{ ...sp, dominio }} />;
}
