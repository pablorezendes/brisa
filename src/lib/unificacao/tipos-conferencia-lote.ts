export type DominioConferenciaLote = "PAGAR" | "RECEBER";
export const LIMITE_CONFERENCIA_LOTE = 100;

export type SelecaoConferenciaLote = { dominio: DominioConferenciaLote; chaves: string[] };
export type ItemPreviaConferenciaLote = {
  chave: string;
  titulo: string;
  valor: number | null;
  pago: number | null;
  aberto: number | null;
  estado: "CONFERIR" | "JA_CONFERIDO" | "BLOQUEADO";
  motivo: string;
};
export type PreviaConferenciaLote = {
  dominio: DominioConferenciaLote;
  assinatura: string;
  itens: ItemPreviaConferenciaLote[];
  resumo: { selecionados: number; conferiveis: number; jaConferidos: number; bloqueados: number };
  impacto: { devido: number; pago: number; aberto: number };
};
export type EntradaConferenciaLote = SelecaoConferenciaLote & {
  assinatura: string;
  confirmado: boolean;
  justificativa?: string;
};
export type ResultadoConferenciaLote = {
  conferidos: number;
  jaConferidos: number;
  bloqueados: number;
  mensagem: string;
};
