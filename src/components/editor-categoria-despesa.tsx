"use client";

import { useId, useRef, useState } from "react";
import { gravarCategoriaDespesa } from "@/app/(app)/financeiro/contas-a-pagar/categorias-actions";
import type { CategoriaDespesaCatalogo } from "@/lib/despesas/tipos-catalogo";
import { btnPrimario, btnSecundario, inputBase } from "@/components/ui";

/** Sem outro form ou dialog: também pode ser usado dentro da nova despesa. */
export function EditorCategoriaDespesa({ inicial, aoSalvar, aoCancelar, aoOcupar, aoAlterar }: {
  inicial?: CategoriaDespesaCatalogo;
  aoSalvar: (categoria: CategoriaDespesaCatalogo, categorias: CategoriaDespesaCatalogo[]) => void;
  aoCancelar: () => void;
  aoOcupar?: (ocupado: boolean) => void;
  aoAlterar?: () => void;
}) {
  const tituloId = useId();
  const nomeId = useId();
  const [rotulo, setRotulo] = useState(inicial?.rotulo ?? "");
  const [restrita, setRestrita] = useState(inicial?.restrita ?? false);
  const [confirmarCorrecaoSigilo, setConfirmarCorrecaoSigilo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const enviando = useRef(false);
  const nome = useRef<HTMLInputElement>(null);

  async function salvar() {
    if (enviando.current) return;
    if (!rotulo.trim()) { setErro("Informe o nome da categoria."); nome.current?.focus(); return; }
    enviando.current = true; setSalvando(true); setErro(""); aoOcupar?.(true);
    try {
      const resposta = await gravarCategoriaDespesa({ codigo: inicial?.codigo, versao: inicial?.versao, rotulo: rotulo.trim(), ativa: inicial?.ativa ?? true, restrita, confirmarCorrecaoSigilo });
      if (resposta.ok) aoSalvar(resposta.categoria, resposta.categorias);
      else setErro(resposta.mensagem);
    } catch { setErro("Não foi possível confirmar o cadastro. Confira a conexão e tente novamente."); }
    finally { enviando.current = false; setSalvando(false); aoOcupar?.(false); }
  }

  return <section aria-labelledby={tituloId} aria-busy={salvando} className="rounded-xl border border-oliva/25 bg-oliva/5 p-4">
    <h3 id={tituloId} className="text-sm font-bold">{inicial ? "Editar categoria" : "Nova categoria"}</h3>
    <p className="mt-1 text-xs leading-relaxed text-tinta-suave">Use um nome fácil de reconhecer, como “Material de escritório”.</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <label htmlFor={nomeId} className="block min-w-0 text-xs font-semibold">Nome da categoria<input ref={nome} id={nomeId} autoComplete="off" maxLength={120} value={rotulo} disabled={salvando || confirmarCorrecaoSigilo} onChange={event => { setRotulo(event.target.value); aoAlterar?.(); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void salvar(); } }} className={`${inputBase} mt-1.5 w-full min-w-0`} placeholder="Ex.: material de escritório" /></label>
      <div className="flex flex-wrap gap-2"><button type="button" className={btnPrimario} disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : inicial ? "Salvar categoria" : "Cadastrar categoria"}</button><button type="button" className={btnSecundario} disabled={salvando} onClick={aoCancelar}>Cancelar</button></div>
    </div>
    <label className="mt-3 flex items-start gap-2 text-xs leading-relaxed"><input type="checkbox" checked={restrita} disabled={salvando || inicial?.restrita} onChange={event => { setRestrita(event.target.checked); aoAlterar?.(); }} className="mt-0.5" /><span><strong>Restrita ao administrador</strong><span className="mt-0.5 block text-tinta-suave">Use para comissões e outras despesas reservadas. Honorários contábeis e advocatícios não exigem essa restrição por padrão. A proteção já salva é preservada.</span></span></label>
    {inicial?.podeCorrigirSigiloHonorarios && <label className="mt-3 flex items-start gap-2 rounded-lg border border-linha bg-white p-3 text-xs leading-relaxed"><input type="checkbox" className="mt-0.5" checked={confirmarCorrecaoSigilo} disabled={salvando} onChange={event => { setConfirmarCorrecaoSigilo(event.target.checked); setRestrita(!event.target.checked); if (event.target.checked) setRotulo(inicial.rotulo); aoAlterar?.(); }} /><span><strong>Corrigir restrição indevida desta categoria de honorários</strong><span className="mt-1 block text-tinta-suave">Confirmo que a categoria é de honorários profissionais, sem comissão. Novas despesas seguirão o acesso normal. As despesas já cadastradas e seus anexos continuam restritos até uma conferência individual em Organizar despesa.</span></span></label>}
    {inicial && !inicial.restrita && restrita && <p className="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-950">As despesas já vinculadas a esta categoria também ficarão restritas ao administrador.</p>}
    {erro && <p role="alert" className="mt-3 text-xs font-semibold text-erro">{erro}</p>}
  </section>;
}
