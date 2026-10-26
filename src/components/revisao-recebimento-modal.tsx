"use client";

import { useEffect, useId, useRef, useState } from "react";
import { BotaoSigilo } from "./botao-sigilo";
import { RevisaoRecebimento } from "./revisao-despesa";
import { btnSecundario } from "./ui";

export function RevisaoRecebimentoModal({ chave, aoFechar }: { chave: string; aoFechar: () => void }) {
  const tituloId = useId();
  const dialogo = useRef<HTMLDialogElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    const elemento = dialogo.current;
    const foco = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    elemento?.showModal(); titulo.current?.focus();
    return () => { elemento?.close(); document.body.style.overflow = overflow; if (foco?.isConnected) foco.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialogo} className="janela-financeira text-left" style={{ width: "min(1080px, calc(100vw - 24px))" }} aria-labelledby={tituloId} onCancel={event => { event.preventDefault(); if (!ocupado) aoFechar(); }}>
    <header className="janela-financeira-cabecalho flex-wrap"><div className="min-w-0 flex-[1_1_24rem]"><p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-oliva">Contas a receber</p><h2 ref={titulo} id={tituloId} tabIndex={-1} className="text-lg font-bold outline-none">Conferir conta a receber</h2><p className="mt-1 text-xs text-tinta-suave">Compare, confirme e acompanhe o resultado sem sair da lista.</p></div><div className="flex shrink-0 flex-wrap gap-2"><BotaoSigilo /><button type="button" className={btnSecundario} disabled={ocupado} onClick={aoFechar} aria-label="Fechar conferência">Fechar ×</button></div></header>
    <div className="janela-financeira-conteudo"><RevisaoRecebimento chave={chave} aoOcupar={setOcupado} /></div>
  </dialog>;
}
