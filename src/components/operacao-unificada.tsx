import Link from "next/link";
import { AcaoAutorizada } from "@/components/acao-autorizada";
import { BotaoUnificacao } from "@/components/botao-unificacao";
import { listarTitulosFinanceiros, listarUnificados } from "@/lib/consultas/unificacao";
import { DOMINIOS_UNIFICACAO, type DominioUnificacao } from "@/lib/unificacao/tipos";
import { filtroOrigemVisivel, origensDoRegistro } from "@/lib/unificacao/origens";
import { explicarConsolidacao } from "@/components/situacao-consolidacao";
import { sincronizarUnificacao } from "@/app/(app)/unificacao/actions";
import { Card, PageHeader, btnPrimario, btnSecundario } from "@/components/ui";
import { primeiroParametro, mensagemUnificacao, hrefUnificacao, motivoUnificacao, dataUnificada, exigirPerfilUnificacao, type ParametrosUnificacao } from "@/components/unificacao-apresentacao";
import { contextoFinanceiro, validarRetornoFinanceiro } from "@/lib/interface/contexto-financeiro";
import { JanelaContextual } from "@/components/janela-contextual";
import { ConferenciaRegistro } from "@/components/conferencia-registro";
import { TelaExclusao } from "@/app/(app)/cadastros/governanca/exclusao";
import { TabelaOperacaoUnificada, type LinhaTabelaOperacao } from "@/components/tabela-operacao-unificada";
import { FiltrosOperacaoUnificada } from "@/components/filtros-operacao-unificada";
import { ResumoOperacaoUnificada } from "@/components/resumo-operacao-unificada";
import { acessoAtual } from "@/lib/acesso/servidor";
import { carteiraIrrestrita, pode, podeAbrirRota } from "@/lib/acesso/politica";
import { alvoExclusaoUnificado } from "@/lib/governanca/alvos-ui";
import { ProvedorRateioDespesa } from "@/components/rateio-despesa-botao";
import { ResumoRateiosDespesas } from "@/components/resumo-rateios-despesas";
import { CategoriasDespesaBotao } from "@/components/categorias-despesa-botao";

export { ESTADOS_UNIFICACAO, primeiroParametro, mensagemUnificacao, hrefUnificacao, motivoUnificacao, dataUnificada, exigirPerfilUnificacao, podeAcessarUnificacao, EstadoUnificado, OrigensUnificadas, type ParametrosUnificacao } from "@/components/unificacao-apresentacao";

const ABAS = [
  { href: "/recebimentos", dominio: "RECEBER", titulo: "A receber" },
  { href: "/financeiro/contas-a-pagar", dominio: "PAGAR", titulo: "A pagar" },
  { href: "/caixa", dominio: "MOVIMENTO", titulo: "Movimentações" },
  { href: "/contratos", dominio: "CONTRATO", titulo: "Contratos" },
  { href: "/cadastros/pessoas", dominio: "PESSOA", titulo: "Pessoas" },
  { href: "/cadastros/base-unificada?dominio=IMOVEL", dominio: "IMOVEL", titulo: "Imóveis" },
  { href: "/unificacao", dominio: "CENTRAL", titulo: "Resolver duplicidades" },
];

const ABAS_FINANCEIRAS = [
  { href: "/financeiro/dados", dominio: "CONFERENCIA", titulo: "Dados do Widesys" },
  { href: "/recebimentos", dominio: "RECEBER", titulo: "A receber" },
  { href: "/financeiro/contas-a-pagar", dominio: "PAGAR", titulo: "A pagar" },
  { href: "/caixa", dominio: "MOVIMENTO", titulo: "Entradas e saídas" },
];

const DOMINIOS_CADASTRAIS = ["PESSOA", "IMOVEL", "CONTRATO", "PARAMETRO"];

