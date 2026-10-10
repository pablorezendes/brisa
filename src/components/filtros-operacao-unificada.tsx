"use client";

import Link from "next/link";
import { btnPrimario, btnSecundario, inputBase } from "@/components/ui";
import { ESTADOS_UNIFICACAO } from "@/components/unificacao-visual";
import { ROTULOS_DOMINIO } from "@/lib/unificacao/tipos";
import { ROTULOS_ORIGEM_DADOS } from "@/lib/unificacao/origens";

/** Somente valores dos filtros e condições de apresentação atravessam esta fronteira. */
type FiltrosOperacaoUnificadaProps = {
  base: string;
  dominio: string;
  dominioFixo: boolean;
  financeiro: boolean;
  movimento: boolean;
  baixa: boolean;
  q: string;
  origem: string;
  estado: string;
  mes: string;
  de: string;
  ate: string;
  papel: string;
  vencidos: boolean;
};

export function FiltrosOperacaoUnificada({ base, dominio, dominioFixo, financeiro, movimento, baixa, q, origem, estado, mes, de, ate, papel, vencidos }: FiltrosOperacaoUnificadaProps) {
  const temFiltrosAvancados = Boolean(de || ate || vencidos || ["VINCULADO", "AUSENTE"].includes(estado));

  return <form action={base} method="get" className="grid gap-3 border-b border-contorno p-4 sm:grid-cols-2 xl:grid-cols-4">
    <label className="text-[11px] font-semibold text-tinta-suave">Buscar<input className={`${inputBase} mt-1 w-full`} name="q" defaultValue={q} placeholder="Nome, referência ou descrição" /></label>
    {!dominioFixo ? <label className="text-[11px] font-semibold text-tinta-suave">Tipo de registro<select name="dominio" defaultValue={dominio ?? ""} className={`${inputBase} mt-1 w-full`}><option value="">Todos os tipos</option>{Object.entries(ROTULOS_DOMINIO).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}</select></label> : null}
    <label className="text-[11px] font-semibold text-tinta-suave">De onde veio<select name="origem" defaultValue={origem} className={`${inputBase} mt-1 w-full`}><option value="">Todas as origens</option>{Object.entries(ROTULOS_ORIGEM_DADOS).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}</select></label>
    {financeiro || movimento || baixa ? <label className="text-[11px] font-semibold text-tinta-suave">Competência<input type="month" name="mes" defaultValue={mes} className={`${inputBase} mt-1 w-full`} /></label> : null}
    {dominio === "PESSOA" ? <label className="text-[11px] font-semibold text-tinta-suave">Papel<select name="papel" defaultValue={papel} className={`${inputBase} mt-1 w-full`}><option value="">Todos os papéis</option>{["INQUILINO", "PROPRIETARIO", "BENEFICIARIO", "FORNECEDOR", "FIADOR", "AVALISTA", "CORRETOR", "FUNCIONARIO", "COMPRADOR", "INTERESSADO"].map((p) => <option key={p} value={p}>{p.toLocaleLowerCase("pt-BR")}</option>)}</select></label> : null}
    <div className="flex flex-wrap items-end gap-2"><button className={btnPrimario}>Aplicar filtros</button><Link prefetch={false} href={base} className={btnSecundario}>Limpar</Link></div>
    <details key={`${de}:${ate}:${vencidos}:${estado}`} open={temFiltrosAvancados} className="col-span-full rounded-lg border border-contorno bg-slate-50/50 px-3 py-2">
      <summary className="cursor-pointer text-xs font-semibold text-oliva-escura">Mais filtros{temFiltrosAvancados ? " · há filtros aplicados" : ""}</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-[11px] font-semibold text-tinta-suave">Situação na consolidação<select name="estado" defaultValue={estado} className={`${inputBase} mt-1 w-full`}><option value="">Disponíveis e pendências</option>{Object.entries(ESTADOS_UNIFICACAO).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}</select></label>
        {financeiro || movimento || baixa ? <><label className="text-[11px] font-semibold text-tinta-suave">Data inicial<input type="date" name="de" defaultValue={de} className={`${inputBase} mt-1 w-full`} /></label><label className="text-[11px] font-semibold text-tinta-suave">Data final<input type="date" name="ate" defaultValue={ate} className={`${inputBase} mt-1 w-full`} /></label></> : null}
        {financeiro ? <label className="flex items-center gap-2 self-end py-2 text-xs"><input type="checkbox" name="vencidos" value="1" defaultChecked={vencidos} />Somente vencidos</label> : null}
      </div>
    </details>
  </form>;
}
