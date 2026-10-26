export type FornecedorResumo = { id: string; nome: string; cpfCnpj: string | null; origem: string; ativo: boolean };
export type FornecedorCadastro = FornecedorResumo & { email: string | null; telefone: string | null; atualizadoEm: string; editavel: boolean };
export type SalvarFornecedorEntrada = {
  requestId: string; id?: string; atualizadoEm?: string;
  nome: string; cpfCnpj?: string | null; email?: string | null; telefone?: string | null;
};
export type FiltrosFornecedores = { termo?: string; pagina?: number; situacao?: "ATIVOS" | "INATIVOS" | "TODOS" };
export type ListaFornecedores = { itens: FornecedorCadastro[]; total: number; pagina: number; paginas: number; permiteEditar: boolean };
export class ErroFornecedor extends Error {
  constructor(public codigo: string, mensagem: string, public existentes: FornecedorResumo[] = []) { super(mensagem); this.name = "ErroFornecedor"; }
}
