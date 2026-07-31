/**
 * Semáforo — a linguagem de atenção do sistema.
 *
 * Todo número que a família precisa julgar ("isso está bom ou está ruim?")
 * passa por aqui e volta com um NÍVEL. O nível manda na cor, no ícone, no
 * texto do selo e no wash de fundo do card. Regra de ouro: a cor NUNCA é a
 * única pista — sempre acompanha ícone + palavra, para quem enxerga cores de
 * forma diferente (e para quem imprime em preto e branco).
 *
 *   verde  ÓTIMO    — nada a fazer
 *   âmbar  ATENÇÃO  — olhe hoje, ainda dá tempo
 *   verm.  CRÍTICO  — aja agora
 *   azul   INFO     — contexto, sem julgamento
 *   cinza  —        — sem dado suficiente
 */

export type Nivel = "otimo" | "atencao" | "critico" | "info" | "neutro";

export interface EstiloNivel {
  /** traço/texto — contraste ≥ 4.5:1 sobre o papel */
  cor: string;
  /** passo escuro do mesmo matiz (destaques, hover) */
  forte: string;
  /** wash de fundo do card/linha */
  fundo: string;
  /** borda sutil no mesmo matiz */
  borda: string;
  /** palavra que aparece no selo */
  rotulo: string;
  /** glifo redundante à cor */
  icone: string;
}

export const NIVEL: Record<Nivel, EstiloNivel> = {
  otimo: {
    cor: "#1f7a4b",
    forte: "#125c37",
    fundo: "rgba(31,122,75,0.07)",
    borda: "rgba(31,122,75,0.30)",
    rotulo: "ótimo",
    icone: "✓",
  },
  atencao: {
    cor: "#a8760f",
    forte: "#7d570a",
    fundo: "rgba(179,128,26,0.09)",
    borda: "rgba(179,128,26,0.34)",
    rotulo: "atenção",
    icone: "!",
  },
  critico: {
    cor: "#c0271d",
    forte: "#8f1811",
    fundo: "rgba(192,39,29,0.07)",
    borda: "rgba(192,39,29,0.30)",
    rotulo: "crítico",
    icone: "▲",
  },
  info: {
    cor: "#3a6ea8",
    forte: "#2a5280",
    fundo: "rgba(58,110,168,0.07)",
    borda: "rgba(58,110,168,0.28)",
    rotulo: "informativo",
    icone: "i",
  },
  neutro: {
    cor: "#6b6e65",
    forte: "#4c4f47",
    fundo: "rgba(107,110,101,0.06)",
    borda: "rgba(107,110,101,0.26)",
    rotulo: "sem dado",
    icone: "·",
  },
};

/** Ordena do mais urgente para o menos — usado na fila de alertas. */
export const PESO_NIVEL: Record<Nivel, number> = {
  critico: 0,
  atencao: 1,
  info: 2,
  otimo: 3,
  neutro: 4,
};

// ---------------------------------------------------------------------------
// Regras de negócio: de número para nível
// ---------------------------------------------------------------------------

/** Taxa de recebimento (1 = 100%). ≥95% ótimo · ≥80% atenção · abaixo crítico. */
export function nivelTaxaRecebimento(taxa: number | null): Nivel {
  if (taxa === null) return "neutro";
  if (taxa >= 0.95) return "otimo";
  if (taxa >= 0.8) return "atencao";
  return "critico";
}

/**
 * Inadimplência pelo PESO dela no mês (pendente ÷ devido), não pelo valor
 * absoluto: R$ 30 mil pendentes num mês de R$ 40 mil é outra história de
 * R$ 30 mil num mês de R$ 500 mil.
 */
export function nivelInadimplencia(
  valorPendente: number,
  totalDevido: number
): Nivel {
  if (valorPendente <= 0) return "otimo";
  if (totalDevido <= 0) return "atencao";
  return valorPendente / totalDevido >= 0.2 ? "critico" : "atencao";
}

/** Saldo/lucro: positivo é bom, zero é neutro, negativo pede reação. */
export function nivelSaldo(valor: number): Nivel {
  if (valor > 0) return "otimo";
  if (valor === 0) return "neutro";
  return "critico";
}

/** Dias de atraso de uma cobrança. */
export function nivelAtraso(dias: number | null): Nivel {
  if (dias === null) return "neutro";
  if (dias <= 0) return "info";
  return dias > 30 ? "critico" : "atencao";
}

/** Tarefa pendente na mesa (reajustes a aplicar, por exemplo). */
export function nivelTarefas(quantidade: number, limiteCritico = 8): Nivel {
  if (quantidade === 0) return "otimo";
  if (quantidade >= limiteCritico) return "critico";
  return "atencao";
}

/** Variação vs. período anterior, sabendo se subir é bom para a métrica. */
export function nivelVariacao(
  atual: number,
  anterior: number | null | undefined,
  bomQuandoSobe = true,
  toleranciaPct = 5
): Nivel {
  if (anterior === null || anterior === undefined || anterior === 0)
    return "neutro";
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100;
  if (Math.abs(pct) < toleranciaPct) return "info";
  const bom = pct > 0 === bomQuandoSobe;
  return bom ? "otimo" : "atencao";
}
