import { exigirPaginaAcesso } from "@/lib/acesso/servidor";
import { hrefFinanceiroPeriodo } from "@/lib/consultas/rota-financeira";
import { redirect } from "next/navigation";

export default async function PainelCobranca({ searchParams }: { searchParams: Promise<{ mes?: string; ano?: string; de?: string; ate?: string }> }) {
  await exigirPaginaAcesso("/paineis/cobranca");
  redirect(hrefFinanceiroPeriodo("/recebimentos", await searchParams, { vencidos: "1" }));
}
