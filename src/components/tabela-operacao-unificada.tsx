"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Dinheiro, Sigilo, btnSecundario } from "@/components/ui";
import { EstadoUnificado, OrigensUnificadas } from "@/components/unificacao-visual";
import { ROTULOS_DOMINIO, type DominioUnificacao, type EstadoUnificacao } from "@/lib/unificacao/tipos";
import type { OrigemDados } from "@/lib/unificacao/origens";
import type { DominioExclusaoTitulos } from "@/lib/governanca/exclusao-titulos-lote-tipos";
import { ExclusaoTitulosModal } from "@/components/exclusao-titulos-modal";
import { alternarSelecao, chavesExcluiveisNaPagina, selecaoVisivel } from "@/components/selecao-exclusao-lote";
import { RateioDespesaBotao } from "@/components/rateio-despesa-botao";

/** DTO exclusivo da tabela. Não aceitar LinhaUnificada nem espalhar registros do DAL. */
export type LinhaTabelaOperacao = {
  chave: string;
  dominio: DominioUnificacao;
  titulo: string;
  descricao: string;
  origens: OrigemDados[];
  papeis: string[];
  estado: EstadoUnificacao;
  contabiliza: boolean;
  correspondencias: number;
  aviso: string | null;
  impacto: string;
  data: string;
  competencia: string | null;
  valor: number | null;
  pago: number | null;
  aberto: number | null;
  natureza: string | null;
  hrefDetalhe: string;
  hrefCadastro: string | null;
  exclusao: { href: string; rotulo: string } | null;
  rateio?: { id?: string; origemChave?: string };
};

type PropriedadesTabela = {
  itens: LinhaTabelaOperacao[];
  financeiro: boolean;
  exibirDominio: boolean;
  exibirValor: boolean;
  contextual: boolean;
  exclusaoLote?: { dominio: DominioExclusaoTitulos; contexto: string };
};

/** A autorização e a projeção mínima acontecem antes, no Server Component. */
export function TabelaOperacaoUnificada(props: PropriedadesTabela) {
  if (props.exclusaoLote && props.financeiro && props.contextual && !props.exibirDominio) {
    return <TabelaComSelecao key={props.exclusaoLote.contexto} {...props} exclusaoLote={props.exclusaoLote} />;
  }
  return conteudoTabela(props);
}

function TabelaComSelecao(props: PropriedadesTabela & { exclusaoLote: NonNullable<PropriedadesTabela["exclusaoLote"]> }) {
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [solicitacao, setSolicitacao] = useState<string[] | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const avisoConclusao = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (mensagem) avisoConclusao.current?.focus({ preventScroll: true }); }, [mensagem]);
  const permitidas = chavesExcluiveisNaPagina(props.itens, props.exclusaoLote.dominio);
  const atuais = selecaoVisivel(selecionados, permitidas);
  const todos = permitidas.length > 0 && atuais.length === permitidas.length;
  const abrir = (chaves: string[]) => { setMensagem(null); setSolicitacao(selecaoVisivel(chaves, permitidas)); };
  const controle = {
    selecionados: atuais,
    permitidas,
    todos,
    alternar: (chave: string) => setSelecionados(atuais => alternarSelecao(atuais, chave, permitidas)),
    alternarTodos: () => setSelecionados(todos ? [] : permitidas),
    excluir: (chave: string) => abrir([chave]),
  };
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-contorno bg-slate-50/70 px-4 py-3">
      <div className="min-w-0"><p className="text-sm font-semibold" role="status" aria-live="polite">{atuais.length ? `${atuais.length} registro(s) selecionado(s)` : "Selecione os lançamentos que deseja excluir"}</p><p className="mt-1 text-[11px] text-tinta-suave">Seleção somente desta página. Ao trocar filtros ou página, a seleção é limpa.</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" className={btnSecundario} disabled={!atuais.length} onClick={() => setSelecionados([])}>Limpar seleção</button><button type="button" disabled={!atuais.length} onClick={() => abrir(atuais)} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-45">Excluir selecionados{atuais.length ? ` (${atuais.length})` : ""}</button></div>
    </div>
    {mensagem && <p ref={avisoConclusao} tabIndex={-1} role="status" className="border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{mensagem} <Link prefetch={false} href="/cadastros/governanca?modo=lixeira" className="font-semibold underline underline-offset-2">Ver lixeira</Link></p>}
    {conteudoTabela(props, controle)}
    {solicitacao?.length ? <ExclusaoTitulosModal dominio={props.exclusaoLote.dominio} chaves={solicitacao} aoFechar={() => setSolicitacao(null)} aoConcluir={resultado => {
      setSelecionados([]); setSolicitacao(null); setMensagem(resultado.mensagem);
    }} /> : null}
  </>;
}

type ControleSelecao = { selecionados: string[]; permitidas: string[]; todos: boolean; alternar: (chave: string) => void; alternarTodos: () => void; excluir: (chave: string) => void };

