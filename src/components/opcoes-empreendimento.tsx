"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function OpcoesEmpreendimento({ nome, children }: { nome: string; children: ReactNode }) {
  const detalhes = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const fecharFora = (event: PointerEvent) => {
      if (event.target instanceof Node && !detalhes.current?.contains(event.target) && detalhes.current) detalhes.current.open = false;
    };
    const escapar = (event: KeyboardEvent) => {
      if (event.key === "Escape" && detalhes.current?.open) {
        detalhes.current.open = false;
        detalhes.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", fecharFora);
    document.addEventListener("keydown", escapar);
    return () => { document.removeEventListener("pointerdown", fecharFora); document.removeEventListener("keydown", escapar); };
  }, []);
  return <details ref={detalhes} className="opcoes-empreendimento relative text-left">
    <summary aria-label={`Mais opções de ${nome}`} title="Mais opções" className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg border border-contorno bg-carta text-sm font-bold hover:bg-papel focus-visible:outline-2 focus-visible:outline-oliva">•••</summary>
    <div className="absolute right-0 top-full z-30 mt-2 w-64 max-w-[calc(100vw-48px)] rounded-xl border border-contorno bg-carta p-2 shadow-xl">
      <p className="mb-1 truncate px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-tinta-suave">{nome}</p>
      {children}
    </div>
  </details>;
}
