import { chavesRestritasUnificacao } from "./privacidade";
import { projetarUnificados } from "./reconciliacao";
import type { DecisaoUnificacao, DominioUnificacao, FonteUnificacao, LinhaUnificada } from "./tipos";

const DOMINIOS_FINANCEIROS = new Set<DominioUnificacao>(["RECEBER", "PAGAR", "MOVIMENTO", "BAIXA_RECEBER", "BAIXA_PAGAR"]);

export function dominioFinanceiroUnificacao(dominio: string): boolean {
  return DOMINIOS_FINANCEIROS.has(dominio as DominioUnificacao);
}

/** A captura vigente é a referência dos fatos financeiros. O importador
 * atualiza o registro pela identidade externa, inclusive quando o valor muda.
 * Decisões de cruzamento das cargas anteriores ficam no histórico. */
export function projetarFinanceiroWidesys(fontes: FonteUnificacao[], decisoes: DecisaoUnificacao[]) {
  const restritas = chavesRestritasUnificacao(fontes, decisoes);
  const financeiras = fontes.filter(f => dominioFinanceiroUnificacao(f.dominio) && f.origem === "WIDESYS")
    .map(f => restritas.has(f.chave) && !f.restrito ? { ...f, restrito: true } : f);
  const cadastros = fontes.filter(f => !dominioFinanceiroUnificacao(f.dominio));
  const linhas = projetarUnificados(cadastros, decisoes.filter(d => !dominioFinanceiroUnificacao(d.dominio)));
  const porChave = new Map(decisoes.map(d => [d.chave, d]));
  for (const f of financeiras) {
    const estado: LinhaUnificada["estado"] = f.qualidade === "OK" ? "ATIVO" : f.qualidade;
    const conferidoNaOrigem = estado === "ATIVO";
    const contabiliza = conferidoNaOrigem && !f.cancelado && !f.informativo;
    linhas.push({
      ...f,
      estado,
      origens: ["WIDESYS"],
      fontes: [f.chave],
      versao: porChave.get(f.chave)?.versao ?? 0,
      candidatos: [],
      avisos: conferidoNaOrigem ? ["WIDESYS_CONFERIDO_NA_ORIGEM"] : [],
      contabiliza,
      conferidoNaOrigem,
      conferidoPorRegra: contabiliza,
      divergencias: [],
    });
  }
  return { fontes: [...cadastros, ...financeiras], linhas };
}
