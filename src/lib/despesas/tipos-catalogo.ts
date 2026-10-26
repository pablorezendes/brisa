export type CategoriaDespesaCatalogo = {
  codigo: string;
  rotulo: string;
  restrita: boolean;
  ativa: boolean;
  versao: number;
  padrao: boolean;
  podeCorrigirSigiloHonorarios?: boolean;
};

export type SalvarCategoriaDespesaEntrada = {
  codigo?: string;
  rotulo: string;
  ativa: boolean;
  restrita: boolean;
  versao?: number;
  confirmarCorrecaoSigilo?: boolean;
};
