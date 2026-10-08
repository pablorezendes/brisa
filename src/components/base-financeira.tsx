/** Explica o universo sem expor valores nem confundir aceitação com auditoria. */
export function BaseFinanceira({ tipo }: { tipo: "locacao" | "livro" | "executivo" }) {
  return <aside className="mb-5 rounded-xl border border-contorno bg-white/70 px-4 py-3 text-xs leading-relaxed text-tinta-suave" aria-label="Base dos indicadores">
    <strong className="text-tinta">{tipo === "livro" ? "Livro-caixa original do Brisa" : tipo === "locacao" ? "Base de locações do Brisa" : "Base de gestão do Brisa"}.</strong>{" "}
    Inclui cargas de planilhas e alterações da operação. Não representa toda a movimentação importada do Widesys.
    Pendências de unificação não são uma conciliação concluída; cópias confirmadas e exclusões respeitam as regras de apuração e fechamento.
  </aside>;
}
