import Link from "next/link";
import { AcaoAutorizada } from "@/components/acao-autorizada";
import { BotaoUnificacao } from "@/components/botao-unificacao";
import { listarUnificados } from "@/lib/consultas/unificacao";
import { ROTULOS_DOMINIO, type DominioUnificacao } from "@/lib/unificacao/tipos";
import { ROTULOS_ORIGEM_DADOS, origensDoRegistro } from "@/lib/unificacao/origens";
import { explicarConsolidacao } from "@/components/situacao-consolidacao";
import { sincronizarUnificacao, sincronizarUnificacaoNaTela } from "@/app/(app)/unificacao/actions";
import { FormularioNaTela } from "@/components/formulario-na-tela";
import { Card, Dinheiro, Kpi, PageHeader, Sigilo, btnPrimario, btnSecundario, inputBase } from "@/components/ui";
import { ESTADOS_UNIFICACAO, primeiroParametro, mensagemUnificacao, hrefUnificacao, motivoUnificacao, dataUnificada, exigirPerfilUnificacao, type ParametrosUnificacao } from "@/components/unificacao-apresentacao";
import { contextoFinanceiro, validarRetornoFinanceiro } from "@/lib/interface/contexto-financeiro";
import { JanelaContextual } from "@/components/janela-contextual";
import { ConferenciaRegistro } from "@/components/conferencia-registro";
import { TelaExclusao } from "@/app/(app)/cadastros/governanca/exclusao";
import { TabelaOperacaoUnificada, type LinhaTabelaOperacao } from "@/components/tabela-operacao-unificada";
import { acessoAtual } from "@/lib/acesso/servidor";
import { carteiraIrrestrita, pode } from "@/lib/acesso/politica";
import { alvoExclusaoUnificado } from "@/lib/governanca/alvos-ui";

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

