"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { Dinheiro, Sigilo, btnSecundario, inputBase } from "@/components/ui";
import { prepararExclusaoTitulos, excluirTitulosSelecionados } from "@/app/(app)/cadastros/governanca/lote-actions";
import type { DominioExclusaoTitulos, PreviaExclusaoTitulos, ResultadoExclusaoTitulos } from "@/lib/governanca/exclusao-titulos-lote-tipos";

const btnExcluir = "inline-flex min-h-10 items-center justify-center rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-wait disabled:opacity-50";
type Concluido = Extract<ResultadoExclusaoTitulos, { estado: "CONCLUIDO" }>;

export function ResumoPreviaExclusao({ previa }: { previa: PreviaExclusaoTitulos }) {
  return <div className="space-y-3">
    <p className="text-sm font-semibold">Confira {previa.itens.length === 1 ? "o registro selecionado" : `os ${previa.itens.length} registros selecionados`}:</p>
    <ul className="max-h-64 divide-y divide-contorno overflow-y-auto rounded-xl border border-contorno bg-carta">
      {previa.itens.map(item => <li key={item.chave} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
        <div className="min-w-0 flex-[1_1_15rem]">
          <p className="break-words font-semibold">{item.nome}</p>
          {item.referencia && <p className="mt-1 break-words text-xs text-tinta-suave">{item.referencia}</p>}
          <p className="mt-1 text-[11px] text-tinta-suave">{item.chave.startsWith("WIDESYS:") ? "Widesys" : "Brisa"}{item.status === "EXCLUIDO" ? " · já excluído; não será excluído novamente" : ""}</p>
          {!!(item.vinculos.pagamentos + item.vinculos.boletos + item.vinculos.baixas) && <p className="mt-1 text-[11px] text-tinta-suave">Vínculos preservados: {item.vinculos.pagamentos} pagamento(s), {item.vinculos.boletos} boleto(s), {item.vinculos.baixas} baixa(s).</p>}
        </div>
        {item.valor !== null && <div className="max-w-full text-right text-sm"><Sigilo><Dinheiro centavos={item.valor} /></Sigilo></div>}
      </li>)}
    </ul>
    <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950"><strong>Somente no Brisa.</strong> Os selecionados saem das listas e dos totais atuais. A origem e o histórico ficam preservados para restauração na lixeira. Não cancela boletos, não estorna pagamentos e não altera fechamentos concluídos.</p>
  </div>;
}