export async function OperacaoUnificada({ dominio: dominioFixo, titulo, base, parametros = {}, nativo, central = false }: {
  dominio?: DominioUnificacao; titulo: string; base: string; parametros?: ParametrosUnificacao;
  nativo?: { href: string; rotulo: string }; central?: boolean;
}) {
  await exigirPerfilUnificacao();
  const dominioSolicitado = DOMINIOS_UNIFICACAO.find(dominio => dominio === primeiroParametro(parametros.dominio));
  const dominio = dominioFixo ?? dominioSolicitado ?? (central ? "PESSOA" : undefined);
  const financeiro = ["RECEBER", "PAGAR"].includes(dominio ?? "");
  const movimento = dominio === "MOVIMENTO";
  const baixa = ["BAIXA_RECEBER", "BAIXA_PAGAR"].includes(dominio ?? "");
  const fonteFinanceiraUnica = financeiro || movimento || baixa;
  const estadoSolicitado = primeiroParametro(parametros.estado) ?? "";
  const estado = fonteFinanceiraUnica && !["ATIVO", "QUARENTENA", "AUSENTE"].includes(estadoSolicitado) ? "" : estadoSolicitado;
  const origem = fonteFinanceiraUnica ? "" : filtroOrigemVisivel(primeiroParametro(parametros.origem));
  const parametrosContextuais = fonteFinanceiraUnica ? { ...parametros, origem: undefined, estado, destino: undefined, buscarDestino: undefined } : parametros;
  const q = (primeiroParametro(parametros.q) ?? "").slice(0, 120);
  const mes = primeiroParametro(parametros.mes) ?? "";
  const de = primeiroParametro(parametros.de) ?? "";
  const ate = primeiroParametro(parametros.ate) ?? "";
  const papel = primeiroParametro(parametros.papel) ?? "";
  const vencidos = primeiroParametro(parametros.vencidos) === "1";
  const pagina = Number(primeiroParametro(parametros.pagina)) || 1;
  const tamanhoSolicitado = Number(primeiroParametro(parametros.porPagina));
  const porPagina = [25, 50, 100].includes(tamanhoSolicitado) ? tamanhoSolicitado : 25;
  const filtros = { estado: estado || undefined, origem: origem || undefined, q, mes, de, ate, papel: papel || undefined, vencidos, pagina, porPagina };
  const dados = dominio === "PAGAR" || dominio === "RECEBER"
    ? await listarTitulosFinanceiros({ ...filtros, dominio })
    : await listarUnificados({ ...filtros, dominio });
  const contexto = financeiro ? contextoFinanceiro(base, parametrosContextuais) : null;
  const chaveSelecionada = primeiroParametro(parametros.registro);
  const painel = primeiroParametro(parametros.painel);
  // URLs servem apenas para navegação. O componente de detalhe/exclusão autoriza novamente no servidor.
  const selecionadoManual = dados.itens.some(item => item.chave === chaveSelecionada && item.proveniencia?.tipo === "CADASTRO_MANUAL");
  const selecaoValida = contexto && chaveSelecionada && (chaveSelecionada.startsWith("WIDESYS:") || selecionadoManual) && chaveSelecionada.split(":")[1] === dominio
    && (painel === "detalhe" || painel === "excluir")
    && validarRetornoFinanceiro(`${contexto.retorno}${contexto.retorno.includes("?") ? "&" : "?"}${new URLSearchParams({ registro: chaveSelecionada, painel })}`);
  const conteudoJanela = selecaoValida ? painel === "excluir"
    ? await TelaExclusao({ tipo: "TITULO", origemId: chaveSelecionada!, contexto: { retorno: contexto!.retorno } })
    : await ConferenciaRegistro({ chave: chaveSelecionada!, parametros: parametrosContextuais, contexto: { retorno: contexto!.retorno, hrefDetalhe: contexto!.hrefDetalhe(chaveSelecionada!), hrefExcluir: contexto!.hrefExcluir(chaveSelecionada!) } })
    : null;
  const hrefDetalhe = (chave: string) => contexto?.hrefDetalhe(chave) ?? hrefUnificacao(chave);
  const acesso = await acessoAtual();
  const listaFinanceira = fonteFinanceiraUnica;
  const abasVisiveis = (listaFinanceira ? ABAS_FINANCEIRAS : ABAS).filter(aba => podeAbrirRota(acesso, aba.href.split("?")[0]));
  const permiteExcluir = acesso.perfil === "ADMINISTRADOR" && pode(acesso, "governanca.editar") && carteiraIrrestrita(acesso);
  const permiteVerRateio = dominio === "PAGAR" && carteiraIrrestrita(acesso) && pode(acesso, "despesas.ver");
  const permiteEditarRateio = permiteVerRateio && pode(acesso, "despesas.editar");
  const novoLancamento = dominio === "PAGAR" && permiteEditarRateio
    ? { href: "/financeiro/contas-a-pagar/novo", rotulo: "Nova conta a pagar" }
    : dominio === "RECEBER" && pode(acesso, "recebimentos.editar") && pode(acesso, "pagamentos.conciliar")
      ? { href: "/recebimentos/novo", rotulo: "Nova conta a receber" }
      : movimento && pode(acesso, "caixa.editar")
        ? { href: mes ? `/caixa/novo?${new URLSearchParams({ mes })}` : "/caixa/novo", rotulo: "Novo movimento" }
        : null;
  // Somente campos já visíveis na lista atravessam a fronteira RSC/cliente.
  // Nunca enviar o objeto do DAL, candidatos, campos fiscais, documentos ou hashes.
  const itensTabela: LinhaTabelaOperacao[] = dados.itens.map(item => {
    const alvo = permiteExcluir ? alvoExclusaoUnificado(item) : null;
    return {
      chave: item.chave,
      dominio: item.dominio,
      titulo: item.titulo,
      descricao: item.descricao,
      origens: origensDoRegistro(item),
      papeis: item.papeis ?? [],
      estado: item.estado,
      conferidoManualmente: item.conferidoManualmente,
      conferidoPorRegra: item.conferidoPorRegra,
      conferidoNaOrigem: item.conferidoNaOrigem,
      cancelado: item.cancelado,
      informativo: item.informativo,
      contabiliza: item.contabiliza,
      correspondencias: fonteFinanceiraUnica ? 0 : item.candidatos.length,
      aviso: item.avisos.length ? motivoUnificacao(item.avisos[0]) : null,
      impacto: fonteFinanceiraUnica ? item.contabiliza ? "Este registro compõe os totais." : "Este registro está fora dos totais." : explicarConsolidacao(item),
      data: dataUnificada(item.vencimento ?? item.data),
      competencia: item.competencia ?? null,
      valor: financeiro || movimento || baixa ? item.valor ?? null : null,
      pago: financeiro ? item.pago ?? null : null,
      aberto: financeiro ? item.aberto ?? null : null,
      natureza: movimento || baixa ? item.natureza ?? null : null,
      hrefDetalhe: hrefDetalhe(item.chave),
      hrefCadastro: contexto || (movimento && item.proveniencia?.tipo === "CADASTRO_MANUAL") ? null : item.href,
      exclusao: alvo ? {
        href: contexto?.hrefExcluir(item.chave) ?? `/cadastros/governanca?${new URLSearchParams({ tipo: alvo.tipo, origemId: alvo.origemId, modo: "excluir" })}`,
        rotulo: alvo.rotulo ?? "Excluir da plataforma",
      } : null,
      rateio: permiteEditarRateio && item.dominio === "PAGAR" && ["ATIVO", "QUARENTENA"].includes(item.estado)
        ? item.origem === "WIDESYS" ? { origemChave: item.chave }
          : item.proveniencia?.tipo === "CADASTRO_MANUAL" ? { id: item.origemId } : undefined
        : undefined,
    };
  });
  const hrefLista = (opcoes: { pagina?: number; estado?: string }) => {
    const p = new URLSearchParams();
    for (const [nome, valor] of Object.entries({ dominio: dominioFixo ? "" : dominio, estado: opcoes.estado ?? estado, origem, q, mes, de, ate, papel, vencidos: vencidos ? "1" : "" })) if (valor) p.set(nome, valor);
    if (porPagina !== 25) p.set("porPagina", String(porPagina));
    if (opcoes.pagina) p.set("pagina", String(opcoes.pagina));
    return `${base}?${p}`;
  };
  const hrefPagina = (pagina: number) => hrefLista({ pagina });
  const atalhos = fonteFinanceiraUnica
    ? [["", "Todos os registros"], ["ATIVO", "Disponíveis"], ["QUARENTENA", "Inconsistências"], ["AUSENTE", "Ausentes na captura"]]
    : [["", "Todos visíveis"], ["ATIVO", "Disponíveis"], ["PENDENTE", "Possíveis duplicatas"], ["REVISAR", "Decisões a revisar"], ["QUARENTENA", "Inconsistências"]];
  return <ProvedorRateioDespesa><div>
    <PageHeader titulo={titulo}
      descricao={listaFinanceira ? "Lançamentos do Widesys e registros manuais do Brisa." : central ? "Consulte os registros e a situação de cada cadastro." : "Consulte registros e pendências cadastrais."}
      acoes={<>
        {permiteVerRateio && <>
          <ResumoRateiosDespesas />
          {podeAbrirRota(acesso, "/cadastros/fornecedores") && <Link href="/cadastros/fornecedores" prefetch={false} className={btnSecundario}>Fornecedores</Link>}
          {acesso.perfil === "ADMINISTRADOR" && <CategoriasDespesaBotao />}
        </>}
        {novoLancamento && <Link href={novoLancamento.href} prefetch={false} className={btnPrimario}>{novoLancamento.rotulo}</Link>}
      </>}
    />
    <nav aria-label={listaFinanceira ? "Listas do financeiro" : "Operação unificada"} className="mb-5 flex flex-wrap gap-1.5 rounded-xl border border-contorno bg-carta p-2">{abasVisiveis.map((aba) => <Link prefetch={false} key={aba.dominio} href={aba.href} aria-current={(central ? aba.dominio === "CENTRAL" : aba.dominio === dominio) ? "page" : undefined} className={`rounded-lg px-3 py-2 text-xs font-semibold ${(central ? aba.dominio === "CENTRAL" : aba.dominio === dominio) ? "bg-oliva/10 text-oliva-escura" : "text-tinta-suave hover:bg-slate-50"}`}>{aba.titulo}</Link>)}</nav>
    {primeiroParametro(parametros.erro) ? <Card nivel="critico" className="mb-4 p-4 text-sm">{primeiroParametro(parametros.erro)}</Card> : null}
    {primeiroParametro(parametros.ok) ? <Card nivel="otimo" className="mb-4 p-4 text-sm">{mensagemUnificacao(primeiroParametro(parametros.ok)!)}</Card> : null}
    {!fonteFinanceiraUnica && !dados.sincronizado ? <Card nivel="atencao" className="mb-4 p-4 text-sm">A análise das correspondências ainda não está registrada. Use “Reanalisar correspondências” para conferir os dados cadastrais já disponíveis no Brisa.</Card> : null}
    <ResumoOperacaoUnificada
      financeiro={financeiro}
      movimento={movimento}
      fonteFinanceiraUnica={fonteFinanceiraUnica}
      devido={financeiro ? dados.resumo.devido : 0}
      pago={financeiro ? dados.resumo.pago : 0}
      aberto={financeiro ? dados.resumo.aberto : 0}
      entradas={movimento ? dados.resumo.entradas : 0}
      saidas={movimento ? dados.resumo.saidas : 0}
      ativos={!financeiro && !movimento ? dados.resumo.ativos : 0}
      vinculados={!financeiro && !movimento ? dados.resumo.vinculados : 0}
      pendentes={dados.resumo.pendentes}
      quarentena={dados.resumo.quarentena}
      abertoPendente={financeiro && dados.resumo.abertoPendente > 0 ? dados.resumo.abertoPendente : 0}
    />
    <div id="lista-lancamentos" className="scroll-mt-20" />
    <Card className="overflow-hidden">
      <nav aria-label="Atalhos por situação" className="flex flex-wrap gap-2 border-b border-contorno p-4">{atalhos.map(([valor, rotulo]) => <Link prefetch={false} key={valor} href={hrefLista({ estado: valor })} aria-current={estado === valor ? "page" : undefined} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${estado === valor ? "border-oliva bg-oliva/10 text-oliva-escura" : "border-contorno text-tinta-suave hover:bg-slate-50"}`}>{rotulo}</Link>)}</nav>
      <FiltrosOperacaoUnificada base={base} dominio={dominio ?? ""} dominioFixo={Boolean(dominioFixo)} dominiosDisponiveis={central && !fonteFinanceiraUnica ? DOMINIOS_CADASTRAIS : undefined} financeiro={financeiro} movimento={movimento} baixa={baixa} fonteFinanceiraUnica={fonteFinanceiraUnica} q={q} origem={origem} estado={estado} mes={mes} de={de} ate={ate} papel={papel} vencidos={vencidos} porPagina={porPagina} />
      {financeiro || movimento || baixa ? <p className="border-b border-contorno px-4 py-2 text-[10px] leading-relaxed text-tinta-suave">{financeiro ? "Mês e intervalo usam a competência do título; no intervalo, ela corresponde ao primeiro dia do mês. Sem competência, usam o vencimento e, na falta dele, a data do registro." : "Mês e intervalo usam a data do movimento ou da baixa. Quando ausente, usam o vencimento e depois a competência, considerada no primeiro dia do mês."}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-contorno bg-slate-50/60 px-4 py-3 text-xs text-tinta-suave"><span>{dados.total} registro(s) · página {dados.pagina} de {dados.paginas || 1}</span><span>{fonteFinanceiraUnica ? "Os totais incluem os lançamentos válidos." : "Possíveis duplicidades e inconsistências ficam fora dos totais."}</span></div>
      <TabelaOperacaoUnificada
        key={contexto?.retorno ?? hrefLista({ pagina: dados.pagina })}
        itens={itensTabela} financeiro={financeiro} exibirDominio={!dominioFixo} fonteFinanceiraUnica={fonteFinanceiraUnica}
        exibirValor={movimento || baixa} contextual={Boolean(contexto)}
        exclusaoLote={permiteExcluir && contexto && (dominio === "RECEBER" || dominio === "PAGAR")
          ? { dominio, contexto: contexto.retorno } : undefined}
      />
      <div className="flex items-center justify-between gap-3 border-t border-contorno p-4"><span className="text-xs text-tinta-suave">A origem e as decisões ficam registradas no histórico.</span><div className="flex gap-2">{dados.pagina > 1 ? <Link prefetch={false} className={btnSecundario} href={hrefPagina(dados.pagina - 1)}>Anterior</Link> : null}{dados.pagina < dados.paginas ? <Link prefetch={false} className={btnSecundario} href={hrefPagina(dados.pagina + 1)}>Próxima</Link> : null}</div></div>
    </Card>
    {!fonteFinanceiraUnica ? <details className="mt-5 rounded-xl border border-contorno bg-carta p-4">
      <summary className="cursor-pointer text-sm font-semibold text-tinta">Ferramentas de conferência e base original</summary>
      <p className="mt-3 max-w-3xl text-xs leading-relaxed text-tinta-suave">Reanalisar compara os registros que já estão no Brisa. Não importa arquivos nem busca dados novos no Widesys. Nenhuma possível duplicata é aprovada por este botão.</p>
      <div className="mt-3 flex flex-wrap items-start gap-3">
        <AcaoAutorizada permissao={["unificacao.editar", "pagamentos.conciliar"]} perfis={["ADMINISTRADOR", "FINANCEIRO"]}><form action={sincronizarUnificacao}><BotaoUnificacao className={btnSecundario}>Reanalisar correspondências</BotaoUnificacao></form></AcaoAutorizada>
        {nativo && podeAbrirRota(acesso, nativo.href.split("?")[0]) ? <Link prefetch={false} href={nativo.href} className={btnSecundario}>{nativo.rotulo}</Link> : null}
      </div>
      {nativo ? <p className="mt-3 text-xs text-tinta-suave">A base original mantém suas próprias regras. Não some seus valores aos desta lista.</p> : null}
    </details> : null}
    {conteudoJanela && contexto ? <JanelaContextual titulo={painel === "excluir" ? "Excluir ou restaurar registro" : "Detalhes do lançamento"} retorno={contexto.retorno} selecao={`${chaveSelecionada}:${painel}`}>{conteudoJanela}</JanelaContextual> : null}
  </div></ProvedorRateioDespesa>;
}
