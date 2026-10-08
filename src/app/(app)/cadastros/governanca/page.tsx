import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader, btnPrimario, btnSecundario, inputBase } from "@/components/ui";
import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { prisma } from "@/lib/db";
import { previaGovernanca } from "@/lib/governanca/servico";
import { ErroGovernanca, ROTULOS_GOVERNANCA, TIPOS_GOVERNANCA, type TipoGovernanca } from "@/lib/governanca/tipos";
import { buscarFinanceirosGovernanca, financeiroSelecionadoGovernanca, filtrosSelecaoGovernanca, type OpcaoFinanceiraGovernanca } from "@/lib/consultas/selecao-governanca";
import { executarGovernanca } from "./actions";
import { TelaExclusao, TelaLixeira } from "./exclusao";

export const metadata = { title: "Revisar e resolver — Brisa" };
type Opcoes = { id: string; nome: string }[];
async function opcoes(tipo: TipoGovernanca): Promise<Opcoes> {
  if (tipo === "PESSOA") return prisma.pessoa.findMany({ select: { id: true, nome: true }, orderBy: { nome: "asc" } });
  if (tipo === "LOCATARIO") return prisma.locatario.findMany({ select: { id: true, nome: true }, orderBy: { nome: "asc" } });
  if (tipo === "EMPREENDIMENTO") return prisma.empreendimento.findMany({ select: { id: true, nome: true }, orderBy: { nome: "asc" } });
  if (tipo === "UNIDADE") return (await prisma.unidade.findMany({ select: { id: true, identificacao: true, empreendimento: { select: { nome: true } } }, orderBy: { identificacao: "asc" } })).map(u => ({ id: u.id, nome: `${u.empreendimento.nome} · ${u.identificacao}` }));
  if (tipo === "IMOVEL_LEGADO") return (await prisma.imovelLegado.findMany({ select: { id: true, nome: true, referencia: true, legadoId: true }, orderBy: { referencia: "asc" } })).map(i => ({ id: i.id, nome: i.nome ?? i.referencia ?? i.legadoId }));
  if (tipo === "CONTA") return (await prisma.contaBancaria.findMany({ select: { id: true, apelido: true, numero: true } })).map(c => ({ id: c.id, nome: `${c.apelido} · ${c.numero}` }));
  return [];
}
function rotuloFinanceiro(item: OpcaoFinanceiraGovernanca) {
  const data = item.data && /^\d{4}-\d{2}-\d{2}$/.test(item.data) ? `${item.data.slice(8, 10)}/${item.data.slice(5, 7)}/${item.data.slice(0, 4)}` : item.competencia ?? "Data não informada";
  return `${item.nome} · ${data} · ${item.origem}`;
}
const estados: Record<string, string> = { EXCLUIDO: "Excluído com histórico", DESCARTADO: "Duplicata excluída", MESCLADO: "Unido a outro cadastro", INATIVO: "Inativo", ATIVO: "Disponível" };
type Parametros = { tipo?: string; origemId?: string; ok?: string; erro?: string; q?: string; mes?: string; buscaMantido?: string; mesMantido?: string; modo?: string; pagina?: string };
export default async function PaginaGovernanca({ searchParams }: { searchParams: Promise<Parametros> }) {
  const acesso = await exigirPermissaoAcesso("governanca.editar", { global: true });
  const sp = await searchParams;
  if (sp.modo === "excluir" && (!(TIPOS_GOVERNANCA as readonly string[]).includes(sp.tipo ?? "") || !sp.origemId)) notFound();
  const tipo = (TIPOS_GOVERNANCA as readonly string[]).includes(sp.tipo ?? "") ? sp.tipo as TipoGovernanca : "LOCATARIO";
  if (!["PESSOA", "LOCATARIO", "UNIDADE", "EMPREENDIMENTO", "IMOVEL_LEGADO", "CAIXA", "TITULO", "CONTA"].includes(tipo) && acesso.perfil !== "ADMINISTRADOR") notFound();
  if (sp.modo === "lixeira") return <TelaLixeira pagina={sp.pagina} />;
  if (sp.modo === "excluir" && sp.origemId) return <TelaExclusao tipo={tipo} origemId={sp.origemId} erro={sp.erro} ok={sp.ok} />;
  await exigirPermissaoAcesso(tipo === "CONTA" ? "contas.ver" : "cadastros.sensiveis", { global: true });
  const financeiro = tipo === "CAIXA" || tipo === "TITULO";
  const filtros = filtrosSelecaoGovernanca(sp.q, sp.mes);
  const filtrosMantido = filtrosSelecaoGovernanca(sp.buscaMantido, sp.mesMantido);
  const resultados = financeiro ? await buscarFinanceirosGovernanca(tipo, filtros) : null;
  const selecionado = financeiro && sp.origemId ? await financeiroSelecionadoGovernanca(tipo, sp.origemId) : null;
  const lista = await opcoes(tipo);
  let previa: Awaited<ReturnType<typeof previaGovernanca>> | null = null;
  let erro = sp.erro;
  if (sp.origemId) {
    try { previa = await previaGovernanca(prisma, tipo, sp.origemId); }
    catch (e) { if (e instanceof ErroGovernanca) erro = e.message; else throw e; }
  }
  const eventos = previa ? await prisma.eventoGovernanca.findMany({ where: { recurso: { tipo, origemId: previa.origemId } }, select: { id: true, acao: true, motivo: true, criadoEm: true, autorId: true }, orderBy: { criadoEm: "desc" }, take: 20 }) : [];
  const excluidosFinanceiros = financeiro ? await buscarFinanceirosGovernanca(tipo, { ...filtros, excluidos: true }) : null;
  const excluidos = financeiro ? [] : await prisma.recursoGovernado.findMany({ where: { tipo, status: { not: "ATIVO" } }, select: { origemId: true, status: true, destinoId: true }, orderBy: { atualizadoEm: "desc" }, take: 50 });
  const destinosBloqueados = new Set((await prisma.recursoGovernado.findMany({ where: { tipo, status: { not: "ATIVO" } }, select: { origemId: true } })).map(r => r.origemId));
  const mantidos = tipo === "TITULO" && previa?.status === "ATIVO" ? await buscarFinanceirosGovernanca(tipo, { q: filtrosMantido.q, mes: filtrosMantido.mes, mantido: true, excluirId: previa.origemId, dominio: selecionado?.dominio }) : null;
  const escolhas = resultados ? [...(selecionado && !resultados.itens.some(r => r.id === selecionado.id) ? [selecionado] : []), ...resultados.itens].map(r => ({ id: r.id, nome: rotuloFinanceiro(r) })) : lista;
  return <div>
    <PageHeader titulo="Revisar e resolver" descricao="Encontre pelo nome, confira o que será mantido e confirme. Você pode organizar os dados sem perder o histórico." acoes={<>{acesso.perfil === "ADMINISTRADOR" && <Link className={btnSecundario} href="/cadastros/governanca?modo=lixeira">Lixeira</Link>}<Link className={btnSecundario} href="/financeiro/dados">Organizar dados</Link><Link className={btnSecundario} href="/cadastros">Cadastros</Link></>} />
    {erro && <p role="alert" className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">{erro}</p>}
    {sp.ok && <p role="status" className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800">{sp.ok}</p>}
    <Card className="mb-4 p-5"><h2 className="mb-3 font-semibold">1. Encontre o cadastro ou lançamento</h2>
      <form className="flex flex-wrap items-end gap-3" method="get"><label className="min-w-0 basis-48 grow text-sm">O que você quer organizar?<select name="tipo" defaultValue={tipo} className={`${inputBase} w-full`}>{TIPOS_GOVERNANCA.map(t => <option key={t} value={t}>{ROTULOS_GOVERNANCA[t]}</option>)}</select></label><button className={btnSecundario}>Escolher tipo</button></form>
      {financeiro && <form className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-[minmax(0,1fr)_10rem_auto]" method="get"><input type="hidden" name="tipo" value={tipo} /><label className="min-w-0 text-sm">Nome, descrição ou arquivo<input type="search" name="q" defaultValue={filtros.q} maxLength={120} className={`${inputBase} w-full`} placeholder="Ex.: aluguel, fornecedor ou nome da planilha" /></label><label className="min-w-0 text-sm">Competência<input type="month" name="mes" defaultValue={filtros.mes} className={`${inputBase} w-full`} /></label><button className={`${btnSecundario} self-end`}>Buscar registros</button></form>}
      {resultados && <p className="mt-3 text-xs text-tinta-suave">{resultados.total} resultado(s). {resultados.total > 30 ? "Mostrando até 30; refine o nome ou a competência para encontrar outro registro." : "Escolha pela descrição, data e origem — não é preciso copiar códigos."} {tipo === "CAIXA" && "Movimentos Widesys são comparados na central de duplicidades."}</p>}
      <form className="mt-3 flex flex-wrap items-end gap-3" method="get"><input type="hidden" name="tipo" value={tipo} /><input type="hidden" name="q" value={filtros.q} /><input type="hidden" name="mes" value={filtros.mes} /><label className="min-w-0 basis-64 grow text-sm">Registro que será revisado<select required name="origemId" defaultValue={sp.origemId ?? ""} className={`${inputBase} w-full`}><option value="">{escolhas.length ? "Selecione o registro…" : "Nenhum registro encontrado"}</option>{escolhas.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}</select></label><button className={btnPrimario} disabled={!escolhas.length}>Conferir registro</button></form>
    </Card>
    {previa && <Card className="mb-4 p-5"><h2 className="font-semibold">2. Confira o registro e o efeito da decisão</h2><p className="mt-2 text-base font-semibold">{previa.nome}</p><p className="mt-1 text-xs text-tinta-suave">{selecionado ? `${selecionado.origem} · ${selecionado.competencia ?? "Sem competência"} · ` : ""}{estados[previa.status] ?? previa.status}</p>
      {selecionado?.href && <Link href={selecionado.href} className="mt-2 inline-block text-xs text-azul underline">Abrir lançamento para comparar</Link>}
      {acesso.perfil === "ADMINISTRADOR" && <div className="mt-4 rounded-xl border border-red-200 p-4"><p className="mb-3 text-sm">O administrador pode excluir da plataforma mesmo com pagamentos, conciliação ou vínculos, preservando o histórico e sem cancelar operações externas.</p><Link className={btnSecundario} href={`/cadastros/governanca?${new URLSearchParams({ modo: "excluir", tipo, origemId: previa.origemId })}`}>{previa.status === "EXCLUIDO" ? "Conferir exclusão e restaurar" : "Excluir da plataforma"}</Link></div>}
      <dl className="my-4 grid grid-cols-2 gap-3 md:grid-cols-4">{Object.entries(previa.vinculos).map(([k,n]) => <div key={k} className="rounded-lg border border-linha p-3"><dt className="text-xs text-tinta-suave">{k}</dt><dd className="text-xl font-semibold">{n}</dd></div>)}</dl>
      {mantidos && <form method="get" className="mb-4 grid gap-3 rounded-xl border border-linha p-4 sm:grid-cols-[minmax(0,1fr)_10rem_auto]"><input type="hidden" name="tipo" value={tipo} /><input type="hidden" name="origemId" value={previa.origemId} /><input type="hidden" name="q" value={filtros.q} /><input type="hidden" name="mes" value={filtros.mes} /><label className="min-w-0 text-sm">Encontre o título que ficará<input type="search" name="buscaMantido" defaultValue={filtrosMantido.q} maxLength={120} placeholder="Nome ou descrição do registro correto" className={`${inputBase} w-full`} /></label><label className="min-w-0 text-sm">Competência do mantido<input type="month" name="mesMantido" defaultValue={filtrosMantido.mes} className={`${inputBase} w-full`} /></label><button className={`${btnSecundario} self-end`}>Buscar mantido</button><p className="text-xs text-tinta-suave sm:col-span-3">{mantidos.total} título(s) disponível(is). {mantidos.total > 30 ? "Refine a busca para encontrar o título correto; exibimos até 30 por busca." : "O título mantido não é alterado nem recebe um novo pagamento."}</p></form>}
      <form action={executarGovernanca} className="space-y-4"><input type="hidden" name="tipo" value={tipo} /><input type="hidden" name="origemId" value={previa.origemId} /><input type="hidden" name="assinaturaPrevia" value={previa.assinatura} />
        {previa.status === "ATIVO" && ["LOCATARIO", "UNIDADE", "EMPREENDIMENTO", "TITULO"].includes(tipo) && <label className="block min-w-0 text-sm">Registro correto que será mantido<select name="destinoId" className={`${inputBase} w-full`} defaultValue=""><option value="">{tipo === "TITULO" ? "Escolha o título correto antes de excluir a duplicata…" : "Selecione se quiser unir dois cadastros…"}</option>{(mantidos ? mantidos.itens.map(r => ({ id: r.id, nome: rotuloFinanceiro(r) })) : lista).filter(r => r.id !== previa!.origemId && !destinosBloqueados.has(r.id)).map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}</select></label>}
        <label className="block text-sm">Motivo da decisão (obrigatório)<textarea name="motivo" required minLength={5} maxLength={500} className={inputBase} rows={2} placeholder="Explique o que foi conferido e por que esta ação é necessária." /></label>
        {tipo === "CONTA" && Boolean(previa.vinculos.titulosAbertos) && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirmarAbertos" value="sim" />Estou ciente dos títulos em aberto. A integração ativa permanece protegida.</label>}
        <label className="flex items-start gap-2 text-sm"><input required type="checkbox" name="confirmar" value="sim" className="mt-1" />Conferi os registros e os vínculos acima. Quero registrar esta decisão.</label>
        <p className="text-xs leading-relaxed text-tinta-suave">Excluir retira o registro da operação, mas preserva sua origem e o motivo. Um administrador pode restaurá-lo. Pagamentos, boletos ativos, períodos fechados e vínculos protegidos continuam bloqueando decisões inseguras.</p>
        <div className="flex flex-wrap gap-3">{previa.status !== "ATIVO" ? acesso.perfil === "ADMINISTRADOR" && <button name="acao" value="restaurar" className={btnPrimario}>Restaurar</button> : <>
          {previa.podeExcluir && <button name="acao" value="excluir" className={btnSecundario}>Excluir com histórico</button>}
          {["LOCATARIO", "UNIDADE", "EMPREENDIMENTO"].includes(tipo) && <button name="acao" value="mesclar" className={btnPrimario}>Unir ao cadastro mantido</button>}
          {tipo === "TITULO" && <button name="acao" value="descartar" className={btnPrimario}>Excluir duplicata com histórico</button>}
          {tipo === "CONTA" && <button name="acao" value="inativar" className={btnPrimario}>Inativar conta</button>}
        </>}</div>
      </form>
      {!previa.podeExcluir && !["TITULO", "CONTA"].includes(tipo) && <p className="mt-4 text-sm text-amber-800">Existem vínculos. A exclusão está bloqueada. A mesclagem só é aplicada quando o sistema consegue preservar todas as referências; cadastros legados exigem reconciliação explícita.</p>}
    </Card>}
    {!!eventos.length && <Card className="mb-4 p-5"><h2 className="mb-3 font-semibold">Histórico da decisão</h2><ul className="space-y-3">{eventos.map(e => <li key={e.id} className="border-b border-linha pb-3 text-sm"><span className="font-medium">{e.acao}</span> · {e.criadoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}<p>{e.motivo}</p><p className="font-mono text-xs text-tinta-suave">Responsável: {e.autorId}</p></li>)}</ul></Card>}
    {!!excluidos.length && <Card className="p-5"><h2 className="mb-3 font-semibold">Excluídos e inativos — histórico preservado</h2><ul className="space-y-2">{excluidos.map(e => <li key={e.origemId} className="break-all text-sm"><Link href={`/cadastros/governanca?${new URLSearchParams({ tipo, origemId: e.origemId })}`} className="text-azul underline">{lista.find(l => l.id === e.origemId)?.nome ?? "Conferir registro"}</Link> · {estados[e.status] ?? e.status}</li>)}</ul></Card>}
    {!!excluidosFinanceiros?.itens.length && <Card className="p-5"><h2 className="mb-2 font-semibold">Excluídos — encontre e restaure</h2><p className="mb-3 text-xs text-tinta-suave">{excluidosFinanceiros.total} registro(s) para os filtros acima. O histórico foi preservado; só um administrador pode restaurar.</p><ul className="space-y-3">{excluidosFinanceiros.itens.map(e => <li key={e.id} className="text-sm"><Link href={`/cadastros/governanca?${new URLSearchParams({ tipo, origemId: e.id })}`} className="text-azul underline">{e.nome}</Link><p className="text-xs text-tinta-suave">{e.origem} · {e.competencia ?? "Sem competência"} · {estados[e.situacao] ?? e.situacao}</p></li>)}</ul></Card>}
  </div>;
}
