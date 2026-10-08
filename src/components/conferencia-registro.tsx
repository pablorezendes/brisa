import { acessoAtual, exigirPaginaAcesso, exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { podeExibirAcao } from "@/components/acao-autorizada";
import Link from "next/link";
import Form from "next/form";
import { ExcluirUnificadoLink } from "@/components/excluir-registro-link";
import { BotaoUnificacao } from "@/components/botao-unificacao";
import { notFound } from "next/navigation";
import { Card, Dinheiro, PageHeader, Sigilo, btnPrimario, btnSecundario, inputBase } from "@/components/ui";
import { EstadoUnificado, OrigensUnificadas, dataUnificada, exigirPerfilUnificacao, hrefUnificacao, mensagemUnificacao, motivoUnificacao, primeiroParametro, type ParametrosUnificacao } from "@/components/unificacao-apresentacao";
import { detalheUnificado } from "@/lib/consultas/unificacao";
import { ROTULOS_DOMINIO, type CampoFonte, type FonteUnificacao, type LinhaUnificada } from "@/lib/unificacao/tipos";
import { resolverUnificacao, resolverUnificacaoNaTela } from "@/app/(app)/unificacao/actions";
import { origensDoRegistro } from "@/lib/unificacao/origens";
import { ImpactoConsolidacao } from "@/components/situacao-consolidacao";
import { carteiraIrrestrita, pode } from "@/lib/acesso/politica";
import { FormularioNaTela } from "@/components/formulario-na-tela";

const CAMPOS_RESERVADOS = new Set(["taxa", "administracao", "composicao"]);
const campoVisivel = (chave: string) => !CAMPOS_RESERVADOS.has(chave);
type ContextoConferencia = { retorno: string; hrefDetalhe: string; hrefExcluir?: string };
function Campo({ campo }: { campo?: CampoFonte }) {
  if (!campo || campo.valor === null || campo.valor === "") return <span className="text-tinta-suave">Não informado</span>;
  if (campo.tipo === "dinheiro" && typeof campo.valor === "number") return <Sigilo><Dinheiro centavos={campo.valor} /></Sigilo>;
  return <span className="break-words">{campo.valor}</span>;
}
function Comparacao({ registro, destino }: { registro: FonteUnificacao; destino: FonteUnificacao }) {
  const campos = [...new Set([...Object.keys(registro.campos), ...Object.keys(destino.campos)])].filter(campoVisivel);
  return <div className="min-w-0 overflow-hidden rounded-lg border border-contorno">
    <div className="grid gap-3 border-b border-contorno bg-slate-50/60 p-4 sm:grid-cols-2">
      <div className="min-w-0"><p className="mb-2 break-words text-xs font-semibold">Este registro · {registro.titulo}</p><OrigensUnificadas origens={origensDoRegistro(registro)} /></div>
      <div className="min-w-0"><p className="mb-2 break-words text-xs font-semibold">Principal que será mantido · {destino.titulo}</p><OrigensUnificadas origens={origensDoRegistro(destino)} /></div>
    </div>
    <dl className="divide-y divide-contorno">{campos.map((chave) => {
      const a = registro.campos[chave]; const b = destino.campos[chave];
      const diverge = a?.valor != null && b?.valor != null && String(a.valor) !== String(b.valor);
      return <div key={chave} className={`min-w-0 p-4 ${diverge ? "bg-amber-50/50" : ""}`}>
        <dt className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-tinta-suave">{a?.rotulo ?? b?.rotulo}{diverge ? <span className="text-[10px] text-amber-800">Valores diferentes</span> : null}</dt>
        <dd className="grid min-w-0 gap-3 text-xs sm:grid-cols-2"><div className="min-w-0 break-words"><span className="mb-1 block text-[10px] text-tinta-suave sm:sr-only">Este registro</span><Campo campo={a} /></div><div className="min-w-0 break-words"><span className="mb-1 block text-[10px] text-tinta-suave sm:sr-only">Principal</span><Campo campo={b} /></div></dd>
      </div>;
    })}</dl>
  </div>;
}
function FormularioDecisao({ registro, acao, destino, contexto }: { registro: LinhaUnificada; acao: "VINCULAR" | "DISTINTO" | "REABRIR"; destino?: LinhaUnificada; contexto?: ContextoConferencia }) {
  const vincular = acao === "VINCULAR";
  const campos = <>
    <input type="hidden" name="chave" value={registro.chave} /><input type="hidden" name="versao" value={registro.versao} /><input type="hidden" name="acao" value={acao} /><input type="hidden" name="hashFonte" value={registro.hash} />
    {contexto ? <input type="hidden" name="retornoContexto" value={contexto.hrefDetalhe} /> : null}
    {destino ? <><input type="hidden" name="destinoChave" value={destino.chave} /><input type="hidden" name="hashDestino" value={destino.hash} /></> : null}
    <p className="text-xs leading-relaxed text-tinta">{vincular ? <>Vincular <strong>{registro.titulo}</strong> ao registro <strong>{destino?.titulo}</strong>. Os valores do registro principal prevalecem e a fonte acrescenta contexto. Esta ocorrência deixa de contar separadamente, sem apagar nenhuma linha de origem.</> : acao === "DISTINTO" ? "Confirmar que este registro representa uma ocorrência diferente. Ele permanece independente; quando financeiro, válido e não cancelado nem informativo, entra nos totais." : "Reabrir esta decisão para uma nova análise das fontes e correspondências."}</p>
    <label className="block text-xs font-semibold text-tinta-suave">Justificativa<textarea name="justificativa" minLength={8} maxLength={500} required rows={2} className={`${inputBase} mt-1 w-full`} placeholder="Descreva a evidência conferida: documento, contrato, competência ou referência." /></label>
    <label className="flex items-start gap-2 text-xs text-tinta"><input type="checkbox" name="confirmar" value="sim" required className="mt-0.5" /><span>{vincular ? "Conferi a comparação e confirmo que são o mesmo registro." : acao === "DISTINTO" ? "Conferi as correspondências e confirmo que é um registro diferente." : "Confirmo a reabertura para revisão."}</span></label>
    <BotaoUnificacao className={btnPrimario}>{vincular ? "São o mesmo registro · confirmar vínculo" : acao === "DISTINTO" ? "São registros diferentes · confirmar" : "Reabrir decisão"}</BotaoUnificacao>
  </>;
  const className = "mt-4 space-y-3 rounded-lg border border-contorno bg-slate-50/60 p-4";
  return contexto
    ? <FormularioNaTela key={`${registro.chave}:${acao}:${destino?.chave ?? ""}`} action={resolverUnificacaoNaTela} className={className}>{campos}</FormularioNaTela>
    : <form action={resolverUnificacao} className={className}>{campos}</form>;
}
export async function ConferenciaRegistro({ chave, parametros: sp = {}, contexto }: {
  chave: string;
  parametros?: ParametrosUnificacao;
  contexto?: ContextoConferencia;
}) {
  await exigirPaginaAcesso("/unificacao/[chave]");
  await exigirPermissaoAcesso("cadastros.sensiveis", { global: true });
  await exigirPerfilUnificacao();
  const acesso = await acessoAtual();
  const podeEditar = podeExibirAcao(acesso, { permissao: ["unificacao.editar", "pagamentos.conciliar"], perfis: ["ADMINISTRADOR", "FINANCEIRO"] });
  const buscaDestino = (primeiroParametro(sp.buscarDestino) ?? "").slice(0, 120);
  const detalhe = await detalheUnificado(chave, buscaDestino);
  if (!detalhe) notFound();
  const { registro, candidatos, fontes, historico, baixas } = detalhe;
  if (contexto && !["RECEBER", "PAGAR"].includes(registro.dominio)) notFound();
  const fontesPlanilha = fontes.filter(fonte => typeof fonte.proveniencia?.arquivo === "string");
  const destinoSelecionado = candidatos.find((c) => c.chave === primeiroParametro(sp.destino));
  const podeResolver = podeEditar && ["PENDENTE", "REVISAR", "ATIVO"].includes(registro.estado) && registro.qualidade === "OK";
  const podeDistinguir = podeEditar && ["PENDENTE", "REVISAR", "ATIVO"].includes(registro.estado) && registro.qualidade === "OK";
  const urlDetalhe = new URL(contexto?.hrefDetalhe ?? hrefUnificacao(registro.chave), "http://brisa.local");
  const parametrosBusca = [...urlDetalhe.searchParams.entries()].filter(([nome]) => !["buscarDestino", "destino", "ok", "erro"].includes(nome));
  const hrefComparacao = (destino: string) => {
    const url = new URL(urlDetalhe);
    url.searchParams.set("destino", destino);
    url.searchParams.set("buscarDestino", buscaDestino);
    url.searchParams.delete("ok");
    url.searchParams.delete("erro");
    return `${url.pathname}?${url.searchParams}#comparacao`;
  };
  const podeExcluir = acesso.perfil === "ADMINISTRADOR" && carteiraIrrestrita(acesso) && pode(acesso, "governanca.editar");
  const excluir = contexto
    ? contexto.hrefExcluir && podeExcluir ? <Link prefetch={false} href={contexto.hrefExcluir} scroll={false} className={`${btnSecundario} text-erro`}>Excluir da plataforma</Link> : null
    : await ExcluirUnificadoLink({ registro });
  return <div className="min-w-0">
    {contexto ? <header className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-contorno pb-4"><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold uppercase tracking-wide text-tinta-suave">{ROTULOS_DOMINIO[registro.dominio]} · Conferência na própria tela</p><h2 className="mt-1 break-words text-lg font-bold">{registro.titulo}</h2><p className="mt-1 break-words text-xs leading-relaxed text-tinta-suave">{registro.descricao}</p></div>{excluir}</header> : <PageHeader titulo={registro.titulo} descricao={`${ROTULOS_DOMINIO[registro.dominio]} · ${registro.descricao}`} acoes={<><Link prefetch={false} href="/unificacao" className={btnSecundario}>Voltar à conferência</Link>{registro.href ? <Link prefetch={false} href={registro.href} className={btnPrimario}>Abrir cadastro / lançamento</Link> : null}{excluir}</>} />}
    {primeiroParametro(sp.erro) ? <Card nivel="critico" className="mb-4 p-4 text-sm">{primeiroParametro(sp.erro)}</Card> : null}{primeiroParametro(sp.ok) ? <Card nivel="otimo" className="mb-4 p-4 text-sm">{mensagemUnificacao(primeiroParametro(sp.ok)!)}</Card> : null}
    <Card className="mb-5 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="mb-2 text-xs font-semibold text-tinta-suave">De onde veio</h2><OrigensUnificadas origens={origensDoRegistro(registro)} /></div><div><h2 className="mb-2 text-xs font-semibold text-tinta-suave">Situação atual</h2><EstadoUnificado item={registro} /></div></div><ImpactoConsolidacao item={registro} className="mt-4" /><p className="mt-2 text-xs text-tinta-suave">A situação acima é o tratamento atual na consulta, não um comprovante de pagamento nem de auditoria manual. Para verificar conferências anteriores, consulte o histórico abaixo.</p>{registro.avisos.length || registro.divergencias.length ? <ul className="mt-3 space-y-1 text-xs text-amber-800">{[...new Set([...registro.avisos, ...registro.divergencias])].map((aviso) => <li key={aviso}>{motivoUnificacao(aviso)}</li>)}</ul> : null}</Card>
    {registro.origem === "WIDESYS" && ["RECEBER", "PAGAR"].includes(registro.dominio) ? <Card nivel="atencao" className="mb-5 p-4"><h2 className="text-sm font-bold">Conferência antes de emissão bancária</h2><p className="mt-1 text-xs leading-relaxed text-tinta-suave">Confira o contrato, o saldo, os dados do pagador e a conta emissora. A unificação deste título não emite boletos automaticamente.</p></Card> : null}
    <div className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card className="p-5"><h2 className="text-sm font-bold">1. Confira este registro</h2><dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">{Object.entries(registro.campos).filter(([chaveCampo]) => campoVisivel(chaveCampo)).map(([chaveCampo, campo]) => <div key={chaveCampo} className="min-w-0 border-b border-contorno pb-3"><dt className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-tinta-suave">{campo.rotulo}</dt><dd className="text-xs"><Campo campo={campo} /></dd></div>)}</dl></Card>
      <Card className="min-w-0 p-5"><h2 className="text-sm font-bold">Qual decisão tomar?</h2><ol className="mt-3 list-decimal space-y-3 pl-4 text-xs leading-relaxed text-tinta-suave"><li>Compare a identificação, a referência do imóvel ou contrato, a competência e os valores das duas fontes.</li><li>Se for a mesma ocorrência, escolha o registro principal e confirme o vínculo. Os valores atuais do principal prevalecem.</li><li>Se as evidências mostrarem ocorrências diferentes, confirme “registro distinto”. Nome e valor, sozinhos, não comprovam identidade.</li></ol>{registro.qualidade !== "OK" ? <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Este registro tem uma inconsistência ou ausência na origem. Confira a captura e corrija a origem antes de incluí-lo no consolidado.</p> : null}{podeDistinguir ? <details className="mt-4 border-t border-contorno pt-4"><summary className="cursor-pointer text-xs font-semibold text-oliva-escura">Conferi: é um registro independente</summary><FormularioDecisao registro={registro} acao="DISTINTO" contexto={contexto} /></details> : null}{podeEditar && (registro.estado === "VINCULADO" || historico.length) ? <details className="mt-4 border-t border-contorno pt-4"><summary className="cursor-pointer text-xs font-semibold text-tinta-suave">Reabrir decisão anterior</summary><FormularioDecisao registro={registro} acao="REABRIR" contexto={contexto} /></details> : null}</Card>
    </div>
    {origensDoRegistro(registro).includes("BRISA") ? <Card className="mb-5 p-4"><h2 className="text-sm font-bold">Inclusão no Brisa: origem ainda a confirmar</h2><p className="mt-2 text-xs leading-relaxed text-tinta-suave">Há uma fonte sem evidência suficiente para identificar como entrou no sistema. Não a classificamos como manual: cadastros e lançamentos antigos também podem ter vindo das planilhas iniciais.</p></Card> : null}
    {fontesPlanilha.length ? <Card className="mb-5 p-5"><h2 className="text-sm font-bold">Evidências de origem nas planilhas</h2><p className="mt-1 text-xs text-tinta-suave">Referências comprovadas de arquivos vinculados a este registro, sem somar a fonte novamente.</p><ul className="mt-3 space-y-3">{fontesPlanilha.map(fonte => <li key={fonte.chave} className="break-words border-l-2 border-contorno pl-3 text-xs text-tinta-suave"><span className="font-semibold text-tinta">{String(fonte.proveniencia!.arquivo)}</span>{typeof fonte.proveniencia!.aba === "string" ? ` · Aba: ${fonte.proveniencia!.aba}` : ""}{typeof fonte.proveniencia!.linha === "number" ? ` · Linha: ${fonte.proveniencia!.linha}` : ""}</li>)}</ul></Card> : null}
    {baixas.length ? <Card className="mb-5 min-w-0 overflow-hidden"><div className="border-b border-contorno p-5"><h2 className="text-sm font-bold">Histórico de pagamentos do título</h2><p className="mt-1 text-xs text-tinta-suave">Trilha histórica das fontes; valores podem divergir do principal. Não soma novamente.</p></div>{contexto ? <div className="divide-y divide-contorno">{baixas.map(baixa => <details key={baixa.chave} className="min-w-0 p-4"><summary className="cursor-pointer text-xs font-semibold text-oliva-escura"><span className="break-words">{dataUnificada(baixa.data)} · {baixa.descricao}</span><span className="ml-2 inline-block"><Sigilo><Dinheiro centavos={baixa.valor} /></Sigilo></span></summary><div className="mt-3 flex flex-wrap items-center gap-2"><OrigensUnificadas origens={origensDoRegistro(baixa)} /><EstadoUnificado item={baixa} />{baixa.cancelado ? <span className="text-xs text-erro">Estornado</span> : null}</div><dl className="mt-3 grid gap-3 sm:grid-cols-2">{Object.entries(baixa.campos).filter(([nome]) => campoVisivel(nome)).map(([nome, campo]) => <div key={nome} className="min-w-0"><dt className="mb-1 text-[10px] font-semibold text-tinta-suave">{campo.rotulo}</dt><dd className="text-xs"><Campo campo={campo} /></dd></div>)}</dl><p className="mt-3 text-[11px] text-tinta-suave">Somente consulta. Conferir este histórico não altera nem estorna o pagamento.</p></details>)}</div> : <div className="tabela-scroll overflow-x-auto" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}><table className="tabela tabela--acoes"><thead><tr><th>Data</th><th>Pagamento e origem</th><th>Situação</th><th className="text-right!">Valor</th><th /></tr></thead><tbody>{baixas.map((baixa) => <tr key={baixa.chave}><td>{dataUnificada(baixa.data)}</td><td className="whitespace-normal!"><p className="mb-1 text-xs">{baixa.descricao}</p><OrigensUnificadas origens={origensDoRegistro(baixa)} /></td><td><EstadoUnificado item={baixa} />{baixa.cancelado ? <p className="mt-1 text-xs text-erro">Estornado</p> : null}</td><td className="text-right!"><Sigilo><Dinheiro centavos={baixa.valor} /></Sigilo></td><td className="text-right!"><Link prefetch={false} href={hrefUnificacao(baixa.chave)} className="text-xs font-semibold text-oliva-escura hover:underline">Ver detalhe</Link><ExcluirUnificadoLink registro={baixa} /></td></tr>)}</tbody></table></div>}</Card> : null}
    <Card className="mb-5 min-w-0 p-5"><h2 className="text-sm font-bold">2. Encontre o registro já existente</h2><p className="mt-1 text-xs text-tinta-suave">As sugestões são pistas, não duplicatas confirmadas. Busque pelo nome ou referência e abra a comparação antes de decidir.</p><Form prefetch={false} action={urlDetalhe.pathname} scroll={false} className="mt-3 flex flex-wrap gap-2">{parametrosBusca.map(([nome, valor], indice) => <input key={`${nome}-${indice}`} type="hidden" name={nome} value={valor} />)}<label className="min-w-0 flex-1"><span className="sr-only">Buscar registro principal</span><input name="buscarDestino" defaultValue={buscaDestino} className={`${inputBase} w-full`} placeholder="Nome ou referência do registro principal" /></label><button className={btnSecundario}>Buscar para comparar</button></Form>{candidatos.length ? <div className="mt-4 grid gap-3 md:grid-cols-2">{candidatos.map((candidato) => <div key={candidato.chave} className="min-w-0 rounded-lg border border-contorno p-4"><div className="mb-2 flex flex-wrap gap-2"><OrigensUnificadas origens={origensDoRegistro(candidato)} /><EstadoUnificado item={candidato} /></div><h3 className="break-words text-sm font-semibold">{candidato.titulo}</h3><p className="mt-1 break-words text-xs text-tinta-suave">{candidato.descricao}</p><p className="mt-2 text-[11px] text-tinta-suave">{registro.candidatos.find((c) => c.chave === candidato.chave)?.motivos.map(motivoUnificacao).join(" · ") ?? "Resultado de busca · identidade a conferir"}</p><Link prefetch={false} href={hrefComparacao(candidato.chave)} scroll={false} className={`${btnSecundario} mt-3`}>Comparar lado a lado</Link></div>)}</div> : <p className="mt-4 text-sm text-tinta-suave">Nenhum registro encontrado. Busque por outra referência ou confira se são ocorrências distintas.</p>}</Card>
    {destinoSelecionado ? <Card className="mb-5 min-w-0 p-5" ><section id="comparacao" tabIndex={-1}><h2 className="mb-1 text-sm font-bold">3. Confira o principal antes de confirmar</h2><p className="mb-4 text-xs text-tinta-suave">Principal proposto: {destinoSelecionado.titulo}. Seus valores serão mantidos; este registro não somará uma segunda vez. Diferenças estão destacadas e nenhum campo será sobrescrito por esta vinculação.</p><Comparacao registro={registro} destino={destinoSelecionado} />{podeResolver ? <FormularioDecisao registro={registro} destino={destinoSelecionado} acao="VINCULAR" contexto={contexto} /> : null}</section></Card> : null}
    {fontes.length > 1 ? <Card className="mb-5 p-5"><h2 className="mb-4 text-sm font-bold">Fontes preservadas neste registro</h2><div className="space-y-4">{fontes.filter((f) => f.chave !== registro.chave).map((fonte) => <div key={fonte.chave}><p className="mb-2 text-xs font-semibold">{fonte.titulo}</p><div className="mb-3"><OrigensUnificadas origens={origensDoRegistro(fonte)} /></div><Comparacao registro={fonte} destino={registro} /></div>)}</div></Card> : null}
    <Card className="p-5"><h2 className="text-sm font-bold">Histórico de decisões</h2>{historico.length ? <ol className="mt-4 space-y-3">{historico.map((h, i) => <li key={i} className="border-l-2 border-contorno pl-4"><p className="text-xs font-semibold">{({ VINCULAR: "Vínculo confirmado", DISTINTO: "Registro distinto confirmado", REABRIR: "Decisão reaberta" } as Record<string, string>)[h.acao] ?? h.acao} · {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(h.criadoEm)}</p><p className="mt-1 text-xs text-tinta-suave">{h.justificativa}</p></li>)}</ol> : <p className="mt-3 text-xs text-tinta-suave">Ainda não há decisão manual registrada para este item. Ele pode estar disponível por uma regra automática.</p>}</Card>
  </div>;
}