/** Abre imediatamente; consulta somente a seleção, sem navegar nem recarregar a lista. */
export function ExclusaoTitulosModal({ dominio, chaves, aoFechar, aoConcluir }: {
  dominio: DominioExclusaoTitulos;
  chaves: string[];
  aoFechar: () => void;
  aoConcluir: (resultado: Concluido) => void;
}) {
  const tituloId = useId();
  const motivoId = useId();
  const dialogo = useRef<HTMLDialogElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const aviso = useRef<HTMLParagraphElement>(null);
  const montado = useRef(false);
  const iniciou = useRef(false);
  const enviando = useRef(false);
  const [previa, setPrevia] = useState<PreviaExclusaoTitulos | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [fase, setFase] = useState<"CONFERINDO" | "PRONTO" | "EXCLUINDO" | "ERRO">("CONFERINDO");
  const [motivo, setMotivo] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const [pendente, iniciar] = useTransition();

  const conferir = useCallback(() => {
    if (enviando.current) return;
    enviando.current = true;
    setFase("CONFERINDO"); setErro(null); setPrevia(null); setConfirmado(false);
    iniciar(async () => {
      try {
        const form = new FormData();
        form.set("dominio", dominio); form.set("chaves", JSON.stringify(chaves));
        const resultado = await prepararExclusaoTitulos(form);
        if (!montado.current) return;
        if (resultado.estado === "PRONTO") { setPrevia(resultado.previa); setFase("PRONTO"); }
        else { setErro(resultado.estado === "ERRO" ? resultado.mensagem : "Atualize a lista para conferir a situação destes registros."); setFase("ERRO"); }
      } catch {
        if (montado.current) { setErro("Não foi possível conferir a seleção. Verifique sua conexão e seu acesso e tente novamente."); setFase("ERRO"); }
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
    if (!iniciou.current) { iniciou.current = true; conferir(); }
    return () => {
      montado.current = false;
      elemento?.close();
      document.body.style.overflow = overflowAnterior;
      if (focoAnterior?.isConnected) focoAnterior.focus({ preventScroll: true });
    };
  }, [conferir]);

  useEffect(() => { if (erro) aviso.current?.focus({ preventScroll: true }); }, [erro]);

  function fechar() {
    if (fase === "EXCLUINDO" || enviando.current && fase !== "CONFERINDO") return;
    aoFechar();
  }

  function confirmar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!previa || pendente || enviando.current || !confirmado || motivo.trim().length < 5) return;
    enviando.current = true;
    setFase("EXCLUINDO"); setErro(null);
    const form = new FormData();
    form.set("dominio", dominio);
    form.set("itens", JSON.stringify(previa.itens.map(({ chave, assinatura }) => ({ chave, assinatura }))));
    form.set("motivo", motivo.trim()); form.set("confirmar", "sim"); form.set("cienciaExclusao", "sim");
    iniciar(async () => {
      try {
        const resultado = await excluirTitulosSelecionados(form);
        if (!montado.current) return;
        if (resultado.estado === "CONCLUIDO") aoConcluir(resultado);
        else {
          setPrevia(null); setConfirmado(false); setFase("ERRO");
          setErro(resultado.estado === "ERRO" ? resultado.mensagem : "Confira novamente a seleção antes de confirmar.");
        }
      } catch {
        if (montado.current) {
          setPrevia(null); setConfirmado(false); setFase("ERRO");
          setErro("Não foi possível confirmar o resultado. Confira novamente a seleção antes de repetir; os registros já excluídos não serão duplicados.");
        }
      } finally { enviando.current = false; }
    });
  }

  return <dialog ref={dialogo} className="janela-financeira" style={{ width: "min(760px, calc(100vw - 24px))" }} aria-labelledby={tituloId} onCancel={event => { event.preventDefault(); fechar(); }}>
    <header className="janela-financeira-cabecalho">
      <div className="min-w-0"><p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-erro">{dominio === "PAGAR" ? "Contas a pagar" : "Contas a receber"}</p><h2 id={tituloId} ref={titulo} tabIndex={-1} className="text-lg font-bold outline-none">{chaves.length === 1 ? "Excluir lançamento" : `Excluir ${chaves.length} lançamentos`}</h2><p className="mt-1 text-xs text-tinta-suave">Somente os registros selecionados. Sua lista e seus filtros continuam aqui.</p></div>
      <button type="button" disabled={fase === "EXCLUINDO"} onClick={fechar} aria-label="Fechar sem excluir" className={`${btnSecundario} shrink-0 disabled:opacity-50`}>Fechar ×</button>
    </header>
    <div className="janela-financeira-conteudo">
      {fase === "CONFERINDO" && <p role="status" aria-live="polite" className="flex items-center gap-3 py-8 text-sm font-semibold"><span aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-contorno border-t-oliva" />Conferindo seleção… Nenhum registro foi excluído.</p>}
      {erro && <div className="space-y-3"><p ref={aviso} tabIndex={-1} role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{erro}</p><button type="button" disabled={pendente} onClick={conferir} className={btnSecundario}>Conferir novamente</button></div>}
      {previa && <form onSubmit={confirmar} aria-busy={fase === "EXCLUINDO"} className="space-y-5">
        <ResumoPreviaExclusao previa={previa} />
        <fieldset disabled={pendente} className="min-w-0 space-y-4 disabled:opacity-60">
          <label htmlFor={motivoId} className="block text-sm font-semibold">Por que excluir?<textarea id={motivoId} required minLength={5} maxLength={500} rows={2} value={motivo} onChange={event => setMotivo(event.target.value)} className={`${inputBase} mt-2 w-full`} placeholder="Ex.: lançamentos duplicados já conferidos." /></label>
          <label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" required checked={confirmado} onChange={event => setConfirmado(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-red-700" /><span>Conferi os registros selecionados. Entendo que esta exclusão é somente no Brisa e não cancela nem estorna operações externas.</span></label>
          <div className="flex flex-wrap gap-3"><button type="submit" className={btnExcluir} disabled={pendente || !confirmado || motivo.trim().length < 5}>{fase === "EXCLUINDO" ? "Excluindo…" : `Confirmar exclusão${chaves.length > 1 ? ` de ${chaves.length} registros` : ""}`}</button><button type="button" onClick={fechar} className={btnSecundario}>Cancelar</button></div>
        </fieldset>
        {fase === "EXCLUINDO" && <p role="status" aria-live="polite" className="text-sm font-semibold text-oliva-escura">Processando a seleção em uma única operação. Aguarde a confirmação; não é preciso clicar novamente.</p>}
      </form>}
    </div>
  </dialog>;
}
