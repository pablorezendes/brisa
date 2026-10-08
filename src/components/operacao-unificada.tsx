import Link from "next/link";
import { AcaoAutorizada } from "@/components/acao-autorizada";
import { BotaoUnificacao } from "@/components/botao-unificacao";
import { notFound } from "next/navigation";
import { perfilAtual } from "@/lib/autorizacao";
import { acessoAtual } from "@/lib/acesso/servidor";
import { carteiraIrrestrita, pode } from "@/lib/acesso/politica";
import { listarUnificados } from "@/lib/consultas/unificacao";
import { ROTULOS_DOMINIO, type DominioUnificacao, type EstadoUnificacao, type LinhaUnificada } from "@/lib/unificacao/tipos";
import { MOTIVOS_UNIFICACAO } from "@/lib/unificacao/reconciliacao";
import { ROTULOS_ORIGEM_DADOS, origensDoRegistro, type OrigemDados } from "@/lib/unificacao/origens";
import { ImpactoConsolidacao } from "@/components/situacao-consolidacao";
import { sincronizarUnificacao } from "@/app/(app)/unificacao/actions";
import { Badge, Card, Dinheiro, Kpi, PageHeader, Sigilo, btnPrimario, btnSecundario, inputBase } from "@/components/ui";

export type ParametrosUnificacao = Record<string, string | string[] | undefined>;
export const ESTADOS_UNIFICACAO: Record<EstadoUnificacao, string> = {
  ATIVO: "Disponível / incluído", PENDENTE: "Aguardando conferência", VINCULADO: "Vinculado ao principal", QUARENTENA: "Dado inconsistente", REVISAR: "Revisar decisão", AUSENTE: "Ausente na origem",
};
export function primeiroParametro(valor: string | string[] | undefined) { return Array.isArray(valor) ? valor[0] : valor; }
export function mensagemUnificacao(valor: string) { return ({ "analise-atualizada": "Análise local atualizada. Nenhum dado novo foi buscado no Widesys. Confira as correspondências abaixo.", resolvido: "Decisão registrada. A consulta unificada já reflete o resultado." } as Record<string, string>)[valor] ?? valor; }
export function hrefUnificacao(chave: string) { return `/unificacao/${encodeURIComponent(chave)}`; }
export function motivoUnificacao(motivo: string) {
  const correspondencias: Record<string, string> = {
    DOCUMENTO_IGUAL: "Mesmo CPF/CNPJ", NOME_IGUAL: "Mesmo nome", IDENTIFICACAO_IGUAL: "Mesma identificação", ENDERECO_IGUAL: "Mesmo endereço",
    PESSOA_E_IMOVEL: "Mesma pessoa e imóvel", MESMA_PESSOA: "Mesma pessoa", MESMO_IMOVEL: "Mesmo imóvel", ALUGUEL_IGUAL_CONFERIR_IMOVEL: "Mesmo aluguel; conferir imóvel",
    MES_E_VINCULO: "Mesma competência e vínculo cadastral", MES_E_VALOR: "Mesma competência e valor", CONTEUDO_REPETIDO: "Conteúdo repetido", DATA_VALOR_NATUREZA: "Mesma data, valor e natureza", TITULO_DATA_VALOR: "Mesmo título, data e valor", PARAMETRO_IGUAL: "Mesmo parâmetro",
    UNIAO_CONFIRMADA: "Vínculo confirmado na revisão", REGISTRO_DISTINTO_CONFIRMADO: "Registro confirmado como distinto", REVISAO_REABERTA: "Decisão reaberta para revisão",
  };
  return MOTIVOS_UNIFICACAO[motivo] ?? correspondencias[motivo] ?? motivo.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
}
export function dataUnificada(data: string | null | undefined) {
  return data && /^\d{4}-\d{2}-\d{2}/.test(data) ? `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(0, 4)}` : data || "—";
}
export async function exigirPerfilUnificacao() {
  if (!await podeAcessarUnificacao()) notFound();
}
export async function podeAcessarUnificacao() {
  const perfil = await perfilAtual();
  const acesso = await acessoAtual();
  return (perfil === "ADMINISTRADOR" || perfil === "FINANCEIRO")
    && carteiraIrrestrita(acesso) && pode(acesso, "cadastros.sensiveis");
}
export function EstadoUnificado({ item }: { item: Pick<LinhaUnificada, "estado"> & Partial<Pick<LinhaUnificada, "contabiliza" | "dominio">> }) {
  const rotulo = item.estado === "ATIVO" ? item.contabiliza && ["RECEBER", "PAGAR", "MOVIMENTO"].includes(item.dominio ?? "") ? "Incluído nos totais" : "Disponível" : ESTADOS_UNIFICACAO[item.estado];
  return <Badge nivel={item.estado === "ATIVO" ? "neutro" : item.estado === "VINCULADO" ? "info" : item.estado === "QUARENTENA" ? "critico" : "atencao"}>{rotulo}</Badge>;
}
export function OrigensUnificadas({ origens }: { origens: string[] }) {
  return <span className="flex flex-wrap gap-1" aria-label="Origem dos dados">{origensDoRegistro({ origem: "BRISA", origens }).map((origem: OrigemDados) => <Badge key={origem} nivel={origem === "WIDESYS" ? "info" : "neutro"}>{ROTULOS_ORIGEM_DADOS[origem]}</Badge>)}</span>;
}

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
  const baixa = ["BAIXA_RECEBER", "BAIXA_PAGAR"].includes(dominio ?? "");
  const movimento = dominio === "MOVIMENTO";
  const hrefLista = (opcoes: { pagina?: number; estado?: string }) => {
    const p = new URLSearchParams();
    for (const [nome, valor] of Object.entries({ dominio: dominioFixo ? "" : dominio, estado: opcoes.estado ?? estado, origem, q, mes, de, ate, papel, vencidos: vencidos ? "1" : "" })) if (valor) p.set(nome, valor);
    if (opcoes.pagina) p.set("pagina", String(opcoes.pagina));
    return `${base}?${p}`;
  };
  const hrefPagina = (pagina: number) => hrefLista({ pagina });
  return <div>
    <PageHeader titulo={titulo} descricao={central ? "Confira o que entra nos totais e resolva possíveis duplicatas, uma de cada vez. Estar incluído não significa ter sido conferido manualmente; a origem e o histórico permanecem preservados." : "Consulte registros e pendências em um só lugar. A origem mostra de onde o dado veio; a situação indica seu efeito nos totais, não uma auditoria concluída."} acoes={<>
      {nativo ? <Link href={nativo.href} className={btnSecundario}>{nativo.rotulo}</Link> : null}
      <AcaoAutorizada permissao={["unificacao.editar", "pagamentos.conciliar"]} perfis={["ADMINISTRADOR", "FINANCEIRO"]}><form action={sincronizarUnificacao}><BotaoUnificacao className={btnSecundario}>Reanalisar correspondências</BotaoUnificacao></form></AcaoAutorizada>
    </>} />
    <nav aria-label="Operação unificada" className="mb-5 flex flex-wrap gap-1.5 rounded-xl border border-contorno bg-carta p-2">{ABAS.map((aba) => <Link key={aba.dominio} href={aba.href} aria-current={(central ? aba.dominio === "CENTRAL" : aba.dominio === dominio) ? "page" : undefined} className={`rounded-lg px-3 py-2 text-xs font-semibold ${(central ? aba.dominio === "CENTRAL" : aba.dominio === dominio) ? "bg-oliva/10 text-oliva-escura" : "text-tinta-suave hover:bg-slate-50"}`}>{aba.titulo}</Link>)}</nav>
    {primeiroParametro(parametros.erro) ? <Card nivel="critico" className="mb-4 p-4 text-sm">{primeiroParametro(parametros.erro)}</Card> : null}
    {primeiroParametro(parametros.ok) ? <Card nivel="otimo" className="mb-4 p-4 text-sm">{mensagemUnificacao(primeiroParametro(parametros.ok)!)}</Card> : null}
    {!dados.sincronizado ? <Card nivel="atencao" className="mb-4 p-4 text-sm">A análise das correspondências ainda não está registrada. Use “Reanalisar correspondências” para conferir os dados já disponíveis no Brisa. Essa ação não importa novas capturas do Widesys nem novas planilhas.</Card> : null}
    {central ? <Card className="mb-5 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-2xl"><h2 className="text-sm font-bold">Uma operação, com a história de cada dado</h2><p className="mt-2 text-xs leading-relaxed text-tinta-suave">Widesys e Planilha Excel identificam fontes comprovadas. “Brisa · origem a confirmar” não significa lançamento manual: pode haver carga antiga ainda sem vínculo comprovado com a planilha.</p></div><Link href="/financeiro/dados" className={btnSecundario}>Ver panorama dos dados</Link></div><ol className="mt-4 grid gap-3 text-xs leading-relaxed sm:grid-cols-3"><li className="rounded-lg border border-contorno p-3"><strong className="block text-tinta">1. Encontre a pendência</strong><span className="text-tinta-suave">Filtre pela origem e pela situação. Origem não é situação de pagamento.</span></li><li className="rounded-lg border border-contorno p-3"><strong className="block text-tinta">2. Compare as evidências</strong><span className="text-tinta-suave">Confira pessoa, imóvel, contrato e competência. Nome e valor iguais não bastam.</span></li><li className="rounded-lg border border-contorno p-3"><strong className="block text-tinta">3. Registre a decisão</strong><span className="text-tinta-suave">Mesma ocorrência: vincule ao principal. Ocorrências diferentes: mantenha ambas.</span></li></ol></Card> : null}
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi rotulo={financeiro ? "Devido incluído" : movimento ? "Entradas incluídas" : "Registros disponíveis"} valor={financeiro || movimento ? <Dinheiro centavos={financeiro ? dados.resumo.devido : dados.resumo.entradas} /> : dados.resumo.ativos} ajuda="Conta os registros atualmente disponíveis, inclusive decisões automáticas. Pendências, quarentena e cópias vinculadas não aumentam o total; inclusão não equivale a auditoria manual." />
      <Kpi rotulo={financeiro ? "Pago / recebido" : movimento ? "Saídas incluídas" : "Fontes vinculadas"} valor={financeiro || movimento ? <Dinheiro centavos={financeiro ? dados.resumo.pago : dados.resumo.saidas} /> : dados.resumo.vinculados} ajuda="Uma fonte vinculada acrescenta contexto ao registro principal; seus valores não são somados novamente." />
      <Kpi rotulo={financeiro ? "Saldo em aberto" : movimento ? "Saldo consolidado" : "Possíveis duplicidades"} valor={financeiro || movimento ? <Dinheiro centavos={financeiro ? dados.resumo.aberto : dados.resumo.entradas - dados.resumo.saidas} /> : dados.resumo.pendentes} nivel={dados.resumo.pendentes ? "atencao" : "neutro"} ajuda="Os totais consideram período, busca e registros aceitos, independentemente do filtro de situação da lista." />
      <Kpi rotulo="Ainda precisam de conferência" valor={dados.resumo.pendentes + dados.resumo.quarentena} detalhe={`${dados.resumo.pendentes} correspondências · ${dados.resumo.quarentena} inconsistências`} nivel={dados.resumo.pendentes + dados.resumo.quarentena ? "atencao" : "otimo"} ajuda="Inclui possíveis duplicatas, decisões a revisar e inconsistências. Nenhum item pendente é incluído automaticamente nos totais." />
    </div>
    {financeiro && dados.resumo.abertoPendente > 0 ? <Card nivel="atencao" className="mb-5 flex flex-wrap items-center justify-between gap-2 px-4 py-3"><span className="text-xs text-tinta-suave">Saldo a conferir · possíveis correspondências, fora dos totais consolidados</span><span className="text-sm font-semibold"><Sigilo><Dinheiro centavos={dados.resumo.abertoPendente} /></Sigilo></span></Card> : null}
    <Card className="overflow-hidden">
      <nav aria-label="Atalhos de situação da consolidação" className="flex flex-wrap gap-2 border-b border-contorno p-4">{[["", "Todos visíveis"], ["ATIVO", "Disponíveis"], ["PENDENTE", "Possíveis duplicatas"], ["REVISAR", "Decisões a revisar"], ["QUARENTENA", "Inconsistências"]].map(([valor, rotulo]) => <Link key={valor} href={hrefLista({ estado: valor })} aria-current={estado === valor ? "page" : undefined} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${estado === valor ? "border-oliva bg-oliva/10 text-oliva-escura" : "border-contorno text-tinta-suave hover:bg-slate-50"}`}>{rotulo}</Link>)}</nav>
      <form action={base} method="get" className="grid gap-3 border-b border-contorno p-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-[11px] font-semibold text-tinta-suave">Buscar<input className={`${inputBase} mt-1 w-full`} name="q" defaultValue={q} placeholder="Nome, referência ou descrição" /></label>
        {!dominioFixo ? <label className="text-[11px] font-semibold text-tinta-suave">Tipo de registro<select name="dominio" defaultValue={dominio ?? ""} className={`${inputBase} mt-1 w-full`}><option value="">Todos os tipos</option>{Object.entries(ROTULOS_DOMINIO).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}</select></label> : null}
        <label className="text-[11px] font-semibold text-tinta-suave">De onde veio<select name="origem" defaultValue={origem} className={`${inputBase} mt-1 w-full`}><option value="">Todas as origens</option>{Object.entries(ROTULOS_ORIGEM_DADOS).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}</select></label>
        <label className="text-[11px] font-semibold text-tinta-suave">Situação na consolidação<select name="estado" defaultValue={estado} className={`${inputBase} mt-1 w-full`}><option value="">Disponíveis e pendências</option>{Object.entries(ESTADOS_UNIFICACAO).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}</select></label>
        {financeiro || movimento || baixa ? <label className="text-[11px] font-semibold text-tinta-suave">Competência<input type="month" name="mes" defaultValue={mes} className={`${inputBase} mt-1 w-full`} /></label> : null}
        {financeiro || movimento || baixa ? <><label className="text-[11px] font-semibold text-tinta-suave">Data inicial<input type="date" name="de" defaultValue={de} className={`${inputBase} mt-1 w-full`} /></label><label className="text-[11px] font-semibold text-tinta-suave">Data final<input type="date" name="ate" defaultValue={ate} className={`${inputBase} mt-1 w-full`} /></label></> : null}
        {dominio === "PESSOA" ? <label className="text-[11px] font-semibold text-tinta-suave">Papel<select name="papel" defaultValue={papel} className={`${inputBase} mt-1 w-full`}><option value="">Todos os papéis</option>{["INQUILINO", "PROPRIETARIO", "BENEFICIARIO", "FORNECEDOR", "FIADOR", "AVALISTA", "CORRETOR", "FUNCIONARIO", "COMPRADOR", "INTERESSADO"].map((p) => <option key={p} value={p}>{p.toLocaleLowerCase("pt-BR")}</option>)}</select></label> : null}
        <div className="flex flex-wrap items-end gap-2">{financeiro ? <label className="mr-2 flex items-center gap-2 py-2 text-xs"><input type="checkbox" name="vencidos" value="1" defaultChecked={vencidos} />Somente vencidos</label> : null}<button className={btnPrimario}>Aplicar filtros</button><Link href={base} className={btnSecundario}>Limpar</Link></div>
      </form>
      {financeiro || movimento || baixa ? <p className="border-b border-contorno px-4 py-2 text-[10px] leading-relaxed text-tinta-suave">{financeiro ? "Mês e intervalo usam a competência do título; no intervalo, ela corresponde ao primeiro dia do mês. Sem competência, usam o vencimento e, na falta dele, a data do registro." : "Mês e intervalo usam a data do movimento ou da baixa. Quando ausente, usam o vencimento e depois a competência, considerada no primeiro dia do mês."}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-contorno bg-slate-50/60 px-4 py-3 text-xs text-tinta-suave"><span>{dados.total} registro(s) · página {dados.pagina} de {dados.paginas || 1}</span><span>Possíveis duplicidades e inconsistências ficam fora dos totais.</span></div>
      <div className="tabela-scroll overflow-x-auto" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}><table className="tabela tabela--acoes"><thead><tr><th>Registro · de onde veio</th>{!dominioFixo ? <th>Tipo</th> : null}<th>Situação · efeito nos totais</th><th>Data / competência</th>{financeiro ? <><th className="text-right!">Devido</th><th className="text-right!">Pago</th><th className="text-right!">Aberto</th></> : movimento || baixa ? <th className="text-right!">Valor</th> : null}<th className="text-right!">Ações</th></tr></thead><tbody>
        {dados.itens.map((item) => <tr key={item.chave}><td className="max-w-[360px] whitespace-normal!"><Link href={hrefUnificacao(item.chave)} className="font-semibold text-oliva-escura hover:underline">{item.titulo}</Link><p className="my-1 text-[11px] text-tinta-suave">{item.descricao}</p><OrigensUnificadas origens={origensDoRegistro(item)} />{item.papeis?.length ? <p className="mt-1 text-[10px] text-tinta-suave">{item.papeis.join(" · ")}</p> : null}</td>{!dominioFixo ? <td>{ROTULOS_DOMINIO[item.dominio]}</td> : null}<td className="max-w-[250px] whitespace-normal!"><EstadoUnificado item={item} />{item.candidatos.length ? <p className="mt-1 text-[11px] text-amber-800">{item.candidatos.length} correspondência(s) para comparar</p> : null}{item.avisos.length ? <p className="mt-1 text-[11px] text-tinta-suave">{motivoUnificacao(item.avisos[0])}</p> : null}<ImpactoConsolidacao item={item} className="mt-2" /></td><td className="text-xs text-tinta-suave">{dataUnificada(item.vencimento ?? item.data)}{item.competencia ? <p className="mt-1 font-mono text-[10px]">{item.competencia}</p> : null}</td>{financeiro ? [item.valor, item.pago, item.aberto].map((valor, indice) => <td key={indice} className="text-right!"><Sigilo><Dinheiro centavos={valor} /></Sigilo></td>) : movimento || baixa ? <td className="text-right!"><span className="block text-[10px] text-tinta-suave">{item.natureza}</span><Sigilo><Dinheiro centavos={item.valor} /></Sigilo></td> : null}<td className="text-right!"><div className="flex flex-col items-end gap-2"><Link href={hrefUnificacao(item.chave)} className="text-xs font-semibold text-oliva-escura hover:underline">{["PENDENTE", "REVISAR", "QUARENTENA"].includes(item.estado) ? "Revisar e resolver" : "Ver detalhes"}</Link>{item.href ? <Link href={item.href} className="text-[11px] text-tinta-suave hover:underline">Abrir cadastro / lançamento</Link> : null}</div></td></tr>)}
        {!dados.itens.length ? <tr><td colSpan={financeiro ? 8 : 6} className="py-12! text-center! text-tinta-suave">Nenhum registro nestes filtros. Isso não significa que toda a base já foi conferida.</td></tr> : null}
      </tbody></table></div>
      <div className="flex items-center justify-between gap-3 border-t border-contorno p-4"><span className="text-xs text-tinta-suave">A origem e as decisões ficam registradas no histórico.</span><div className="flex gap-2">{dados.pagina > 1 ? <Link className={btnSecundario} href={hrefPagina(dados.pagina - 1)}>Anterior</Link> : null}{dados.pagina < dados.paginas ? <Link className={btnSecundario} href={hrefPagina(dados.pagina + 1)}>Próxima</Link> : null}</div></div>
    </Card>
  </div>;
}
