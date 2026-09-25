/** Apenas apresentação: não carrega nem antecipa dados financeiros. */
export default function CarregandoPagina() {
  return <section aria-busy="true" aria-label="Carregando página" className="space-y-5">
    <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl border border-contorno bg-white px-5 py-4">
      <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border-2 border-[#d3e5df] border-t-oliva motion-safe:animate-spin"/>
      <div><p className="text-sm font-semibold text-tinta">Carregando página…</p><p className="mt-1 text-xs text-tinta-suave">Você pode continuar navegando pelo menu.</p></div>
    </div>
    <div aria-hidden="true" className="space-y-5 motion-safe:animate-pulse">
      <div className="space-y-3 py-2"><div className="h-7 w-56 max-w-full rounded-lg bg-[#dfe8e8]"/><div className="h-3 w-80 max-w-full rounded bg-[#e5ecee]"/></div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0,1,2,3].map(i => <div key={i} className="h-28 rounded-xl border border-contorno bg-white p-5"><div className="h-3 w-24 rounded bg-[#e5ecee]"/><div className="mt-5 h-6 w-32 max-w-full rounded bg-[#e5ecee]"/></div>)}</div>
      <div className="space-y-5 rounded-xl border border-contorno bg-white p-5"><div className="h-4 w-48 max-w-full rounded bg-[#e5ecee]"/>{[0,1,2,3].map(i => <div key={i} className="h-9 rounded-md bg-[#f0f4f5]"/>)}</div>
    </div>
  </section>;
}
