import Link from "next/link";

/** Navegação de ano por querystring (?ano=YYYY), por links (server-friendly). */
export function SeletorAno({ base, ano }: { base: string; ano: number }) {
  return (
    <div className="flex items-center gap-1 text-sm">
      <Link
        href={`${base}?ano=${ano - 1}`}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 hover:bg-slate-50"
      >
        ‹
      </Link>
      <span className="min-w-16 px-2 text-center font-semibold">{ano}</span>
      <Link
        href={`${base}?ano=${ano + 1}`}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 hover:bg-slate-50"
      >
        ›
      </Link>
    </div>
  );
}

/** ?ano= válido ou fallback. */
export function anoDaQuery(
  anoParam: string | undefined,
  fallback: number
): number {
  const n = Number(anoParam);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : fallback;
}
