export type CategoriaDespesa = { codigo: string; rotulo: string; restrita: boolean };

/** Catálogo operacional. Os IDs de origem servem somente para sugerir a
 * classificação de títulos já existentes; não promovem nem recriam registros.
 */
export const CATEGORIAS_DESPESA: readonly CategoriaDespesa[] = [
  { codigo: "GRATIFICACAO_DONATIVOS", rotulo: "Gratificação / Donativos", restrita: false },
  { codigo: "IMPOSTOS", rotulo: "Impostos", restrita: false },
  { codigo: "AQUISICAO", rotulo: "Aquisição", restrita: false },
  { codigo: "DESPESAS_DIVERSAS", rotulo: "Despesas diversas", restrita: false },
  { codigo: "TRANSPORTE", rotulo: "Transporte", restrita: false },
  { codigo: "PROGRAMA_WIDESYS", rotulo: "Programa Widesys", restrita: false },
  { codigo: "SEGURO", rotulo: "Seguro", restrita: false },
  { codigo: "ADMINISTRACAO_COMISSAO", rotulo: "Administração / comissão", restrita: true },
  { codigo: "MANUTENCAO_SERVICOS", rotulo: "Manutenção e serviços", restrita: false },
  { codigo: "OUTRAS", rotulo: "Outras despesas", restrita: false },
];

export const categoriaDespesa = (codigo: string | null | undefined) => CATEGORIAS_DESPESA.find(categoria => categoria.codigo === codigo) ?? null;

const categoriasLegadas: Readonly<Record<string, string>> = {
  "618": "GRATIFICACAO_DONATIVOS", "619": "IMPOSTOS", "620": "AQUISICAO",
  "641": "DESPESAS_DIVERSAS", "623": "TRANSPORTE", "637": "PROGRAMA_WIDESYS", "638": "SEGURO",
};

/** Mapa comprovado pelo catálogo de 16/09/2026. O grupo 333 (Administração
 * BRISA) não representa comissão e não recebe classificação automática.
 */
export const categoriaWidesys = (id: string | null | undefined) => categoriaDespesa(id ? categoriasLegadas[id] : null);
