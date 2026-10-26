"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { btnSecundario } from "@/components/ui";

const GerenciadorCategoriasDespesa = dynamic(() => import("./gerenciador-categorias-despesa").then(modulo => modulo.GerenciadorCategoriasDespesa), { ssr: false, loading: () => <span role="status" className="text-xs text-tinta-suave">Abrindo categorias…</span> });

export function CategoriasDespesaBotao() {
  const [aberto, setAberto] = useState(false);
  return <><button type="button" aria-haspopup="dialog" aria-expanded={aberto} disabled={aberto} onClick={() => setAberto(true)} className={btnSecundario}>Categorias</button>{aberto && <GerenciadorCategoriasDespesa aoFechar={() => setAberto(false)} />}</>;
}
