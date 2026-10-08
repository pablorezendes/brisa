import type { FonteUnificacao } from "@/lib/unificacao/tipos";
import type { TipoGovernanca } from "./tipos";

/** A identidade é da fonte, não de um candidato de duplicidade ou do destino vinculado. */
export function alvoExclusaoUnificado(registro: Pick<FonteUnificacao, "dominio" | "origem" | "origemId" | "chave" | "tituloChave">): { tipo: TipoGovernanca; origemId: string; rotulo?: string } | null {
  const { dominio, origem, origemId, chave } = registro;
  if (dominio === "RECEBER" || dominio === "PAGAR") return { tipo: "TITULO", origemId: chave };
  if (dominio === "PESSOA") return { tipo: origem === "BRISA" ? "LOCATARIO" : "PESSOA", origemId };
  if (dominio === "IMOVEL") return { tipo: origem === "BRISA" ? "UNIDADE" : "IMOVEL_LEGADO", origemId };
  if (dominio === "CONTRATO") return { tipo: origem === "BRISA" ? "CONTRATO" : "CONTRATO_LEGADO", origemId };
  if (dominio === "MOVIMENTO") return { tipo: origem === "BRISA" ? "CAIXA" : "MOVIMENTO_LEGADO", origemId };
  if (dominio === "PARAMETRO") return { tipo: "PARAMETRO", origemId };
  if ((dominio === "BAIXA_RECEBER" || dominio === "BAIXA_PAGAR") && registro.tituloChave) return { tipo: "TITULO", origemId: registro.tituloChave, rotulo: "Excluir título vinculado" };
  return null;
}
