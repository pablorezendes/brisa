"use client";

import dynamic from "next/dynamic";
import { createContext, useContext, useState, type ReactNode } from "react";

const RevisaoRecebimentoModal = dynamic(() => import("./revisao-recebimento-modal").then(modulo => modulo.RevisaoRecebimentoModal), { ssr: false, loading: () => <span role="status" className="text-xs text-tinta-suave">Preparando conferência…</span> });
const ContextoRevisaoRecebimento = createContext<{ chave: string | null; abrir: (chave: string) => void } | null>(null);

/** Mantém a confirmação visível mesmo quando o registro sai do filtro de pendências. */
export function ProvedorRevisaoRecebimento({ children }: { children: ReactNode }) {
  const [chave, setChave] = useState<string | null>(null);
  return <ContextoRevisaoRecebimento.Provider value={{ chave, abrir: setChave }}>{children}{chave && <RevisaoRecebimentoModal chave={chave} aoFechar={() => setChave(null)} />}</ContextoRevisaoRecebimento.Provider>;
}

export function RevisaoRecebimentoBotao({ chave, conferido = false }: { chave: string; conferido?: boolean }) {
  const contexto = useContext(ContextoRevisaoRecebimento);
  const [abertoLocal, setAbertoLocal] = useState(false);
  const aberto = contexto ? contexto.chave === chave : abertoLocal;
  return <>
    <button type="button" aria-haspopup="dialog" aria-expanded={aberto} disabled={contexto ? contexto.chave !== null : abertoLocal} onClick={() => contexto ? contexto.abrir(chave) : setAbertoLocal(true)} className="inline-flex min-h-8 items-center rounded-md px-2 py-1 text-xs font-semibold text-oliva-escura hover:bg-oliva/5 hover:underline">{conferido ? "Conferido" : "Conferir"}</button>
    {!contexto && abertoLocal && <RevisaoRecebimentoModal chave={chave} aoFechar={() => setAbertoLocal(false)} />}
  </>;
}
