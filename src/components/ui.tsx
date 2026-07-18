import Link from "next/link";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import {
  formatarCompetencia,
  parseCompetencia,
  competencia as fmtCompetencia,
} from "@/lib/dominio/normalizacao";

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
          <p className="mt-1 text-sm text-slate-500">{descricao}</p>
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
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`rounded-lg border border-contorno bg-carta ${className}`}
      style={style}
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
      className={`font-mono tabular-nums ${negativo ? "text-red-600" : ""} ${
        destaque ? "font-semibold" : ""
      }`}
    >
      {formatarBRL(centavos)}
    </span>
  );
}

/**
 * Status editorial: ponto colorido de 8px + rótulo em caixa alta.
 * (O design system proíbe pílulas/badges preenchidos.)
 */
export function Badge({
  children,
  cor = "slate",
}: {
  children: React.ReactNode;
  cor?: "slate" | "verde" | "vermelho" | "ambar" | "azul";
}) {
  const ponto: Record<string, string> = {
    slate: "#75786f",
    verde: "#5e6e52",
    vermelho: "#ba1a1a",
    ambar: "#b3801a",
    azul: "#4a68a8",
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-tinta-suave">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: ponto[cor] }}
      />
      {children}
    </span>
  );
}

/**
 * "?" de ajuda com explicação em tooltip (CSS puro, hover/foco).
 * Use ao lado de rótulos de KPI e cabeçalhos de coluna para explicar a
 * métrica em linguagem simples — sempre dizendo COMO agir no lançamento.
 */
export function Ajuda({ dica }: { dica: string }) {
  return (
    <span className="dica" tabIndex={0} data-dica={dica} aria-label={dica}>
      ?
    </span>
  );
}

/** KPI simples para dashboards. */
export function Kpi({
  rotulo,
  valor,
  detalhe,
  variacao,
  ajuda,
}: {
  rotulo: string;
  valor: React.ReactNode;
  detalhe?: string;
  variacao?: React.ReactNode;
  /** explicação da métrica em linguagem simples (vira um "?" com tooltip) */
  ajuda?: string;
}) {
  return (
    <Card className="px-4 py-4 sm:px-5">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-tinta-suave">
        {rotulo}
        {ajuda ? <Ajuda dica={ajuda} /> : null}
      </div>
      <div className="mt-1.5 font-serif text-xl font-semibold tabular-nums text-tinta sm:text-2xl">
        {valor}
      </div>
      {variacao ? <div className="mt-1">{variacao}</div> : null}
      {detalhe ? (
        <div className="mt-1 text-xs text-tinta-suave">{detalhe}</div>
      ) : null}
    </Card>
  );
}

/**
 * Variação vs mês anterior, legível por qualquer pessoa:
 * "▲ 12,3% vs mês anterior" — verde/vermelho conforme o que é bom para a
 * métrica (bomQuandoSobe: comissão sim, inadimplência não).
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
      <span className="text-xs text-slate-400">
        {anterior === 0 || anterior === null || anterior === undefined
          ? "sem base de comparação"
          : "estável vs mês anterior"}
      </span>
    );
  }
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100;
  const subiu = pct > 0;
  const positivo = subiu === bomQuandoSobe;
  return (
    <span
      className={`font-mono text-[11px] font-bold ${
        positivo ? "text-oliva-escura" : "text-erro"
      }`}
    >
      {subiu ? "▲" : "▼"} {Math.abs(pct).toFixed(1).replace(".", ",")}% vs mês
      anterior
    </span>
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
  return (
    <div className="flex items-center gap-1 text-sm">
      <Link
        href={`${base}?mes=${anterior}`}
        className="rounded border border-contorno bg-carta px-2.5 py-1 hover:bg-[#efeee9]"
      >
        ‹
      </Link>
      <span className="min-w-24 px-2 text-center font-mono text-[13px] font-bold uppercase tracking-wider">
        {formatarCompetencia(mes)}
      </span>
      <Link
        href={`${base}?mes=${proximo}`}
        className="rounded border border-contorno bg-carta px-2.5 py-1 hover:bg-[#efeee9]"
      >
        ›
      </Link>
    </div>
  );
}

export const btnPrimario =
  "inline-flex items-center gap-1.5 rounded bg-oliva px-3 py-1.5 text-sm font-semibold text-white hover:bg-oliva-escura disabled:opacity-50";
export const btnSecundario =
  "inline-flex items-center gap-1.5 rounded border border-tinta bg-transparent px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-[#efeee9] disabled:opacity-50";
export const inputBase =
  "rounded border border-contorno bg-white px-2.5 py-1.5 font-mono text-sm text-tinta focus:outline-none focus:border-tinta focus:ring-1 focus:ring-tinta";
