import { hashFonteCorresponde } from "./hashes";
import type { CandidatoUnificacao, DecisaoUnificacao, FonteUnificacao } from "./tipos";

export const DECISAO_VALOR_DIFERENTE = "REGRA_VALOR_DIFERENTE";
export const MOTIVO_VALORES_DIFERENTES = "VALORES_DIFERENTES_CONFIRMADOS";

/** A regra usa o valor integral do título em centavos, nunca pago ou saldo. */
export function valorDevidoConhecido(valor: FonteUnificacao["valor"]): valor is number {
  return typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 0;
}

export function valoresDevidosDiferentes(a: FonteUnificacao, b: FonteUnificacao): boolean {
  return (a.dominio === "PAGAR" || a.dominio === "RECEBER") && a.dominio === b.dominio
    && valorDevidoConhecido(a.valor) && valorDevidoConhecido(b.valor) && a.valor !== b.valor;
}

const MOTIVOS_AUTOMATICOS_SUPERADOS = new Set([
  "POSSIVEL_DUPLICIDADE", "POSSIVEL_DUPLICIDADE_INTERNA", "POSSIVEIS_CORRESPONDENCIAS",
  "PERIODO_JA_EXISTE_NA_PLANILHA", "SEM_CORRESPONDENCIA_ENCONTRADA", "ANALISE_NECESSARIA",
]);

export type EvidenciaValoresDiferentes = { comparados: Array<{ chave: string; hash: string; valor: number }> };

/**
 * Prova somente a revisão autorizada por valores diferentes. Recebe a mesma
 * fotografia/indexação de candidatosPara; não grava, cria títulos ou dá baixa.
 * Decisões humanas, vínculos e alterações posteriores nunca são sobrescritos.
 */
export function avaliarRegraValoresDiferentes({ fonte, fontesComparaveis, candidatosAtuais, destinos, anterior }: {
  fonte: FonteUnificacao;
  fontesComparaveis: FonteUnificacao[];
  candidatosAtuais: CandidatoUnificacao[];
  destinos: ReadonlyMap<string, string>;
  anterior?: DecisaoUnificacao;
}): EvidenciaValoresDiferentes | null {
  if ((fonte.dominio !== "PAGAR" && fonte.dominio !== "RECEBER") || fonte.qualidade !== "OK"
    || fonte.cancelado || fonte.informativo || fonte.vinculoExplicito || fonte.motivos.length
    || !fonte.competencia || !valorDevidoConhecido(fonte.valor) || candidatosAtuais.length) return null;
  if (anterior) {
    if (anterior.decisao !== "AUTOMATICA" || !["ATIVO", "PENDENTE"].includes(anterior.status)
      || anterior.destinoChave || !hashFonteCorresponde(fonte, anterior.hashFonte)) return null;
    try {
      const motivos: unknown = JSON.parse(anterior.motivos);
      if (!Array.isArray(motivos) || motivos.some(m => !MOTIVOS_AUTOMATICOS_SUPERADOS.has(m))) return null;
    } catch { return null; }
  }
  const destino = (chave: string) => destinos.get(chave) ?? chave;
  const comparados = new Map<string, EvidenciaValoresDiferentes["comparados"][number]>();
  for (const outra of fontesComparaveis) {
    if (outra.chave === fonte.chave || outra.dominio !== fonte.dominio || outra.qualidade !== "OK"
      || outra.cancelado || outra.informativo || outra.competencia !== fonte.competencia) continue;
    const mesmoVinculo = (["pessoaChave", "imovelChave", "contratoChave"] as const).some(campo => {
      const a = fonte[campo], b = outra[campo];
      return !!a && !!b && destino(a) === destino(b);
    });
    if (!mesmoVinculo) continue;
    // A defesa também vale se um chamador fornecer candidatos incompletos.
    if (!valoresDevidosDiferentes(fonte, outra)) return null;
    comparados.set(outra.chave, { chave: outra.chave, hash: outra.hash, valor: outra.valor! });
  }
  return comparados.size ? { comparados: [...comparados.values()].sort((a, b) => a.chave.localeCompare(b.chave)) } : null;
}
