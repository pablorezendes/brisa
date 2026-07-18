"use client";

/** Exclusão com confirmação nativa (confirm) antes de disparar a server action. */
import { excluirLancamento } from "./actions";

export function BotaoExcluir({ id, resumo }: { id: string; resumo: string }) {
  return (
    <form
      action={excluirLancamento}
      className="inline"
      onSubmit={(e) => {
        if (!confirm(`Excluir o lançamento "${resumo}"?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="text-xs font-medium text-red-600 hover:underline"
        title="Excluir lançamento"
      >
        Excluir
      </button>
    </form>
  );
}
