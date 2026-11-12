import { carteiraIrrestrita, pode, type PoliticaAcesso } from "@/lib/acesso/politica";
import type { LinhaUnificada } from "./tipos";

export function tipoBaixaRecebimento(
  titulo: Pick<LinhaUnificada, "dominio" | "origem" | "estado" | "aberto" | "contabiliza" | "cancelado" | "lancamentoManual">,
  acesso: PoliticaAcesso,
): "BRISA" | "WIDESYS" | null {
  if (titulo.dominio !== "RECEBER" || titulo.estado !== "ATIVO" || !titulo.contabiliza || titulo.cancelado || (titulo.aberto ?? 0) <= 0) return null;
  if (!carteiraIrrestrita(acesso) || !pode(acesso, "recebimentos.editar") || !pode(acesso, "pagamentos.conciliar") || !pode(acesso, "caixa.editar")) return null;
  if (titulo.origem === "WIDESYS") return "WIDESYS";
  return titulo.origem === "BRISA" && titulo.lancamentoManual ? "BRISA" : null;
}
