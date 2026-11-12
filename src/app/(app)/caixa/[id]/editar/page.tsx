import { exigirPaginaAcesso, exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { redirect } from "next/navigation";

export default async function PaginaEditarLancamento() {
  await exigirPaginaAcesso("/caixa/[id]/editar");
  await exigirPermissaoAcesso("caixa.editar", { global: true });
  redirect("/caixa");
}
