"use client";

import dynamic from "next/dynamic";
import { createContext, useContext, useState, type ReactNode } from "react";
import { btnPrimario } from "@/components/ui";

const RateioDespesaModal = dynamic(() => import("./rateio-despesa-modal").then(modulo => modulo.RateioDespesaModal), { ssr: false, loading: () => <span role="status" className="text-xs text-tinta-suave">Preparando despesa…</span> });

type SelecaoDespesa = { origemChave?: string; id?: string };
const ContextoDespesa = createContext<{ selecao: SelecaoDespesa | null; abrir: (selecao: SelecaoDespesa) => void } | null>(null);

/** A janela pertence à página: resolver uma pendência pode remover sua linha do filtro. */
export function ProvedorRateioDespesa({ children }: { children: ReactNode }) {
  const [selecao, setSelecao] = useState<SelecaoDespesa | null>(null);
  return <ContextoDespesa.Provider value={{ selecao, abrir: setSelecao }}>
    {children}
    {selecao && <RateioDespesaModal selecao={selecao} aoFechar={() => setSelecao(null)} />}
  </ContextoDespesa.Provider>;
}

export function RateioDespesaBotao({ origemChave, id, compacto = false }: { origemChave?: string; id?: string; compacto?: boolean }) {
  const contexto = useContext(ContextoDespesa);
  const [abertoLocal, setAbertoLocal] = useState(false);
  const aberto = contexto ? Boolean(contexto.selecao && contexto.selecao.origemChave === origemChave && contexto.selecao.id === id) : abertoLocal;
  return <>
    <button type="button" aria-haspopup="dialog" aria-expanded={aberto} disabled={contexto ? Boolean(contexto.selecao) : abertoLocal} onClick={() => contexto ? contexto.abrir({ origemChave, id }) : setAbertoLocal(true)} className={compacto ? "inline-flex min-h-8 items-center rounded-md px-2 py-1 text-xs font-semibold text-oliva-escura hover:bg-oliva/5 hover:underline" : btnPrimario}>{compacto ? "Organizar despesa" : "Nova despesa"}</button>
    {!contexto && abertoLocal && <RateioDespesaModal selecao={{ origemChave, id }} aoFechar={() => setAbertoLocal(false)} />}
  </>;
}
