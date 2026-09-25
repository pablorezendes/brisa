import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Dinheiro, PageHeader, Sigilo } from "@/components/ui";
import { prisma } from "@/lib/db";
import { exigirAcessoFiscal } from "@/lib/fiscal/acesso";
import { ROTA_FISCAL, type PayloadFiscal } from "@/lib/fiscal/dominio";
import { AvisoFiscal, FormularioRascunho, StatusFiscal, botaoFiscal, botaoFiscalSecundario } from "../_ui";
import { executarAcaoFiscal } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Revisão fiscal — Brisa" };

export default async function DetalheNotaFiscal({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; ok?: string }> }) {
  await exigirAcessoFiscal();
  const { id } = await params;
  const avisos = await searchParams;
  const nota = await prisma.notaFiscalServico.findUnique({ where: { id }, include: { eventos: { orderBy: { criadoEm: "desc" }, take: 60 } } });
  if (!nota) notFound();
  const p = JSON.parse(nota.payload) as PayloadFiscal;
  const corrigivel = ["RASCUNHO", "REJEITADA"].includes(nota.status);
  const consultavel = ["TRANSMITINDO", "PROCESSANDO", "INCERTA", "AUTORIZADA", "CANCELADA"].includes(nota.status);
  const identidade = <><input type="hidden" name="id" value={nota.id}/><input type="hidden" name="payloadHash" value={nota.payloadHash}/></>;
  return <div><PageHeader titulo="Revisão e acompanhamento fiscal" descricao="Confira a prestação antes de aprovar. Referência, numeração e histórico permanecem vinculados a este documento." acoes={<Link href={ROTA_FISCAL} className={botaoFiscalSecundario}>Voltar às notas</Link>}/><AvisoFiscal {...avisos}/>
    <Card className="mb-5 p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="break-all text-lg font-semibold text-tinta">{nota.origemChave}</h2><div className="flex flex-wrap gap-2"><Badge cor={nota.ambiente === "PRODUCAO" ? "verde" : "azul"}>{nota.ambiente === "PRODUCAO" ? "Produção" : "Homologação · sem validade fiscal"}</Badge><StatusFiscal status={nota.status}/></div></div>
      <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{[["Tomador",nota.tomadorNome],["CPF/CNPJ",nota.tomadorDocumento],["Competência",nota.competencia],["DPS reservada",`${p.serie_dps} / ${p.numero_dps}`]].map(([titulo,valor])=><div key={titulo}><dt className="text-[10px] font-semibold uppercase tracking-wider text-tinta-suave">{titulo}</dt><dd className="mt-1 break-words text-sm text-tinta">{valor}</dd></div>)}</dl>
      <div className="mt-5 grid gap-5 border-t border-contorno pt-5 sm:grid-cols-2"><div><p className="text-xs text-tinta-suave">Valor do serviço</p><p className="mt-2 max-w-full font-mono text-2xl"><Sigilo><Dinheiro centavos={nota.valorServico}/></Sigilo></p></div><div><p className="text-xs text-tinta-suave">Tributação revisada</p><p className="mt-2 break-words font-mono text-xs">ISS {p.codigo_tributacao_nacional_iss} · NBS {p.codigo_nbs}<br/>IBS/CBS {p.ibs_cbs_situacao_tributaria} / {p.ibs_cbs_classificacao_tributaria}</p></div></div>
      <p className="mt-4 whitespace-pre-wrap break-words text-sm text-tinta">{nota.descricao}</p><p className="mt-4 break-all font-mono text-[10px] text-tinta-suave">Referência: {nota.referencia}</p>
      {nota.erroMensagem && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900"><strong>{nota.erroCodigo}</strong> · {nota.erroMensagem}</div>}
      {nota.numero && <p className="mt-4 text-sm font-semibold">NFS-e {nota.numero} · verificador {nota.codigoVerificacao ?? "a consultar"}</p>}
      {nota.urlDocumento && <a href={nota.urlDocumento} target="_blank" rel="noreferrer" className={`${botaoFiscalSecundario} mt-3`}>Abrir documento no autorizador ↗</a>}
    </Card>
    {nota.status === "RASCUNHO" && <Card className="mb-5 p-5"><form action={executarAcaoFiscal}>{identidade}<input type="hidden" name="acao" value="aprovar"/><label className="flex items-start gap-3 text-xs leading-relaxed"><input type="checkbox" name="confirmar" required className="mt-0.5"/><span>Revisei o rascunho salvo acima: emitente, serviço, tomador, competência, valor e enquadramento. Aprovar não transmite. Se editar os campos abaixo, salve primeiro e revise a versão atualizada.</span></label><button className={`${botaoFiscal} mt-4`}>Aprovar este rascunho salvo</button></form></Card>}
    {nota.status === "APROVADA" && <Card className="mb-5 p-5"><h2 className="text-sm font-bold">Pronto para a transmissão manual</h2><form action={executarAcaoFiscal} className="mt-3">{identidade}<input type="hidden" name="acao" value="transmitir"/><label className="flex items-start gap-3 text-xs leading-relaxed"><input type="checkbox" name="confirmar" required className="mt-0.5"/><span>{nota.ambiente === "PRODUCAO" ? "Autorizo a transmissão real desta NFS-e ao provedor/município, com efeitos fiscais e dados do tomador acima." : "Autorizo transmitir este documento ao ambiente de homologação do provedor, sem validade fiscal."}</span></label><button className={`${botaoFiscal} mt-4`}>{nota.ambiente === "PRODUCAO" ? "Transmitir NFS-e em produção" : "Transmitir em homologação"}</button></form><form action={executarAcaoFiscal} className="mt-3">{identidade}<input type="hidden" name="acao" value="revisar"/><button className="text-xs font-semibold text-oliva-escura underline">Voltar para revisão sem transmitir</button></form></Card>}
    {consultavel && <Card className="mb-5 p-5"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-sm font-bold">Acompanhar a mesma referência</h2><p className="mt-1 max-w-3xl text-xs leading-relaxed text-tinta-suave">Consulta não emite outra nota. Resultados incertos não podem ser reenviados. Se houver duplicidade de DPS ou referência não localizada, confira o painel do provedor antes de qualquer intervenção.</p></div><form action={executarAcaoFiscal}>{identidade}<input type="hidden" name="acao" value="consultar"/><button className={botaoFiscalSecundario}>Consultar situação</button></form></div></Card>}
    {corrigivel && <details className="mb-5" open={nota.status === "REJEITADA"}><summary className="cursor-pointer rounded-lg border border-contorno bg-carta p-4 text-sm font-semibold text-oliva-escura">Revisar / corrigir rascunho</summary><div className="mt-4"><FormularioRascunho nota={nota}/></div></details>}
    <Card className="p-5"><h2 className="text-sm font-bold">Trilha do documento</h2><ol className="mt-5 space-y-4">{nota.eventos.map((e)=><li key={e.id} className="border-l-2 border-contorno pl-4"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold">{e.tipo.replaceAll("_", " ")}</span><time className="font-mono text-[10px] text-tinta-suave">{e.criadoEm.toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}</time></div><p className="mt-1 text-xs text-tinta-suave">{e.mensagem}</p></li>)}</ol><p className="mt-5 border-t border-contorno pt-3 text-[11px] text-tinta-suave">Cancelamento e substituição não são executados por este módulo. Siga o procedimento do município/provedor e use a consulta para atualizar a situação. Autorizar uma nota não altera os saldos nem baixa cobranças.</p></Card>
  </div>;
}
