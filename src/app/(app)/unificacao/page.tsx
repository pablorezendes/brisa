import { exigirPaginaAcesso, exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { OperacaoUnificada, type ParametrosUnificacao } from "@/components/operacao-unificada";
export const metadata = { title: "Unificação e duplicidades — Brisa" };
export const dynamic = "force-dynamic";
export default async function Pagina({ searchParams }: { searchParams: Promise<ParametrosUnificacao> }) {
  await exigirPaginaAcesso("/unificacao");
  await exigirPermissaoAcesso("cadastros.sensiveis", { global: true });
  return <OperacaoUnificada titulo="Unificação e duplicidades" base="/unificacao" parametros={await searchParams} central />;
}
