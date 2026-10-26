import { LIMITE_CONFERENCIA_LOTE, type DominioConferenciaLote } from "@/lib/unificacao/tipos-conferencia-lote";

/** A seleção não decide elegibilidade; a prévia autorizada explica os bloqueios. */
export function chavesConferenciaNaPagina(itens: Array<{ chave: string; dominio: string }>, dominio: DominioConferenciaLote): string[] {
  return [...new Set(itens.filter(item => item.dominio === dominio && item.chave.split(":")[1] === dominio
    && /^(BRISA|WIDESYS):(RECEBER|PAGAR):[^\s:]{1,150}$/.test(item.chave)).map(item => item.chave))].slice(0, LIMITE_CONFERENCIA_LOTE);
}
