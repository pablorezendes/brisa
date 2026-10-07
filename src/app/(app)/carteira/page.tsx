import Link from "next/link";
import { acessoAtual } from "@/lib/acesso/servidor";
import { pode } from "@/lib/acesso/politica";
import { consultarCarteira } from "@/lib/acesso/carteira";
import { prisma } from "@/lib/db";
import { Card, PageHeader, Dinheiro, Sigilo, btnSecundario, inputBase } from "@/components/ui";

export default async function CarteiraPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const acesso = await acessoAtual();
  const sp = await searchParams;
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const atual = `${hoje.find(p => p.type === "year")!.value}-${hoje.find(p => p.type === "month")!.value}`;
  const mes = typeof sp.mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) ? sp.mes : atual;
  const abas = [
    ...(pode(acesso, "cadastros.ver") ? [{ id: "imoveis", nome: "Imóveis" }, { id: "empreendimentos", nome: "Empreendimentos" }, { id: "clientes", nome: "Clientes" }] : []),
    ...(pode(acesso, "contratos.ver") ? [{ id: "contratos", nome: "Contratos" }] : []),
    ...(pode(acesso, "financeiro.ver") ? [{ id: "financeiro", nome: "Financeiro" }] : []),
  ];
  const aba = abas.find(a => a.id === sp.aba)?.id ?? abas[0]?.id ?? "";
  const dados = await consultarCarteira(prisma, acesso, mes);
  const busca = typeof sp.q === "string" ? sp.q.trim().slice(0, 100).toLocaleLowerCase("pt-BR") : "";
  const corresponde = (v: object) => !busca || Object.values(v).some(x => typeof x === "string" && x.toLocaleLowerCase("pt-BR").includes(busca));
  const itens = (aba === "clientes" ? dados.clientes : aba === "empreendimentos" ? dados.empreendimentos : dados.imoveis).filter(corresponde);
  const contratos = dados.contratos.filter(corresponde);
  const titulos = dados.titulos.filter(corresponde);
  const total = aba === "contratos" ? contratos.length : aba === "financeiro" ? titulos.length : itens.length;
  const paginas = Math.max(1, Math.ceil(total / 30));
  const pagina = Math.min(paginas, Math.max(1, Math.floor(Number(sp.pagina) || 1)));
  const trecho = <T,>(xs: T[]) => xs.slice((pagina - 1) * 30, pagina * 30);
  const url = (a: string, pg = 1) => `/carteira?${new URLSearchParams({ aba: a, mes, q: busca, pagina: String(pg) })}`;
  return <>
    <PageHeader titulo="Minha carteira" descricao="Clientes, imóveis e financeiro dentro da sua abrangência autorizada. Consulta segura, sem alterar a operação." acoes={pode(acesso, "relatorios.exportar") && pode(acesso, "financeiro.ver") && pode(acesso, "carteira.ver") ? <a className={btnSecundario} href={`/carteira/exportar?mes=${mes}`}>Exportar financeiro do mês</a> : undefined} />
    <Card className="mb-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{acesso.global ? "Carteira completa, respeitando os bloqueios" : "Carteira liberada pelo administrador"}</h2><p className="mt-1 text-sm text-tinta-suave">Somente vínculos comprovados. Caixa global, dados legados sem vínculo e comissões não são compartilhados nesta área.</p></div><span className="rounded-lg border border-contorno px-3 py-2 text-xs font-semibold">Somente leitura</span></div>
      {!pode(acesso, "carteira.ver") ? <p className="mt-4 text-sm">Seu acesso ainda não foi liberado. Solicite ao administrador a função e a carteira necessárias.</p> : null}
    </Card>
    <div className="mb-5 flex flex-wrap gap-2" aria-label="Seções da carteira">{abas.map(a => <Link key={a.id} className={`rounded-lg border px-4 py-2 text-sm font-semibold ${aba === a.id ? "border-oliva bg-oliva text-white" : "border-contorno bg-white"}`} href={url(a.id)} aria-current={aba === a.id ? "page" : undefined}>{a.nome}</Link>)}</div>
    <form className="mb-5 flex flex-wrap items-end gap-3" action="/carteira">
      <input type="hidden" name="aba" value={aba} />
      <label className="grid w-full gap-1 text-xs font-semibold sm:w-auto">Competência<input className={inputBase} type="month" name="mes" defaultValue={mes} /></label>
      <label className="grid min-w-0 flex-[1_1_16rem] gap-1 text-xs font-semibold">Buscar na carteira<input className={inputBase} name="q" maxLength={100} defaultValue={busca} placeholder="Nome, imóvel ou situação" /></label>
      <button className={btnSecundario} type="submit">Aplicar filtros</button>
    </form>
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-contorno p-4"><h2 className="font-semibold">{abas.find(a => a.id === aba)?.nome ?? "Acesso pendente"}</h2><span className="text-xs text-tinta-suave">{total} registro(s) autorizado(s)</span></div>
      {total === 0 ? <div className="p-8 text-sm text-tinta-suave">Nenhum registro autorizado corresponde a esta seleção. Uma lista vazia não significa ausência de dados no sistema; confirme sua abrangência com o administrador.</div> : <div className="tabela-scroll overflow-x-auto" role="region" aria-label="Registros da carteira autorizada" tabIndex={0}><table className="tabela">
        {aba === "financeiro" ? <><thead><tr><th>Origem</th><th>Natureza</th><th>Imóvel / cliente</th><th>Vencimento</th><th>Devido</th><th>Pago</th><th>Em aberto</th></tr></thead><tbody>{trecho(titulos).map(t => <tr key={t.id}><td>{t.origem}</td><td>{t.natureza === "PAGAR" ? "A pagar" : "A receber"}</td><td>{t.imovel}<div className="text-xs text-tinta-suave">{t.cliente}</div></td><td>{t.vencimento ?? "Não informado"}</td><td><Sigilo><Dinheiro centavos={t.devido} /></Sigilo></td><td><Sigilo><Dinheiro centavos={t.pago} /></Sigilo></td><td><Sigilo><Dinheiro centavos={t.aberto} /></Sigilo></td></tr>)}</tbody></> : aba === "contratos" ? <><thead><tr><th>Imóvel</th><th>Cliente</th><th>Situação</th><th>Início</th><th>Fim</th><th>Origem</th></tr></thead><tbody>{trecho(contratos).map(c => <tr key={c.id}><td>{c.imovel}</td><td>{c.cliente}</td><td>{c.situacao}</td><td>{c.inicio ?? "—"}</td><td>{c.fim ?? "—"}</td><td>{c.origem}</td></tr>)}</tbody></> : <><thead><tr><th>Nome</th><th>{aba === "clientes" ? "Categoria" : "Empreendimento"}</th><th>Origem</th>{aba === "clientes" && pode(acesso, "cadastros.sensiveis") ? <><th>Documento</th><th>Contato</th></> : null}</tr></thead><tbody>{trecho(itens).map(i => <tr key={i.id}><td>{i.nome}</td><td>{i.grupo}</td><td>{i.origem}</td>{aba === "clientes" && pode(acesso, "cadastros.sensiveis") ? <><td>{i.documento ?? "—"}</td><td>{i.contato ?? "—"}</td></> : null}</tr>)}</tbody></>}
      </table></div>}
      <div className="flex items-center justify-between gap-3 border-t border-contorno p-4 text-sm">{pagina > 1 ? <Link className={btnSecundario} href={url(aba, pagina - 1)}>Anterior</Link> : <span />}<span>Página {pagina} de {paginas}</span>{pagina < paginas ? <Link className={btnSecundario} href={url(aba, pagina + 1)}>Próxima</Link> : <span />}</div>
    </Card>
    {aba === "financeiro" ? <p className="mt-3 text-xs leading-relaxed text-tinta-suave">Inclui apenas títulos operacionais reconciliados, por competência. Pendências, fontes fora da carteira, receitas de administração/comissão, títulos legados sem classificação e lançamentos sem contrato autorizado não entram na consulta nem na exportação.</p> : null}
  </>;
}
