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
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
        {descricao ? (
          <p className="mt-1 text-sm text-slate-500">{descricao}</p>
        ) : null}
      </div>
      {acoes ? <div className="flex items-center gap-2">{acoes}</div> : null}
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
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}
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

export function Badge({
  children,
  cor = "slate",
}: {
  children: React.ReactNode;
  cor?: "slate" | "verde" | "vermelho" | "ambar" | "azul";
}) {
  const cores: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700",
    verde: "bg-emerald-100 text-emerald-800",
    vermelho: "bg-red-100 text-red-700",
    ambar: "bg-amber-100 text-amber-800",
    azul: "bg-sky-100 text-sky-800",
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cores[cor]}`}
    >
      {children}
    </span>
  );
}

/** KPI simples para dashboards. */
export function Kpi({
  rotulo,
  valor,
  detalhe,
  variacao,
}: {
  rotulo: string;
  valor: React.ReactNode;
  detalhe?: string;
  variacao?: React.ReactNode;
}) {
  return (
    <Card className="border-t-2 px-5 py-4" >
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {rotulo}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{valor}</div>
      {variacao ? <div className="mt-1">{variacao}</div> : null}
      {detalhe ? (
        <div className="mt-1 text-xs text-slate-500">{detalhe}</div>
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
      className={`text-xs font-semibold ${
        positivo ? "text-emerald-700" : "text-red-600"
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
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 hover:bg-slate-50"
      >
        ‹
      </Link>
      <span className="min-w-24 px-2 text-center font-semibold">
        {formatarCompetencia(mes)}
      </span>
      <Link
        href={`${base}?mes=${proximo}`}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 hover:bg-slate-50"
      >
        ›
      </Link>
    </div>
  );
}

export const btnPrimario =
  "inline-flex items-center gap-1.5 rounded-md bg-marca px-3 py-1.5 text-sm font-medium text-white hover:bg-marca-escura disabled:opacity-50";
export const btnSecundario =
  "inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50";
export const inputBase =
  "rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-marca-clara";
