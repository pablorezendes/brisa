"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { btnPrimario } from "@/components/ui";

const RateioDespesaModal = dynamic(() => import("./rateio-despesa-modal").then(modulo => modulo.RateioDespesaModal), { ssr: false, loading: () => <span role="status" className="text-xs text-tinta-suave">Preparando janela de rateio…</span> });

export function RateioDespesaBotao({ origemChave, id, compacto = false }: { origemChave?: string; id?: string; compacto?: boolean }) {
  const [aberto, setAberto] = useState(false);
  return <>
    <button type="button" aria-haspopup="dialog" aria-expanded={aberto} disabled={aberto} onClick={() => setAberto(true)} className={compacto ? "inline-flex min-h-8 items-center rounded-md px-2 py-1 text-xs font-semibold text-oliva-escura hover:bg-oliva/5 hover:underline" : btnPrimario}>{compacto ? "Ratear despesa" : "Nova despesa com rateio"}</button>
    {aberto && <RateioDespesaModal selecao={{ origemChave, id }} aoFechar={() => setAberto(false)} />}
  </>;
}
