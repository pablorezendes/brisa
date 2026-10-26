import type { EstadoUnificacao } from "../unificacao/tipos";

export type ResumoRevisaoDespesa = {
  chave: string; hash: string; titulo: string; descricao: string; origem: string;
  competencia: string | null; data: string | null; valor: number; pago: number; aberto: number;
};
export type RevisaoDespesa = {
  chave: string; estado: EstadoUnificacao; pendente: boolean; podeConcluir: boolean;
  motivo: string; versao: number; hashFonte: string; assinatura: string;
  incluidoNosTotais: boolean; candidatosIndisponiveis: number;
  registro: ResumoRevisaoDespesa; candidatos: ResumoRevisaoDespesa[];
};
export type ConcluirRevisaoDespesaEntrada = {
  chave: string; versao: number; hashFonte: string; assinatura: string;
  acao: "DISTINTO" | "VINCULAR"; destinoChave?: string; hashDestino?: string; justificativa: string;
};
