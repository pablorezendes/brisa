export const TIPOS_GOVERNANCA = ["PESSOA", "LOCATARIO", "UNIDADE", "EMPREENDIMENTO", "IMOVEL_LEGADO", "CAIXA", "TITULO", "CONTA"] as const;
export type TipoGovernanca = typeof TIPOS_GOVERNANCA[number];
export const ROTULOS_GOVERNANCA: Record<TipoGovernanca, string> = {
  PESSOA: "Pessoa / empresa (legado)", LOCATARIO: "Inquilino", UNIDADE: "Imóvel", EMPREENDIMENTO: "Empreendimento",
  IMOVEL_LEGADO: "Imóvel legado", CAIXA: "Lançamento de caixa", TITULO: "Título financeiro", CONTA: "Conta bancária",
};
export class ErroGovernanca extends Error {
  constructor(public codigo: string, mensagem: string) { super(mensagem); this.name = "ErroGovernanca"; }
}
export type AtorGovernanca = { id: string; administrador: boolean; assinaturaPrevia?: string };
export function validarIdentidade(tipo: string, id: string): asserts tipo is TipoGovernanca {
  if (!(TIPOS_GOVERNANCA as readonly string[]).includes(tipo) || !id || id.length > 250) throw new ErroGovernanca("IDENTIDADE_INVALIDA", "Selecione um registro válido.");
}
