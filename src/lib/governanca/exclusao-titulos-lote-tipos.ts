/** DTOs sem dependências de servidor; nenhuma fotografia financeira bruta vai ao cliente. */
export const LIMITE_EXCLUSAO_TITULOS = 100;
export type DominioExclusaoTitulos = "RECEBER" | "PAGAR";
export type ItemPreviaExclusaoTitulo = {
  chave: string;
  nome: string;
  referencia: string | null;
  valor: number | null;
  status: string;
  assinatura: string;
  vinculos: { pagamentos: number; boletos: number; baixas: number };
};
export type PreviaExclusaoTitulos = {
  dominio: DominioExclusaoTitulos;
  itens: ItemPreviaExclusaoTitulo[];
  total: number;
};
export type ItemConfirmacaoExclusaoTitulo = { chave: string; assinatura: string };
export type ResultadoExclusaoTitulos =
  | { estado: "PRONTO"; previa: PreviaExclusaoTitulos }
  | { estado: "CONCLUIDO"; excluidos: string[]; jaExcluidos: string[]; mensagem: string }
  | { estado: "ERRO"; mensagem: string; codigo: string };
