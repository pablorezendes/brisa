import { exigirPaginaAcesso } from "@/lib/acesso/servidor";
import { exigirAcessoComissoes } from "@/lib/autorizacao";
import ComissaoConteudo from "./_conteudo";

export const metadata = { title: "Comissões — Brisa" };
export const dynamic = "force-dynamic";

export default async function ComissoesPage() {
  await exigirPaginaAcesso("/financeiro/comissoes");
  await exigirAcessoComissoes();
  return <ComissaoConteudo />;
}
