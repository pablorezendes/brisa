"use client";

import Link from "next/link";
import { Dinheiro, Sigilo } from "@/components/ui";
import { EstadoUnificado, OrigensUnificadas } from "@/components/unificacao-visual";
import { ROTULOS_DOMINIO, type DominioUnificacao, type EstadoUnificacao } from "@/lib/unificacao/tipos";
import type { OrigemDados } from "@/lib/unificacao/origens";

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
};

/** A autorização e a projeção mínima acontecem antes, no Server Component. */
export function TabelaOperacaoUnificada({ itens, financeiro, exibirDominio, exibirValor, contextual }: {
  itens: LinhaTabelaOperacao[];
  financeiro: boolean;
  exibirDominio: boolean;
  exibirValor: boolean;
  contextual: boolean;
}) {
  // O GET da própria lista reabre a janela com todos os filtros preservados.
  // Evita depender da transição RSC para abrir detalhes em listas extensas.
  const LinkRegistro = contextual ? "a" : Link;
  const propsLinkRegistro = contextual ? {} : { prefetch: false as const };
  return <div className="tabela-scroll overflow-x-auto" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}>
    <table className={`tabela tabela--acoes${financeiro && !exibirDominio ? " tabela-financeira" : ""}`}>
      <thead><tr>
        <th>Registro · de onde veio</th>
        {exibirDominio ? <th>Tipo</th> : null}
        <th>Situação · efeito nos totais</th><th>Data / competência</th>
        {financeiro ? <><th className="tabela-valor-separado text-right!">Devido</th><th className="tabela-valor-separado text-right!">Pago</th><th className="tabela-valor-separado text-right!">Aberto</th>{!exibirDominio ? <th className="tabela-valores-agrupados text-right!">Valores</th> : null}</> : exibirValor ? <th className="text-right!">Valor</th> : null}
        <th className="text-right!">Ações</th>
      </tr></thead>
      <tbody>{itens.map(item => <tr key={item.chave}>
        <td className="max-w-[360px] whitespace-normal!">
          <LinkRegistro {...propsLinkRegistro} href={item.hrefDetalhe} className="font-semibold text-oliva-escura hover:underline">{item.titulo}</LinkRegistro>
          <p className="my-1 text-[11px] text-tinta-suave">{item.descricao}</p>
          <OrigensUnificadas origens={item.origens} />
          {item.papeis.length ? <p className="mt-1 text-[10px] text-tinta-suave">{item.papeis.join(" · ")}</p> : null}
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
          <LinkRegistro {...propsLinkRegistro} href={item.hrefDetalhe} className="text-xs font-semibold text-oliva-escura hover:underline">{["PENDENTE", "REVISAR", "QUARENTENA"].includes(item.estado) ? "Revisar e resolver" : "Ver detalhes"}</LinkRegistro>
          {item.exclusao ? <LinkRegistro {...propsLinkRegistro} href={item.exclusao.href} className="inline-flex min-h-8 items-center rounded-md px-2 py-1 text-xs font-semibold text-erro underline-offset-4 hover:bg-erro/5 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2" title="Revisar o impacto e confirmar a exclusão com histórico">{item.exclusao.rotulo}</LinkRegistro> : null}
          {item.hrefCadastro ? <Link prefetch={false} href={item.hrefCadastro} className="text-[11px] text-tinta-suave hover:underline">Abrir cadastro / lançamento</Link> : null}
        </div></td>
      </tr>)}
      {!itens.length ? <tr><td colSpan={4 + Number(exibirDominio) + (financeiro ? 3 : Number(exibirValor))} className="py-12! text-center! text-tinta-suave">Nenhum registro nestes filtros. Isso não significa que toda a base já foi conferida.</td></tr> : null}
      </tbody>
    </table>
  </div>;
}
