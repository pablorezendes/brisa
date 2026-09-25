import { OperacaoUnificada, type ParametrosUnificacao } from "@/components/operacao-unificada";
export const metadata = { title: "Contratos unificados — Brisa" };
export const dynamic = "force-dynamic";
export default async function Pagina({ searchParams }: { searchParams: Promise<ParametrosUnificacao> }) {
  return <OperacaoUnificada dominio="CONTRATO" titulo="Contratos" base="/cadastros/contratos-unificados" parametros={await searchParams} nativo={{ href: "/contratos?visao=locacao", rotulo: "Administrar locações" }} />;
}
