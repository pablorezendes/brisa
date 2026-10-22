import type { PrismaClient } from "@prisma/client";
import { carregarDadosFontesUnificacao, derivarFontesUnificacao } from "./fontes";
import { filtrarFontesGovernadas } from "../governanca/filtros";
import { projetarUnificados } from "./reconciliacao";
import type { DecisaoUnificacao } from "./tipos";

/**
 * Lista financeira: preserva todas as fontes do domínio e suas dependências,
 * mas não lê caixa, baixas, parâmetros e cadastros nativos não utilizados.
 * Sem cache entre requisições. A fotografia permanece transacional; a CPU
 * de derivação/reconciliação roda após liberar a conexão de leitura.
 * Detalhes, workers, reanálise e relatórios gerais continuam na leitura completa.
 */
export async function lerListaFinanceira(db: PrismaClient, dominio: "RECEBER" | "PAGAR") {
  const [dados, decisoes, governados] = await db.$transaction(tx => Promise.all([
    carregarDadosFontesUnificacao(tx, dominio),
    tx.unificacaoRegistro.findMany({ where: { dominio } }),
    tx.recursoGovernado.findMany({ where: { tipo: "TITULO" }, select: { tipo: true, origemId: true, status: true } }),
  ]), { maxWait: 2000, timeout: 60000 });
  const fontes = filtrarFontesGovernadas((await derivarFontesUnificacao(dados)).filter(f => f.dominio === dominio), governados);
  return { fontes, decisoes, linhas: projetarUnificados(fontes, decisoes as DecisaoUnificacao[]) };
}
