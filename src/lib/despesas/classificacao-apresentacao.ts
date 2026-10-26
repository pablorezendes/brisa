import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { FonteUnificacao } from "../unificacao/tipos";
import { categoriaDespesa } from "./categorias";

type Referencia = Pick<FonteUnificacao, "chave" | "dominio" | "origem">;
type ClassificacaoApresentacao = { categoria: string; responsavel: string };

/** Recebe somente registros já autorizados e paginados. A classificação local
 * é apresentação: não substitui a fonte financeira nem participa de seu hash.
 */
export async function carregarClassificacoesApresentacao(
  db: Pick<PrismaClient, "despesaDocumento">,
  registros: readonly Referencia[],
  perfil: string,
): Promise<Map<string, ClassificacaoApresentacao>> {
  const chaves = [...new Set(registros.filter(registro => registro.dominio === "PAGAR" && registro.origem === "WIDESYS"
    && /^WIDESYS:PAGAR:[^\s:]+$/.test(registro.chave)).map(registro => registro.chave))];
  const resultado = new Map<string, ClassificacaoApresentacao>();
  if (!chaves.length || !["ADMINISTRADOR", "FINANCEIRO"].includes(perfil)) return resultado;
  const documentos = await db.despesaDocumento.findMany({
    where: { origemChave: { in: chaves }, categoriaCodigo: { not: null }, ...(perfil === "ADMINISTRADOR" ? {} : { restrita: false }) },
    select: { origemChave: true, categoriaCodigo: true, categoriaRotulo: true, destinoCusto: true, restrita: true },
  });
  const autorizadas = new Set(chaves);
  for (const documento of documentos) {
    const categoria = categoriaDespesa(documento.categoriaCodigo);
    const rotulo = documento.categoriaRotulo ?? categoria?.rotulo;
    if (!documento.origemChave || !autorizadas.has(documento.origemChave) || !rotulo
      || (perfil !== "ADMINISTRADOR" && (documento.restrita || categoria?.restrita))) continue;
    const responsavel = documento.destinoCusto === "ADMINISTRADORA" ? "Administradora"
      : documento.destinoCusto === "EMPREENDIMENTOS" ? "Empreendimentos" : null;
    if (responsavel) resultado.set(documento.origemChave, { categoria: rotulo, responsavel });
  }
  return resultado;
}

export function apresentarClassificacaoDespesa<T extends FonteUnificacao>(
  registro: T,
  classificacoes: ReadonlyMap<string, ClassificacaoApresentacao>,
): T {
  const classificacao = classificacoes.get(registro.chave);
  if (!classificacao) return registro;
  return {
    ...registro,
    descricao: [`Categoria no Brisa: ${classificacao.categoria}`, `Custo no Brisa: ${classificacao.responsavel}`, registro.descricao].filter(Boolean).join(" · "),
    campos: {
      ...registro.campos,
      categoriaBrisa: { rotulo: "Categoria informada no Brisa", valor: classificacao.categoria, tipo: "texto" },
      responsavelCustoBrisa: { rotulo: "Responsável pelo custo informado no Brisa", valor: classificacao.responsavel, tipo: "texto" },
    },
  };
}
