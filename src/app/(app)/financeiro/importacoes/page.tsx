import { redirect } from "next/navigation";
import { exigirPaginaAcesso } from "@/lib/acesso/servidor";

export default async function PaginaImportacaoArquivada() {
  await exigirPaginaAcesso("/financeiro/importacoes");
  redirect("/financeiro/dados");
}
