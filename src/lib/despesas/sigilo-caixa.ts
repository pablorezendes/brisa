import type { Prisma } from "@prisma/client";

/** O pagamento único não deve revelar a nota reservada por outra tela.
 * Aplica a restrição no SQL, antes de listar, agregar ou editar valores.
 * Não altera a classificação de lançamentos antigos sem vínculo com nota.
 */
export function filtroCaixaDespesasRestritas(perfil: string): Prisma.LancamentoCaixaWhereInput {
  if (perfil === "ADMINISTRADOR") return {};
  return { OR: [{ despesaDocumento: { is: null } }, { despesaDocumento: { is: { restrita: false } } }] };
}
