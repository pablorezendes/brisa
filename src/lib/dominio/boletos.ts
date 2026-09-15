import type { Locatario } from "@prisma/client";

export const STATUS_BOLETO_ATIVOS = [
  "EMITINDO",
  "RESULTADO_DESCONHECIDO",
  "REGISTRADO",
  "VENCIDO",
  "PAGAMENTO_REPORTADO",
  "CANCELAMENTO_REPORTADO",
  "LIQUIDADO",
] as const;

export type StatusVisualBoleto = {
  rotulo: string;
  nivel: "otimo" | "atencao" | "critico" | "info" | "neutro";
};

export const STATUS_VISUAL_BOLETO: Record<string, StatusVisualBoleto> = {
  RASCUNHO: { rotulo: "Rascunho", nivel: "neutro" },
  EMITINDO: { rotulo: "Registrando", nivel: "info" },
  RESULTADO_DESCONHECIDO: { rotulo: "Confirmando emissão", nivel: "atencao" },
  REGISTRADO: { rotulo: "Em aberto", nivel: "info" },
  PAGAMENTO_REPORTADO: { rotulo: "Pagamento informado", nivel: "atencao" },
  CANCELAMENTO_REPORTADO: { rotulo: "Cancelamento informado", nivel: "critico" },
  LIQUIDADO: { rotulo: "Pago no banco", nivel: "otimo" },
  BAIXADO: { rotulo: "Baixado sem pagamento", nivel: "neutro" },
  BAIXADO_SEM_PAGAMENTO: { rotulo: "Baixado sem pagamento", nivel: "neutro" },
  VENCIDO: { rotulo: "Vencido", nivel: "critico" },
  ESTORNADO: { rotulo: "Liquidação revertida", nivel: "critico" },
  ERRO: { rotulo: "Falha na emissão", nivel: "critico" },
};

export function statusVisualBoleto(status: string): StatusVisualBoleto {
  return STATUS_VISUAL_BOLETO[status] ?? { rotulo: status, nivel: "neutro" };
}

export function boletoEstaAtivo(status: string): boolean {
  return (STATUS_BOLETO_ATIVOS as readonly string[]).includes(status);
}

export function totalDevido(recebimento: {
  valor: number;
  iptu: number;
  cond: number;
}): number {
  return recebimento.valor + recebimento.iptu + recebimento.cond;
}

/** Data civil, sem Date/fuso. Se o dia não existe no mês, usa o último dia. */
export function vencimentoDoRecebimento(
  competencia: string,
  diaVencimento: number | null,
): string | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(competencia);
  if (!match) return null;
  const ano = Number(match[1]);
  const mes = Number(match[2]);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const dia = Math.min(Math.max(diaVencimento ?? 10, 1), ultimoDia);
  return `${match[1]}-${match[2]}-${String(dia).padStart(2, "0")}`;
}

export type CampoPagador =
  | "cpfCnpj"
  | "endereco"
  | "numeroEndereco"
  | "bairro"
  | "cidade"
  | "cep"
  | "uf";

const ROTULOS_PAGADOR: Record<CampoPagador, string> = {
  cpfCnpj: "CPF/CNPJ",
  endereco: "endereço",
  numeroEndereco: "número",
  bairro: "bairro",
  cidade: "cidade",
  cep: "CEP",
  uf: "UF",
};

export function camposPagadorPendentes(
  locatario: Pick<Locatario, CampoPagador>,
): { campo: CampoPagador; rotulo: string }[] {
  return (Object.keys(ROTULOS_PAGADOR) as CampoPagador[])
    .filter((campo) => !locatario[campo]?.trim())
    .map((campo) => ({ campo, rotulo: ROTULOS_PAGADOR[campo] }));
}

export type ResultadoConciliacao =
  | { tipo: "CONCILIAR"; recebido: number }
  | {
      tipo: "PENDENTE";
      motivo:
        | "MES_FECHADO"
        | "BAIXA_MANUAL_EXISTENTE"
        | "PAGAMENTO_PARCIAL"
        | "PAGAMENTO_MAIOR";
    };

/**
 * Decide se uma liquidação bancária pode alimentar o campo legado
 * `Recebimento.recebido`. Parcial/maior e conflito manual ficam visíveis na
 * conciliação; assim as telas antigas não confundem parcial com quitação.
 */
export function avaliarConciliacao({
  total,
  totalPagamentosConfirmados,
  recebidoLegado,
  baixaManualSemVinculo = false,
  mesFechado,
}: {
  total: number;
  totalPagamentosConfirmados: number;
  recebidoLegado: number | null;
  baixaManualSemVinculo?: boolean;
  mesFechado: boolean;
}): ResultadoConciliacao {
  if (mesFechado) return { tipo: "PENDENTE", motivo: "MES_FECHADO" };
  if (baixaManualSemVinculo) {
    return { tipo: "PENDENTE", motivo: "BAIXA_MANUAL_EXISTENTE" };
  }
  if (recebidoLegado !== null && recebidoLegado !== totalPagamentosConfirmados) {
    return { tipo: "PENDENTE", motivo: "BAIXA_MANUAL_EXISTENTE" };
  }
  if (totalPagamentosConfirmados < total) {
    return { tipo: "PENDENTE", motivo: "PAGAMENTO_PARCIAL" };
  }
  if (totalPagamentosConfirmados > total) {
    return { tipo: "PENDENTE", motivo: "PAGAMENTO_MAIOR" };
  }
  return { tipo: "CONCILIAR", recebido: totalPagamentosConfirmados };
}