function conteudoTabela({ itens, financeiro, exibirDominio, exibirValor, contextual }: PropriedadesTabela, selecao?: ControleSelecao) {
  // O GET da própria lista reabre a janela com todos os filtros preservados.
  // Evita depender da transição RSC para abrir detalhes em listas extensas.
  const LinkRegistro = contextual ? "a" : Link;
  const propsLinkRegistro = contextual ? {} : { prefetch: false as const };
  return <div className="tabela-scroll overflow-x-auto" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}>
    <table className={`tabela tabela--acoes${financeiro && !exibirDominio ? " tabela-financeira" : ""}`}>
      <thead><tr>
        <th>{selecao ? <label className="flex items-center gap-3"><input type="checkbox" checked={selecao.todos} disabled={!selecao.permitidas.length} ref={elemento => { if (elemento) elemento.indeterminate = !!selecao.selecionados.length && !selecao.todos; }} onChange={selecao.alternarTodos} aria-label="Selecionar todos os registros desta página" className="h-4 w-4 shrink-0 accent-oliva" /><span>Registro · de onde veio</span></label> : "Registro · de onde veio"}</th>
        {exibirDominio ? <th>Tipo</th> : null}
        <th>Situação · efeito nos totais</th><th>Data / competência</th>
        {financeiro ? <><th className="tabela-valor-separado text-right!">Devido</th><th className="tabela-valor-separado text-right!">Pago</th><th className="tabela-valor-separado text-right!">Aberto</th>{!exibirDominio ? <th className="tabela-valores-agrupados text-right!">Valores</th> : null}</> : exibirValor ? <th className="text-right!">Valor</th> : null}
        <th className="text-right!">Ações</th>
      </tr></thead>
      <tbody>{itens.map(item => <tr key={item.chave} className={selecao?.selecionados.includes(item.chave) ? "bg-oliva/5" : undefined}>
        <td className="max-w-[360px] whitespace-normal!">
          <div className="flex items-start gap-3">
          {selecao ? <input type="checkbox" checked={selecao.selecionados.includes(item.chave)} disabled={!selecao.permitidas.includes(item.chave)} onChange={() => selecao.alternar(item.chave)} aria-label={`Selecionar ${item.titulo}`} className="mt-1 h-4 w-4 shrink-0 accent-oliva" /> : null}
          <div className="min-w-0">
          <LinkRegistro {...propsLinkRegistro} href={item.hrefDetalhe} className="font-semibold text-oliva-escura hover:underline">{item.titulo}</LinkRegistro>
          <p className="my-1 text-[11px] text-tinta-suave">{item.descricao}</p>
          <OrigensUnificadas origens={item.origens} />
          {item.papeis.length ? <p className="mt-1 text-[10px] text-tinta-suave">{item.papeis.join(" · ")}</p> : null}
          </div></div>
        </td>
        {exibirDominio ? <td>{ROTULOS_DOMINIO[item.dominio]}</td> : null}
        <td className="max-w-[250px] whitespace-normal!">
          <EstadoUnificado item={item} />
          {item.correspondencias ? <p className="mt-1 text-[11px] text-amber-800">{item.correspondencias} correspondência(s) para comparar</p> : null}
          <details className="mt-2 text-xs text-tinta-suave">
            <summary className="cursor-pointer text-[11px] font-medium text-oliva-escura">Entenda a situação</summary>
            {item.aviso ? <p className="mt-2 text-[11px]">{item.aviso}</p> : null}
            <p className="mt-2 leading-relaxed">{item.impacto}</p>
          </details>
        </td>
        <td className="text-xs text-tinta-suave">{item.data}{item.competencia ? <p className="mt-1 font-mono text-[10px]">{item.competencia}</p> : null}</td>
        {financeiro ? <>
          {[item.valor, item.pago, item.aberto].map((valor, indice) => <td key={indice} className="tabela-valor-separado text-right!"><Sigilo><Dinheiro centavos={valor} /></Sigilo></td>)}
          {!exibirDominio ? <td className="tabela-valores-agrupados"><dl className="tabela-valores-financeiros">{[{ rotulo: "Devido", valor: item.valor }, { rotulo: "Pago", valor: item.pago }, { rotulo: "Aberto", valor: item.aberto }].map(({ rotulo, valor }) => <div key={rotulo}><dt>{rotulo}</dt><dd><Sigilo><Dinheiro centavos={valor} /></Sigilo></dd></div>)}</dl></td> : null}
        </> : exibirValor ? <td className="text-right!"><span className="block text-[10px] text-tinta-suave">{item.natureza}</span><Sigilo><Dinheiro centavos={item.valor} /></Sigilo></td> : null}
        <td className="text-right!"><div className="flex flex-col items-end gap-2">
          {item.rateio && item.dominio === "PAGAR" ? <RateioDespesaBotao {...item.rateio} compacto /> : null}
          <LinkRegistro {...propsLinkRegistro} href={item.hrefDetalhe} className="text-xs font-semibold text-oliva-escura hover:underline">{["PENDENTE", "REVISAR", "QUARENTENA"].includes(item.estado) ? "Revisar e resolver" : "Ver detalhes"}</LinkRegistro>
          {item.exclusao ? selecao?.permitidas.includes(item.chave) ? <button type="button" onClick={() => selecao.excluir(item.chave)} className="inline-flex min-h-8 items-center rounded-md px-2 py-1 text-xs font-semibold text-erro underline-offset-4 hover:bg-erro/5 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2" title="Conferir e excluir nesta tela">{item.exclusao.rotulo}</button> : <LinkRegistro {...propsLinkRegistro} href={item.exclusao.href} className="inline-flex min-h-8 items-center rounded-md px-2 py-1 text-xs font-semibold text-erro underline-offset-4 hover:bg-erro/5 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2" title="Revisar o impacto e confirmar a exclusão com histórico">{item.exclusao.rotulo}</LinkRegistro> : null}
          {item.hrefCadastro ? <Link prefetch={false} href={item.hrefCadastro} className="text-[11px] text-tinta-suave hover:underline">Abrir cadastro / lançamento</Link> : null}
        </div></td>
      </tr>)}
      {!itens.length ? <tr><td colSpan={4 + Number(exibirDominio) + (financeiro ? 3 : Number(exibirValor))} className="py-12! text-center! text-tinta-suave">Nenhum registro nestes filtros. Isso não significa que toda a base já foi conferida.</td></tr> : null}
      </tbody>
    </table>
  </div>;
}
