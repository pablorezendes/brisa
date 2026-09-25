import { redirect } from "next/navigation";
import { exigirAcessoComissoes } from "@/lib/autorizacao";

/** Atalhos antigos preservam o período, sempre após conferir a permissão. */
export default async function ComissaoAntigaPage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string; de?: string; ate?: string }>;
}) {
  await exigirAcessoComissoes();
  const sp = await searchParams;
  const params = new URLSearchParams();
  if (sp.ano) params.set("ano", sp.ano);
  if (sp.de) params.set("de", sp.de);
  if (sp.ate) params.set("ate", sp.ate);
  redirect(`/financeiro/comissoes${params.size ? `?${params}` : ""}`);
}
