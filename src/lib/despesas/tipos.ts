export const LIMITE_RATEIOS = 100;
export type TipoDocumentoDespesa = "NOTA_FISCAL" | "BOLETO" | "GUIA" | "RECIBO" | "OUTRO" | "SEM_DOCUMENTO";
export type DestinoCustoDespesa = "ADMINISTRADORA" | "EMPREENDIMENTOS";

export type LinhaRateioEntrada = {
  empreendimentoId: string;
  unidadeId?: string | null;
  descricao: string;
  categoria?: string | null;
  valor: number;
};
export type PagamentoDespesaEntrada =
  | { modo: "MANTER" }
  | { modo: "VINCULAR"; lancamentoCaixaId: string; assinatura: string; via?: string }
  | { modo: "REGISTRAR"; data: string; centroCusto: string; categoria: string; contaBancariaId?: string | null; via: string; observacao?: string };

export type SalvarDespesaEntrada = {
  requestId: string;
  id?: string;
  origemChave?: string | null;
  origemHash?: string | null;
  confirmarFonteAlterada?: boolean;
  versao?: number;
  fornecedorNome: string;
  fornecedorDocumento?: string | null;
  fornecedorPessoaId?: string | null;
  categoriaCodigo?: string | null;
  descricao?: string | null;
  tipoDocumento?: TipoDocumentoDespesa;
  destinoCusto?: DestinoCustoDespesa;
  numero: string;
  serie?: string | null;
  tomadorNome?: string | null;
  tomadorDocumento?: string | null;
  emissao: string;
  competencia: string;
  vencimento?: string | null;
  total: number;
  statusRateio: "RASCUNHO" | "CONFERIDO";
  rateios: LinhaRateioEntrada[];
  pagamento: PagamentoDespesaEntrada;
};

export type DespesaEditor = {
  documento: {
    id?: string;
    origemChave: string | null;
    origemHash: string | null;
    fonteAlterada: boolean;
    versao: number;
    fornecedorNome: string;
    fornecedorDocumento: string | null;
    fornecedorPessoaId?: string | null;
    categoriaCodigo: string | null;
    descricao: string | null;
    tipoDocumento: TipoDocumentoDespesa;
    destinoCusto: DestinoCustoDespesa;
    numero: string;
    serie: string | null;
    tomadorNome: string | null;
    tomadorDocumento: string | null;
    emissao: string;
    competencia: string;
    vencimento: string | null;
    total: number;
    statusRateio: "RASCUNHO" | "CONFERIDO";
    rateios: LinhaRateioEntrada[];
  };
  pagamento: { origem: "NENHUM" | "CAIXA" | "WIDESYS"; valor: number; data: string | null; lancamentoCaixaId: string | null; situacao: string; ativo: boolean };
  empreendimentos: { id: string; nome: string; unidades: { id: string; identificacao: string }[] }[];
  contas: { id: string; apelido: string }[];
  categorias: { codigo: string; rotulo: string; restrita: boolean; ativa?: boolean }[];
  gerenciaCategorias?: boolean;
  permiteCadastrarFornecedor?: boolean;
  permitePagamento: boolean;
  anexos: { id: string; nomeOriginal: string; mimeType: string; tamanho: number }[];
};

export type PagamentoDisponivel = {
  id: string; data: string | null; descricao: string | null; valor: number;
  centroCusto: string; caixaOrigem: string | null; assinatura: string;
};
export type ResultadoSalvarDespesa = { id: string; chave: string; versao: number; repetido: boolean; lancamentoCaixaId: string | null };
export class ErroDespesa extends Error {
  constructor(public readonly codigo: string, mensagem: string) { super(mensagem); this.name = "ErroDespesa"; }
}
