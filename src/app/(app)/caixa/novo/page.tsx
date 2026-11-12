import { exigirPaginaAcesso, exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { hrefFinanceiroPeriodo } from "@/lib/consultas/rota-financeira";
import { redirect } from "next/navigation";

export default async function PaginaNovoLancamento({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  await exigirPaginaAcesso("/caixa/novo");
  await exigirPermissaoAcesso("caixa.editar", { global: true });
  redirect(hrefFinanceiroPeriodo("/caixa", await searchParams));
}
