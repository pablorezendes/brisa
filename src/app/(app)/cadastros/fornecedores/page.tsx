import Link from "next/link";
import { exigirPaginaAcesso, exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { prisma } from "@/lib/db";
import { listarFornecedores } from "@/lib/fornecedores/servico";
import { FornecedoresPainel } from "@/components/fornecedores-painel";
import { PageHeader, btnSecundario, inputBase } from "@/components/ui";
import { NavegacaoCadastros } from "../_components";

export const metadata = { title: "Fornecedores — Cadastros — Brisa" };
const primeiro = (s: string | string[] | undefined) => Array.isArray(s) ? s[0] : s;

export default async function PaginaFornecedores({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await exigirPaginaAcesso("/cadastros/fornecedores");
  const acesso = await exigirPermissaoAcesso("cadastros.sensiveis", { global: true });
  const sp = await searchParams; const termo = (primeiro(sp.q) ?? "").trim().slice(0, 120);
  const situacao = primeiro(sp.situacao) === "INATIVOS" ? "INATIVOS" : primeiro(sp.situacao) === "TODOS" ? "TODOS" : "ATIVOS";
  const lista = await listarFornecedores(prisma, { termo, situacao, pagina: Number(primeiro(sp.pagina) ?? 1) }, { id: acesso.usuarioId });
  const urlPagina = (pagina: number) => `/cadastros/fornecedores?${new URLSearchParams({ q: termo, situacao, pagina: String(pagina) })}`;
  return <div><PageHeader titulo="Fornecedores" descricao="Cadastre prestadores e empresas, aproveite os cadastros importados e selecione o fornecedor ao lançar uma despesa." acoes={<Link href="/financeiro/contas-a-pagar" className={btnSecundario}>Ir para Contas a pagar</Link>} /><NavegacaoCadastros atual="fornecedores" />
    <form method="get" className="mb-5 grid gap-3 rounded-xl border border-contorno bg-carta p-4 sm:grid-cols-[minmax(0,1fr)_10rem_auto]"><label className="min-w-0 text-xs font-semibold">Buscar<input type="search" name="q" defaultValue={termo} placeholder="Nome ou CPF/CNPJ" maxLength={120} className={`${inputBase} mt-1 w-full`} /></label><label className="text-xs font-semibold">Situação<select name="situacao" defaultValue={situacao} className={`${inputBase} mt-1 w-full`}><option value="ATIVOS">Ativos</option><option value="INATIVOS">Inativos</option><option value="TODOS">Todos</option></select></label><button className={`${btnSecundario} self-end`}>Buscar</button></form>
    <FornecedoresPainel lista={lista} />
    {lista.paginas > 1 && <nav aria-label="Páginas de fornecedores" className="mt-4 flex flex-wrap items-center justify-between gap-3">{lista.pagina > 1 ? <Link className={btnSecundario} href={urlPagina(lista.pagina - 1)}>← Anterior</Link> : <span />}<span className="text-xs text-tinta-suave">Página {lista.pagina} de {lista.paginas}</span>{lista.pagina < lista.paginas ? <Link className={btnSecundario} href={urlPagina(lista.pagina + 1)}>Próxima →</Link> : <span />}</nav>}
  </div>;
}
