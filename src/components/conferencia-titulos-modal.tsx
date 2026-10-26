"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BotaoSigilo, useValoresVisiveis } from "@/components/botao-sigilo";
import { Dinheiro, Sigilo, btnPrimario, btnSecundario, inputBase } from "@/components/ui";
import { prepararConferenciaSelecionados, conferirTitulosSelecionados } from "@/app/(app)/unificacao/conferencia-lote-actions";
import type { DominioConferenciaLote, PreviaConferenciaLote, ResultadoConferenciaLote } from "@/lib/unificacao/tipos-conferencia-lote";

const rotulos = { CONFERIR: "Será conferido", JA_CONFERIDO: "Já conferido · sem alteração", BLOQUEADO: "Precisa de revisão individual" };

export function ResumoConferenciaLote({ previa }: { previa: PreviaConferenciaLote }) {
  return <div className="space-y-4">
    <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-950"><strong className="block text-xl">{previa.resumo.conferiveis}</strong>Para marcar como conferidos</p>
      <p className="rounded-lg border border-contorno bg-slate-50 p-3"><strong className="block text-xl">{previa.resumo.jaConferidos}</strong>Já conferidos</p>
      <p className="rounded-lg border border-contorno bg-slate-50 p-3"><strong className="block text-xl">{previa.resumo.bloqueados}</strong>Preservados para revisão</p>
    </div>
    <div className="rounded-xl border border-contorno p-3">
      <p className="text-sm font-semibold">O que será acrescentado aos totais</p>
      <p className="mt-1 text-xs leading-relaxed text-tinta-suave">Somente os valores que ainda estavam fora dos totais. O que já está incluído não será somado novamente.</p>
      <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">{[{ rotulo: "Devido", valor: previa.impacto.devido }, { rotulo: previa.dominio === "PAGAR" ? "Pago" : "Recebido", valor: previa.impacto.pago }, { rotulo: "Em aberto", valor: previa.impacto.aberto }].map(item => <div key={item.rotulo} className="min-w-0"><dt className="text-xs text-tinta-suave">{item.rotulo}</dt><dd className="mt-1 break-words font-semibold"><Sigilo><Dinheiro centavos={item.valor} /></Sigilo></dd></div>)}</dl>
    </div>
    <ul aria-label="Lançamentos selecionados para conferência" className="max-h-64 divide-y divide-contorno overflow-y-auto rounded-xl border border-contorno">
      {previa.itens.map(item => <li key={item.chave} className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
        <div className="min-w-0 flex-[1_1_16rem]"><p className="break-words font-semibold">{item.titulo}</p><p className={`mt-1 text-xs font-semibold ${item.estado === "BLOQUEADO" ? "text-amber-800" : item.estado === "CONFERIR" ? "text-oliva-escura" : "text-tinta-suave"}`}>{rotulos[item.estado]}</p><p className="mt-1 break-words text-xs leading-relaxed text-tinta-suave">{item.motivo}</p></div>
        <div className="max-w-full text-right"><Sigilo><Dinheiro centavos={item.valor} /></Sigilo></div>
      </li>)}
    </ul>
    <p className="rounded-lg bg-oliva/5 p-3 text-xs leading-relaxed"><strong>Uma conferência para a seleção.</strong> Os lançamentos elegíveis serão confirmados como independentes. Esta ação não cria títulos, pagamentos ou movimentos de caixa. Cópias já vinculadas e registros bloqueados permanecem como estão.</p>
  </div>;
}

