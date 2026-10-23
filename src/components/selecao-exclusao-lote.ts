import { LIMITE_EXCLUSAO_TITULOS, type DominioExclusaoTitulos } from "@/lib/governanca/exclusao-titulos-lote-tipos";

type ItemSelecionavel = { chave: string; dominio: string; exclusao: unknown | null };

/** Selecionar a página nunca significa selecionar registros fora da tela. */
export function chavesExcluiveisNaPagina(itens: ItemSelecionavel[], dominio: DominioExclusaoTitulos): string[] {
  return [...new Set(itens.filter(item => item.exclusao && item.dominio === dominio
    && item.chave.split(":")[1] === dominio && /^(BRISA|WIDESYS):(RECEBER|PAGAR):[^\s:]+$/.test(item.chave)
    && item.chave.length <= 250).map(item => item.chave))].slice(0, LIMITE_EXCLUSAO_TITULOS);
}

export function selecaoVisivel(chaves: string[], permitidas: string[]): string[] {
  const disponiveis = new Set(permitidas);
  return [...new Set(chaves)].filter(chave => disponiveis.has(chave)).slice(0, LIMITE_EXCLUSAO_TITULOS);
}

export function alternarSelecao(chaves: string[], chave: string, permitidas: string[]): string[] {
  const atuais = selecaoVisivel(chaves, permitidas);
  if (!permitidas.includes(chave)) return atuais;
  if (atuais.includes(chave)) return atuais.filter(atual => atual !== chave);
  return [...atuais, chave].slice(0, LIMITE_EXCLUSAO_TITULOS);
}
