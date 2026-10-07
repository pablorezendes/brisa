import Link from "next/link";
import { Card, PageHeader, btnPrimario, btnSecundario, inputBase } from "@/components/ui";
import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { prisma } from "@/lib/db";
import { previaGovernanca } from "@/lib/governanca/servico";
import { ErroGovernanca, ROTULOS_GOVERNANCA, TIPOS_GOVERNANCA, type TipoGovernanca } from "@/lib/governanca/tipos";
import { lerOperacaoUnificada } from "@/lib/unificacao/servico";
import { executarGovernanca } from "./actions";

export const metadata = { title: "Revisar e resolver — Brisa" };
type Opcoes = { id: string; nome: string }[];
async function opcoes(tipo: TipoGovernanca): Promise<Opcoes> {
  if (tipo === "PESSOA") return prisma.pessoa.findMany({ select: { id: true, nome: true }, orderBy: { nome: "asc" } });
  if (tipo === "LOCATARIO") return prisma.locatario.findMany({ select: { id: true, nome: true }, orderBy: { nome: "asc" } });
  if (tipo === "EMPREENDIMENTO") return prisma.empreendimento.findMany({ select: { id: true, nome: true }, orderBy: { nome: "asc" } });
  if (tipo === "UNIDADE") return (await prisma.unidade.findMany({ select: { id: true, identificacao: true, empreendimento: { select: { nome: true } } }, orderBy: { identificacao: "asc" } })).map(u => ({ id: u.id, nome: `${u.empreendimento.nome} · ${u.identificacao}` }));
  if (tipo === "IMOVEL_LEGADO") return (await prisma.imovelLegado.findMany({ select: { id: true, nome: true, referencia: true, legadoId: true }, orderBy: { referencia: "asc" } })).map(i => ({ id: i.id, nome: i.nome ?? i.referencia ?? i.legadoId }));
  if (tipo === "CONTA") return (await prisma.contaBancaria.findMany({ select: { id: true, apelido: true, numero: true } })).map(c => ({ id: c.id, nome: `${c.apelido} · ${c.numero}` }));
  // Caixa/títulos usam busca por identidade exata para não enviar a operação inteira ao cliente.
  return [];
}
export default async function PaginaGovernanca({ searchParams }: { searchParams: Promise<{ tipo?: string; origemId?: string; ok?: string; erro?: string }> }) {
  const acesso = await exigirPermissaoAcesso("governanca.editar", { global: true });
  const sp = await searchParams;
  const tipo = (TIPOS_GOVERNANCA as readonly string[]).includes(sp.tipo ?? "") ? sp.tipo as TipoGovernanca : "LOCATARIO";
  const lista = await opcoes(tipo);
  let previa: Awaited<ReturnType<typeof previaGovernanca>> | null = null;
  let erro = sp.erro;
  if (sp.origemId) {
    try { previa = await previaGovernanca(prisma, tipo, sp.origemId); }
    catch (e) { if (e instanceof ErroGovernanca) erro = e.message; else throw e; }
  }
  const eventos = previa ? await prisma.eventoGovernanca.findMany({ where: { recurso: { tipo, origemId: previa.origemId } }, select: { id: true, acao: true, motivo: true, criadoEm: true, autorId: true }, orderBy: { criadoEm: "desc" }, take: 20 }) : [];
  const excluidos = await prisma.recursoGovernado.findMany({ where: { tipo, status: { not: "ATIVO" } }, select: { origemId: true, status: true, destinoId: true }, orderBy: { atualizadoEm: "desc" }, take: 50 });
  const destinosBloqueados = new Set((await prisma.recursoGovernado.findMany({ where: { tipo, status: { not: "ATIVO" } }, select: { origemId: true } })).map(r => r.origemId));
  const titulos = tipo === "TITULO" && previa ? (await lerOperacaoUnificada(prisma)).linhas.filter(l => ["RECEBER", "PAGAR"].includes(l.dominio) && l.estado === "ATIVO" && l.chave !== previa.origemId).slice(0, 100).map(l => ({ id: l.chave, nome: `${l.dominio} · ${l.titulo} · ${l.competencia ?? "sem competência"}` })) : [];
  return <div>
    <PageHeader titulo="Revisar e resolver" descricao="Confirme a identidade, confira os vínculos e preserve o histórico. Nenhuma ação apaga dados fisicamente." acoes={<Link className={btnSecundario} href="/cadastros">Voltar aos cadastros</Link>} />
    {erro && <p role="alert" className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">{erro}</p>}
    {sp.ok && <p role="status" className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800">{sp.ok}</p>}
    <Card className="mb-4 p-5"><h2 className="mb-3 font-semibold">1. Escolha o cadastro ou lançamento</h2>
      <form className="flex flex-wrap items-end gap-3" method="get"><label className="min-w-48 flex-1 text-sm">Tipo<select name="tipo" defaultValue={tipo} className={inputBase}>{TIPOS_GOVERNANCA.map(t => <option key={t} value={t}>{ROTULOS_GOVERNANCA[t]}</option>)}</select></label><button className={btnSecundario}>Trocar tipo</button></form>
      <form className="mt-3 flex flex-wrap items-end gap-3" method="get"><input type="hidden" name="tipo" value={tipo} /><label className="min-w-48 flex-1 text-sm">Registro de origem{lista.length ? <select required name="origemId" defaultValue={sp.origemId ?? ""} className={inputBase}><option value="">Selecione…</option>{lista.map(r => <option key={r.id} value={r.id}>{r.nome} · {r.id.slice(0, 8)}</option>)}</select> : <input required name="origemId" defaultValue={sp.origemId} className={inputBase} placeholder={tipo === "TITULO" ? "BRISA:RECEBER:ID ou WIDESYS:PAGAR:ID" : "ID do lançamento"} />}</label><button className={btnPrimario}>Conferir vínculos</button></form>
    </Card>
    {previa && <Card className="mb-4 p-5"><h2 className="font-semibold">2. Confira antes de confirmar</h2><p className="mt-2 text-sm">{previa.nome}</p><p className="mt-1 break-all font-mono text-xs text-tinta-suave">{previa.origemId} · {previa.status}</p>
      <dl className="my-4 grid grid-cols-2 gap-3 md:grid-cols-4">{Object.entries(previa.vinculos).map(([k,n]) => <div key={k} className="rounded-lg border border-linha p-3"><dt className="text-xs text-tinta-suave">{k}</dt><dd className="text-xl font-semibold">{n}</dd></div>)}</dl>
      <form action={executarGovernanca} className="space-y-4"><input type="hidden" name="tipo" value={tipo} /><input type="hidden" name="origemId" value={previa.origemId} /><input type="hidden" name="assinaturaPrevia" value={previa.assinatura} />
        {previa.status === "ATIVO" && ["LOCATARIO", "UNIDADE", "EMPREENDIMENTO", "TITULO"].includes(tipo) && <label className="block text-sm">Registro que será mantido<select name="destinoId" className={inputBase} defaultValue=""><option value="">Selecione somente para mesclar ou descartar…</option>{(tipo === "TITULO" ? titulos : lista).filter(r => r.id !== previa!.origemId && !destinosBloqueados.has(r.id)).map(r => <option key={r.id} value={r.id}>{r.nome} · {r.id.slice(0, 8)}</option>)}</select></label>}
        <label className="block text-sm">Motivo da decisão (obrigatório)<textarea name="motivo" required minLength={5} maxLength={500} className={inputBase} rows={2} placeholder="Explique o que foi conferido e por que esta ação é necessária." /></label>
        {tipo === "CONTA" && Boolean(previa.vinculos.titulosAbertos) && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirmarAbertos" value="sim" />Estou ciente dos títulos em aberto. A integração ativa permanece protegida.</label>}
        <label className="flex items-start gap-2 text-sm"><input required type="checkbox" name="confirmar" value="sim" className="mt-1" />Conferi os registros e os vínculos acima. Quero registrar esta decisão.</label>
        <div className="flex flex-wrap gap-3">{previa.status !== "ATIVO" ? acesso.perfil === "ADMINISTRADOR" && <button name="acao" value="restaurar" className={btnPrimario}>Restaurar / desfazer</button> : <>
          {previa.podeExcluir && <button name="acao" value="excluir" className={btnSecundario}>Excluir logicamente</button>}
          {["LOCATARIO", "UNIDADE", "EMPREENDIMENTO"].includes(tipo) && <button name="acao" value="mesclar" className={btnPrimario}>Mesclar no registro mantido</button>}
          {tipo === "TITULO" && <button name="acao" value="descartar" className={btnPrimario}>Descartar a duplicata</button>}
          {tipo === "CONTA" && <button name="acao" value="inativar" className={btnPrimario}>Inativar conta</button>}
        </>}</div>
      </form>
      {!previa.podeExcluir && !["TITULO", "CONTA"].includes(tipo) && <p className="mt-4 text-sm text-amber-800">Existem vínculos. A exclusão está bloqueada. A mesclagem só é aplicada quando o sistema consegue preservar todas as referências; cadastros legados exigem reconciliação explícita.</p>}
    </Card>}
    {!!eventos.length && <Card className="mb-4 p-5"><h2 className="mb-3 font-semibold">Histórico da decisão</h2><ul className="space-y-3">{eventos.map(e => <li key={e.id} className="border-b border-linha pb-3 text-sm"><span className="font-medium">{e.acao}</span> · {e.criadoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}<p>{e.motivo}</p><p className="font-mono text-xs text-tinta-suave">Responsável: {e.autorId}</p></li>)}</ul></Card>}
    {!!excluidos.length && <Card className="p-5"><h2 className="mb-3 font-semibold">Decisões preservadas — últimas 50</h2><ul className="space-y-2">{excluidos.map(e => <li key={e.origemId} className="break-all text-sm"><Link href={`/cadastros/governanca?${new URLSearchParams({ tipo, origemId: e.origemId })}`} className="text-azul underline">{lista.find(l => l.id === e.origemId)?.nome ?? e.origemId}</Link> · {e.status}</li>)}</ul></Card>}
  </div>;
}
