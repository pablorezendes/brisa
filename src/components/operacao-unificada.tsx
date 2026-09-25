import Link from "next/link";
import { BotaoUnificacao } from "@/components/botao-unificacao";
import { notFound } from "next/navigation";
import { perfilAtual } from "@/lib/autorizacao";
import { listarUnificados } from "@/lib/consultas/unificacao";
import { ROTULOS_DOMINIO, type DominioUnificacao, type EstadoUnificacao, type LinhaUnificada } from "@/lib/unificacao/tipos";
import { MOTIVOS_UNIFICACAO } from "@/lib/unificacao/reconciliacao";
import { sincronizarUnificacao } from "@/app/(app)/unificacao/actions";
import { Badge, Card, Dinheiro, Kpi, PageHeader, Sigilo, btnPrimario, btnSecundario, inputBase } from "@/components/ui";

export type ParametrosUnificacao = Record<string, string | string[] | undefined>;
export const ESTADOS_UNIFICACAO: Record<EstadoUnificacao, string> = {
  ATIVO: "Consolidado", PENDENTE: "Possível duplicidade", VINCULADO: "Vinculado", QUARENTENA: "Dado inconsistente", REVISAR: "Revisar decisão", AUSENTE: "Ausente na origem",
};
export function primeiroParametro(valor: string | string[] | undefined) { return Array.isArray(valor) ? valor[0] : valor; }
export function mensagemUnificacao(valor: string) { return ({ "analise-atualizada": "Conciliação atualizada. Confira as correspondências e os totais abaixo.", resolvido: "Decisão registrada. A consulta unificada já reflete o resultado." } as Record<string, string>)[valor] ?? valor; }
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
  return perfil === "ADMINISTRADOR" || perfil === "FINANCEIRO";
}
export function EstadoUnificado({ item }: { item: Pick<LinhaUnificada, "estado"> }) {
  return <Badge nivel={item.estado === "ATIVO" ? "otimo" : item.estado === "VINCULADO" ? "info" : item.estado === "QUARENTENA" ? "critico" : "atencao"}>{ESTADOS_UNIFICACAO[item.estado]}</Badge>;
}
export function OrigensUnificadas({ origens }: { origens: string[] }) {
  return <span className="flex flex-wrap gap-1">{origens.map((origem) => <Badge key={origem} nivel={origem === "WIDESYS" ? "info" : "neutro"}>{origem === "BRISA" ? "Brisa" : origem === "PLANILHA" ? "Planilha" : origem}</Badge>)}</span>;
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
  const q = (primeiroParametro(parametros.q) ?? "").slice(0, 120);
  const mes = primeiroParametro(parametros.mes) ?? "";
  const de = primeiroParametro(parametros.de) ?? "";
  const ate = primeiroParametro(parametros.ate) ?? "";
  const papel = primeiroParametro(parametros.papel) ?? "";
  const vencidos = primeiroParametro(parametros.vencidos) === "1";
  const pagina = Number(primeiroParametro(parametros.pagina)) || 1;
  const dados = await listarUnificados({ dominio, estado: estado || undefined, q, mes, de, ate, papel: papel || undefined, vencidos, pagina });
  const financeiro = ["RECEBER", "PAGAR"].includes(dominio ?? "");
  const baixa = ["BAIXA_RECEBER", "BAIXA_PAGAR"].includes(dominio ?? "");
  const movimento = dominio === "MOVIMENTO";
  const hrefPagina = (numero: number) => {
    const p = new URLSearchParams();
    for (const [nome, valor] of Object.entries({ dominio: dominioFixo ? "" : dominio, estado, q, mes, de, ate, papel, vencidos: vencidos ? "1" : "" })) if (valor) p.set(nome, valor);
    p.set("pagina", String(numero));
    return `${base}?${p}`;
  };
  return <div>
    <PageHeader titulo={titulo} descricao={central ? "Revise coincidências entre Widesys, planilhas e operação atual. Cada decisão preserva a origem e define o que entra uma única vez no consolidado." : "Widesys, planilhas e operação atual reunidos em uma consulta. A origem acompanha cada registro e as possíveis duplicidades ficam sinalizadas para revisão."} acoes={<>
      {nativo ? <Link href={nativo.href} className={btnSecundario}>{nativo.rotulo}</Link> : null}
      <form action={sincronizarUnificacao}><BotaoUnificacao className={btnPrimario}>Atualizar conciliação</BotaoUnificacao></form>
    </>} />
    <nav aria-label="Operação unificada" className="mb-5 flex flex-wrap gap-1.5 rounded-xl border border-contorno bg-carta p-2">{ABAS.map((aba) => <Link key={aba.dominio} href={aba.href} aria-current={(central ? aba.dominio === "CENTRAL" : aba.dominio === dominio) ? "page" : undefined} className={`rounded-lg px-3 py-2 text-xs font-semibold ${(central ? aba.dominio === "CENTRAL" : aba.dominio === dominio) ? "bg-oliva/10 text-oliva-escura" : "text-tinta-suave hover:bg-slate-50"}`}>{aba.titulo}</Link>)}</nav>
    {primeiroParametro(parametros.erro) ? <Card nivel="critico" className="mb-4 p-4 text-sm">{primeiroParametro(parametros.erro)}</Card> : null}
    {primeiroParametro(parametros.ok) ? <Card nivel="otimo" className="mb-4 p-4 text-sm">{mensagemUnificacao(primeiroParametro(parametros.ok)!)}</Card> : null}
    {!dados.sincronizado ? <Card nivel="atencao" className="mb-4 p-4 text-sm">Há dados novos para conciliar. Use “Atualizar conciliação” para revisar as correspondências com a base atual.</Card> : null}
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi rotulo={financeiro ? "Devido consolidado" : movimento ? "Entradas consolidadas" : "Registros consolidados"} valor={financeiro || movimento ? <Dinheiro centavos={financeiro ? dados.resumo.devido : dados.resumo.entradas} /> : dados.resumo.ativos} ajuda="Conta cada registro aceito uma vez. Pendências, quarentena e cópias vinculadas não aumentam o total." />
      <Kpi rotulo={financeiro ? "Pago / recebido" : movimento ? "Saídas consolidadas" : "Fontes vinculadas"} valor={financeiro || movimento ? <Dinheiro centavos={financeiro ? dados.resumo.pago : dados.resumo.saidas} /> : dados.resumo.vinculados} ajuda="Uma fonte vinculada acrescenta contexto ao registro principal; seus valores não são somados novamente." />
      <Kpi rotulo={financeiro ? "Saldo em aberto" : movimento ? "Saldo consolidado" : "Possíveis duplicidades"} valor={financeiro || movimento ? <Dinheiro centavos={financeiro ? dados.resumo.aberto : dados.resumo.entradas - dados.resumo.saidas} /> : dados.resumo.pendentes} nivel={dados.resumo.pendentes ? "atencao" : "neutro"} ajuda="Os totais consideram período, busca e registros aceitos, independentemente do filtro de situação da lista." />
      <Kpi rotulo="A resolver" valor={dados.resumo.pendentes + dados.resumo.quarentena} detalhe={`${dados.resumo.pendentes} correspondências · ${dados.resumo.quarentena} inconsistências`} nivel={dados.resumo.pendentes + dados.resumo.quarentena ? "atencao" : "otimo"} ajuda="Abra o registro para comparar campos. Vincule a uma ocorrência existente ou confirme que são registros diferentes." />
    </div>
    {financeiro && dados.resumo.abertoPendente > 0 ? <Card nivel="atencao" className="mb-5 flex flex-wrap items-center justify-between gap-2 px-4 py-3"><span className="text-xs text-tinta-suave">Saldo a conferir · possíveis correspondências, fora dos totais consolidados</span><span className="text-sm font-semibold"><Sigilo><Dinheiro centavos={dados.resumo.abertoPendente} /></Sigilo></span></Card> : null}
    <Card className="overflow-hidden">
      <form action={base} method="get" className="grid gap-3 border-b border-contorno p-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-[11px] font-semibold text-tinta-suave">Buscar<input className={`${inputBase} mt-1 w-full`} name="q" defaultValue={q} placeholder="Nome, referência ou descrição" /></label>
        {!dominioFixo ? <label className="text-[11px] font-semibold text-tinta-suave">Tipo de registro<select name="dominio" defaultValue={dominio ?? ""} className={`${inputBase} mt-1 w-full`}><option value="">Todos os tipos</option>{Object.entries(ROTULOS_DOMINIO).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}</select></label> : null}
        <label className="text-[11px] font-semibold text-tinta-suave">Situação<select name="estado" defaultValue={estado} className={`${inputBase} mt-1 w-full`}><option value="">Consolidados e pendências</option>{Object.entries(ESTADOS_UNIFICACAO).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}</select></label>
        {financeiro || movimento || baixa ? <label className="text-[11px] font-semibold text-tinta-suave">Competência<input type="month" name="mes" defaultValue={mes} className={`${inputBase} mt-1 w-full`} /></label> : null}
        {financeiro || movimento || baixa ? <><label className="text-[11px] font-semibold text-tinta-suave">Data inicial<input type="date" name="de" defaultValue={de} className={`${inputBase} mt-1 w-full`} /></label><label className="text-[11px] font-semibold text-tinta-suave">Data final<input type="date" name="ate" defaultValue={ate} className={`${inputBase} mt-1 w-full`} /></label></> : null}
        {dominio === "PESSOA" ? <label className="text-[11px] font-semibold text-tinta-suave">Papel<select name="papel" defaultValue={papel} className={`${inputBase} mt-1 w-full`}><option value="">Todos os papéis</option>{["INQUILINO", "PROPRIETARIO", "BENEFICIARIO", "FORNECEDOR", "FIADOR", "AVALISTA", "CORRETOR", "FUNCIONARIO", "COMPRADOR", "INTERESSADO"].map((p) => <option key={p} value={p}>{p.toLocaleLowerCase("pt-BR")}</option>)}</select></label> : null}
        <div className="flex flex-wrap items-end gap-2">{financeiro ? <label className="mr-2 flex items-center gap-2 py-2 text-xs"><input type="checkbox" name="vencidos" value="1" defaultChecked={vencidos} />Somente vencidos</label> : null}<button className={btnPrimario}>Aplicar filtros</button><Link href={base} className={btnSecundario}>Limpar</Link></div>
      </form>
      {financeiro || movimento || baixa ? <p className="border-b border-contorno px-4 py-2 text-[10px] leading-relaxed text-tinta-suave">{financeiro ? "Mês e intervalo usam a competência do título; no intervalo, ela corresponde ao primeiro dia do mês. Sem competência, usam o vencimento e, na falta dele, a data do registro." : "Mês e intervalo usam a data do movimento ou da baixa. Quando ausente, usam o vencimento e depois a competência, considerada no primeiro dia do mês."}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-contorno bg-slate-50/60 px-4 py-3 text-xs text-tinta-suave"><span>{dados.total} registro(s) · página {dados.pagina} de {dados.paginas || 1}</span><span>Possíveis duplicidades e inconsistências ficam fora dos totais.</span></div>
      <div className="overflow-x-auto"><table className="tabela"><thead><tr><th>Registro e origem</th>{!dominioFixo ? <th>Tipo</th> : null}<th>Situação</th><th>Data / competência</th>{financeiro ? <><th className="text-right!">Devido</th><th className="text-right!">Pago</th><th className="text-right!">Aberto</th></> : movimento || baixa ? <th className="text-right!">Valor</th> : null}<th className="text-right!">Ações</th></tr></thead><tbody>
        {dados.itens.map((item) => <tr key={item.chave}><td className="max-w-[360px] whitespace-normal!"><Link href={hrefUnificacao(item.chave)} className="font-semibold text-oliva-escura hover:underline">{item.titulo}</Link><p className="my-1 text-[11px] text-tinta-suave">{item.descricao}</p><OrigensUnificadas origens={item.origens} />{item.papeis?.length ? <p className="mt-1 text-[10px] text-tinta-suave">{item.papeis.join(" · ")}</p> : null}</td>{!dominioFixo ? <td>{ROTULOS_DOMINIO[item.dominio]}</td> : null}<td className="max-w-[250px] whitespace-normal!"><EstadoUnificado item={item} />{item.candidatos.length ? <p className="mt-1 text-[11px] text-amber-800">{item.candidatos.length} correspondência(s) para comparar</p> : null}{item.avisos.length ? <p className="mt-1 text-[11px] text-tinta-suave">{motivoUnificacao(item.avisos[0])}</p> : null}{!item.contabiliza ? <p className="mt-1 text-[10px] text-tinta-suave">Fora dos totais</p> : null}</td><td className="text-xs text-tinta-suave">{dataUnificada(item.vencimento ?? item.data)}{item.competencia ? <p className="mt-1 font-mono text-[10px]">{item.competencia}</p> : null}</td>{financeiro ? [item.valor, item.pago, item.aberto].map((valor, indice) => <td key={indice} className="text-right!"><Sigilo><Dinheiro centavos={valor} /></Sigilo></td>) : movimento || baixa ? <td className="text-right!"><span className="block text-[10px] text-tinta-suave">{item.natureza}</span><Sigilo><Dinheiro centavos={item.valor} /></Sigilo></td> : null}<td className="text-right!"><div className="flex flex-col items-end gap-2"><Link href={hrefUnificacao(item.chave)} className="text-xs font-semibold text-oliva-escura hover:underline">{["PENDENTE", "REVISAR", "QUARENTENA"].includes(item.estado) ? "Revisar e resolver" : "Ver detalhes"}</Link>{item.href ? <Link href={item.href} className="text-[11px] text-tinta-suave hover:underline">Abrir cadastro / lançamento</Link> : null}</div></td></tr>)}
        {!dados.itens.length ? <tr><td colSpan={financeiro ? 8 : 6} className="py-12! text-center! text-tinta-suave">Nenhum registro encontrado para estes filtros.</td></tr> : null}
      </tbody></table></div>
      <div className="flex items-center justify-between gap-3 border-t border-contorno p-4"><span className="text-xs text-tinta-suave">A origem e as decisões ficam registradas no histórico.</span><div className="flex gap-2">{dados.pagina > 1 ? <Link className={btnSecundario} href={hrefPagina(dados.pagina - 1)}>Anterior</Link> : null}{dados.pagina < dados.paginas ? <Link className={btnSecundario} href={hrefPagina(dados.pagina + 1)}>Próxima</Link> : null}</div></div>
    </Card>
  </div>;
}
