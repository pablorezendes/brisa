"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { salvarEmpreendimentoNaTela } from "@/app/(app)/cadastros/actions";
import { IconeMenu } from "./icones-menu";
import { btnPrimario, btnSecundario, inputBase } from "./ui";

type Empreendimento = { id: string; nome: string; ativo: boolean; imoveis?: number; contratos?: number };

export function EditorEmpreendimento({ item, retorno, abrirInicial = false }: { item?: Empreendimento; retorno: string; abrirInicial?: boolean }) {
  const [aberto, setAberto] = useState(abrirInicial);
  const botao = useRef<HTMLButtonElement>(null);
  return <>
    {!abrirInicial && <button ref={botao} type="button" className={item ? btnSecundario : btnPrimario} aria-haspopup="dialog" aria-expanded={aberto} aria-label={item ? `Editar ${item.nome}` : undefined} onClick={() => setAberto(true)}>{item ? "Editar" : "+ Novo empreendimento"}</button>}
    {aberto && <FormularioEmpreendimento item={item} retorno={retorno} fechar={() => { setAberto(false); botao.current?.focus(); }} limparUrl={abrirInicial} />}
  </>;
}

function FormularioEmpreendimento({ item, retorno, fechar, limparUrl }: { item?: Empreendimento; retorno: string; fechar: () => void; limparUrl: boolean }) {
  const router = useRouter();
  const id = useId();
  const dialogo = useRef<HTMLDialogElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const bloqueado = useRef(false);
  const [nome, setNome] = useState(item?.nome ?? "");
  const [erro, setErro] = useState("");
  const [descartar, setDescartar] = useState(false);
  const [pendente, enviar] = useTransition();
  const alterado = nome !== (item?.nome ?? "");
  useEffect(() => {
    const elemento = dialogo.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    elemento?.showModal();
    campo.current?.focus({ preventScroll: true });
    return () => { elemento?.close(); document.body.style.overflow = overflow; };
  }, []);
  useEffect(() => { if (erro && !pendente) campo.current?.focus(); }, [erro, pendente]);
  function concluir() {
    fechar();
    if (limparUrl) router.replace(retorno, { scroll: false });
  }
  function tentarFechar() {
    if (bloqueado.current) return;
    if (alterado) setDescartar(true); else concluir();
  }
  return <dialog ref={dialogo} className="janela-financeira editor-empreendimento" aria-labelledby={`${id}-titulo`} aria-describedby={`${id}-descricao`} onCancel={e => { e.preventDefault(); tentarFechar(); }}>
    <header className="flex items-start justify-between gap-4 border-b border-contorno p-6">
      <div className="flex min-w-0 gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-oliva/10 text-oliva-escura"><IconeMenu nome="empreendimentos" tamanho={23} /></span>
        <div><p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-oliva-escura">Cadastro de empreendimento</p><h2 id={`${id}-titulo`} className="text-xl font-bold tracking-tight">{item ? "Editar empreendimento" : "Novo empreendimento"}</h2></div>
      </div>
      <button type="button" aria-label="Fechar editor" disabled={pendente} onClick={tentarFechar} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-contorno text-xl hover:bg-papel disabled:opacity-50">×</button>
    </header>
    <form className="min-h-0 overflow-auto" aria-busy={pendente} onSubmit={e => {
      e.preventDefault();
      if (bloqueado.current) return;
      bloqueado.current = true;
      setErro("");
      const dados = new FormData(e.currentTarget);
      enviar(async () => {
        try {
          const resultado = await salvarEmpreendimentoNaTela(dados);
          if (resultado.erro) { setErro(resultado.erro); campo.current?.focus(); return; }
          const destino = new URL(retorno, window.location.origin);
          destino.searchParams.set("ok", resultado.ok ?? "Empreendimento salvo.");
          fechar();
          router.replace(`${destino.pathname}${destino.search}`, { scroll: false });
          router.refresh();
        } catch { setErro("Não foi possível salvar. Confira sua conexão e tente novamente."); }
        finally { bloqueado.current = false; }
      });
    }}>
      {item && <input type="hidden" name="id" value={item.id} />}
      <div className="space-y-5 p-6">
        <p id={`${id}-descricao`} className="text-sm leading-relaxed text-tinta-suave">{item ? "Atualize o nome usado para identificar este empreendimento no sistema." : "Comece pelo nome. Depois, vincule os imóveis a este empreendimento."}</p>
        <div><label htmlFor={`${id}-nome`} className="block text-sm font-semibold">Nome do empreendimento <span className="font-normal text-tinta-suave">(obrigatório)</span></label>
          <input ref={campo} id={`${id}-nome`} name="nome" required maxLength={120} autoComplete="off" value={nome} disabled={pendente} onChange={e => { setNome(e.target.value); setErro(""); setDescartar(false); }} placeholder="Ex.: Edifício Jardim das Flores" aria-invalid={!!erro} aria-describedby={`${id}-ajuda${erro ? ` ${id}-erro` : ""}`} className={`${inputBase} mt-2 w-full py-3 text-base`} />
          <p id={`${id}-ajuda`} className="mt-2 text-xs leading-relaxed text-tinta-suave">Use um nome fácil de reconhecer na lista de imóveis e nos relatórios.</p>
          {erro && <p id={`${id}-erro`} role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{erro}</p>}
        </div>
        {item && <div className="rounded-xl border border-contorno bg-papel p-4"><p className="mb-3 text-xs font-semibold text-tinta-suave">Vínculos deste empreendimento</p><div className="grid grid-cols-3 gap-3 text-sm"><div><strong className="block text-lg tabular-nums">{item.imoveis ?? "—"}</strong><span className="text-xs text-tinta-suave">Imóveis</span></div><div><strong className="block text-lg tabular-nums">{item.contratos ?? "—"}</strong><span className="text-xs text-tinta-suave">Contratos abertos</span></div><div><strong className="block text-base text-oliva-escura">{item.ativo ? "Ativo" : "Inativo"}</strong><span className="text-xs text-tinta-suave">Situação atual</span></div></div><p className="mt-3 border-t border-contorno pt-3 text-xs leading-relaxed text-tinta-suave">A alteração do nome mantém os imóveis e os contratos vinculados.</p></div>}
        {descartar && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-semibold">Descartar a alteração ainda não salva?</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={btnSecundario} onClick={() => { setDescartar(false); campo.current?.focus(); }}>Continuar editando</button><button type="button" disabled={pendente} className="rounded-lg px-3 py-2 font-semibold text-erro" onClick={concluir}>Descartar e fechar</button></div></div>}
      </div>
      <footer className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t border-contorno bg-carta px-6 py-4">
        {pendente && <span role="status" className="mr-auto text-xs text-tinta-suave">Salvando…</span>}
        <button type="button" onClick={tentarFechar} disabled={pendente} className={btnSecundario}>Cancelar</button>
        <button type="submit" disabled={pendente || !nome.trim() || (!!item && !alterado)} className={btnPrimario}>{pendente ? "Salvando…" : item ? "Salvar alterações" : "Criar empreendimento"}</button>
      </footer>
    </form>
  </dialog>;
}
