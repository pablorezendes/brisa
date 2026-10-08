import type { LinhaUnificada } from "@/lib/unificacao/tipos";

type Situacao = Pick<LinhaUnificada, "estado" | "contabiliza" | "dominio" | "cancelado" | "informativo">;

/** Origem responde de onde veio; esta mensagem responde o efeito da decisão. */
export function explicarConsolidacao(item: Situacao): string {
  if (item.estado === "VINCULADO") return "Representado pelo registro principal. Não soma novamente.";
  if (item.estado === "QUARENTENA") return "Dados inconsistentes: confira a origem. Fora dos totais.";
  if (item.estado === "REVISAR") return "A decisão precisa de nova conferência. Fora dos totais.";
  if (item.estado === "AUSENTE") return "Ausente na captura atual. Fora dos totais.";
  if (item.estado === "PENDENTE") return "Aguardando conferência: verifique possíveis correspondências antes de incluir. Fora dos totais.";
  if (item.cancelado) return "Registro cancelado. Não entra nos totais.";
  if (item.informativo || !item.contabiliza) return "Disponível para consulta. Não soma valores novamente.";
  return ["RECEBER", "PAGAR", "MOVIMENTO"].includes(item.dominio)
    ? "Incluído nos totais. Isso não significa conferência manual concluída."
    : "Cadastro disponível na operação. A origem permanece identificada.";
}

export function ImpactoConsolidacao({ item, className = "" }: { item: Situacao; className?: string }) {
  return <p className={`text-xs leading-relaxed text-tinta-suave ${className}`}>{explicarConsolidacao(item)}</p>;
}
