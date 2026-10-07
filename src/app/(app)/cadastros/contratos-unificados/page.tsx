import { exigirPaginaAcesso, exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { OperacaoUnificada, type ParametrosUnificacao } from "@/components/operacao-unificada";
export const metadata = { title: "Contratos unificados — Brisa" };
export const dynamic = "force-dynamic";
export default async function Pagina({ searchParams }: { searchParams: Promise<ParametrosUnificacao> }) {
  await exigirPaginaAcesso("/cadastros/contratos-unificados");
  await exigirPermissaoAcesso("cadastros.sensiveis", { global: true });
  return <OperacaoUnificada dominio="CONTRATO" titulo="Contratos" base="/cadastros/contratos-unificados" parametros={await searchParams} nativo={{ href: "/contratos?visao=locacao", rotulo: "Administrar locações" }} />;
}
