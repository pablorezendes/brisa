import { exigirPaginaAcesso } from "@/lib/acesso/servidor";
import { redirect } from "next/navigation";

export default async function PaginaHistoricoTemporada() {
  await exigirPaginaAcesso("/temporada/historico");
  redirect("/temporada");
}
