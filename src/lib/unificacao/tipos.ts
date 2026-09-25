export const DOMINIOS_UNIFICACAO = ["PESSOA", "IMOVEL", "CONTRATO", "RECEBER", "PAGAR", "BAIXA_RECEBER", "BAIXA_PAGAR", "MOVIMENTO", "PARAMETRO"] as const;
export type DominioUnificacao = typeof DOMINIOS_UNIFICACAO[number];
export type EstadoUnificacao = "ATIVO" | "PENDENTE" | "VINCULADO" | "QUARENTENA" | "REVISAR" | "AUSENTE";
export const ROTULOS_DOMINIO: Record<DominioUnificacao, string> = {
  PESSOA: "Pessoas", IMOVEL: "Imóveis", CONTRATO: "Contratos", RECEBER: "Contas a receber", PAGAR: "Contas a pagar",
  BAIXA_RECEBER: "Recebimentos detalhados", BAIXA_PAGAR: "Pagamentos detalhados", MOVIMENTO: "Movimentações", PARAMETRO: "Parâmetros",
};
export type CampoFonte = { rotulo: string; valor: string | number | null; tipo?: "dinheiro" | "documento" | "texto" };
export type FonteUnificacao = {
  chave: string; dominio: DominioUnificacao; origem: "BRISA" | "WIDESYS"; origemId: string;
  titulo: string; descricao: string; href: string | null; hash: string;
  qualidade: "OK" | "QUARENTENA" | "AUSENTE";
  motivos: string[]; campos: Record<string, CampoFonte>;
  nomeNorm: string; documento?: string | null; pessoaChave?: string | null; imovelChave?: string | null;
  contratoChave?: string | null; tituloChave?: string | null; vinculoExplicito?: string | null;
  competencia?: string | null; data?: string | null; vencimento?: string | null;
  valor?: number | null; pago?: number | null; aberto?: number | null; natureza?: string | null;
  cancelado?: boolean; informativo?: boolean; papeis?: string[];
  proveniencia?: Record<string, unknown>;
};
export type CandidatoUnificacao = { chave: string; motivos: string[] };
export type DecisaoUnificacao = {
  chave: string; dominio: string; origem: string; origemId: string; status: string;
  destinoChave: string | null; hashFonte: string; hashDestino: string | null;
  candidatos: string; motivos: string; proveniencia: string; decisao: string; versao: number;
};
export type LinhaUnificada = FonteUnificacao & {
  estado: EstadoUnificacao; origens: string[]; fontes: string[]; versao: number;
  candidatos: Array<CandidatoUnificacao & { titulo: string; descricao: string }>;
  avisos: string[]; contabiliza: boolean; divergencias: string[];
};
export type FiltrosUnificacao = {
  dominio?: string; estado?: string; q?: string; pagina?: number; porPagina?: number;
  mes?: string; de?: string; ate?: string; vencidos?: boolean; papel?: string;
};
export type ListaUnificada = {
  itens: LinhaUnificada[]; total: number; pagina: number; paginas: number; porPagina: number;
  resumo: { ativos: number; pendentes: number; vinculados: number; quarentena: number; devido: number; pago: number; aberto: number; devidoPendente: number; pagoPendente: number; abertoPendente: number; entradas: number; saidas: number; vencidos: number; valorVencido: number };
  sincronizado: boolean;
};
