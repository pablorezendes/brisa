import type { EstadoUnificacao, LinhaUnificada } from "@/lib/unificacao/tipos";
import { ROTULOS_ORIGEM_DADOS, origensDoRegistro, type OrigemDados } from "@/lib/unificacao/origens";
import { Badge } from "@/components/ui";

/** Apresentação pura: não importa sessão, banco nem política de autorização. */
export const ESTADOS_UNIFICACAO: Record<EstadoUnificacao, string> = {
  ATIVO: "Disponível / incluído", PENDENTE: "Aguardando conferência", VINCULADO: "Vinculado ao principal", QUARENTENA: "Dado inconsistente", REVISAR: "Revisar decisão", AUSENTE: "Ausente na origem",
};

export function registroConferido(item: Pick<LinhaUnificada, "estado" | "conferidoManualmente" | "conferidoPorRegra">) {
  return (!!item.conferidoManualmente && ["ATIVO", "VINCULADO"].includes(item.estado))
    || (!!item.conferidoPorRegra && item.estado === "ATIVO");
}

export function EstadoUnificado({ item }: { item: Pick<LinhaUnificada, "estado"> & Partial<Pick<LinhaUnificada, "contabiliza" | "dominio" | "conferidoManualmente" | "conferidoPorRegra" | "conferidoNaOrigem" | "cancelado" | "informativo">> }) {
  const conferido = registroConferido(item) && (!item.conferidoNaOrigem || item.conferidoManualmente);
  if (item.estado === "ATIVO") {
    if (item.cancelado) return <Badge nivel="neutro">Cancelado</Badge>;
    if (conferido) return <Badge nivel="otimo">{item.informativo ? "Conferido · informativo" : "Conferido"}</Badge>;
    if (item.informativo) return <Badge nivel="neutro">Somente consulta</Badge>;
    const somaValores = item.contabiliza && ["RECEBER", "PAGAR", "MOVIMENTO"].includes(item.dominio ?? "");
    return <Badge nivel="neutro">{somaValores
      ? item.conferidoNaOrigem ? "Incluído nos totais" : "Incluído automaticamente"
      : "Disponível"}</Badge>;
  }
  if (item.estado === "VINCULADO" && conferido) return <Badge nivel="otimo">Conferido · vinculado</Badge>;
  const rotulo = item.conferidoNaOrigem && ["PENDENTE", "REVISAR"].includes(item.estado)
    ? "Vínculo a revisar"
    : ESTADOS_UNIFICACAO[item.estado];
  return <Badge nivel={item.estado === "VINCULADO" ? "info" : item.estado === "QUARENTENA" ? "critico" : "atencao"}>{rotulo}</Badge>;
}

export function OrigensUnificadas({ origens }: { origens: string[] }) {
  return <span className="flex flex-wrap gap-1" aria-label="Origem dos dados">{origensDoRegistro({ origem: "BRISA", origens }).map((origem: OrigemDados) => <Badge key={origem} nivel={origem === "WIDESYS" ? "info" : "neutro"}>{ROTULOS_ORIGEM_DADOS[origem]}</Badge>)}</span>;
}
