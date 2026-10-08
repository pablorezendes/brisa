import { notFound } from "next/navigation";
import { exigirPaginaAcesso } from "@/lib/acesso/servidor";
import { ConferenciaRegistro } from "@/components/conferencia-registro";
import type { ParametrosUnificacao } from "@/components/unificacao-apresentacao";

export const metadata = { title: "Conferir registro — Unificação — Brisa" };
export const dynamic = "force-dynamic";

export default async function Pagina({ params, searchParams }: {
  params: Promise<{ chave: string }>;
  searchParams: Promise<ParametrosUnificacao>;
}) {
  await exigirPaginaAcesso("/unificacao/[chave]");
  const [{ chave: chaveParam }, parametros] = await Promise.all([params, searchParams]);
  let chave: string;
  try { chave = decodeURIComponent(chaveParam); } catch { notFound(); }
  return ConferenciaRegistro({ chave, parametros });
}
