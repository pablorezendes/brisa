"use client";

import { Dinheiro, Sigilo } from "@/components/ui";
import type { CampoFonte } from "@/lib/unificacao/tipos";

/** Recebe somente campos visíveis, já autorizados e projetados no servidor. */
export type CampoConferencia = { chave: string; campo: CampoFonte };
export type LinhaComparacaoConferencia = { chave: string; a: CampoFonte | null; b: CampoFonte | null };

function ValorCampo({ campo }: { campo: CampoFonte | null }) {
  if (!campo || campo.valor === null || campo.valor === "") return <span className="text-tinta-suave">Não informado</span>;
  if (campo.tipo === "dinheiro" && typeof campo.valor === "number") return <Sigilo><Dinheiro centavos={campo.valor} /></Sigilo>;
  return <span className="break-words">{campo.valor}</span>;
}

export function CamposRegistroConferencia({ campos }: { campos: CampoConferencia[] }) {
  return <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">{campos.map(({ chave, campo }) => <div key={chave} className="min-w-0 border-b border-contorno pb-3"><dt className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-tinta-suave">{campo.rotulo}</dt><dd className="text-xs"><ValorCampo campo={campo} /></dd></div>)}</dl>;
}

export function ComparacaoCamposConferencia({ campos }: { campos: LinhaComparacaoConferencia[] }) {
  return <dl className="divide-y divide-contorno">{campos.map(({ chave, a, b }) => {
    const diverge = a?.valor != null && b?.valor != null && String(a.valor) !== String(b.valor);
    return <div key={chave} className={`min-w-0 p-4 ${diverge ? "bg-amber-50/50" : ""}`}>
      <dt className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-tinta-suave">{a?.rotulo ?? b?.rotulo}{diverge ? <span className="text-[10px] text-amber-800">Valores diferentes</span> : null}</dt>
      <dd className="grid min-w-0 gap-3 text-xs sm:grid-cols-2"><div className="min-w-0 break-words"><span className="mb-1 block text-[10px] text-tinta-suave sm:sr-only">Este registro</span><ValorCampo campo={a} /></div><div className="min-w-0 break-words"><span className="mb-1 block text-[10px] text-tinta-suave sm:sr-only">Principal</span><ValorCampo campo={b} /></div></dd>
    </div>;
  })}</dl>;
}
