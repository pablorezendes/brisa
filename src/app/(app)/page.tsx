import { exigirPaginaAcesso } from "@/lib/acesso/servidor";
import { hrefFinanceiroPeriodo } from "@/lib/consultas/rota-financeira";
import { redirect } from "next/navigation";

export default async function Home({ searchParams }: { searchParams: Promise<{ mes?: string; ano?: string; de?: string; ate?: string }> }) {
  await exigirPaginaAcesso("/");
  redirect(hrefFinanceiroPeriodo("/executivo", await searchParams));
}
