import Link from "next/link";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import {
  formatarCompetencia,
  parseCompetencia,
  competencia as fmtCompetencia,
} from "@/lib/dominio/normalizacao";
import { NIVEL, PESO_NIVEL, type Nivel } from "@/lib/dominio/semaforo";

/** Cabeçalho padrão de página. */
export function PageHeader({
  titulo,
  descricao,
  acoes,
}: {
  titulo: string;
  descricao?: string;
  acoes?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{titulo}</h1>
        {descricao ? (
          <p className="mt-1 text-sm text-tinta-suave">{descricao}</p>
        ) : null}
      </div>
      {acoes ? (
        <div className="flex flex-wrap items-center gap-2">{acoes}</div>
      ) : null}
    </div>
  );
}

export function Card({
  children,
  className = "",
  style,
  nivel,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** pinta a faixa lateral e o wash de fundo com a cor do semáforo */
  nivel?: Nivel;
}) {
  const est = nivel ? NIVEL[nivel] : null;
  return (
    <div
      className={`rounded-xl border bg-carta ${est ? "card-sem" : ""} ${className}`}
      style={{
        borderColor: est ? est.borda : "var(--contorno)",
        backgroundColor: est ? est.fundo : undefined,
        ...(est ? ({ "--sem-cor": est.cor } as React.CSSProperties) : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Valor monetário (centavos) alinhado à direita; negativo em vermelho. */
export function Dinheiro({
  centavos,
  destaque = false,
}: {
  centavos: number | null | undefined;
  destaque?: boolean;
}) {
  const negativo = (centavos ?? 0) < 0;
  return (
    <span
      className={`font-mono tabular-nums ${negativo ? "text-erro" : ""} ${
        destaque ? "font-semibold" : ""
      }`}
    >
      {formatarBRL(centavos)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Semáforo — ponto + palavra + ícone. A cor nunca vem sozinha.
// ---------------------------------------------------------------------------

/** Só o ponto colorido (para células de tabela apertadas). Tem título nativo. */
export function Ponto({ nivel, titulo }: { nivel: Nivel; titulo?: string }) {
  const est = NIVEL[nivel];
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full align-middle ${
        nivel === "critico" ? "sem-pulso" : ""
      }`}
      style={{
        background: est.cor,
        color: est.cor,
        boxShadow: `0 0 0 2.5px ${est.fundo}`,
      }}
      title={titulo ?? est.rotulo}
      aria-label={titulo ?? est.rotulo}
    />
  );
}

/**
 * Selo de nível: ponto + texto em caixa alta sobre um wash da própria cor.
 * É a peça que responde "isso está bom ou ruim?" sem obrigar a ler o número.
 */
export function Selo({
  nivel,
  children,
  icone = true,
}: {
  nivel: Nivel;
  children?: React.ReactNode;
  icone?: boolean;
}) {
  const est = NIVEL[nivel];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.09em] whitespace-nowrap"
      style={{
        color: est.forte,
        background: est.fundo,
        border: `1px solid ${est.borda}`,
      }}
    >
      {icone ? (
        <span aria-hidden="true" className="text-[10px] leading-none">
          {est.icone}
        </span>
      ) : null}
      {children ?? est.rotulo}
    </span>
  );
}

const COR_PARA_NIVEL: Record<string, Nivel> = {
  verde: "otimo",
  ambar: "atencao",
  vermelho: "critico",
  azul: "info",
  slate: "neutro",
};

/**
 * Status em linha. Aceita a paleta antiga (`cor`) ou o nível do semáforo
 * (`nivel`) — as duas desembocam no mesmo selo.
 */
export function Badge({
  children,
  cor = "slate",
  nivel,
}: {
  children: React.ReactNode;
  cor?: "slate" | "verde" | "vermelho" | "ambar" | "azul";
  nivel?: Nivel;
}) {
  return (
    <Selo nivel={nivel ?? COR_PARA_NIVEL[cor] ?? "neutro"} icone={false}>
      {children}
    </Selo>
  );
}

/**
 * "i" de informação com explicação em tooltip (CSS puro, hover/foco).
 * Vai ao lado de TODO rótulo de KPI, título de card e cabeçalho de coluna —
 * sempre em linguagem simples e dizendo COMO agir no lançamento.
 */
export function Ajuda({ dica }: { dica: string }) {
  return (
    <span
      className="dica"
      tabIndex={0}
      role="note"
      data-dica={dica}
      aria-label={dica}
    >
      i
    </span>
  );
}

// ---------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------

/**
 * Cartão de indicador. Além do número, carrega:
 *  · o "i" com a explicação da métrica;
 *  · o selo do semáforo (ótimo / atenção / crítico), que também tinge a faixa
 *    lateral e o fundo do card;
 *  · uma linha de recado (`nota`) dizendo o que fazer quando não está verde.
 */
export function Kpi({
  rotulo,
  valor,
  detalhe,
  variacao,
  ajuda,
  nivel,
  nota,
  selo,
  grafico,
  href,
}: {
  rotulo: string;
  valor: React.ReactNode;
  detalhe?: string;
  variacao?: React.ReactNode;
  /** explicação da métrica em linguagem simples (vira o "i" com tooltip) */
  ajuda?: string;
  /** veredito do semáforo — pinta faixa, fundo e selo */
  nivel?: Nivel;
  /** o que fazer a respeito, quando há algo a fazer */
  nota?: string;
  /** texto do selo; por padrão usa a palavra do nível */
  selo?: string;
  /** mini-gráfico (sparkline, barra de composição) no rodapé do card */
  grafico?: React.ReactNode;
  /** torna o card inteiro clicável */
  href?: string;
}) {
  const est = nivel ? NIVEL[nivel] : null;
  const conteudo = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-tinta-suave">
          {rotulo}
          {ajuda ? <Ajuda dica={ajuda} /> : null}
        </div>
        {nivel && nivel !== "neutro" ? (
          <Selo nivel={nivel}>{selo}</Selo>
        ) : null}
      </div>
      <div className="mt-2 font-serif text-xl font-semibold tabular-nums text-tinta sm:text-[26px] sm:leading-tight">
        {valor}
      </div>
      {variacao ? <div className="mt-1.5">{variacao}</div> : null}
      {detalhe ? (
        <div className="mt-1.5 text-xs leading-snug text-tinta-suave">
          {detalhe}
        </div>
      ) : null}
      {grafico ? <div className="mt-3">{grafico}</div> : null}
      {nota && est ? (
        <div
          className="mt-3 flex items-start gap-1.5 border-t pt-2 text-[11px] leading-snug font-medium"
          style={{ borderColor: est.borda, color: est.forte }}
        >
          <span aria-hidden="true">{est.icone}</span>
          <span>{nota}</span>
        </div>
      ) : null}
    </>
  );

  const classe = `px-4 py-4 transition-colors sm:px-5 ${
    href ? "block rounded-xl hover:bg-[#f3f1eb]" : ""
  }`;

  if (href) {
    return (
      <Card nivel={nivel} className="p-0">
        <Link href={href} className={classe}>
          {conteudo}
        </Link>
      </Card>
    );
  }
  return (
    <Card nivel={nivel} className={classe}>
      {conteudo}
    </Card>
  );
}

/**
 * Variação vs mês anterior, legível por qualquer pessoa:
 * "▲ 12,3% vs mês anterior" — verde/âmbar conforme o que é bom para a métrica
 * (comissão: subir é bom; inadimplência: subir é ruim).
 */
export function Variacao({
  atual,
  anterior,
  bomQuandoSobe = true,
}: {
  atual: number;
  anterior: number | null | undefined;
  bomQuandoSobe?: boolean;
}) {
  if (
    anterior === null ||
    anterior === undefined ||
    anterior === 0 ||
    atual === anterior
  ) {
    return (
      <span className="font-mono text-[11px] text-tinta-suave/70">
        {anterior === 0 || anterior === null || anterior === undefined
          ? "sem base de comparação"
          : "estável vs mês anterior"}
      </span>
    );
  }
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100;
  const subiu = pct > 0;
  const est = NIVEL[subiu === bomQuandoSobe ? "otimo" : "atencao"];
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-bold"
      style={{ color: est.forte, background: est.fundo }}
    >
      {subiu ? "▲" : "▼"} {Math.abs(pct).toFixed(1).replace(".", ",")}%
      <span className="font-normal opacity-70">vs mês anterior</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Alertas — a fila de atenção do topo das páginas
// ---------------------------------------------------------------------------

export interface ItemAlerta {
  nivel: Nivel;
  titulo: string;
  /** o que está acontecendo e o que fazer, em uma frase */
  texto: string;
  acao?: { rotulo: string; href: string };
}

/** Uma linha da fila de atenção. */
export function Alerta({ item }: { item: ItemAlerta }) {
  const est = NIVEL[item.nivel];
  return (
    <div
      className="flex items-start gap-3 rounded-lg border px-3.5 py-2.5"
      style={{ borderColor: est.borda, background: est.fundo }}
    >
      <span
        className={`mt-[3px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
          item.nivel === "critico" ? "sem-pulso" : ""
        }`}
        style={{ background: est.cor, color: "#fdfbf8" }}
        aria-hidden="true"
      >
        {est.icone}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className="text-[12px] font-bold uppercase tracking-[0.06em]"
          style={{ color: est.forte }}
        >
          {item.titulo}
        </div>
        <p className="mt-0.5 text-[13px] leading-snug text-tinta">{item.texto}</p>
      </div>
      {item.acao ? (
        <Link
          href={item.acao.href}
          className="mt-0.5 shrink-0 whitespace-nowrap text-[12px] font-bold hover:underline"
          style={{ color: est.forte }}
        >
          {item.acao.rotulo} →
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Central de atenção: ordena do mais urgente para o menos e mostra tudo que
 * pede ação hoje. Quando não há nada pendente, dá o "tudo em dia" — silêncio
 * num painel de alertas é ambíguo, confirmação não é.
 */
export function PainelAlertas({
  itens,
  ajuda,
  vazio = "Nada pedindo atenção neste mês — comissão em dia, cobranças recebidas e nenhum reajuste a aplicar.",
}: {
  itens: ItemAlerta[];
  ajuda?: string;
  vazio?: string;
}) {
  const ordenados = [...itens].sort(
    (a, b) => PESO_NIVEL[a.nivel] - PESO_NIVEL[b.nivel]
  );
  const criticos = ordenados.filter((i) => i.nivel === "critico").length;
  const atencoes = ordenados.filter((i) => i.nivel === "atencao").length;

  return (
    <Card className="mb-6 px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-tinta-suave">
          Precisa da sua atenção
          {ajuda ? <Ajuda dica={ajuda} /> : null}
        </h2>
        <div className="flex items-center gap-2">
          {criticos > 0 ? (
            <Selo nivel="critico">
              {criticos} {criticos === 1 ? "urgente" : "urgentes"}
            </Selo>
          ) : null}
          {atencoes > 0 ? (
            <Selo nivel="atencao">{atencoes} a olhar</Selo>
          ) : null}
          {criticos === 0 && atencoes === 0 ? (
            <Selo nivel="otimo">tudo em dia</Selo>
          ) : null}
        </div>
      </div>
      {ordenados.length === 0 ? (
        <div
          className="flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-[13px] text-tinta"
          style={{
            borderColor: NIVEL.otimo.borda,
            background: NIVEL.otimo.fundo,
          }}
        >
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
            style={{ background: NIVEL.otimo.cor, color: "#fdfbf8" }}
            aria-hidden="true"
          >
            ✓
          </span>
          {vazio}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {ordenados.map((item, i) => (
            <Alerta key={i} item={item} />
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * Cabeçalho de card/seção: título em serifa, "i" com a explicação e um espaço
 * à direita para legenda, selo ou link de aprofundamento.
 */
export function TituloCard({
  titulo,
  ajuda,
  nivel,
  direita,
}: {
  titulo: string;
  ajuda?: string;
  nivel?: Nivel;
  direita?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
      <h2 className="flex items-center gap-1.5 font-serif text-[15px] font-semibold text-tinta">
        {nivel && nivel !== "neutro" ? <Ponto nivel={nivel} /> : null}
        {titulo}
        {ajuda ? <Ajuda dica={ajuda} /> : null}
      </h2>
      {direita ? (
        <div className="flex items-center gap-3">{direita}</div>
      ) : null}
    </div>
  );
}

/** Link de aprofundamento no canto do card. */
export function LinkCard({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="whitespace-nowrap text-[12px] font-bold text-oliva-escura hover:underline"
    >
      {children} →
    </Link>
  );
}

/**
 * Navegação de mês por querystring (?mes=YYYY-MM), server-friendly (links).
 * Uso: <SeletorMes base="/recebimentos" mes="2026-06" />
 */
export function SeletorMes({ base, mes }: { base: string; mes: string }) {
  const { ano, mes: m } = parseCompetencia(mes);
  const anterior =
    m === 1 ? fmtCompetencia(ano - 1, 12) : fmtCompetencia(ano, m - 1);
  const proximo =
    m === 12 ? fmtCompetencia(ano + 1, 1) : fmtCompetencia(ano, m + 1);
  const seta =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-contorno bg-carta text-tinta-suave transition-colors hover:border-tinta hover:text-tinta";
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <Link href={`${base}?mes=${anterior}`} className={seta} aria-label="Mês anterior">
        ‹
      </Link>
      <span className="min-w-24 rounded-lg border border-contorno bg-carta px-3 py-1.5 text-center font-mono text-[13px] font-bold uppercase tracking-wider">
        {formatarCompetencia(mes)}
      </span>
      <Link href={`${base}?mes=${proximo}`} className={seta} aria-label="Próximo mês">
        ›
      </Link>
    </div>
  );
}

export const btnPrimario =
  "inline-flex items-center gap-1.5 rounded-lg bg-oliva px-3 py-1.5 text-sm font-semibold text-white hover:bg-oliva-escura disabled:opacity-50";
export const btnSecundario =
  "inline-flex items-center gap-1.5 rounded-lg border border-tinta bg-transparent px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-[#efeee9] disabled:opacity-50";
export const inputBase =
  "rounded-lg border border-contorno bg-white px-2.5 py-1.5 font-mono text-sm text-tinta focus:outline-none focus:border-tinta focus:ring-1 focus:ring-tinta";
