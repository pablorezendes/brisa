import type { EstadoUnificacao } from "./tipos";

export type DominioRevisaoFinanceira = "PAGAR" | "RECEBER";
export type ResumoRevisaoFinanceira = {
  chave: string; hash: string; titulo: string; descricao: string; origem: string;
  competencia: string | null; data: string | null; valor: number; pago: number; aberto: number;
};
export type RevisaoFinanceira = {
  chave: string; dominio: DominioRevisaoFinanceira; estado: EstadoUnificacao;
  pendente: boolean; podeConcluir: boolean; conferidoManualmente: boolean;
  motivo: string; versao: number; hashFonte: string; assinatura: string;
  incluidoNosTotais: boolean; candidatosIndisponiveis: number;
  registro: ResumoRevisaoFinanceira; candidatos: ResumoRevisaoFinanceira[];
};
export type ConcluirRevisaoFinanceiraEntrada = {
  chave: string; versao: number; hashFonte: string; assinatura: string;
  acao: "DISTINTO" | "VINCULAR"; destinoChave?: string; hashDestino?: string; justificativa: string;
};