export async function OperacaoUnificada({ dominio: dominioFixo, titulo, base, parametros = {}, nativo, central = false }: {
  dominio?: DominioUnificacao; titulo: string; base: string; parametros?: ParametrosUnificacao;
  nativo?: { href: string; rotulo: string }; central?: boolean;
}) {
  await exigirPerfilUnificacao();
  const dominio = dominioFixo ?? primeiroParametro(parametros.dominio);
  const estado = primeiroParametro(parametros.estado) ?? "";
  const origem = primeiroParametro(parametros.origem) ?? "";
  const q = (primeiroParametro(parametros.q) ?? "").slice(0, 120);
  const mes = primeiroParametro(parametros.mes) ?? "";
  const de = primeiroParametro(parametros.de) ?? "";
  const ate = primeiroParametro(parametros.ate) ?? "";
  const papel = primeiroParametro(parametros.papel) ?? "";
  const vencidos = primeiroParametro(parametros.vencidos) === "1";
  const pagina = Number(primeiroParametro(parametros.pagina)) || 1;
  const dados = await listarUnificados({ dominio, estado: estado || undefined, origem: origem || undefined, q, mes, de, ate, papel: papel || undefined, vencidos, pagina });
  const financeiro = ["RECEBER", "PAGAR"].includes(dominio ?? "");
  const contexto = financeiro ? contextoFinanceiro(base, parametros) : null;
  const chaveSelecionada = primeiroParametro(parametros.registro);
  const painel = primeiroParametro(parametros.painel);
  // URLs servem apenas para navegação. O componente de detalhe/exclusão autoriza novamente no servidor.
  const selecaoValida = contexto && chaveSelecionada && chaveSelecionada.split(":")[1] === dominio
    && (painel === "detalhe" || painel === "excluir")
    && validarRetornoFinanceiro(`${contexto.retorno}${contexto.retorno.includes("?") ? "&" : "?"}${new URLSearchParams({ registro: chaveSelecionada, painel })}`);
  const conteudoJanela = selecaoValida ? painel === "excluir"
    ? await TelaExclusao({ tipo: "TITULO", origemId: chaveSelecionada!, contexto: { retorno: contexto!.retorno } })
    : await ConferenciaRegistro({ chave: chaveSelecionada!, parametros, contexto: { retorno: contexto!.retorno, hrefDetalhe: contexto!.hrefDetalhe(chaveSelecionada!), hrefExcluir: contexto!.hrefExcluir(chaveSelecionada!) } })
    : null;
  const hrefDetalhe = (chave: string) => contexto?.hrefDetalhe(chave) ?? hrefUnificacao(chave);
  const baixa = ["BAIXA_RECEBER", "BAIXA_PAGAR"].includes(dominio ?? "");
  const movimento = dominio === "MOVIMENTO";
  const acesso = await acessoAtual();
  const permiteExcluir = acesso.perfil === "ADMINISTRADOR" && pode(acesso, "governanca.editar") && carteiraIrrestrita(acesso);
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
      contabiliza: item.contabiliza,
      correspondencias: item.candidatos.length,
      aviso: item.avisos.length ? motivoUnificacao(item.avisos[0]) : null,
      impacto: explicarConsolidacao(item),
      data: dataUnificada(item.vencimento ?? item.data),
      competencia: item.competencia ?? null,
      valor: financeiro || movimento || baixa ? item.valor ?? null : null,
      pago: financeiro ? item.pago ?? null : null,
      aberto: financeiro ? item.aberto ?? null : null,
      natureza: movimento || baixa ? item.natureza ?? null : null,
      hrefDetalhe: hrefDetalhe(item.chave),
      hrefCadastro: contexto ? null : item.href,
      exclusao: alvo ? {
        href: contexto?.hrefExcluir(item.chave) ?? `/cadastros/governanca?${new URLSearchParams({ tipo: alvo.tipo, origemId: alvo.origemId, modo: "excluir" })}`,
        rotulo: alvo.rotulo ?? "Excluir da plataforma",
      } : null,
    };
  });
  const hrefLista = (opcoes: { pagina?: number; estado?: string }) => {
    const p = new URLSearchParams();
    for (const [nome, valor] of Object.entries({ dominio: dominioFixo ? "" : dominio, estado: opcoes.estado ?? estado, origem, q, mes, de, ate, papel, vencidos: vencidos ? "1" : "" })) if (valor) p.set(nome, valor);
    if (opcoes.pagina) p.set("pagina", String(opcoes.pagina));
    return `${base}?${p}`;
  };
  const hrefPagina = (pagina: number) => hrefLista({ pagina });
  return <div>
    <PageHeader titulo={titulo} descricao={central ? "Confira o que entra nos totais e resolva possíveis duplicatas, uma de cada vez. Estar incluído não significa ter sido conferido manualmente; a origem e o histórico permanecem preservados." : "Consulte registros e pendências em um só lugar. A origem mostra de onde o dado veio; a situação indica seu efeito nos totais, não uma auditoria concluída."} acoes={<>
      {nativo ? <Link prefetch={false} href={nativo.href} className={btnSecundario}>{nativo.rotulo}</Link> : null}
      <AcaoAutorizada permissao={["unificacao.editar", "pagamentos.conciliar"]} perfis={["ADMINISTRADOR", "FINANCEIRO"]}>{contexto ? <FormularioNaTela action={sincronizarUnificacaoNaTela}><button className={btnSecundario}>Reanalisar correspondências</button></FormularioNaTela> : <form action={sincronizarUnificacao}><BotaoUnificacao className={btnSecundario}>Reanalisar correspondências</BotaoUnificacao></form>}</AcaoAutorizada>
    </>} />
    <nav aria-label="Operação unificada" className="mb-5 flex flex-wrap gap-1.5 rounded-xl border border-contorno bg-carta p-2">{ABAS.map((aba) => <Link prefetch={false} key={aba.dominio} href={aba.href} aria-current={(central ? aba.dominio === "CENTRAL" : aba.dominio === dominio) ? "page" : undefined} className={`rounded-lg px-3 py-2 text-xs font-semibold ${(central ? aba.dominio === "CENTRAL" : aba.dominio === dominio) ? "bg-oliva/10 text-oliva-escura" : "text-tinta-suave hover:bg-slate-50"}`}>{aba.titulo}</Link>)}</nav>
    {primeiroParametro(parametros.erro) ? <Card nivel="critico" className="mb-4 p-4 text-sm">{primeiroParametro(parametros.erro)}</Card> : null}
    {primeiroParametro(parametros.ok) ? <Card nivel="otimo" className="mb-4 p-4 text-sm">{mensagemUnificacao(primeiroParametro(parametros.ok)!)}</Card> : null}
    {!dados.sincronizado ? <Card nivel="atencao" className="mb-4 p-4 text-sm">A análise das correspondências ainda não está registrada. Use “Reanalisar correspondências” para conferir os dados já disponíveis no Brisa. Essa ação não importa novas capturas do Widesys nem novas planilhas.</Card> : null}
    {central ? <Card className="mb-5 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-2xl"><h2 className="text-sm font-bold">Uma operação, com a história de cada dado</h2><p className="mt-2 text-xs leading-relaxed text-tinta-suave">Widesys e Planilha Excel identificam fontes comprovadas. “Brisa · origem a confirmar” não significa lançamento manual: pode haver carga antiga ainda sem vínculo comprovado com a planilha.</p></div><Link prefetch={false} href="/financeiro/dados" className={btnSecundario}>Ver panorama dos dados</Link></div><ol className="mt-4 grid gap-3 text-xs leading-relaxed sm:grid-cols-3"><li className="rounded-lg border border-contorno p-3"><strong className="block text-tinta">1. Encontre a pendência</strong><span className="text-tinta-suave">Filtre pela origem e pela situação. Origem não é situação de pagamento.</span></li><li className="rounded-lg border border-contorno p-3"><strong className="block text-tinta">2. Compare as evidências</strong><span className="text-tinta-suave">Confira pessoa, imóvel, contrato e competência. Nome e valor iguais não bastam.</span></li><li className="rounded-lg border border-contorno p-3"><strong className="block text-tinta">3. Registre a decisão</strong><span className="text-tinta-suave">Mesma ocorrência: vincule ao principal. Ocorrências diferentes: mantenha ambas.</span></li></ol></Card> : null}
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi rotulo={financeiro ? "Devido incluído" : movimento ? "Entradas incluídas" : "Registros disponíveis"} valor={financeiro || movimento ? <Dinheiro centavos={financeiro ? dados.resumo.devido : dados.resumo.entradas} /> : dados.resumo.ativos} ajuda="Conta os registros atualmente disponíveis, inclusive decisões automáticas. Pendências, quarentena e cópias vinculadas não aumentam o total; inclusão não equivale a auditoria manual." />
      <Kpi rotulo={financeiro ? "Pago / recebido" : movimento ? "Saídas incluídas" : "Fontes vinculadas"} valor={financeiro || movimento ? <Dinheiro centavos={financeiro ? dados.resumo.pago : dados.resumo.saidas} /> : dados.resumo.vinculados} ajuda="Uma fonte vinculada acrescenta contexto ao registro principal; seus valores não são somados novamente." />
      <Kpi rotulo={financeiro ? "Saldo em aberto" : movimento ? "Saldo consolidado" : "Possíveis duplicidades"} valor={financeiro || movimento ? <Dinheiro centavos={financeiro ? dados.resumo.aberto : dados.resumo.entradas - dados.resumo.saidas} /> : dados.resumo.pendentes} nivel={dados.resumo.pendentes ? "atencao" : "neutro"} ajuda="Os totais consideram período, busca e registros aceitos, independentemente do filtro de situação da lista." />
      <Kpi rotulo="Ainda precisam de conferência" valor={dados.resumo.pendentes + dados.resumo.quarentena} detalhe={`${dados.resumo.pendentes} correspondências · ${dados.resumo.quarentena} inconsistências`} nivel={dados.resumo.pendentes + dados.resumo.quarentena ? "atencao" : "otimo"} ajuda="Inclui possíveis duplicatas, decisões a revisar e inconsistências. Nenhum item pendente é incluído automaticamente nos totais." />
    </div>
    {financeiro && dados.resumo.abertoPendente > 0 ? <Card nivel="atencao" className="mb-5 flex flex-wrap items-center justify-between gap-2 px-4 py-3"><span className="text-xs text-tinta-suave">Saldo a conferir · possíveis correspondências, fora dos totais consolidados</span><span className="text-sm font-semibold"><Sigilo><Dinheiro centavos={dados.resumo.abertoPendente} /></Sigilo></span></Card> : null}
    <Card className="overflow-hidden">
      <nav aria-label="Atalhos de situação da consolidação" className="flex flex-wrap gap-2 border-b border-contorno p-4">{[["", "Todos visíveis"], ["ATIVO", "Disponíveis"], ["PENDENTE", "Possíveis duplicatas"], ["REVISAR", "Decisões a revisar"], ["QUARENTENA", "Inconsistências"]].map(([valor, rotulo]) => <Link prefetch={false} key={valor} href={hrefLista({ estado: valor })} aria-current={estado === valor ? "page" : undefined} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${estado === valor ? "border-oliva bg-oliva/10 text-oliva-escura" : "border-contorno text-tinta-suave hover:bg-slate-50"}`}>{rotulo}</Link>)}</nav>
      <form action={base} method="get" className="grid gap-3 border-b border-contorno p-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-[11px] font-semibold text-tinta-suave">Buscar<input className={`${inputBase} mt-1 w-full`} name="q" defaultValue={q} placeholder="Nome, referência ou descrição" /></label>
        {!dominioFixo ? <label className="text-[11px] font-semibold text-tinta-suave">Tipo de registro<select name="dominio" defaultValue={dominio ?? ""} className={`${inputBase} mt-1 w-full`}><option value="">Todos os tipos</option>{Object.entries(ROTULOS_DOMINIO).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}</select></label> : null}
        <label className="text-[11px] font-semibold text-tinta-suave">De onde veio<select name="origem" defaultValue={origem} className={`${inputBase} mt-1 w-full`}><option value="">Todas as origens</option>{Object.entries(ROTULOS_ORIGEM_DADOS).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}</select></label>
        <label className="text-[11px] font-semibold text-tinta-suave">Situação na consolidação<select name="estado" defaultValue={estado} className={`${inputBase} mt-1 w-full`}><option value="">Disponíveis e pendências</option>{Object.entries(ESTADOS_UNIFICACAO).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}</select></label>
        {financeiro || movimento || baixa ? <label className="text-[11px] font-semibold text-tinta-suave">Competência<input type="month" name="mes" defaultValue={mes} className={`${inputBase} mt-1 w-full`} /></label> : null}
        {financeiro || movimento || baixa ? <><label className="text-[11px] font-semibold text-tinta-suave">Data inicial<input type="date" name="de" defaultValue={de} className={`${inputBase} mt-1 w-full`} /></label><label className="text-[11px] font-semibold text-tinta-suave">Data final<input type="date" name="ate" defaultValue={ate} className={`${inputBase} mt-1 w-full`} /></label></> : null}
        {dominio === "PESSOA" ? <label className="text-[11px] font-semibold text-tinta-suave">Papel<select name="papel" defaultValue={papel} className={`${inputBase} mt-1 w-full`}><option value="">Todos os papéis</option>{["INQUILINO", "PROPRIETARIO", "BENEFICIARIO", "FORNECEDOR", "FIADOR", "AVALISTA", "CORRETOR", "FUNCIONARIO", "COMPRADOR", "INTERESSADO"].map((p) => <option key={p} value={p}>{p.toLocaleLowerCase("pt-BR")}</option>)}</select></label> : null}
        <div className="flex flex-wrap items-end gap-2">{financeiro ? <label className="mr-2 flex items-center gap-2 py-2 text-xs"><input type="checkbox" name="vencidos" value="1" defaultChecked={vencidos} />Somente vencidos</label> : null}<button className={btnPrimario}>Aplicar filtros</button><Link prefetch={false} href={base} className={btnSecundario}>Limpar</Link></div>
      </form>
      {financeiro || movimento || baixa ? <p className="border-b border-contorno px-4 py-2 text-[10px] leading-relaxed text-tinta-suave">{financeiro ? "Mês e intervalo usam a competência do título; no intervalo, ela corresponde ao primeiro dia do mês. Sem competência, usam o vencimento e, na falta dele, a data do registro." : "Mês e intervalo usam a data do movimento ou da baixa. Quando ausente, usam o vencimento e depois a competência, considerada no primeiro dia do mês."}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-contorno bg-slate-50/60 px-4 py-3 text-xs text-tinta-suave"><span>{dados.total} registro(s) · página {dados.pagina} de {dados.paginas || 1}</span><span>Possíveis duplicidades e inconsistências ficam fora dos totais.</span></div>
      <TabelaOperacaoUnificada itens={itensTabela} financeiro={financeiro} exibirDominio={!dominioFixo} exibirValor={movimento || baixa} contextual={Boolean(contexto)} />
      <div className="flex items-center justify-between gap-3 border-t border-contorno p-4"><span className="text-xs text-tinta-suave">A origem e as decisões ficam registradas no histórico.</span><div className="flex gap-2">{dados.pagina > 1 ? <Link prefetch={false} className={btnSecundario} href={hrefPagina(dados.pagina - 1)}>Anterior</Link> : null}{dados.pagina < dados.paginas ? <Link prefetch={false} className={btnSecundario} href={hrefPagina(dados.pagina + 1)}>Próxima</Link> : null}</div></div>
    </Card>
    {conteudoJanela && contexto ? <JanelaContextual titulo={painel === "excluir" ? "Excluir ou restaurar registro" : "Conferir e resolver registro"} retorno={contexto.retorno} selecao={`${chaveSelecionada}:${painel}`} comparacao={primeiroParametro(parametros.destino)}>{conteudoJanela}</JanelaContextual> : null}
  </div>;
}
