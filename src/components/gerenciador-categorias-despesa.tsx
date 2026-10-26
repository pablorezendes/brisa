"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { carregarCategoriasDespesas, gravarCategoriaDespesa } from "@/app/(app)/financeiro/contas-a-pagar/categorias-actions";
import type { CategoriaDespesaCatalogo } from "@/lib/despesas/tipos-catalogo";
import { btnPrimario, btnSecundario, inputBase } from "@/components/ui";
import { EditorCategoriaDespesa } from "./editor-categoria-despesa";

export function GerenciadorCategoriasDespesa({ aoFechar }: { aoFechar: () => void }) {
  const tituloId = useId();
  const dialogo = useRef<HTMLDialogElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const vivo = useRef(false);
  const iniciou = useRef(false);
  const enviando = useRef(false);
  const [categorias, setCategorias] = useState<CategoriaDespesaCatalogo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [gerenciavel, setGerenciavel] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [busca, setBusca] = useState("");
  const [inativas, setInativas] = useState(false);
  const [edicao, setEdicao] = useState<CategoriaDespesaCatalogo | "NOVA" | null>(null);
  const [alterado, setAlterado] = useState(false);
  const [confirmarFechar, setConfirmarFechar] = useState(false);
  const carregar = useCallback(async () => {
    setCarregando(true); setErro("");
    try {
      const resposta = await carregarCategoriasDespesas();
      if (!vivo.current) return;
      if (resposta.ok) { setCategorias(resposta.categorias); setGerenciavel(resposta.gerenciavel); }
      else setErro(resposta.mensagem);
    } catch { if (vivo.current) setErro("Não foi possível carregar as categorias. Tente novamente."); }
    finally { if (vivo.current) setCarregando(false); }
  }, []);
  useEffect(() => {
    const elemento = dialogo.current;
    const foco = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; vivo.current = true;
    elemento?.showModal(); titulo.current?.focus();
    if (!iniciou.current) { iniciou.current = true; void carregar(); }
    return () => { vivo.current = false; elemento?.close(); document.body.style.overflow = overflow; if (foco?.isConnected) foco.focus({ preventScroll: true }); };
  }, [carregar]);
  function fechar() { if (!ocupado) { if (alterado) setConfirmarFechar(true); else aoFechar(); } }
  async function alternar(categoria: CategoriaDespesaCatalogo) {
    if (enviando.current || ocupado) return;
    enviando.current = true; setOcupado(true); setErro(""); setMensagem("");
    try {
      const resposta = await gravarCategoriaDespesa({ ...categoria, ativa: !categoria.ativa });
      if (!vivo.current) return;
      if (resposta.ok) { setCategorias(resposta.categorias); setMensagem(`${categoria.rotulo}: categoria ${resposta.categoria.ativa ? "reativada" : "inativada"}. Os lançamentos anteriores foram preservados.`); }
      else setErro(resposta.mensagem);
    } catch { if (vivo.current) setErro("Não foi possível confirmar a alteração. Atualize a lista antes de tentar novamente."); }
    finally { enviando.current = false; if (vivo.current) setOcupado(false); }
  }
  const normalizar = (texto: string) => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const visiveis = categorias.filter(categoria => (inativas || categoria.ativa) && normalizar(categoria.rotulo).includes(normalizar(busca.trim())));
  return <dialog ref={dialogo} className="janela-financeira text-left" style={{ width: "min(800px, calc(100vw - 24px))" }} aria-labelledby={tituloId} onCancel={event => { event.preventDefault(); fechar(); }}>
    <header className="janela-financeira-cabecalho flex-wrap"><div className="min-w-0 flex-1"><p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-oliva">Contas a pagar</p><h2 id={tituloId} ref={titulo} tabIndex={-1} className="text-lg font-bold outline-none">Categorias de despesas</h2><p className="mt-1 text-xs leading-relaxed text-tinta-suave">Organize os tipos de gasto usados nos novos lançamentos.</p></div><button type="button" disabled={ocupado} className={btnSecundario} onClick={fechar} aria-label="Fechar categorias">Fechar ×</button></header>
    <div className="janela-financeira-conteudo space-y-4">
      {confirmarFechar && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm"><p className="font-semibold">A categoria ainda não foi salva.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={btnPrimario} onClick={() => setConfirmarFechar(false)}>Continuar editando</button><button type="button" className={btnSecundario} onClick={aoFechar}>Sair sem salvar</button></div></div>}
      {carregando && <p role="status" className="py-5 text-sm">Carregando categorias…</p>}
      {erro && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"><p>{erro}</p><button type="button" className={`${btnSecundario} mt-2`} disabled={ocupado} onClick={() => void carregar()}>Atualizar lista</button></div>}
      {mensagem && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">{mensagem}</p>}
      {!carregando && gerenciavel && <>
        <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-tinta-suave">Renomear organiza o catálogo. Os lançamentos já registrados mantêm a classificação da época. Inativar retira a categoria das novas despesas; não apaga despesas nem pagamentos.</p>
        {edicao ? <EditorCategoriaDespesa key={edicao === "NOVA" ? "nova" : edicao.codigo} inicial={edicao === "NOVA" ? undefined : edicao} aoOcupar={setOcupado} aoAlterar={() => setAlterado(true)} aoCancelar={() => { setEdicao(null); setAlterado(false); }} aoSalvar={(categoria, todas) => { setCategorias(todas); setEdicao(null); setAlterado(false); setMensagem(`Categoria “${categoria.rotulo}” salva.`); }} /> : <button type="button" className={btnPrimario} disabled={ocupado} onClick={() => { setEdicao("NOVA"); setMensagem(""); }}>+ Nova categoria</button>}
        <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-xs font-semibold">Buscar categoria<input type="search" maxLength={120} value={busca} onChange={event => setBusca(event.target.value)} className={`${inputBase} mt-1.5 w-full min-w-0`} placeholder="Nome da categoria" /></label><label className="flex min-h-10 items-center gap-2 text-xs"><input type="checkbox" checked={inativas} onChange={event => setInativas(event.target.checked)} />Mostrar inativas</label></div>
        <ul aria-label="Categorias cadastradas" className="divide-y divide-contorno rounded-xl border border-contorno">{visiveis.map(categoria => <li key={categoria.codigo} className="flex flex-wrap items-center justify-between gap-3 p-3"><div className="min-w-0 flex-[1_1_15rem]"><p className="break-words text-sm font-semibold">{categoria.rotulo}</p><p className="mt-1 text-[11px] text-tinta-suave">{categoria.ativa ? "Ativa" : "Inativa"}{categoria.restrita ? " · Restrita ao administrador" : ""}{categoria.padrao ? " · Categoria inicial" : ""}</p></div><div className="flex shrink-0 flex-wrap gap-2"><button type="button" className={btnSecundario} disabled={ocupado || Boolean(edicao)} aria-label={`Editar categoria ${categoria.rotulo}`} onClick={() => { setEdicao(categoria); setMensagem(""); }}>Editar</button><button type="button" className={btnSecundario} disabled={ocupado || Boolean(edicao)} aria-label={`${categoria.ativa ? "Inativar" : "Reativar"} categoria ${categoria.rotulo}`} onClick={() => void alternar(categoria)}>{categoria.ativa ? "Inativar" : "Reativar"}</button></div></li>)}</ul>
        {!visiveis.length && <p role="status" className="py-3 text-sm text-tinta-suave">Nenhuma categoria encontrada com esses filtros.</p>}
      </>}
      {!carregando && !gerenciavel && !erro && <p className="py-3 text-sm text-tinta-suave">O cadastro de categorias é gerenciado pelo administrador.</p>}
    </div>
  </dialog>;
}
