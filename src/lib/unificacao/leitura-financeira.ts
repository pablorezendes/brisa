import type { PrismaClient } from "@prisma/client";
import { carregarDadosFontesUnificacao, derivarFontesUnificacao } from "./fontes";
import { filtrarFontesGovernadas } from "../governanca/filtros";
import { projetarUnificados } from "./reconciliacao";
import type { DecisaoUnificacao } from "./tipos";
import { projetarFinanceiroWidesys } from "./projecao-widesys";

/**
 * Lista financeira: preserva todas as fontes do domínio e suas dependências,
 * mas não lê caixa inteiro, baixas, parâmetros e cadastros nativos não utilizados.
 * Em PAGAR, lê somente a saída vinculada a cada nota nativa para conferir o
 * pagamento único, sem carregar as parcelas de rateio nem somá-las ao título.
 * Sem cache entre requisições. A fotografia permanece transacional; a CPU
 * de derivação/reconciliação roda após liberar a conexão de leitura.
 * Detalhes, workers, reanálise e relatórios gerais continuam na leitura completa.
 */
export async function lerListaFinanceira(db: PrismaClient, dominio: "RECEBER" | "PAGAR", opcoes?: { somenteWidesysFinanceiro?: boolean }) {
  const [dados, decisoes, governados] = await db.$transaction(tx => Promise.all([
    carregarDadosFontesUnificacao(tx, dominio),
    tx.unificacaoRegistro.findMany({ where: { dominio } }),
    tx.recursoGovernado.findMany({ where: { tipo: "TITULO" }, select: { tipo: true, origemId: true, status: true } }),
  ]), { maxWait: 2000, timeout: 60000 });
  const fontes = filtrarFontesGovernadas((await derivarFontesUnificacao(dados, !opcoes?.somenteWidesysFinanceiro)).filter(f => f.dominio === dominio), governados);
  if (opcoes?.somenteWidesysFinanceiro) return { decisoes, ...projetarFinanceiroWidesys(fontes, decisoes) };
  return { fontes, decisoes, linhas: projetarUnificados(fontes, decisoes as DecisaoUnificacao[]) };
}
