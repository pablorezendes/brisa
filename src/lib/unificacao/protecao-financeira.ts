import { carregarFontesUnificacao, chaveFonte, type BancoUnificacao } from "./fontes";
import { projetarUnificados } from "./reconciliacao";
import type { DecisaoUnificacao, FonteUnificacao } from "./tipos";

export class ErroProtecaoUnificacao extends Error {
  constructor(mensagem: string) { super(mensagem); this.name = "ErroProtecaoUnificacao"; }
}

type VinculoHistorico = { registroChave: string; destinoChave: string | null };

export function montarProtecaoFinanceira(
  fontes: FonteUnificacao[],
  decisoes: DecisaoUnificacao[],
  historico: VinculoHistorico[] = [],
) {
  const linhas = projetarUnificados(fontes, decisoes);
  return {
    fontes,
    decisoes,
    porChave: new Map(linhas.map(linha => [linha.chave, linha])),
    decisoesPorChave: new Map(decisoes.map(decisao => [decisao.chave, decisao])),
    historicoVinculado: new Set(historico.flatMap(item => [item.registroChave, ...(item.destinoChave ? [item.destinoChave] : [])])),
  };
}

type ProtecaoFinanceira = ReturnType<typeof montarProtecaoFinanceira>;

/** Usa a fotografia atual, incluindo decisões que ficaram desatualizadas. */
export async function carregarProtecaoFinanceira(db: BancoUnificacao): Promise<ProtecaoFinanceira> {
  const [fontes, decisoes, historico] = await Promise.all([
    carregarFontesUnificacao(db),
    db.unificacaoRegistro.findMany(),
    db.unificacaoDecisao.findMany({ where: { acao: "VINCULAR" }, select: { registroChave: true, destinoChave: true } }),
  ]);
  return montarProtecaoFinanceira(fontes, decisoes, historico);
}

function possuiVinculo(contexto: ProtecaoFinanceira, chave: string): boolean {
  return Boolean(contexto.decisoesPorChave.get(chave)?.destinoChave) || contexto.decisoes.some(decisao => decisao.destinoChave === chave);
}

export function impedimentoRecebimentoUnificado(
  contexto: ProtecaoFinanceira,
  recebimentoId: string,
  operacao: "EMITIR" | "LIMPAR" | "EXCLUIR",
): string | null {
  const chave = chaveFonte("BRISA", "RECEBER", recebimentoId);
  const linha = contexto.porChave.get(chave);
  if (!linha) return "O lançamento mudou. Atualize a tela antes de continuar.";
  if (possuiVinculo(contexto, chave) || (operacao !== "EMITIR" && contexto.historicoVinculado.has(chave))) {
    return operacao === "EMITIR"
      ? "Este lançamento possui vínculo entre fontes. Confira o título e o boleto da origem em Unificação antes de qualquer nova cobrança."
      : "Este lançamento participa de uma unificação e deve permanecer para auditoria. Confira o vínculo em Unificação; o valor recebido pode ser corrigido sem excluir ou limpar seu histórico.";
  }
  if (linha.estado !== "ATIVO") {
    return "Este lançamento aguarda conferência em Unificação. Resolva a pendência antes de emitir, limpar ou excluir.";
  }
  const decisao = contexto.decisoesPorChave.get(chave);
  if (operacao === "EMITIR" && decisao?.decisao !== "MANUAL" && linha.candidatos.some(candidato => candidato.chave.startsWith("WIDESYS:RECEBER:"))) {
    return "Existe uma possível cobrança correspondente no Widesys. Compare em Unificação antes de emitir outro boleto.";
  }
  return null;
}

/** Só usa vínculos contratuais explícitos; nome ou valor nunca identificam um título. */
export function impedimentoGeracaoUnificada(
  contexto: ProtecaoFinanceira,
  contratoId: string,
  competencia: string,
): string | null {
  const chave = chaveFonte("BRISA", "CONTRATO", contratoId);
  const contrato = contexto.porChave.get(chave);
  if (!contrato) return "Contrato alterado. Atualize a tela antes de gerar cobranças.";
  if (!["ATIVO", "VINCULADO"].includes(contrato.estado)) {
    return "O contrato aguarda conferência em Unificação antes da geração de cobranças.";
  }
  const decisao = contexto.decisoesPorChave.get(chave);
  if (contrato.estado === "VINCULADO" && decisao?.destinoChave?.startsWith("BRISA:")) {
    return "Este contrato está vinculado a outro contrato Brisa. Gere a cobrança pelo contrato principal.";
  }
  const principal = contrato.estado === "VINCULADO" && decisao?.destinoChave
    ? contexto.porChave.get(decisao.destinoChave)
    : contrato;
  if (!principal) return "O vínculo do contrato precisa ser revisto em Unificação.";
  const grupo = new Set([chave, ...principal.fontes]);
  const vinculoDesatualizado = contexto.decisoes.some(item =>
    item.dominio === "CONTRATO" && item.destinoChave &&
    (grupo.has(item.destinoChave) || grupo.has(item.chave)) &&
    contexto.porChave.get(item.chave)?.estado !== "VINCULADO",
  );
  if (vinculoDesatualizado) return "Uma fonte vinculada ao contrato mudou. Refaça a conferência em Unificação antes de gerar cobranças.";

  const tituloExistente = contexto.fontes.some(fonte =>
    fonte.origem === "WIDESYS" && fonte.dominio === "RECEBER" &&
    fonte.contratoChave && grupo.has(fonte.contratoChave) && fonte.competencia === competencia &&
    !(fonte.cancelado && fonte.qualidade === "OK"),
  );
  return tituloExistente
    ? "O contrato vinculado já possui título Widesys nesta competência. Confira a cobrança existente em Unificação."
    : null;
}
