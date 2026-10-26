"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { pesquisarFornecedores } from "@/app/(app)/cadastros/fornecedores/actions";
import type { FornecedorResumo } from "@/lib/fornecedores/tipos";
import { FornecedorFormulario } from "./fornecedor-formulario";
import { btnSecundario, inputBase } from "./ui";

type Valor = { id: string | null; nome: string; cpfCnpj: string | null };
export function SeletorFornecedorDespesa({ valor, onChange, disabled = false, permiteCadastrar = false, aoOcupar }: {
  valor: Valor; onChange: (v: Valor) => void; disabled?: boolean; permiteCadastrar?: boolean; aoOcupar?: (busy: boolean) => void;
}) {
  const id = useId(); const [termo, setTermo] = useState(""); const [itens, setItens] = useState<FornecedorResumo[] | null>(null);
  const [criando, setCriando] = useState(false); const [busy, setBusy] = useState(false); const [erro, setErro] = useState("");
  async function buscar() {
    if (busy || disabled) return; setBusy(true); setErro("");
    try { const r = await pesquisarFornecedores({ termo }); if (r.ok) setItens(r.fornecedores); else setErro(r.mensagem); }
    catch { setErro("Não foi possível buscar os fornecedores."); } finally { setBusy(false); }
  }
  function selecionar(p: FornecedorResumo) { onChange({ id: p.id, nome: p.nome, cpfCnpj: p.cpfCnpj }); setCriando(false); setItens(null); setTermo(""); }
  return <div className="space-y-3 rounded-xl border border-contorno bg-white p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-bold text-tinta">Fornecedor / prestador</h3><Link href="/cadastros/fornecedores" className="text-xs font-semibold text-oliva-escura underline" target="_blank" rel="noopener noreferrer">Gerenciar fornecedores</Link></div>
    {criando ? <div className="rounded-lg bg-fundo p-3"><h4 className="mb-3 text-sm font-semibold">Novo fornecedor</h4><FornecedorFormulario nomeInicial={valor.nome} documentoInicial={valor.cpfCnpj ?? ""} aoSalvar={selecionar} aoCancelar={() => setCriando(false)} aoOcupar={aoOcupar} /></div> : <>
      {valor.id ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-oliva/5 p-3"><div className="min-w-0"><p className="break-words text-sm font-semibold">{valor.nome}</p><p className="text-xs text-tinta-suave">{valor.cpfCnpj || "Documento não informado"} · Cadastro vinculado</p></div><button type="button" className={btnSecundario} disabled={disabled || busy} onClick={() => onChange({ ...valor, id: null })}>Trocar fornecedor</button></div> : <div className="grid gap-3 sm:grid-cols-2">
        <label className="min-w-0 text-xs font-semibold" htmlFor={`${id}-nome`}>Nome do fornecedor *<input id={`${id}-nome`} className={`${inputBase} mt-1 w-full`} value={valor.nome} onChange={e => onChange({ ...valor, nome: e.target.value })} maxLength={250} required disabled={disabled || busy} /></label>
        <label className="min-w-0 text-xs font-semibold" htmlFor={`${id}-documento`}>CPF/CNPJ do fornecedor<input id={`${id}-documento`} className={`${inputBase} mt-1 w-full`} value={valor.cpfCnpj ?? ""} onChange={e => onChange({ ...valor, cpfCnpj: e.target.value })} maxLength={30} inputMode="numeric" disabled={disabled || busy} /></label>
      </div>}
      <div className="flex flex-wrap gap-2"><label className="min-w-0 flex-1" htmlFor={`${id}-busca`}><span className="sr-only">Buscar fornecedor cadastrado</span><input id={`${id}-busca`} type="search" className={`${inputBase} w-full`} value={termo} onChange={e => setTermo(e.target.value)} placeholder="Buscar fornecedor por nome ou CPF/CNPJ" maxLength={120} disabled={disabled || busy} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void buscar(); } }} /></label><button type="button" className={btnSecundario} onClick={buscar} disabled={disabled || busy}>{busy ? "Buscando..." : "Buscar"}</button>{permiteCadastrar && <button type="button" className={btnSecundario} onClick={() => setCriando(true)} disabled={disabled || busy}>+ Novo fornecedor</button>}</div>
      {itens && <div className="max-h-56 space-y-2 overflow-y-auto" aria-label="Fornecedores encontrados">{itens.length ? itens.map(p => <button key={p.id} type="button" disabled={disabled || busy} onClick={() => selecionar(p)} className="flex w-full flex-wrap justify-between gap-2 rounded-lg border border-contorno p-3 text-left hover:border-oliva"><span className="min-w-0 break-words text-xs font-semibold">{p.nome}</span><span className="text-[11px] text-tinta-suave">{p.cpfCnpj || "Sem documento"} · {p.origem === "BRISA" ? "Brisa" : "Importado"}</span></button>) : <p className="text-xs text-tinta-suave">Nenhum fornecedor encontrado. Cadastre um novo ou mantenha o nome informado no lançamento.</p>}</div>}
    </>}
    {erro && <p role="alert" className="text-xs text-red-700">{erro}</p>}
  </div>;
}
