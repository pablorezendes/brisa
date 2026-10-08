import type { EstadoUnificacao, LinhaUnificada } from "@/lib/unificacao/tipos";
import { ROTULOS_ORIGEM_DADOS, origensDoRegistro, type OrigemDados } from "@/lib/unificacao/origens";
import { Badge } from "@/components/ui";

/** Apresentação pura: não importa sessão, banco nem política de autorização. */
export const ESTADOS_UNIFICACAO: Record<EstadoUnificacao, string> = {
  ATIVO: "Disponível / incluído", PENDENTE: "Aguardando conferência", VINCULADO: "Vinculado ao principal", QUARENTENA: "Dado inconsistente", REVISAR: "Revisar decisão", AUSENTE: "Ausente na origem",
};

export function EstadoUnificado({ item }: { item: Pick<LinhaUnificada, "estado"> & Partial<Pick<LinhaUnificada, "contabiliza" | "dominio">> }) {
  const rotulo = item.estado === "ATIVO" ? item.contabiliza && ["RECEBER", "PAGAR", "MOVIMENTO"].includes(item.dominio ?? "") ? "Incluído nos totais" : "Disponível" : ESTADOS_UNIFICACAO[item.estado];
  return <Badge nivel={item.estado === "ATIVO" ? "neutro" : item.estado === "VINCULADO" ? "info" : item.estado === "QUARENTENA" ? "critico" : "atencao"}>{rotulo}</Badge>;
}

export function OrigensUnificadas({ origens }: { origens: string[] }) {
  return <span className="flex flex-wrap gap-1" aria-label="Origem dos dados">{origensDoRegistro({ origem: "BRISA", origens }).map((origem: OrigemDados) => <Badge key={origem} nivel={origem === "WIDESYS" ? "info" : "neutro"}>{ROTULOS_ORIGEM_DADOS[origem]}</Badge>)}</span>;
}
