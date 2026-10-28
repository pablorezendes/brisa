import type { CandidatoUnificacao, DecisaoUnificacao, FonteUnificacao } from "./tipos";
import { hashFonteCorresponde } from "./hashes";

export const DECISAO_WIDESYS = "REGRA_WIDESYS_ORIGEM";

/** IDs externos distintos com datas diferentes não são candidatos internos.
 * A política persistida abaixo também confirma a origem dos demais IDs válidos. */
export function registrosDistintosWidesys(a: FonteUnificacao, b: FonteUnificacao) {
  if (a.origem !== "WIDESYS" || b.origem !== "WIDESYS" || a.dominio !== b.dominio || a.origemId === b.origemId) return false;
  const datas = ["PAGAR", "RECEBER"].includes(a.dominio) ? [a.vencimento, b.vencimento]
    : ["MOVIMENTO", "BAIXA_PAGAR", "BAIXA_RECEBER"].includes(a.dominio) ? [a.data, b.data] : [];
  return datas.length === 2 && datas.every(d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) && datas[0] !== datas[1];
}

export function planejarConfiancaWidesys(f: FonteUnificacao, candidatos: CandidatoUnificacao[],
  anterior: DecisaoUnificacao | undefined, periodoReceberBrisa: boolean, decisoes: ReadonlyMap<string, DecisaoUnificacao> = new Map()) {
  if (f.origem !== "WIDESYS" || f.qualidade !== "OK" || f.vinculoExplicito || anterior?.destinoChave
    || (anterior && !["AUTOMATICA", DECISAO_WIDESYS].includes(anterior.decisao))) return null;
  const cruzamentos = candidatos.filter(c => c.chave.startsWith("BRISA:"));
  const principalPreservado = anterior?.status === "ATIVO" && hashFonteCorresponde(f, anterior.hashFonte)
    && cruzamentos.every(c => !decisoes.has(c.chave) || decisoes.get(c.chave)?.status === "PENDENTE");
  const pendente = !principalPreservado && (cruzamentos.length > 0 || (f.dominio === "RECEBER" && periodoReceberBrisa));
  return { status: pendente ? "PENDENTE" : "ATIVO", decisao: DECISAO_WIDESYS,
    hashFonte: f.hash, candidatos: JSON.stringify(cruzamentos),
    motivos: JSON.stringify(["WIDESYS_CONFERIDO_NA_ORIGEM", ...(pendente ? ["CONCILIAR_COM_BASE_BRISA"] : [])]) };
}
