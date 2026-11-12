import { exigirPaginaAcesso } from "@/lib/acesso/servidor";
import { hrefFinanceiroPeriodo } from "@/lib/consultas/rota-financeira";
import { redirect } from "next/navigation";

export default async function PaginaPainelCaixa({ searchParams }: { searchParams: Promise<{ mes?: string; ano?: string; de?: string; ate?: string }> }) {
  await exigirPaginaAcesso("/paineis/caixa");
  redirect(hrefFinanceiroPeriodo("/caixa", await searchParams));
}
