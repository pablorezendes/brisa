/**
 * DTOs internos da integração com a Cobrança Bancária Sicoob v3.
 *
 * Eles deliberadamente não dependem dos modelos do Prisma. A camada de aplicação
 * é responsável por traduzir ContaBancaria/Recebimento/Boleto para estes tipos.
 */

export type AmbienteSicoob = "sandbox" | "producao";

export type StatusBoletoSicoob =
  | "REGISTRADO"
  | "VENCIDO"
  | "LIQUIDADO"
  | "BAIXADO"
  | "PROTESTADO"
  | "REJEITADO"
  | "CANCELADO"
  | "DESCONHECIDO";

export type StatusWebhookSicoob =
  | "AGUARDANDO_VALIDACAO"
  | "VALIDADO"
  | "INATIVO"
  | "DESCONHECIDO";

export type ContaCobrancaSicoobDTO = {
  /** Número que identifica o contrato do beneficiário no Sisbr. */
  numeroCliente: number;
  /** 1 = simples com registro. */
  codigoModalidade: number;
  /** Conta corrente, apenas dígitos e sem dígito verificador. */
  numeroContaCorrente: number;
  /** Identificador opcional do contrato de cobrança. */
  numeroContratoCobranca?: number;
};

export type PagadorSicoobDTO = {
  numeroCpfCnpj: string;
  nome: string;
  endereco: string;
  bairro: string;
  cidade: string;
  cep: string;
  uf: string;
  email?: string;
};

export type EmitirBoletoSicoobDTO = {
  conta: ContaCobrancaSicoobDTO;
  /** Identificador idempotente do título no Brisa, com no máximo 18 caracteres. */
  seuNumero: string;
  /** Valor nominal persistido como inteiro, evitando float no domínio. */
  valorCentavos: number;
  dataEmissao: string;
  dataVencimento: string;
  pagador: PagadorSicoobDTO;
  identificacaoBoletoEmpresa?: string;
  /** Espécie contratual (por exemplo RC, DS ou DM); não é inferida pela integração. */
  codigoEspecieDocumento: string;
  identificacaoEmissaoBoleto?: 1 | 2;
  identificacaoDistribuicaoBoleto?: 1 | 2;
  numeroParcela?: number;
  aceite?: boolean;
  mensagensInstrucao?: string[];
  gerarPdf?: boolean;
  codigoCadastrarPix?: 0 | 1 | 2;
  dataLimitePagamento?: string;
  politica?: {
    codigoProtesto?: 1 | 2 | 3;
    numeroDiasProtesto?: number;
    codigoNegativacao?: 2 | 3;
    numeroDiasNegativacao?: number;
    tipoDesconto?: 0;
    tipoMulta?: 0;
    tipoJurosMora?: 3;
  };
};

export type ConsultarBoletoSicoobDTO = {
  conta: Pick<
    ContaCobrancaSicoobDTO,
    "numeroCliente" | "codigoModalidade" | "numeroContratoCobranca"
  >;
  nossoNumero?: string;
  linhaDigitavel?: string;
  codigoBarras?: string;
};

export type BoletoSicoobNormalizado = {
  nossoNumero: string | null;
  seuNumero: string | null;
  numeroCliente: number | null;
  numeroContaCorrente: number | null;
  codigoModalidade: number | null;
  numeroContratoCobranca: number | null;
  status: StatusBoletoSicoob;
  situacaoOriginal: string | null;
  valorOriginalCentavos: number | null;
  valorPagoCentavos: number | null;
  dataEmissao: string | null;
  dataVencimento: string | null;
  dataLiquidacao: string | null;
  codigoBarras: string | null;
  linhaDigitavel: string | null;
  qrCode: string | null;
  pdfBase64: string | null;
};

export type RegistrarWebhookBaixaOperacionalSicoobDTO = {
  /** Deve ser HTTPS. Inclua um segredo de alta entropia na rota do callback. */
  url: string;
  email?: string;
};

export type WebhookSicoobRegistrado = {
  idWebhook: string;
  status: StatusWebhookSicoob;
  /** O POST v3 retorna somente o id; confirme o estado posteriormente com GET. */
  statusConfirmado: boolean;
};

export type WebhookSicoobDetalhe = WebhookSicoobRegistrado & {
  url: string;
  codigoSituacao: 1 | 2 | 3;
};

export type IdentificadoresEventoSicoob = {
  nossosNumeros: string[];
  seusNumeros: string[];
  codigosBarras: string[];
  numerosCliente: string[];
  numerosIdentificadorBaixa: string[];
  idsWebhook: string[];
  idsEvento: string[];
};

export type SolicitarLiquidacoesSicoobDTO = {
  numeroCliente: number;
  /** Formato AAAA-MM-DD. A API limita cada solicitação a dois dias. */
  dataInicial: string;
  dataFinal: string;
};

export type SolicitacaoMovimentacaoSicoob = {
  codigoSolicitacao: string;
  mensagem: string | null;
};

export type EstadoMovimentacaoSicoob = {
  pronto: boolean;
  /** HTTP 204: ainda não há arquivo/conteúdo; a orquestração aplica uma janela de espera. */
  semRegistros: boolean;
  quantidadeArquivos: number;
  quantidadeTotalRegistros: number | null;
  idsArquivos: string[];
};

export type BaixarArquivoMovimentacaoSicoobDTO = {
  numeroCliente: number;
  codigoSolicitacao: string;
  idArquivo: string;
};

/**
 * Registro normalizado do movimento 5 (LIQUI). O parser só produz este DTO
 * depois de confirmar o tipo, o beneficiário e os campos mínimos de
 * conciliação; ele nunca converte outro movimento em liquidação.
 */
export type LiquidacaoMovimentacaoSicoob = {
  codigoTipoMovimento: 5;
  siglaMovimento: "LIQUI";
  numeroCliente: number;
  numeroContrato: number;
  codigoModalidade: number;
  numeroTitulo: string;
  seuNumero: string;
  numeroContaCorrente: number;
  valorTituloCentavos: number;
  valorLiquidoCentavos: number;
  valorAbatimentoCentavos: number | null;
  valorDescontoCentavos: number | null;
  valorMoraCentavos: number | null;
  valorTarifaCentavos: number | null;
  dataMovimentoLiquidacao: string;
  dataLiquidacao: string;
  dataPrevisaoCredito: string | null;
  codigoBarras: string | null;
  numeroBancoRecebedor: number | null;
  numeroAgenciaRecebedora: number | null;
  idTipoOperacaoFinanceira: number | null;
  tipoOperacaoFinanceira: string | null;
  tipoCarteiraOperacaoCredito: string | null;
};

export type ArquivoLiquidacoesSicoob = {
  idArquivo: string;
  nomeArquivo: string;
  nomeEntrada: string;
  quantidadeRegistros: number;
  liquidacoes: LiquidacaoMovimentacaoSicoob[];
};