export function ConferenciaTitulosModal({ dominio, chaves, aoFechar, aoConcluir }: {
  dominio: DominioConferenciaLote;
  chaves: string[];
  aoFechar: () => void;
  aoConcluir: (resultado: ResultadoConferenciaLote) => void;
}) {
  const router = useRouter();
  const tituloId = useId();
  const notaId = useId();
  const dialogo = useRef<HTMLDialogElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const aviso = useRef<HTMLParagraphElement>(null);
  const montado = useRef(false);
  const iniciou = useRef(false);
  const enviando = useRef(false);
  const atualizouAoFechar = useRef(false);
  const visiveis = useValoresVisiveis();
  const [previa, setPrevia] = useState<PreviaConferenciaLote | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [fase, setFase] = useState<"PREPARANDO" | "PRONTO" | "SALVANDO" | "ERRO">("PREPARANDO");
  const [justificativa, setJustificativa] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const [pendente, iniciar] = useTransition();

  const preparar = useCallback(() => {
    if (enviando.current) return;
    enviando.current = true;
    setFase("PREPARANDO"); setErro(null); setPrevia(null); setConfirmado(false);
    iniciar(async () => {
      try {
        const resposta = await prepararConferenciaSelecionados({ dominio, chaves });
        if (!montado.current) return;
        if (resposta.estado === "PRONTO") { setPrevia(resposta.previa); setFase("PRONTO"); }
        else { setErro(resposta.mensagem); setFase("ERRO"); }
      } catch {
        if (montado.current) { setErro("Não foi possível preparar a conferência. Verifique sua conexão e tente novamente."); setFase("ERRO"); }
      } finally { enviando.current = false; }
    });
  }, [dominio, chaves]);

  useEffect(() => {
    const elemento = dialogo.current;
    const focoAnterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    montado.current = true;
    elemento?.showModal();
    titulo.current?.focus({ preventScroll: true });
    if (!iniciou.current) { iniciou.current = true; preparar(); }
    return () => {
      montado.current = false;
      elemento?.close();
      document.body.style.overflow = overflowAnterior;
      if (focoAnterior?.isConnected) focoAnterior.focus({ preventScroll: true });
    };
  }, [preparar]);
  useEffect(() => { if (erro) aviso.current?.focus({ preventScroll: true }); }, [erro]);

  function fechar() {
    if (fase === "SALVANDO") return;
    // Uma resposta perdida pode deixar a lista antiga mesmo após o commit.
    // A prévia é somente leitura; ao voltar, recupera a lista sem nova escrita.
    if (previa && !previa.resumo.conferiveis && previa.resumo.jaConferidos > 0 && !atualizouAoFechar.current) {
      atualizouAoFechar.current = true;
      router.refresh();
    }
    aoFechar();
  }
  function confirmar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!previa || !previa.resumo.conferiveis || !confirmado || !visiveis || pendente || enviando.current) return;
    enviando.current = true; setFase("SALVANDO"); setErro(null);
    iniciar(async () => {
      try {
        const resposta = await conferirTitulosSelecionados({ dominio, chaves, assinatura: previa.assinatura, confirmado: true, justificativa: justificativa.trim() || undefined });
        if (!montado.current) return;
        if (resposta.estado === "CONCLUIDO") aoConcluir(resposta.resultado);
        else { setPrevia(null); setConfirmado(false); setFase("ERRO"); setErro(resposta.mensagem); }
      } catch {
        if (montado.current) {
          setPrevia(null); setConfirmado(false); setFase("ERRO");
          setErro("Não foi possível confirmar o resultado. Confira novamente a seleção; os registros já conferidos não serão somados outra vez.");
        }
      } finally { enviando.current = false; }
    });
  }

  return <dialog ref={dialogo} className="janela-financeira" style={{ width: "min(840px, calc(100vw - 24px))" }} aria-labelledby={tituloId} onCancel={event => { event.preventDefault(); fechar(); }}>
    <header className="janela-financeira-cabecalho">
      <div className="min-w-0"><p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-oliva-escura">{dominio === "PAGAR" ? "Contas a pagar" : "Contas a receber"}</p><h2 id={tituloId} ref={titulo} tabIndex={-1} className="text-lg font-bold outline-none">Marcar selecionados como conferidos</h2><p className="mt-1 text-xs text-tinta-suave">{chaves.length} lançamento(s) selecionado(s). Sua lista e seus filtros continuam aqui.</p></div>
      <div className="flex shrink-0 flex-wrap gap-2"><BotaoSigilo /><button type="button" onClick={fechar} disabled={fase === "SALVANDO"} className={btnSecundario} aria-label="Fechar conferência em lote">Fechar ×</button></div>
    </header>
    <div className="janela-financeira-conteudo">
      {fase === "PREPARANDO" && <p role="status" className="flex items-center gap-3 py-8 text-sm font-semibold"><span aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-contorno border-t-oliva" />Preparando a seleção… Nenhum lançamento foi alterado.</p>}
      {erro && <div className="space-y-3"><p ref={aviso} tabIndex={-1} role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{erro}</p><button type="button" onClick={preparar} disabled={pendente} className={btnSecundario}>Conferir seleção novamente</button></div>}
      {previa && <form onSubmit={confirmar} aria-busy={fase === "SALVANDO"} className="space-y-5">
        <ResumoConferenciaLote previa={previa} />
        {previa.resumo.conferiveis > 0 ? <fieldset disabled={pendente} className="min-w-0 space-y-4 disabled:opacity-60">
          <label htmlFor={notaId} className="block text-sm font-semibold">Observação (opcional)<textarea id={notaId} maxLength={500} rows={2} value={justificativa} onChange={event => setJustificativa(event.target.value)} className={`${inputBase} mt-2 w-full`} placeholder="Ex.: documentos conferidos com o extrato." /></label>
          <label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" checked={confirmado} onChange={event => setConfirmado(event.target.checked)} required className="mt-1 h-4 w-4 shrink-0 accent-oliva" /><span>Conferi os selecionados e confirmo que os lançamentos elegíveis são independentes, não são cópias uns dos outros.</span></label>
          {!visiveis && <p className="text-xs text-tinta-suave">Use “Ver valores” para conferir o impacto antes de confirmar.</p>}
          <div className="flex flex-wrap gap-3"><button type="submit" disabled={pendente || !confirmado || !visiveis} className={btnPrimario}>{fase === "SALVANDO" ? "Conferindo seleção…" : `Confirmar ${previa.resumo.conferiveis} lançamento(s)`}</button><button type="button" onClick={fechar} className={btnSecundario}>Cancelar</button></div>
        </fieldset> : <div className="space-y-3"><p role="status" className="text-sm text-tinta-suave">Nenhum lançamento precisa ou pode ser conferido por esta seleção. Os já conferidos e os bloqueados permanecem como estão.</p><button type="button" onClick={fechar} className={btnSecundario}>Voltar para a lista</button></div>}
        {fase === "SALVANDO" && <p role="status" className="text-sm font-semibold text-oliva-escura">Registrando a conferência em uma única operação. Aguarde o resultado.</p>}
      </form>}
    </div>
  </dialog>;
}
