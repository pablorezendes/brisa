import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Dinheiro, PageHeader, Sigilo, btnSecundario, inputBase } from "@/components/ui";
import { prisma } from "@/lib/db";
import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { previaGovernanca } from "@/lib/governanca/servico";
import { ErroGovernanca, ROTULOS_GOVERNANCA, type TipoGovernanca } from "@/lib/governanca/tipos";
import { executarGovernanca, executarGovernancaNaTela } from "./actions";
import { FormularioNaTela } from "@/components/formulario-na-tela";

const rotaLixeira = "/cadastros/governanca?modo=lixeira";
const btnExcluir = "inline-flex items-center justify-center rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:opacity-50";
async function admin() {
  const acesso = await exigirPermissaoAcesso("governanca.editar", { global: true });
  if (acesso.perfil !== "ADMINISTRADOR") notFound();
}

export async function TelaExclusao({ tipo, origemId, erro, ok, contexto }: { tipo: TipoGovernanca; origemId: string; erro?: string; ok?: string; contexto?: { retorno: string } }) {
  await admin();
  let previa;
  try { previa = await previaGovernanca(prisma, tipo, origemId); }
  catch (e) { if (e instanceof ErroGovernanca && ["NAO_ENCONTRADO", "IDENTIDADE_INVALIDA"].includes(e.codigo)) notFound(); throw e; }
  const excluido = previa.status === "EXCLUIDO";
  const eventos = await prisma.eventoGovernanca.findMany({ where: { recurso: { tipo, origemId } }, select: { id: true, acao: true, motivo: true, criadoEm: true }, orderBy: { criadoEm: "desc" }, take: 10 });
  const campos = <>
    <input type="hidden" name="tipo" value={tipo} /><input type="hidden" name="origemId" value={origemId} /><input type="hidden" name="modo" value="excluir" /><input type="hidden" name="confirmar" value="sim" /><input type="hidden" name="assinaturaPrevia" value={previa.assinatura} />
    {contexto ? <input type="hidden" name="retornoContexto" value={contexto.retorno} /> : null}
    <label className="block text-sm font-medium">{excluido ? "Por que restaurar?" : "Por que excluir?"}<textarea required name="motivo" minLength={5} maxLength={500} rows={3} className={`${inputBase} mt-2 w-full`} placeholder="Ex.: lançamento duplicado já conferido na planilha e no extrato." /></label>
    <label className="flex items-start gap-3 text-sm"><input className="mt-1" required type="checkbox" name="cienciaExclusao" value="sim" /><span>{excluido ? "Conferi o registro e quero restaurar sua situação anterior, sem emitir cobranças ou disparar mensagens." : "Conferi o registro. Entendo que a exclusão é somente na plataforma e não cancela nem estorna operações externas."}</span></label>
    <div className="flex flex-wrap gap-3"><button className={excluido ? btnSecundario : btnExcluir} name="acao" value={excluido ? "restaurar" : "excluir-plataforma"}>{excluido ? "Restaurar registro" : "Confirmar exclusão"}</button>{!contexto ? <Link href="/financeiro/dados" className={btnSecundario}>Voltar sem alterar</Link> : null}</div>
  </>;
  return <div className="mx-auto min-w-0 max-w-4xl">
    {contexto ? <header className="mb-5 border-b border-contorno pb-4"><h2 className="break-words text-lg font-bold">{excluido ? "Registro excluído da plataforma" : "Excluir da plataforma"}</h2><p className="mt-1 text-xs leading-relaxed text-tinta-suave">Decisão administrativa com histórico e possibilidade de restauração. Para voltar sem alterar, feche esta janela.</p></header> : <PageHeader titulo={excluido ? "Registro excluído da plataforma" : "Excluir da plataforma"} descricao="Decisão administrativa com histórico e possibilidade de restauração." acoes={<Link href={rotaLixeira} className={btnSecundario}>Ver lixeira</Link>} />}
    {erro && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{erro}</p>}
    {ok && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{ok}</p>}
    <Card className="p-5 sm:p-7"><p className="text-xs font-semibold uppercase tracking-wider text-tinta-suave">{ROTULOS_GOVERNANCA[tipo]}</p><h2 className="mt-2 break-words text-xl font-bold">{previa.nome}</h2>
      {previa.referencia && <p className="mt-2 break-words text-sm text-tinta-suave">{previa.referencia}</p>}
      {previa.valor != null && <p className="mt-3 text-sm">Valor do registro: <Sigilo><Dinheiro centavos={previa.valor} /></Sigilo></p>}
      <p className="mt-4 text-sm leading-relaxed">{excluido ? "Este registro foi retirado das listas operacionais. O conteúdo original e seus vínculos foram preservados." : "Você pode excluir este registro mesmo que esteja pago, conciliado, com vínculos ou em mês fechado. Ele sai das listas atuais e, quando for um lançamento financeiro, deixa de participar dos respectivos totais atuais."}</p>
      <div className="my-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950"><strong>Somente dentro do Brisa.</strong> Não cancela boleto no banco ou nota fiscal, não estorna pagamento e não apaga registros vinculados. Fechamentos já registrados continuam preservados no histórico. Excluir um cadastro ou contrato não exclui suas cobranças: revise cada lançamento que deseja retirar.</div>
      {!!Object.keys(previa.vinculos).length && <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">{Object.entries(previa.vinculos).map(([nome, quantidade]) => <div key={nome} className="rounded-lg border border-linha p-3"><dt className="break-words text-xs text-tinta-suave">{nome}</dt><dd className="text-xl font-semibold">{quantidade}</dd></div>)}</dl>}
      {contexto ? <FormularioNaTela action={executarGovernancaNaTela} className="space-y-4">{campos}</FormularioNaTela> : <form action={executarGovernanca} className="space-y-4">{campos}</form>}
    </Card>
    {!!eventos.length && <Card className="mt-5 p-5"><h2 className="font-semibold">Histórico de decisões</h2><ul className="mt-3 space-y-3">{eventos.map(e => <li key={e.id} className="border-t border-linha pt-3 text-sm"><p>{e.acao === "EXCLUIDO" ? "Exclusão registrada" : "Situação atualizada"} · {e.criadoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p><p className="mt-1 text-tinta-suave">{e.motivo}</p></li>)}</ul></Card>}
  </div>;
}

export async function TelaLixeira({ pagina }: { pagina?: string }) {
  await admin();
  const atual = /^\d{1,6}$/.test(pagina ?? "") ? Math.max(1, Number(pagina)) : 1;
  const where = { status: "EXCLUIDO" };
  const [total, itens] = await Promise.all([prisma.recursoGovernado.count({ where }), prisma.recursoGovernado.findMany({ where, orderBy: [{ atualizadoEm: "desc" }, { id: "asc" }], skip: (atual - 1) * 30, take: 30, select: { id: true, tipo: true, origemId: true, estadoAnterior: true, motivo: true, atualizadoEm: true } })]);
  return <div><PageHeader titulo="Lixeira da plataforma" descricao="Registros excluídos com histórico. Restaurar não dispara operações externas." acoes={<Link href="/financeiro/dados" className={btnSecundario}>Conferir dados</Link>} /><Card className="p-5"><p className="mb-4 text-sm text-tinta-suave">{total} registro(s) · página {atual}</p><ul className="space-y-4">{itens.map(item => {
    let nome = ROTULOS_GOVERNANCA[item.tipo as TipoGovernanca] ?? "Registro";
    try { const estado = JSON.parse(item.estadoAnterior); if (typeof estado.nome === "string") nome = estado.nome; } catch { /* Histórico antigo sem nome. */ }
    return <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-linha p-4"><div className="min-w-0 flex-1"><p className="break-words font-semibold">{nome}</p><p className="mt-1 text-xs text-tinta-suave">{ROTULOS_GOVERNANCA[item.tipo as TipoGovernanca]} · {item.atualizadoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p><p className="mt-2 break-words text-sm">{item.motivo}</p></div><Link className={btnSecundario} href={`/cadastros/governanca?${new URLSearchParams({ modo: "excluir", tipo: item.tipo, origemId: item.origemId })}`}>Conferir e restaurar</Link></li>;
  })}</ul>{!itens.length && <p>Nenhum registro excluído nesta página.</p>}<div className="mt-5 flex gap-3">{atual > 1 && <Link href={`${rotaLixeira}&pagina=${atual - 1}`} className={btnSecundario}>Anterior</Link>}{atual * 30 < total && <Link href={`${rotaLixeira}&pagina=${atual + 1}`} className={btnSecundario}>Próxima</Link>}</div></Card></div>;
}
