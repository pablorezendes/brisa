import { chavesRestritasUnificacao } from "./privacidade";
import { projetarUnificados } from "./reconciliacao";
import type { DecisaoUnificacao, DominioUnificacao, FonteUnificacao, LinhaUnificada } from "./tipos";

const DOMINIOS_FINANCEIROS = new Set<DominioUnificacao>(["RECEBER", "PAGAR", "MOVIMENTO", "BAIXA_RECEBER", "BAIXA_PAGAR"]);

export function dominioFinanceiroUnificacao(dominio: string): boolean {
  return DOMINIOS_FINANCEIROS.has(dominio as DominioUnificacao);
}

export function integraFinanceiro(fonte: Pick<FonteUnificacao, "origem" | "lancamentoManual">) {
  return fonte.origem === "WIDESYS" || fonte.lancamentoManual === true;
}

/** A captura vigente entra pela identidade externa e os lançamentos manuais
 * entram pela marca atribuída na criação. A carga histórica fica arquivada. */
export function projetarFinanceiroWidesys(fontes: FonteUnificacao[], decisoes: DecisaoUnificacao[]) {
  const restritas = chavesRestritasUnificacao(fontes, decisoes);
  const financeiras = fontes.filter(f => dominioFinanceiroUnificacao(f.dominio) && integraFinanceiro(f))
    .map(f => restritas.has(f.chave) && !f.restrito ? { ...f, restrito: true } : f);
  const cadastros = fontes.filter(f => !dominioFinanceiroUnificacao(f.dominio));
  const linhas = projetarUnificados(cadastros, decisoes.filter(d => !dominioFinanceiroUnificacao(d.dominio)));
  const porChave = new Map(decisoes.map(d => [d.chave, d]));
  for (const f of financeiras) {
    const estado: LinhaUnificada["estado"] = f.qualidade === "OK" ? "ATIVO" : f.qualidade;
    const conferidoNaOrigem = estado === "ATIVO" && f.origem === "WIDESYS";
    const contabiliza = estado === "ATIVO" && !f.cancelado && !f.informativo;
    linhas.push({
      ...f,
      estado,
      origens: [f.origem === "WIDESYS" ? "WIDESYS" : "MANUAL"],
      fontes: [f.chave],
      versao: porChave.get(f.chave)?.versao ?? 0,
      candidatos: [],
      avisos: conferidoNaOrigem ? ["WIDESYS_CONFERIDO_NA_ORIGEM"] : [],
      contabiliza,
      conferidoNaOrigem,
      conferidoPorRegra: conferidoNaOrigem && contabiliza,
      divergencias: [],
    });
  }
  return { fontes: [...cadastros, ...financeiras], linhas };
}
