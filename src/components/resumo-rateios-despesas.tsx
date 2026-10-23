"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { consultarCustosRateados } from "@/app/(app)/financeiro/contas-a-pagar/rateios-consulta";
import type { ResumoRateios } from "@/lib/consultas/rateios";
import { btnSecundario, Dinheiro, inputBase, Sigilo } from "./ui";

export function ResumoRateiosDespesas() {
  const [aberto, setAberto] = useState(false);
  return <><button type="button" className={btnSecundario} onClick={() => setAberto(true)}>Custos por empreendimento</button>{aberto && <JanelaCustos aoFechar={() => setAberto(false)} />}</>;
}

function JanelaCustos({ aoFechar }: { aoFechar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const iniciou = useRef(false);
  const [mes, setMes] = useState("");
  const [resumo, setResumo] = useState<ResumoRateios | null>(null);
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const carregar = (competencia: string) => iniciar(async () => {
    setErro("");
    try {
      const resposta = await consultarCustosRateados(competencia);
      setResumo(resposta.resumo ?? null); setErro(resposta.erro ?? "");
    } catch { setResumo(null); setErro("Não foi possível consultar. Confira seu acesso e tente novamente."); }
  });
  useEffect(() => {
    const dialog = ref.current;
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    if (!iniciou.current) { iniciou.current = true; carregar(""); }
    return () => { dialog?.close(); document.body.style.overflow = overflow; anterior?.focus(); };
  }, []);
  return <dialog ref={ref} onCancel={e => { e.preventDefault(); aoFechar(); }} aria-labelledby="custos-rateados-titulo" style={{ width: "min(56rem, calc(100vw - 2rem))" }} className="fixed inset-0 m-auto max-h-[90dvh] overflow-auto rounded-2xl border border-contorno bg-carta p-0 text-left text-tinta shadow-2xl backdrop:bg-slate-950/50">
    <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-contorno bg-carta p-5"><div><h2 id="custos-rateados-titulo" className="text-xl font-bold">Custos por empreendimento</h2><p className="mt-1 text-xs text-tinta-suave">Apropriação por competência. Não representa outra nota nem outra saída de caixa.</p></div><button type="button" className={btnSecundario} onClick={aoFechar}>Fechar</button></div>
    <div className="space-y-4 p-5"><form onSubmit={e => { e.preventDefault(); carregar(mes); }} className="flex flex-wrap items-end gap-3"><label className="grid gap-1 text-xs font-semibold">Competência<input className={inputBase} type="month" value={mes} onChange={e => setMes(e.target.value)} /></label><button className={btnSecundario} disabled={pendente}>Consultar</button><span className="pb-2 text-xs text-tinta-suave">Em branco: todas as competências.</span></form>
      {erro && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</p>}
      {pendente ? <p role="status" className="py-8 text-center text-sm text-tinta-suave">Conferindo as notas e os rateios…</p> : resumo && <>
        <div className="rounded-xl border border-contorno bg-fundo p-4"><p className="text-xs font-semibold text-tinta-suave">Total apropriado nesta consulta</p><p className="mt-1 text-2xl font-bold"><Sigilo><Dinheiro centavos={resumo.total} /></Sigilo></p><p className="mt-2 text-xs text-tinta-suave">{resumo.notasConferidas} nota(s) com parcelas válidas · {resumo.notasPendentes} nota(s) ainda precisam de conferência</p></div>
        {resumo.custos.length ? <div className="tabela-scroll overflow-x-auto" role="region" aria-label="Custos rateados por empreendimento" tabIndex={0}><table className="tabela"><thead><tr><th>Empreendimento</th><th>Competência</th><th>Parcelas</th><th>Custo apropriado</th></tr></thead><tbody>{resumo.custos.map(c => <tr key={`${c.empreendimentoId}:${c.competencia}`}><td className="font-semibold">{c.empreendimento}</td><td>{c.competencia}</td><td>{c.parcelas}</td><td><Sigilo><Dinheiro centavos={c.valor} /></Sigilo></td></tr>)}</tbody></table></div> : <p className="p-5 text-sm text-tinta-suave">Nenhum rateio conferido disponível. Salve a nota e conclua a distribuição para incluir os custos aqui.</p>}
      </>}
      <p className="text-xs leading-relaxed text-tinta-suave">Entram apenas notas ativas, sem duplicidade pendente, com soma fechada e fonte atualizada. Rascunhos e dados a revisar não entram neste total. O rateio é gerencial: não emite documentos fiscais nem gera reembolsos entre empresas.</p>
    </div>
  </dialog>;
}
