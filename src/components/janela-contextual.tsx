"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export function JanelaContextual({ titulo, retorno, selecao, comparacao, children }: { titulo: string; retorno: string; selecao?: string; comparacao?: string; children: ReactNode }) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const conteudoRef = useRef<HTMLDivElement>(null);
  const destinoNavegacao = useRef(retorno);
  const router = useRouter();
  const [fechando, navegar] = useTransition();
  const [aviso, setAviso] = useState<"pendente" | "rascunho" | null>(null);
  useEffect(() => {
    const elemento = dialogo.current;
    const focoAnterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    elemento?.showModal();
    tituloRef.current?.focus({ preventScroll: true });
    return () => {
      elemento?.close();
      document.body.style.overflow = overflowAnterior;
      if (focoAnterior?.isConnected) focoAnterior.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const conteudo = conteudoRef.current;
    const secao = comparacao && conteudo?.querySelector<HTMLElement>("#comparacao");
    if (conteudo && secao) {
      conteudo.scrollTo({ top: secao.getBoundingClientRect().top - conteudo.getBoundingClientRect().top + conteudo.scrollTop - 16 });
      secao.focus({ preventScroll: true });
    } else if (conteudo) conteudo.scrollTo({ top: 0 });
  }, [selecao, comparacao]);
  function fechar(descartarRascunho = false) {
    if (dialogo.current?.querySelector('form[aria-busy="true"]')) { setAviso("pendente"); return; }
    if (!descartarRascunho && dialogo.current?.querySelector('form[data-alterado="true"]')) { destinoNavegacao.current = retorno; setAviso("rascunho"); return; }
    navegar(() => router.replace(retorno, { scroll: false }));
  }
  return <dialog ref={dialogo} className="janela-financeira" aria-labelledby="titulo-janela-financeira"
    onCancel={event => { event.preventDefault(); fechar(); }}
    onSubmitCapture={event => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const impedirNavegacao = () => {
        event.preventDefault();
        // next/form pode iniciar a navegação no handler de destino mesmo quando
        // defaultPrevented veio de um ancestral, por isso impedimos a propagação.
        event.stopPropagation();
      };
      if (dialogo.current?.querySelector('form[aria-busy="true"]')) {
        impedirNavegacao(); setAviso("pendente"); return;
      }
      if (form.dataset.operacao === "contextual" || form.method.toLowerCase() !== "get") return;
      if (!dialogo.current?.querySelector('form[data-alterado="true"]')) return;
      impedirNavegacao();
      const destino = new URL(form.action, window.location.href);
      if (destino.origin !== window.location.origin) return;
      destino.search = "";
      const submitter = (event.nativeEvent as SubmitEvent).submitter;
      for (const [nome, valor] of new FormData(form, submitter)) {
        destino.searchParams.append(nome, typeof valor === "string" ? valor : valor.name);
      }
      destinoNavegacao.current = `${destino.pathname}${destino.search}${destino.hash}`;
      setAviso("rascunho");
    }}
    onClickCapture={event => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (dialogo.current?.querySelector('form[aria-busy="true"]')) { event.preventDefault(); setAviso("pendente"); }
      else if (dialogo.current?.querySelector('form[data-alterado="true"]')) {
        event.preventDefault(); destinoNavegacao.current = link.getAttribute("href")!; setAviso("rascunho");
      }
    }}>
    <header className="janela-financeira-cabecalho">
      <div className="min-w-0"><p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-oliva-escura">Resolver nesta tela</p><h2 id="titulo-janela-financeira" ref={tituloRef} tabIndex={-1} className="text-lg font-bold outline-none">{titulo}</h2><p className="mt-1 text-xs text-tinta-suave">Sua lista e seus filtros permanecem ao fundo.</p></div>
      <button type="button" aria-label="Fechar janela e voltar à lista" disabled={fechando} onClick={() => fechar()} className="shrink-0 rounded-lg border border-contorno bg-carta px-3 py-2 text-sm font-semibold hover:bg-slate-50">{fechando ? "Fechando…" : "Fechar ×"}</button>
    </header>
    <div ref={conteudoRef} className="janela-financeira-conteudo">{children}</div>
    {aviso && <footer className="janela-financeira-rodape">
      <p role="alert" className="text-sm">{aviso === "pendente" ? "Aguarde a conclusão do envio antes de fechar." : "Há uma justificativa ou alteração ainda não enviada. Deseja continuar editando?"}</p>
      <div className="mt-3 flex flex-wrap gap-3"><button type="button" onClick={() => setAviso(null)} className="rounded-lg border border-contorno px-3 py-2 text-sm font-semibold">Continuar nesta janela</button>{aviso === "rascunho" && <button type="button" onClick={() => {
        if (dialogo.current?.querySelector('form[aria-busy="true"]')) { setAviso("pendente"); return; }
        dialogo.current?.querySelectorAll<HTMLFormElement>('form[data-alterado="true"]').forEach(form => { form.reset(); form.dataset.alterado = "false"; });
        setAviso(null); navegar(() => router.replace(destinoNavegacao.current, { scroll: false }));
      }} className="rounded-lg px-3 py-2 text-sm font-semibold text-erro">Descartar rascunho e continuar</button>}</div>
    </footer>}
  </dialog>;
}
