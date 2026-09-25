import { exigirAcessoComissoes } from "@/lib/autorizacao";
import ComissaoConteudo from "./_conteudo";

export const metadata = { title: "Comissões — Brisa" };
export const dynamic = "force-dynamic";

export default async function ComissoesPage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string; de?: string; ate?: string }>;
}) {
  await exigirAcessoComissoes();
  return <ComissaoConteudo searchParams={searchParams} />;
}
