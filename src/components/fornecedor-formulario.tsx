"use client";

import { useId, useRef, useState } from "react";
import { pesquisarFornecedores, salvarCadastroFornecedor, usarPessoaComoFornecedor } from "@/app/(app)/cadastros/fornecedores/actions";
import type { FornecedorCadastro, FornecedorResumo } from "@/lib/fornecedores/tipos";
import { btnPrimario, btnSecundario, inputBase } from "./ui";

export function FornecedorFormulario({ inicial, aoSalvar, aoCancelar, nomeInicial = "", documentoInicial = "", aoOcupar }: {
  inicial?: FornecedorCadastro; nomeInicial?: string; documentoInicial?: string;
  aoSalvar: (fornecedor: FornecedorResumo) => void; aoCancelar: () => void; aoOcupar?: (busy: boolean) => void;
}) {
  const id = useId(); const requestId = useRef<string | null>(null);
  const [nome, setNome] = useState(inicial?.nome ?? nomeInicial);
  const [cpfCnpj, setDocumento] = useState(inicial?.cpfCnpj ?? documentoInicial);
  const [email, setEmail] = useState(inicial?.email ?? ""); const [telefone, setTelefone] = useState(inicial?.telefone ?? "");
  const [busy, setBusy] = useState(false); const [erro, setErro] = useState("");
  const [pessoas, setPessoas] = useState<FornecedorResumo[] | null>(null);
  async function salvar() {
    if (busy) return; setBusy(true); aoOcupar?.(true); setErro("");
    requestId.current ??= crypto.randomUUID();
    try {
      const r = await salvarCadastroFornecedor({ requestId: requestId.current, id: inicial?.id, atualizadoEm: inicial?.atualizadoEm, nome, cpfCnpj, email, telefone });
      if (r.ok) aoSalvar(r.fornecedor); else { setErro(r.mensagem); if (r.existentes) setPessoas(r.existentes); }
    } catch { setErro("Não foi possível salvar. Tente novamente."); } finally { setBusy(false); aoOcupar?.(false); }
  }
  async function buscar() {
    if (busy) return; setBusy(true); setErro("");
    try { const r = await pesquisarFornecedores({ termo: cpfCnpj.trim() || nome.trim(), todasPessoas: true }); if (r.ok) setPessoas(r.fornecedores); else setErro(r.mensagem); }
    catch { setErro("Não foi possível buscar os cadastros."); } finally { setBusy(false); }
  }
  async function usar(p: FornecedorResumo) {
    if (busy) return; setBusy(true); aoOcupar?.(true); setErro("");
    try { const r = await usarPessoaComoFornecedor(p.id); if (r.ok) aoSalvar(r.fornecedor); else setErro(r.mensagem); }
    catch { setErro("Não foi possível vincular o cadastro."); } finally { setBusy(false); aoOcupar?.(false); }
  }
  return <div className="space-y-4" aria-busy={busy} onKeyDown={e => { if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault(); }}>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-xs font-semibold text-tinta" htmlFor={`${id}-nome`}>Nome / razão social *<input id={`${id}-nome`} className={`${inputBase} mt-1 w-full`} value={nome} onChange={e => setNome(e.target.value)} maxLength={250} disabled={busy} autoComplete="organization" /></label>
      <label className="min-w-0 text-xs font-semibold text-tinta" htmlFor={`${id}-documento`}>CPF/CNPJ (opcional)<input id={`${id}-documento`} className={`${inputBase} mt-1 w-full`} value={cpfCnpj} onChange={e => setDocumento(e.target.value)} maxLength={30} disabled={busy} inputMode="numeric" /></label>
      <label className="min-w-0 text-xs font-semibold text-tinta" htmlFor={`${id}-email`}>E-mail (opcional)<input id={`${id}-email`} type="email" className={`${inputBase} mt-1 w-full`} value={email} onChange={e => setEmail(e.target.value)} maxLength={200} disabled={busy} /></label>
      <label className="min-w-0 text-xs font-semibold text-tinta" htmlFor={`${id}-telefone`}>Telefone (opcional)<input id={`${id}-telefone`} type="tel" className={`${inputBase} mt-1 w-full`} value={telefone} onChange={e => setTelefone(e.target.value)} maxLength={40} disabled={busy} /></label>
    </div>
    {!inicial && <div className="rounded-lg border border-contorno bg-white p-3">
      <p className="mb-2 text-xs text-tinta-suave">Já existe como cliente, proprietário ou fornecedor? Busque pelo nome ou CPF/CNPJ acima e aproveite o cadastro.</p>
      <button type="button" className={btnSecundario} onClick={buscar} disabled={busy || (!nome.trim() && !cpfCnpj.trim())}>Buscar cadastro existente</button>
      {pessoas && <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">{pessoas.length ? pessoas.map(p => <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-contorno p-2"><div className="min-w-0"><div className="break-words text-xs font-semibold">{p.nome}</div><div className="text-[11px] text-tinta-suave">{p.cpfCnpj || "Documento não informado"} · {p.origem === "BRISA" ? "Brisa" : "Importado"}</div></div><button type="button" className={btnSecundario} disabled={busy} onClick={() => usar(p)}>Usar este cadastro</button></div>) : <p className="text-xs text-tinta-suave">Nenhum cadastro encontrado. Você pode cadastrar abaixo.</p>}</div>}
    </div>}
    {erro && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{erro}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className={btnPrimario} disabled={busy || !nome.trim()} onClick={salvar}>{busy ? "Salvando..." : inicial ? "Salvar fornecedor" : "Cadastrar e selecionar"}</button><button type="button" className={btnSecundario} disabled={busy} onClick={aoCancelar}>Cancelar</button></div>
  </div>;
}
