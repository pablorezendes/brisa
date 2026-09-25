/** Única política para menu, página e exportação de comissões. */
export const PERFIS_COMISSOES: readonly string[] = ["ADMINISTRADOR"];

export function perfilPodeVerComissoes(perfil: string): boolean {
  return PERFIS_COMISSOES.includes(perfil);
}
