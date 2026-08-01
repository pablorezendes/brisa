/**
 * Semáforo — a linguagem de atenção do sistema.
 *
 * Todo número que a família precisa julgar ("isso está bom ou está ruim?")
 * passa por aqui e volta com um NÍVEL. Disciplina editorial (stile/DESIGN.md):
 * a cor aparece SÓ no ponto, no filete lateral do card e nas barras de
 * gráfico — texto é sempre tinta. E a cor nunca é a única pista: sempre
 * acompanha a palavra do nível, para quem enxerga cores de forma diferente
 * (e para quem imprime em preto e branco).
 *
 * As cinco cores são EXATAMENTE as da paleta do site — nenhum tom novo:
 *   oliva   #5e6e52  ÓTIMO    — nada a fazer
 *   âmbar   #b3801a  ATENÇÃO  — olhe hoje, ainda dá tempo
 *   terrac. #ba1a1a  CRÍTICO  — aja agora
 *   índigo  #4a68a8  INFO     — contexto, sem julgamento
 *   cinza   #75786f  —        — sem dado suficiente
 */

export type Nivel = "otimo" | "atencao" | "critico" | "info" | "neutro";

export interface EstiloNivel {
  /** cor da paleta — usada APENAS em ponto/filete/barra, nunca em texto */
  cor: string;
  /** passo escuro do mesmo matiz quando existe na paleta (senão = cor) */
  forte: string;
  /** tinta muito diluída da própria cor — raríssimo, só linha de alerta */
  fundo: string;
  /** borda sutil no mesmo matiz — raríssimo */
  borda: string;
  /** palavra que aparece ao lado do ponto */
  rotulo: string;
  /** glifo redundante à cor (uso pontual) */
  icone: string;
}

export const NIVEL: Record<Nivel, EstiloNivel> = {
  otimo: {
    cor: "#5e6e52", // --oliva
    forte: "#46563b", // --oliva-escura
    fundo: "rgba(94,110,82,0.06)",
    borda: "rgba(94,110,82,0.25)",
    rotulo: "ótimo",
    icone: "✓",
  },
  atencao: {
    cor: "#b3801a", // --ambar
    forte: "#b3801a",
    fundo: "rgba(179,128,26,0.06)",
    borda: "rgba(179,128,26,0.25)",
    rotulo: "atenção",
    icone: "!",
  },
  critico: {
    cor: "#ba1a1a", // --erro (terracota)
    forte: "#ba1a1a",
    fundo: "rgba(186,26,26,0.05)",
    borda: "rgba(186,26,26,0.25)",
    rotulo: "crítico",
    icone: "▲",
  },
  info: {
    cor: "#4a68a8", // índigo da paleta de dados
    forte: "#4a68a8",
    fundo: "rgba(74,104,168,0.05)",
    borda: "rgba(74,104,168,0.25)",
    rotulo: "informativo",
    icone: "i",
  },
  neutro: {
    cor: "#75786f", // --contorno-forte
    forte: "#444840", // --tinta-suave
    fundo: "rgba(117,120,111,0.05)",
    borda: "rgba(117,120,111,0.25)",
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
