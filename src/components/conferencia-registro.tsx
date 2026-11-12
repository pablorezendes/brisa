import { acessoAtual, exigirPaginaAcesso, exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { randomUUID } from "node:crypto";
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
import { CamposRegistroConferencia, ComparacaoCamposConferencia } from "@/components/campos-conferencia";
import { FormularioLancamentoManual } from "@/components/formulario-lancamento-manual";
import { registrarBaixaRecebimentoManual, registrarBaixaRecebimentoWidesys } from "@/app/(app)/recebimentos/novo/actions";
import { hojeISO } from "@/lib/dominio/periodo";
import { tipoBaixaRecebimento } from "@/lib/unificacao/baixa-recebimento";

const CAMPOS_RESERVADOS = new Set(["taxa", "administracao", "composicao"]);
const campoVisivel = (registro: FonteUnificacao, chave: string) => !CAMPOS_RESERVADOS.has(chave)
  && (registro.origem === "WIDESYS" || registro.proveniencia?.tipo === "CADASTRO_MANUAL" || registro.campos[chave]?.tipo !== "dinheiro");
// Projeção explícita: não enviar objetos do DAL nem campos reservados ao cliente.
const campoProjetado = (campo: CampoFonte): CampoFonte => ({ rotulo: campo.rotulo, valor: campo.valor, ...(campo.tipo ? { tipo: campo.tipo } : {}) });
type ContextoConferencia = { retorno: string; hrefDetalhe: string; hrefExcluir?: string; priorizarBaixa?: boolean };
const ROTAS_FINANCEIRAS: Record<string, string | undefined> = {
  RECEBER: "/recebimentos",
  PAGAR: "/financeiro/contas-a-pagar",
  MOVIMENTO: "/caixa",
  BAIXA_RECEBER: "/recebimentos",
  BAIXA_PAGAR: "/financeiro/contas-a-pagar",
};

function detalhesFinanceiros({ registro, baixas, rota, contextual, excluir, acao, priorizarBaixa }: { registro: LinhaUnificada; baixas: LinhaUnificada[]; rota: string; contextual: boolean; excluir: React.ReactNode; acao?: React.ReactNode; priorizarBaixa?: boolean }) {
  const rotulo = ROTULOS_DOMINIO[registro.dominio];
  const avisos = registro.avisos.length ? <ul className="mt-3 space-y-1 text-xs text-amber-800">{registro.avisos.map(aviso => <li key={aviso}>{motivoUnificacao(aviso)}</li>)}</ul> : null;
  return <div className="min-w-0 space-y-4">
    {contextual ? <header className="flex flex-wrap items-start justify-between gap-3 border-b border-contorno pb-4">
      <div className="min-w-0"><h2 className="break-words text-lg font-bold">{registro.titulo}</h2><p className="mt-1 break-words text-xs text-tinta-suave">{registro.descricao}</p></div>{excluir}
    </header> : <PageHeader titulo={registro.titulo} descricao={`${rotulo} · ${registro.descricao}`} acoes={<><Link prefetch={false} href={rota} className={btnSecundario}>Voltar à lista</Link>{excluir}</>} />}
    {priorizarBaixa && <>{avisos}{acao}</>}
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2"><OrigensUnificadas origens={origensDoRegistro(registro)} /><EstadoUnificado item={registro} /></div>
      {registro.estado === "QUARENTENA" ? <p className="mt-3 text-xs text-tinta-suave">Confira este lançamento no Widesys e importe uma captura atualizada após corrigir a origem.</p> : null}
      {!priorizarBaixa && avisos}
      <CamposRegistroConferencia campos={Object.entries(registro.campos).filter(([chave]) => campoVisivel(registro, chave)).map(([chave, campo]) => ({ chave, campo: campoProjetado(campo) }))} />
    </Card>
    {!priorizarBaixa && acao}
    {baixas.length ? <Card className="divide-y divide-contorno overflow-hidden">
      <h2 className="p-4 text-sm font-bold">{registro.dominio === "RECEBER" ? "Recebimentos registrados" : "Baixas registradas no Widesys"}</h2>
      {baixas.map(baixa => <details key={baixa.chave} className="p-4">
        <summary className="cursor-pointer text-xs font-semibold text-oliva-escura"><span className="break-words">{dataUnificada(baixa.data)} · {baixa.descricao} · {baixa.origem === "WIDESYS" ? "Widesys" : "Brisa"}</span><span className="ml-2 inline-block"><Sigilo><Dinheiro centavos={baixa.valor} /></Sigilo></span></summary>
        <div className="mt-3"><EstadoUnificado item={baixa} /></div>
        {baixa.avisos.length > 0 && <ul className="mt-3 space-y-1 text-xs text-amber-800">{baixa.avisos.map(aviso => <li key={aviso}>{motivoUnificacao(aviso)}</li>)}</ul>}
        <CamposRegistroConferencia campos={Object.entries(baixa.campos).filter(([chave]) => campoVisivel(baixa, chave)).map(([chave, campo]) => ({ chave, campo: campoProjetado(campo) }))} />
      </details>)}
    </Card> : null}
  </div>;
}

function Comparacao({ registro, destino }: { registro: FonteUnificacao; destino: FonteUnificacao }) {
  const campos = [...new Set([...Object.keys(registro.campos), ...Object.keys(destino.campos)])]
    .filter(chave => Boolean(registro.campos[chave] && campoVisivel(registro, chave) || destino.campos[chave] && campoVisivel(destino, chave)));
  return <div className="min-w-0 overflow-hidden rounded-lg border border-contorno">
    <div className="grid gap-3 border-b border-contorno bg-slate-50/60 p-4 sm:grid-cols-2">
      <div className="min-w-0"><p className="mb-2 break-words text-xs font-semibold">Este registro · {registro.titulo}</p><OrigensUnificadas origens={origensDoRegistro(registro)} /></div>
      <div className="min-w-0"><p className="mb-2 break-words text-xs font-semibold">Principal que será mantido · {destino.titulo}</p><OrigensUnificadas origens={origensDoRegistro(destino)} /></div>
    </div>
    <ComparacaoCamposConferencia campos={campos.map(chave => ({ chave, a: registro.campos[chave] && campoVisivel(registro, chave) ? campoProjetado(registro.campos[chave]) : null, b: destino.campos[chave] && campoVisivel(destino, chave) ? campoProjetado(destino.campos[chave]) : null }))} />
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
  const rotaFinanceira = ROTAS_FINANCEIRAS[chave.split(":")[1]];
  const buscaDestino = rotaFinanceira ? "" : (primeiroParametro(sp.buscarDestino) ?? "").slice(0, 120);
  const detalhe = await detalheUnificado(chave, buscaDestino);
  if (!detalhe) notFound();
  const { registro, candidatos, fontes, historico, baixas } = detalhe;
  if (contexto && !["RECEBER", "PAGAR"].includes(registro.dominio)) notFound();
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
    ? contexto.hrefExcluir && podeExcluir && !registro.baixaLocalWidesys ? <Link prefetch={false} href={contexto.hrefExcluir} scroll={false} className={`${btnSecundario} text-erro`}>Excluir da plataforma</Link> : null
    : await ExcluirUnificadoLink({ registro });
  if (rotaFinanceira) {
    if (registro.origem !== "WIDESYS" && registro.proveniencia?.tipo !== "CADASTRO_MANUAL") notFound();
    const manual = registro.proveniencia?.tipo === "CADASTRO_MANUAL";
    const podeEditarCaixa = manual && carteiraIrrestrita(acesso) && pode(acesso, "caixa.editar");
    const tipoBaixa = tipoBaixaRecebimento(registro, acesso);
    const registrarBaixa = tipoBaixa === "WIDESYS" ? registrarBaixaRecebimentoWidesys : registrarBaixaRecebimentoManual;
    const acao = tipoBaixa
      ? <Card className="p-5">
          <h3 className="text-sm font-bold">Registrar recebimento</h3>
          <div className="mb-4 mt-1 space-y-1 text-sm text-tinta-suave">
            <p>Saldo em aberto <Sigilo><Dinheiro centavos={registro.aberto ?? 0} /></Sigilo>. Para uma baixa parcial, informe o valor que entrou.</p>
            {tipoBaixa === "WIDESYS" && <p>A partir da primeira baixa no Brisa, registre aqui os próximos recebimentos deste título.</p>}
          </div>
          <FormularioLancamentoManual
            acao={registrarBaixa.bind(null, registro.origemId, randomUUID(), contexto?.retorno ?? rotaFinanceira)}
            cancelar={contexto?.retorno ?? rotaFinanceira}
            rotuloEnvio="Confirmar recebimento"
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm">Valor recebido (R$)<input className={`${inputBase} mt-1 w-full`} name="valor" inputMode="decimal" placeholder="0,00" required /></label>
              <label className="text-sm">Data do recebimento<input className={`${inputBase} mt-1 w-full`} type="date" name="dataPagamento" defaultValue={hojeISO()} required /></label>
              <label className="text-sm">Forma
                <select className={`${inputBase} mt-1 w-full`} name="via">
                  <option value="PIX">Pix</option><option value="BOLETO">Boleto</option>
                  <option value="DINHEIRO">Dinheiro</option><option value="TRANSFERENCIA">Transferência</option>
                </select>
              </label>
            </div>
          </FormularioLancamentoManual>
        </Card>
      : manual && registro.dominio === "MOVIMENTO" && registro.tituloChave
        ? <Link href={hrefUnificacao(registro.tituloChave)} className={btnSecundario}>Ver conta vinculada</Link>
        : podeEditarCaixa && registro.dominio === "MOVIMENTO" && registro.href
          ? <Link href={registro.href} className={btnSecundario}>Editar movimento</Link>
          : undefined;
    return detalhesFinanceiros({ registro, baixas: baixas.filter(baixa => baixa.origem === "WIDESYS" || (baixa.dominio === "BAIXA_RECEBER" && baixa.lancamentoManual)), rota: rotaFinanceira, contextual: Boolean(contexto), excluir, acao, priorizarBaixa: contexto?.priorizarBaixa });
  }
  return <div className="min-w-0">
    {contexto ? <header className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-contorno pb-4"><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold uppercase tracking-wide text-tinta-suave">{ROTULOS_DOMINIO[registro.dominio]} · Conferência na própria tela</p><h2 className="mt-1 break-words text-lg font-bold">{registro.titulo}</h2><p className="mt-1 break-words text-xs leading-relaxed text-tinta-suave">{registro.descricao}</p></div>{excluir}</header> : <PageHeader titulo={registro.titulo} descricao={`${ROTULOS_DOMINIO[registro.dominio]} · ${registro.descricao}`} acoes={<><Link prefetch={false} href="/unificacao" className={btnSecundario}>Voltar à conferência</Link>{registro.href ? <Link prefetch={false} href={registro.href} className={btnPrimario}>Abrir cadastro / lançamento</Link> : null}{excluir}</>} />}
    {primeiroParametro(sp.erro) ? <Card nivel="critico" className="mb-4 p-4 text-sm">{primeiroParametro(sp.erro)}</Card> : null}{primeiroParametro(sp.ok) ? <Card nivel="otimo" className="mb-4 p-4 text-sm">{mensagemUnificacao(primeiroParametro(sp.ok)!)}</Card> : null}
    <Card className="mb-5 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="mb-2 text-xs font-semibold text-tinta-suave">De onde veio</h2><OrigensUnificadas origens={origensDoRegistro(registro)} /></div><div><h2 className="mb-2 text-xs font-semibold text-tinta-suave">Situação atual</h2><EstadoUnificado item={registro} /></div></div><ImpactoConsolidacao item={registro} className="mt-4" /><p className="mt-2 text-xs text-tinta-suave">A situação acima é o tratamento atual na consulta, não um comprovante de pagamento nem de auditoria manual. Para verificar conferências anteriores, consulte o histórico abaixo.</p>{registro.avisos.length || registro.divergencias.length ? <ul className="mt-3 space-y-1 text-xs text-amber-800">{[...new Set([...registro.avisos, ...registro.divergencias])].map((aviso) => <li key={aviso}>{motivoUnificacao(aviso)}</li>)}</ul> : null}</Card>
    <div className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card className="p-5"><h2 className="text-sm font-bold">1. Confira este registro</h2><CamposRegistroConferencia campos={Object.entries(registro.campos).filter(([chave]) => campoVisivel(registro, chave)).map(([chave, campo]) => ({ chave, campo: campoProjetado(campo) }))} /></Card>
      <Card className="min-w-0 p-5"><h2 className="text-sm font-bold">Qual decisão tomar?</h2><ol className="mt-3 list-decimal space-y-3 pl-4 text-xs leading-relaxed text-tinta-suave"><li>Compare a identificação, a referência do imóvel ou contrato, a competência e os valores das duas fontes.</li><li>Se for a mesma ocorrência, escolha o registro principal e confirme o vínculo. Os valores atuais do principal prevalecem.</li><li>Se as evidências mostrarem ocorrências diferentes, confirme “registro distinto”. Nome e valor, sozinhos, não comprovam identidade.</li></ol>{registro.qualidade !== "OK" ? <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Este registro tem uma inconsistência ou ausência na origem. Confira a captura e corrija a origem antes de incluí-lo no consolidado.</p> : null}{podeDistinguir ? <details className="mt-4 border-t border-contorno pt-4"><summary className="cursor-pointer text-xs font-semibold text-oliva-escura">Conferi: é um registro independente</summary><FormularioDecisao registro={registro} acao="DISTINTO" contexto={contexto} /></details> : null}{podeEditar && (registro.estado === "VINCULADO" || historico.length) ? <details className="mt-4 border-t border-contorno pt-4"><summary className="cursor-pointer text-xs font-semibold text-tinta-suave">Reabrir decisão anterior</summary><FormularioDecisao registro={registro} acao="REABRIR" contexto={contexto} /></details> : null}</Card>
    </div>
    <Card className="mb-5 min-w-0 p-5"><h2 className="text-sm font-bold">2. Encontre o registro já existente</h2><p className="mt-1 text-xs text-tinta-suave">As sugestões são pistas, não duplicatas confirmadas. Busque pelo nome ou referência e abra a comparação antes de decidir.</p><Form prefetch={false} action={urlDetalhe.pathname} scroll={false} className="mt-3 flex flex-wrap gap-2">{parametrosBusca.map(([nome, valor], indice) => <input key={`${nome}-${indice}`} type="hidden" name={nome} value={valor} />)}<label className="min-w-0 flex-1"><span className="sr-only">Buscar registro principal</span><input name="buscarDestino" defaultValue={buscaDestino} className={`${inputBase} w-full`} placeholder="Nome ou referência do registro principal" /></label><button className={btnSecundario}>Buscar para comparar</button></Form>{candidatos.length ? <div className="mt-4 grid gap-3 md:grid-cols-2">{candidatos.map((candidato) => <div key={candidato.chave} className="min-w-0 rounded-lg border border-contorno p-4"><div className="mb-2 flex flex-wrap gap-2"><OrigensUnificadas origens={origensDoRegistro(candidato)} /><EstadoUnificado item={candidato} /></div><h3 className="break-words text-sm font-semibold">{candidato.titulo}</h3><p className="mt-1 break-words text-xs text-tinta-suave">{candidato.descricao}</p><p className="mt-2 text-[11px] text-tinta-suave">{registro.candidatos.find((c) => c.chave === candidato.chave)?.motivos.map(motivoUnificacao).join(" · ") ?? "Resultado de busca · identidade a conferir"}</p><Link prefetch={false} href={hrefComparacao(candidato.chave)} scroll={false} className={`${btnSecundario} mt-3`}>Comparar lado a lado</Link></div>)}</div> : <p className="mt-4 text-sm text-tinta-suave">Nenhum registro encontrado. Busque por outra referência ou confira se são ocorrências distintas.</p>}</Card>
    {destinoSelecionado ? <Card className="mb-5 min-w-0 p-5" ><section id="comparacao" tabIndex={-1}><h2 className="mb-1 text-sm font-bold">3. Confira o principal antes de confirmar</h2><p className="mb-4 text-xs text-tinta-suave">Principal proposto: {destinoSelecionado.titulo}. Seus valores serão mantidos; este registro não somará uma segunda vez. Diferenças estão destacadas e nenhum campo será sobrescrito por esta vinculação.</p><Comparacao registro={registro} destino={destinoSelecionado} />{podeResolver ? <FormularioDecisao registro={registro} destino={destinoSelecionado} acao="VINCULAR" contexto={contexto} /> : null}</section></Card> : null}
    {fontes.length > 1 ? <Card className="mb-5 p-5"><h2 className="mb-4 text-sm font-bold">Fontes preservadas neste registro</h2><div className="space-y-4">{fontes.filter((f) => f.chave !== registro.chave).map((fonte) => <div key={fonte.chave}><p className="mb-2 text-xs font-semibold">{fonte.titulo}</p><div className="mb-3"><OrigensUnificadas origens={origensDoRegistro(fonte)} /></div><Comparacao registro={fonte} destino={registro} /></div>)}</div></Card> : null}
    <Card className="p-5"><h2 className="text-sm font-bold">Histórico de decisões</h2>{historico.length ? <ol className="mt-4 space-y-3">{historico.map((h, i) => <li key={i} className="border-l-2 border-contorno pl-4"><p className="text-xs font-semibold">{({ VINCULAR: "Vínculo confirmado", DISTINTO: "Registro distinto confirmado", REABRIR: "Decisão reaberta", CONFERIR_ORIGEM_WIDESYS: "Origem conferida no Widesys" } as Record<string, string>)[h.acao] ?? h.acao} · {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(h.criadoEm)}</p>{h.acao !== "CONFERIR_ORIGEM_WIDESYS" && <p className="mt-1 text-xs text-tinta-suave">{h.justificativa}</p>}</li>)}</ol> : <p className="mt-3 text-xs text-tinta-suave">Ainda não há decisão manual registrada para este item. Ele pode estar disponível por uma regra automática.</p>}</Card>
  </div>;
}
