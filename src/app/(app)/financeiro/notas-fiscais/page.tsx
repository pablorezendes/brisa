import Link from "next/link";
import { Badge, Card, Dinheiro, PageHeader, Sigilo } from "@/components/ui";
import { prisma } from "@/lib/db";
import { exigirAcessoFiscal } from "@/lib/fiscal/acesso";
import { ROTA_FISCAL, STATUS_FISCAIS } from "@/lib/fiscal/dominio";
import { AbasFiscais, AvisoFiscal, StatusFiscal, botaoFiscal, botaoFiscalSecundario } from "./_ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notas fiscais de serviços — Brisa" };

export default async function NotasFiscaisPage({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string; status?: string; pagina?: string }> }) {
  await exigirAcessoFiscal();
  const params = await searchParams;
  const status = params.status && Object.hasOwn(STATUS_FISCAIS, params.status) ? params.status : undefined;
  const pagina = Math.min(10000, Math.max(1, Number.parseInt(params.pagina ?? "1", 10) || 1));
  const [config, notas, total, contagens] = await Promise.all([
    prisma.configuracaoFiscal.findUnique({ where: { id: "goiania" }, select: { habilitada: true, ambiente: true } }),
    prisma.notaFiscalServico.findMany({ where: { status }, orderBy: { criadoEm: "desc" }, skip: (pagina - 1) * 30, take: 30 }),
    prisma.notaFiscalServico.count({ where: { status } }),
    prisma.notaFiscalServico.groupBy({ by: ["status"], _count: true }),
  ]);
  const qtd = (estados: string[]) => contagens.filter((r) => estados.includes(r.status)).reduce((acc, r) => acc + r._count, 0);
  return <div>
    <PageHeader titulo="Notas fiscais de serviços" descricao="Goiânia · da revisão à autorização, com rastreabilidade e proteção contra emissão duplicada." acoes={<Link href={`${ROTA_FISCAL}/novo`} className={botaoFiscal}>Novo rascunho</Link>}/>
    <AbasFiscais atual="notas"/><AvisoFiscal {...params}/>
    <Card className="mb-5 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-contorno p-5"><div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-oliva">Motor fiscal · NFS-e</p><h2 className="mt-1 text-lg font-bold text-tinta">Um serviço. Uma referência. Um documento.</h2><p className="mt-1 max-w-3xl text-xs leading-relaxed text-tinta-suave">Salvar não emite. Cada nota passa por revisão explícita antes do envio. Se a resposta se perder, o sistema consulta a mesma referência e bloqueia repetição.</p></div><Badge cor={config?.habilitada ? "verde" : "ambar"}>{config?.habilitada ? `${config.ambiente === "PRODUCAO" ? "Produção" : "Homologação"} · habilitado` : "Transmissão desabilitada"}</Badge></div>
      <div className="grid grid-cols-2 divide-x divide-contorno lg:grid-cols-4">{[["Em preparação", qtd(["RASCUNHO", "APROVADA"])],["Em processamento",qtd(["TRANSMITINDO","PROCESSANDO"])],["Autorizadas",qtd(["AUTORIZADA"])],["Precisam de atenção",qtd(["REJEITADA","INCERTA"])]].map(([titulo, n])=><div key={titulo} className="min-w-0 p-5"><p className="text-xs text-tinta-suave">{titulo}</p><p className="mt-2 truncate font-mono text-2xl font-semibold text-tinta"><Sigilo>{n}</Sigilo></p></div>)}</div>
    </Card>
    {!config && <Card className="mb-5 p-5"><h2 className="text-sm font-semibold text-tinta">Comece pela configuração fiscal</h2><p className="mt-2 text-xs leading-relaxed text-tinta-suave">Cadastre emitente, serviço e tributação com sua contabilidade. O adaptador Focus NFe é opcional e exige conta contratada, certificado cadastrado no provedor, liberação municipal e token no servidor. Nenhuma contratação ou emissão foi realizada.</p><Link href={`${ROTA_FISCAL}/configuracao`} className={`${botaoFiscalSecundario} mt-3`}>Configurar emitente</Link></Card>}
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-contorno p-5"><h2 className="text-sm font-semibold text-tinta">Documentos e histórico</h2><form className="flex items-center gap-2"><label className="sr-only" htmlFor="status-fiscal">Situação</label><select id="status-fiscal" name="status" defaultValue={status ?? ""} className="max-w-full rounded-lg border border-contorno bg-carta p-2 text-xs"><option value="">Todas as situações</option>{Object.entries(STATUS_FISCAIS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select><button className={botaoFiscalSecundario}>Filtrar</button></form></div>
      {!notas.length ? <div className="p-10 text-center"><p className="text-sm font-semibold text-tinta">Nenhuma nota nesta seleção</p><p className="mt-2 text-xs text-tinta-suave">Os dados financeiros não são convertidos em notas automaticamente. Crie um rascunho com o serviço e o tomador conferidos.</p></div> : <div className="overflow-x-auto"><table className="tabela min-w-[850px] w-full"><thead><tr><th>Prestação / tomador</th><th>Competência</th><th>Ambiente</th><th>Valor do serviço</th><th>Situação</th><th>Documento</th></tr></thead><tbody>{notas.map((nota)=><tr key={nota.id}><td><Link href={`${ROTA_FISCAL}/${nota.id}`} className="font-semibold text-oliva-escura hover:underline">{nota.origemChave}</Link><span className="mt-1 block max-w-60 truncate text-xs text-tinta-suave">{nota.tomadorNome}</span></td><td className="font-mono text-xs">{nota.competencia}</td><td><Badge cor={nota.ambiente === "PRODUCAO" ? "verde" : "azul"}>{nota.ambiente === "PRODUCAO" ? "Produção" : "Teste"}</Badge></td><td><Sigilo><Dinheiro centavos={nota.valorServico}/></Sigilo></td><td><StatusFiscal status={nota.status}/></td><td><Link href={`${ROTA_FISCAL}/${nota.id}`} className="text-xs font-semibold text-oliva-escura">{nota.numero ? `NFS-e ${nota.numero}` : "Abrir revisão"} →</Link></td></tr>)}</tbody></table></div>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-contorno p-4 text-xs text-tinta-suave"><span>{total} documento(s) · página {pagina}</span><div className="flex gap-3">{pagina > 1 && <Link href={`${ROTA_FISCAL}?${new URLSearchParams({ ...(status ? { status } : {}), pagina: String(pagina - 1) })}`}>Anterior</Link>}{pagina * 30 < total && <Link href={`${ROTA_FISCAL}?${new URLSearchParams({ ...(status ? { status } : {}), pagina: String(pagina + 1) })}`}>Próxima</Link>}</div></div>
    </Card>
    <p className="mt-4 text-xs leading-relaxed text-tinta-suave">Escopo inicial: serviços nacionais tributáveis sem retenções ou regimes especiais. Não emite NF-e de mercadorias, não registra receitas ou baixas financeiras e não envia notas ao cliente automaticamente.</p>
  </div>;
}
