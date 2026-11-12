"use client";

import Link from "next/link";
import { startTransition, useActionState, type ReactNode } from "react";
import { btnPrimario, btnSecundario } from "@/components/ui";

type Estado = { erro?: string };

export function FormularioLancamentoManual({ acao, cancelar, rotuloEnvio = "Salvar lançamento", children }: {
  acao: (estado: Estado, dados: FormData) => Promise<Estado>;
  cancelar: string;
  rotuloEnvio?: string;
  children: ReactNode;
}) {
  const [estado, enviar, pendente] = useActionState(acao, {});

  return (
    <form action={enviar} aria-busy={pendente} onSubmit={evento => {
      evento.preventDefault();
      if (pendente) return;
      const dados = new FormData(evento.currentTarget);
      startTransition(() => enviar(dados));
    }}>
      <fieldset className="space-y-4" disabled={pendente}>
        {children}
        {estado.erro && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-erro">{estado.erro}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button className={btnPrimario} type="submit">{pendente ? "Salvando…" : rotuloEnvio}</button>
          <Link className={btnSecundario} href={cancelar}>Cancelar</Link>
        </div>
      </fieldset>
    </form>
  );
}
