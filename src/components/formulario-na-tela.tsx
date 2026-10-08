"use client";

import { startTransition, useActionState, useEffect, useRef, type ReactNode } from "react";
import type { ResultadoNaTela } from "@/lib/interface/resultado-na-tela";

/** Mantém os campos e o contexto da lista, inclusive quando a validação falha. */
export function FormularioNaTela({ action, children, className }: {
  action: (estado: ResultadoNaTela, form: FormData) => Promise<ResultadoNaTela>;
  children: ReactNode;
  className?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const avisoRef = useRef<HTMLDivElement>(null);
  const enviando = useRef(false);
  const [resultado, enviar, pendente] = useActionState(async (estado: ResultadoNaTela, dados: FormData) => {
    try { return await action(estado, dados); }
    catch { return { erro: "Não foi possível concluir. Confira seu acesso e tente novamente; em caso de dúvida, atualize a consulta antes de repetir." }; }
    finally { enviando.current = false; }
  }, {});
  useEffect(() => {
    if (resultado.ok && formRef.current) formRef.current.dataset.alterado = "false";
    if (resultado.erro || resultado.ok) avisoRef.current?.focus({ preventScroll: true });
  }, [resultado]);
  return <form ref={formRef} action={enviar} className={className} aria-busy={pendente} data-operacao="contextual"
    onInput={() => { if (formRef.current) formRef.current.dataset.alterado = "true"; }}
    onSubmit={event => {
      event.preventDefault();
      if (enviando.current || pendente) return;
      const submitter = (event.nativeEvent as SubmitEvent).submitter;
      const dados = new FormData(event.currentTarget, submitter);
      enviando.current = true;
      startTransition(() => enviar(dados));
    }}>
    {(resultado.erro || resultado.ok) && <div ref={avisoRef} tabIndex={-1} role={resultado.erro ? "alert" : "status"} className={`mb-4 rounded-lg border p-3 text-sm ${resultado.erro ? "border-red-200 bg-red-50 text-red-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>{resultado.erro ?? resultado.ok}</div>}
    <fieldset disabled={pendente} className="min-w-0 space-y-3 disabled:opacity-60">{children}</fieldset>
    {pendente && <p role="status" className="mt-3 text-sm font-semibold text-oliva-escura">Salvando decisão… Aguarde a confirmação.</p>}
  </form>;
}
