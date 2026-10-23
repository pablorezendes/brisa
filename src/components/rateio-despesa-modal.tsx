"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { BotaoSigilo, useValoresVisiveis } from "@/components/botao-sigilo";
import { Dinheiro, Sigilo, btnPrimario, btnSecundario, inputBase } from "@/components/ui";
import { carregarRateioDespesa, procurarPagamentoDespesa, salvarRateioDespesa } from "@/app/(app)/financeiro/contas-a-pagar/rateio-actions";
import type { DespesaEditor, PagamentoDisponivel, PagamentoDespesaEntrada, SalvarDespesaEntrada } from "@/lib/despesas/tipos";
import { LIMITE_RATEIOS } from "@/lib/despesas/tipos";
import { centavosRateio, conferirValoresRateio, linhasEditaveis, linhaVazia, valorEditavel, type RateioEditavel } from "./rateio-formulario";

type Selecao = { id?: string; origemChave?: string };
const campo = `${inputBase} mt-1.5 w-full min-w-0`;
const rotulo = "block min-w-0 text-xs font-semibold text-tinta";

export function RateioDespesaModal({ selecao, aoFechar }: { selecao: Selecao; aoFechar: () => void }) {
  const tituloId = useId();
  const dialogo = useRef<HTMLDialogElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const iniciado = useRef(false);
  const vivo = useRef(false);
  const [editor, setEditor] = useState<DespesaEditor | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [alterado, setAlterado] = useState(false);
  const [confirmarFechar, setConfirmarFechar] = useState(false);
  const idInicial = useRef(selecao);
  const carregar = useCallback(async () => {
    setCarregando(true); setErro("");
    try {
      const resposta = await carregarRateioDespesa(idInicial.current);
      if (!vivo.current) return;
      if (resposta.ok) setEditor(resposta.editor);
      else setErro(resposta.mensagem);
    } catch { if (vivo.current) setErro("Não foi possível abrir a despesa. Verifique sua conexão e seu acesso e tente novamente."); }
    finally { if (vivo.current) setCarregando(false); }
  }, []);
  useEffect(() => {
    const elemento = dialogo.current;
    const foco = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    vivo.current = true;
    elemento?.showModal(); titulo.current?.focus();
    if (!iniciado.current) { iniciado.current = true; void carregar(); }
    return () => { vivo.current = false; elemento?.close(); document.body.style.overflow = overflow; if (foco?.isConnected) foco.focus({ preventScroll: true }); };
  }, [carregar]);
  function fechar() { if (!ocupado) { if (alterado) setConfirmarFechar(true); else aoFechar(); } }
  return <dialog ref={dialogo} className="janela-financeira text-left" style={{ width: "min(1120px, calc(100vw - 24px))" }} aria-labelledby={tituloId} onCancel={event => { event.preventDefault(); fechar(); }}>
    <header className="janela-financeira-cabecalho flex-wrap">
      <div className="min-w-0 flex-[1_1_24rem]"><p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-oliva">Contas a pagar · rateio manual</p><h2 id={tituloId} ref={titulo} tabIndex={-1} className="text-lg font-bold outline-none">Uma nota. Um pagamento. Vários empreendimentos.</h2><p className="mt-1 text-xs text-tinta-suave">Distribua o custo sem duplicar o documento nem a saída no caixa.</p></div>
      <div className="flex shrink-0 flex-wrap gap-2"><BotaoSigilo /><button type="button" disabled={ocupado} onClick={fechar} className={btnSecundario} aria-label="Fechar rateio">Fechar ×</button></div>
    </header>
    <div className="janela-financeira-conteudo">
      {confirmarFechar && <div role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm"><p className="font-semibold">Há alterações ainda não salvas.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={btnPrimario} onClick={() => setConfirmarFechar(false)}>Continuar editando</button><button type="button" className={btnSecundario} onClick={aoFechar}>Sair sem salvar</button></div></div>}
      {carregando && <p role="status" className="py-10 text-sm font-semibold">Carregando somente esta despesa…</p>}
      {erro && <div role="alert" className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"><p>{erro}</p><button type="button" onClick={() => void carregar()} className={btnSecundario}>Tentar novamente</button></div>}
      {editor && !carregando && <FormularioRateioDespesa inicial={editor} aoOcupar={setOcupado} aoAlterar={setAlterado} aoFechar={fechar} />}
    </div>
  </dialog>;
}

export function ResumoRateio({ total, linhas }: { total: string; linhas: Pick<RateioEditavel, "valor">[] }) {
  const resumo = conferirValoresRateio(total, linhas);
  return <div className="grid grid-cols-1 gap-2 rounded-xl border border-contorno bg-slate-50/80 p-3 sm:grid-cols-3" aria-live="polite">
    {[{ nome: "Total da nota", valor: resumo.total }, { nome: "Distribuído", valor: resumo.distribuido }, { nome: resumo.restante < 0 ? "Acima do total" : "Falta distribuir", valor: Math.abs(resumo.restante) }].map(item => <div key={item.nome} className="min-w-0 rounded-lg bg-carta p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-tinta-suave">{item.nome}</p><p className={`mt-1 max-w-full break-words text-lg font-semibold ${item.nome === "Acima do total" ? "text-erro" : ""}`}><Sigilo><Dinheiro centavos={item.valor} /></Sigilo></p></div>)}
    <p className="text-xs leading-relaxed text-tinta-suave sm:col-span-3">{resumo.completo ? "Os valores fecham. Confira os empreendimentos e as descrições antes de confirmar." : "Informe o valor de cada serviço. A conferência só é concluída quando a soma fecha exatamente; você pode salvar um rascunho."}</p>
  </div>;
}

export function FormularioRateioDespesa({ inicial, aoOcupar, aoAlterar, aoFechar }: { inicial: DespesaEditor; aoOcupar: (valor: boolean) => void; aoAlterar: (valor: boolean) => void; aoFechar: () => void }) {
  const visiveis = useValoresVisiveis();
  const [editor, setEditor] = useState(inicial);
  const [documento, setDocumento] = useState({ ...inicial.documento, totalTexto: valorEditavel(inicial.documento.total) });
  const [linhas, setLinhas] = useState(() => linhasEditaveis(inicial));
  const [modoPagamento, setModoPagamento] = useState<PagamentoDespesaEntrada["modo"]>("MANTER");
  const [busca, setBusca] = useState("");
  const [pagamentos, setPagamentos] = useState<PagamentoDisponivel[]>([]);
  const [pagamentoSelecionado, setPagamentoSelecionado] = useState<PagamentoDisponivel | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [buscou, setBuscou] = useState(false);
  const [pagamentoNovo, setPagamentoNovo] = useState({ data: "", centroCusto: "", categoria: "", via: "PIX", contaBancariaId: "" });
  const [cientePagamento, setCientePagamento] = useState(false);
  const [confirmaFonte, setConfirmaFonte] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [anexando, setAnexando] = useState(false);
  const [reabrirNecessario, setReabrirNecessario] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const envio = useRef(false);
  const aviso = useRef<HTMLParagraphElement>(null);
  const versaoBusca = useRef(0);
  const legado = Boolean(editor.documento.origemChave);
  const temPagamento = editor.pagamento.origem !== "NENHUM";
  const resumo = conferirValoresRateio(documento.totalTexto, linhas);
  useEffect(() => { if (erro) aviso.current?.focus(); }, [erro]);
  function alterarDocumento(campoDocumento: keyof typeof documento, valor: string) {
    setDocumento(atual => ({ ...atual, [campoDocumento]: valor })); aoAlterar(true); setSucesso("");
    if (campoDocumento === "totalTexto") { versaoBusca.current++; setPagamentoSelecionado(null); setPagamentos([]); setBuscou(false); }
  }
  function alterarLinha(chave: string, dados: Partial<RateioEditavel>) { setLinhas(atuais => atuais.map(linha => linha.chave === chave ? { ...linha, ...dados } : linha)); aoAlterar(true); setSucesso(""); }
  async function buscar() {
    if (resumo.total === null || resumo.total <= 0 || buscando) return;
    const versao = ++versaoBusca.current;
    setBuscando(true); setErro(""); setPagamentoSelecionado(null); setPagamentos([]); setBuscou(false);
    try {
      const resposta = await procurarPagamentoDespesa({ termo: busca, total: resumo.total });
      if (versao !== versaoBusca.current) return;
      if (resposta.ok) { setPagamentos(resposta.pagamentos); setBuscou(true); } else setErro(resposta.mensagem);
    } catch { setErro("Não foi possível consultar as saídas. Tente novamente antes de registrar um novo pagamento."); }
    finally { setBuscando(false); }
  }
  async function salvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (envio.current || salvando || anexando || reabrirNecessario) return;
    const statusRateio = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "CONFERIDO" ? "CONFERIDO" : "RASCUNHO";
    setErro(""); setSucesso("");
    if (resumo.total === null || resumo.total <= 0) { setErro("Informe um total válido, maior que zero, com no máximo dois centavos decimais."); return; }
    if (statusRateio === "CONFERIDO" && !resumo.completo) { setErro("A soma do rateio precisa fechar exatamente com o total da nota."); return; }
    const aproveitadas = linhas.filter(linha => linha.empreendimentoId || linha.unidadeId || linha.descricao.trim() || linha.categoria?.trim() || linha.valor.trim());
    if (aproveitadas.some(linha => !linha.empreendimentoId || !linha.descricao.trim() || !centavosRateio(linha.valor))) { setErro("Em cada linha preenchida, informe o empreendimento, o serviço e um valor maior que zero. Remova as linhas incompletas para salvar um rascunho."); return; }
    let pagamento: PagamentoDespesaEntrada = { modo: "MANTER" };
    if (modoPagamento === "VINCULAR") {
      if (!pagamentoSelecionado) { setErro("Busque e selecione a saída já existente no caixa."); return; }
      pagamento = { modo: "VINCULAR", lancamentoCaixaId: pagamentoSelecionado.id, assinatura: pagamentoSelecionado.assinatura, via: pagamentoNovo.via };
    } else if (modoPagamento === "REGISTRAR") {
      if (!cientePagamento) { setErro("Confirme que o pagamento já aconteceu e não existe no caixa."); return; }
      pagamento = { modo: "REGISTRAR", ...pagamentoNovo, contaBancariaId: pagamentoNovo.contaBancariaId || null };
    }
    const entrada: SalvarDespesaEntrada = {
      requestId, id: documento.id, origemChave: documento.origemChave, origemHash: documento.origemHash, versao: documento.versao,
      confirmarFonteAlterada: confirmaFonte, fornecedorNome: documento.fornecedorNome, fornecedorDocumento: documento.fornecedorDocumento,
      numero: documento.numero, serie: documento.serie, tomadorNome: documento.tomadorNome, tomadorDocumento: documento.tomadorDocumento,
      emissao: documento.emissao, competencia: documento.competencia, vencimento: documento.vencimento,
      total: resumo.total, statusRateio, rateios: aproveitadas.map(({ empreendimentoId, unidadeId, descricao, categoria, valor }) => ({ empreendimentoId, unidadeId: unidadeId || null, descricao, categoria: categoria || null, valor: centavosRateio(valor)! })), pagamento,
    };
    envio.current = true; setSalvando(true); aoOcupar(true);
    try {
      const resposta = await salvarRateioDespesa(entrada);
      if (!resposta.ok) { setErro(resposta.mensagem); return; }
      const atualizado = await carregarRateioDespesa({ id: resposta.resultado.id }).catch(() => null);
      if (atualizado?.ok) {
        setEditor(atualizado.editor); setDocumento({ ...atualizado.editor.documento, totalTexto: valorEditavel(atualizado.editor.documento.total) });
        setLinhas(linhasEditaveis(atualizado.editor));
      } else {
        setDocumento(atual => ({ ...atual, id: resposta.resultado.id, versao: resposta.resultado.versao }));
        setReabrirNecessario(true);
        setErro("O rateio foi salvo, mas não foi possível recarregar os detalhes. Feche e abra novamente antes de editar.");
      }
      setModoPagamento("MANTER"); setCientePagamento(false); setPagamentoSelecionado(null); setConfirmaFonte(false); setRequestId(crypto.randomUUID()); aoAlterar(false);
      setSucesso(statusRateio === "CONFERIDO" ? "Rateio conferido e salvo. O custo foi distribuído sem duplicar a nota ou o pagamento." : "Rascunho salvo. O valor ainda não distribuído continua pendente de rateio.");
    } catch { setErro("Não foi possível confirmar o resultado. Você pode tentar salvar novamente sem duplicar a operação; não altere os dados antes de confirmar."); }
    finally { envio.current = false; setSalvando(false); aoOcupar(false); }
  }
  const dadosTexto = [
    { chave: "fornecedorNome", nome: "Fornecedor / prestador", obrigatorio: true },
    { chave: "fornecedorDocumento", nome: "CPF/CNPJ do fornecedor", obrigatorio: false },
    { chave: "numero", nome: "Número da nota", obrigatorio: true },
    { chave: "serie", nome: "Série (opcional)", obrigatorio: false },
  ] as const;
  return <div className="space-y-5">
    <form onSubmit={event => void salvar(event)} className="space-y-5" aria-busy={salvando}>
      {erro && <p ref={aviso} tabIndex={-1} role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{erro}</p>}
      {sucesso && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{sucesso}</p>}
      {editor.documento.fonteAlterada && <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><input type="checkbox" checked={confirmaFonte} onChange={event => setConfirmaFonte(event.target.checked)} className="mt-1 shrink-0" /><span>A origem foi atualizada depois do último rateio. Conferi novamente os dados e autorizo salvar o rateio sobre os valores atuais.</span></label>}
      <fieldset disabled={salvando || anexando || reabrirNecessario} className="min-w-0 space-y-5 disabled:opacity-60">
        <section className="rounded-xl border border-contorno p-4">
          <h3 className="text-sm font-bold">1. Documento único</h3>
          <p className="mt-1 text-xs leading-relaxed text-tinta-suave">{legado ? "Este título veio do Widesys. Você pode completar os dados locais da nota. O valor, o pagamento e o registro de origem permanecem preservados." : "Cadastre uma vez. O tomador é quem consta na nota original, mesmo quando outros empreendimentos receberam o serviço."}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {dadosTexto.map(item => <label key={item.chave} className={rotulo}>{item.nome}<input value={documento[item.chave] ?? ""} onChange={event => alterarDocumento(item.chave, event.target.value)} required={item.obrigatorio} maxLength={item.chave === "fornecedorNome" ? 200 : 50} className={campo} /></label>)}
            <label className={rotulo}>Emissão da nota<input type="date" required value={documento.emissao} onChange={event => alterarDocumento("emissao", event.target.value)} className={campo} /></label>
            <label className={rotulo}>Competência do custo<input type="month" required value={documento.competencia} onChange={event => alterarDocumento("competencia", event.target.value)} className={campo} /></label>
            <label className={rotulo}>Vencimento (opcional)<input type="date" value={documento.vencimento ?? ""} onChange={event => alterarDocumento("vencimento", event.target.value)} className={campo} /></label>
            <label className={rotulo}>Total da nota (R$)<input type={visiveis ? "text" : "password"} inputMode="decimal" autoComplete="off" required readOnly={!visiveis || legado || temPagamento} value={documento.totalTexto} onChange={event => alterarDocumento("totalTexto", event.target.value)} className={`${campo} font-mono`} aria-describedby="rateio-valor-aviso" /></label>
            <label className={`${rotulo} sm:col-span-2`}>Nome do tomador na nota<input value={documento.tomadorNome ?? ""} onChange={event => alterarDocumento("tomadorNome", event.target.value)} maxLength={200} className={campo} placeholder="Informe como está no documento original" /></label>
            <label className={`${rotulo} sm:col-span-2`}>CPF/CNPJ do tomador<input value={documento.tomadorDocumento ?? ""} onChange={event => alterarDocumento("tomadorDocumento", event.target.value)} maxLength={20} className={campo} placeholder="Opcional, sem alterar o destinatário fiscal" /></label>
          </div>
          {!documento.fornecedorDocumento?.trim() && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-950">Informe o CPF/CNPJ do fornecedor para proteção adicional contra nota repetida. Sem esse dado, confira o fornecedor e o número antes de cadastrar outra nota.</p>}
        </section>
        <section className="space-y-4 rounded-xl border border-contorno p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-bold">2. Quanto pertence a cada empreendimento?</h3><p className="mt-1 text-xs text-tinta-suave">Digite os valores manualmente. Você pode repetir um empreendimento para descrever serviços diferentes.</p></div><span className="text-xs font-semibold text-tinta-suave">{documento.statusRateio === "CONFERIDO" ? "Rateio conferido" : "Rascunho"}</span></div>
          {!visiveis && <p id="rateio-valor-aviso" className="rounded-lg bg-slate-50 p-3 text-xs text-tinta-suave">Os valores estão ocultos. Use “Ver valores” no topo desta janela para preencher e conferir o rateio.</p>}
          <ResumoRateio total={documento.totalTexto} linhas={linhas} />
          <ol className="space-y-3">{linhas.map((linha, indice) => {
            const unidades = editor.empreendimentos.find(item => item.id === linha.empreendimentoId)?.unidades ?? [];
            return <li key={linha.chave} className="min-w-0 rounded-lg border border-contorno bg-slate-50/40 p-3">
              <div className="mb-3 flex items-center justify-between gap-2"><span className="text-xs font-bold text-tinta-suave">Serviço {indice + 1}</span><button type="button" onClick={() => { setLinhas(atuais => atuais.filter(item => item.chave !== linha.chave)); aoAlterar(true); }} className="min-h-8 rounded px-2 text-xs font-semibold text-erro hover:bg-erro/5" aria-label={`Remover serviço ${indice + 1}`}>Remover linha</button></div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className={rotulo}>Empreendimento<select value={linha.empreendimentoId} onChange={event => alterarLinha(linha.chave, { empreendimentoId: event.target.value, unidadeId: "" })} className={campo}><option value="">Selecione…</option>{editor.empreendimentos.map(item => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
                <label className={rotulo}>Imóvel (opcional)<select value={linha.unidadeId ?? ""} disabled={!linha.empreendimentoId} onChange={event => alterarLinha(linha.chave, { unidadeId: event.target.value })} className={campo}><option value="">Área comum / sem imóvel</option>{unidades.map(item => <option key={item.id} value={item.id}>{item.identificacao}</option>)}</select></label>
                <label className={rotulo}>Categoria (opcional)<input value={linha.categoria ?? ""} onChange={event => alterarLinha(linha.chave, { categoria: event.target.value })} maxLength={100} className={campo} placeholder="Ex.: manutenção elétrica" /></label>
                <label className={rotulo}>Valor deste serviço (R$)<input type={visiveis ? "text" : "password"} inputMode="decimal" autoComplete="off" readOnly={!visiveis} value={linha.valor} onChange={event => alterarLinha(linha.chave, { valor: event.target.value })} className={`${campo} font-mono`} placeholder={visiveis ? "0,00" : ""} /></label>
                <label className={`${rotulo} sm:col-span-2 lg:col-span-4`}>Serviço realizado<input value={linha.descricao} onChange={event => alterarLinha(linha.chave, { descricao: event.target.value })} maxLength={500} className={campo} placeholder="Descreva o serviço que pertence a este empreendimento" /></label>
              </div>
            </li>;
          })}</ol>
          <button type="button" disabled={linhas.length >= LIMITE_RATEIOS} onClick={() => { setLinhas(atuais => [...atuais, linhaVazia()]); aoAlterar(true); }} className={btnSecundario}>+ Adicionar empreendimento ou serviço</button>
        </section>
        <section className="rounded-xl border border-contorno p-4">
          <h3 className="text-sm font-bold">3. Um único pagamento</h3>
          {temPagamento ? <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><p className="font-semibold">{editor.pagamento.origem === "WIDESYS" ? "Pagamento preservado da origem Widesys" : "Saída já vinculada no caixa"}</p><p className="mt-2 flex flex-wrap gap-2 text-xs text-tinta-suave"><span>{editor.pagamento.situacao}</span><span>{editor.pagamento.data || "Sem data informada"}</span><Sigilo><Dinheiro centavos={editor.pagamento.valor} /></Sigilo></p><p className="mt-2 text-xs text-tinta-suave">Salvar o rateio não registra outro pagamento.{!editor.pagamento.ativo ? " Atenção: o movimento vinculado não está ativo. Confira a origem." : ""}</p></div>
            : !editor.permitePagamento || legado ? <p className="mt-2 text-xs text-tinta-suave">{legado ? "O pagamento segue o registro de origem. Nenhuma saída será criada por este rateio." : "Seu acesso permite distribuir os custos, mas não registrar pagamentos no caixa."}</p>
              : <div className="mt-3 space-y-4">
                <div className="grid gap-2 sm:grid-cols-3">{[{ valor: "MANTER", titulo: "Ainda não foi pago", detalhe: "Somente a conta a pagar." }, { valor: "VINCULAR", titulo: "Já está no caixa", detalhe: "Vincular uma saída existente, sem repetir." }, { valor: "REGISTRAR", titulo: "Foi pago, mas não está no caixa", detalhe: "Registrar uma única saída." }].map(item => <label key={item.valor} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-xs ${modoPagamento === item.valor ? "border-oliva bg-oliva/5" : "border-contorno"}`}><input type="radio" name="modoPagamento" value={item.valor} checked={modoPagamento === item.valor} onChange={() => { setModoPagamento(item.valor as PagamentoDespesaEntrada["modo"]); setCientePagamento(false); aoAlterar(true); }} className="mt-0.5" /><span><strong className="block">{item.titulo}</strong><span className="mt-1 block text-tinta-suave">{item.detalhe}</span></span></label>)}</div>
                {modoPagamento === "VINCULAR" && <div className="space-y-3"><div className="flex flex-wrap items-end gap-2"><label className={`${rotulo} min-w-48 flex-1`}>Localizar saída com o mesmo valor<input value={busca} onChange={event => setBusca(event.target.value)} className={campo} maxLength={100} placeholder="Descrição ou fornecedor" /></label><button type="button" disabled={buscando || !resumo.total} onClick={() => void buscar()} className={btnSecundario}>{buscando ? "Buscando…" : "Buscar no caixa"}</button></div>
                  {buscou && !pagamentos.length && <p role="status" className="text-xs text-tinta-suave">Nenhuma saída disponível encontrada com este valor. Confira a busca e os registros antes de criar outro pagamento.</p>}
                  <div className="max-h-64 space-y-2 overflow-y-auto">{pagamentos.map(item => <label key={item.id} className={`flex items-start gap-3 rounded-lg border p-3 text-xs ${pagamentoSelecionado?.id === item.id ? "border-oliva bg-oliva/5" : "border-contorno"}`}><input type="radio" name="pagamentoExistente" checked={pagamentoSelecionado?.id === item.id} onChange={() => { setPagamentoSelecionado(item); aoAlterar(true); }} className="mt-1" /><span className="min-w-0 flex-1"><strong className="block break-words">{item.descricao || "Saída sem descrição"}</strong><span className="mt-1 block text-tinta-suave">{item.data || "Sem data"} · {item.centroCusto}{item.caixaOrigem ? ` · ${item.caixaOrigem}` : ""}</span></span><Sigilo><Dinheiro centavos={item.valor} /></Sigilo></label>)}</div>
                </div>}
                {modoPagamento === "REGISTRAR" && <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3"><p className="text-xs leading-relaxed text-amber-950">Este registro é interno: não envia PIX nem movimenta sua conta bancária. Use somente para um pagamento já realizado e ainda ausente do caixa.</p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <label className={rotulo}>Data real do pagamento<input type="date" required value={pagamentoNovo.data} onChange={event => { setPagamentoNovo(atual => ({ ...atual, data: event.target.value })); aoAlterar(true); }} className={campo} /></label>
                    <label className={rotulo}>Caixa / centro de origem<select required value={pagamentoNovo.centroCusto} onChange={event => { setPagamentoNovo(atual => ({ ...atual, centroCusto: event.target.value })); aoAlterar(true); }} className={campo}><option value="">Selecione…</option><option value="AL">A. Camargo</option><option value="CH">Chácara</option><option value="BRISA">Brisa Azul</option></select></label>
                    <label className={rotulo}>Categoria no caixa<input required value={pagamentoNovo.categoria} maxLength={100} onChange={event => { setPagamentoNovo(atual => ({ ...atual, categoria: event.target.value })); aoAlterar(true); }} className={campo} placeholder="Ex.: manutenção" /></label>
                    <label className={rotulo}>Forma de pagamento<select value={pagamentoNovo.via} onChange={event => { setPagamentoNovo(atual => ({ ...atual, via: event.target.value })); aoAlterar(true); }} className={campo}>{["PIX", "TRANSFERENCIA", "BOLETO", "DINHEIRO"].map(via => <option key={via} value={via}>{via}</option>)}</select></label>
                    <label className={`${rotulo} lg:col-span-2`}>Conta bancária pagadora (opcional)<select value={pagamentoNovo.contaBancariaId} onChange={event => { setPagamentoNovo(atual => ({ ...atual, contaBancariaId: event.target.value })); aoAlterar(true); }} className={campo}><option value="">Não informada</option>{editor.contas.map(conta => <option key={conta.id} value={conta.id}>{conta.apelido}</option>)}</select></label>
                  </div>
                  <label className="flex items-start gap-2 text-xs leading-relaxed"><input type="checkbox" checked={cientePagamento} onChange={event => setCientePagamento(event.target.checked)} className="mt-1" /><span>Conferi: este pagamento já aconteceu, pelo valor integral da nota, e ainda não existe no caixa.</span></label>
                </div>}
              </div>}
        </section>
        <p className="text-xs leading-relaxed text-tinta-suave">O rateio é gerencial: separa custos por empreendimento sem emitir outra nota, gerar reembolso ou alterar o tomador fiscal. No caixa, continua existindo somente o pagamento único.</p>
        <div className="flex flex-wrap items-center gap-3 border-t border-contorno pt-4"><button type="submit" value="CONFERIDO" className={btnPrimario} disabled={!visiveis || !resumo.completo || editor.documento.fonteAlterada && !confirmaFonte}>{salvando ? "Salvando…" : "Salvar e concluir conferência"}</button><button type="submit" value="RASCUNHO" className={btnSecundario} disabled={!visiveis || editor.documento.fonteAlterada && !confirmaFonte}>Salvar rascunho</button><button type="button" className={btnSecundario} onClick={aoFechar}>Fechar</button></div>
      </fieldset>
    </form>
    <AnexosDespesa despesaId={documento.id} iniciais={editor.anexos} bloqueado={salvando || reabrirNecessario} aoOcupar={valor => { setAnexando(valor); aoOcupar(valor); }} />
  </div>;
}

function AnexosDespesa({ despesaId, iniciais, bloqueado, aoOcupar }: { despesaId?: string; iniciais: DespesaEditor["anexos"]; bloqueado: boolean; aoOcupar: (valor: boolean) => void }) {
  const [anexos, setAnexos] = useState(iniciais);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!despesaId || !arquivo || enviando || bloqueado) return;
    setMensagem(""); setErro(false);
    if (arquivo.size > 5 * 1024 * 1024 || !["application/pdf", "image/jpeg", "image/png"].includes(arquivo.type)) { setErro(true); setMensagem("Escolha um PDF, JPG ou PNG de até 5 MB."); return; }
    setEnviando(true); aoOcupar(true);
    try {
      const form = new FormData(); form.set("despesaId", despesaId); form.set("arquivo", arquivo);
      const resposta = await fetch("/financeiro/contas-a-pagar/anexos", { method: "POST", body: form });
      if (!resposta.ok) throw new Error("UPLOAD");
      const dados = await resposta.json() as { anexo: DespesaEditor["anexos"][number] };
      setAnexos(atuais => atuais.some(item => item.id === dados.anexo.id) ? atuais : [...atuais, dados.anexo]);
      setArquivo(null); if (input.current) input.current.value = ""; setMensagem("Arquivo anexado ao documento único.");
    } catch { setErro(true); setMensagem("Não foi possível anexar. Confira seu acesso, o tamanho e o formato do arquivo e tente novamente."); }
    finally { setEnviando(false); aoOcupar(false); }
  }
  return <section className="rounded-xl border border-contorno p-4"><h3 className="text-sm font-bold">Nota e comprovante</h3><p className="mt-1 text-xs leading-relaxed text-tinta-suave">Acesso restrito ao documento completo. Os anexos não são compartilhados com a visão de carteira dos sócios.</p>
    {!despesaId ? <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-tinta-suave">Salve a despesa primeiro para anexar a nota e o comprovante (PDF, JPG ou PNG, até 5 MB cada).</p> : <>
      <ul className="mt-3 space-y-2">{anexos.map(anexo => <li key={anexo.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-xs"><span className="min-w-0 break-all font-semibold">{anexo.nomeOriginal}<span className="ml-2 font-normal text-tinta-suave">{Math.ceil(anexo.tamanho / 1024)} KB</span></span><a href={`/financeiro/contas-a-pagar/anexos?id=${encodeURIComponent(anexo.id)}`} className="font-semibold text-oliva-escura underline" download>Baixar arquivo</a></li>)}</ul>
      <form onSubmit={event => void enviar(event)} className="mt-3 flex flex-wrap items-end gap-3"><label className={`${rotulo} min-w-0 flex-1`}>Anexar nota ou comprovante<input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={enviando || bloqueado} onChange={event => setArquivo(event.target.files?.[0] ?? null)} className="mt-2 block w-full min-w-0 text-xs" /></label><button type="submit" disabled={!arquivo || enviando || bloqueado || anexos.length >= 10} className={btnSecundario}>{enviando ? "Enviando…" : "Anexar arquivo"}</button></form>
      <p className="mt-2 text-[11px] text-tinta-suave">Até 10 arquivos de 5 MB. PDFs ou imagens JPG/PNG.</p>
      {mensagem && <p role={erro ? "alert" : "status"} className={`mt-3 text-xs ${erro ? "text-erro" : "text-oliva-escura"}`}>{mensagem}</p>}
    </>}
  </section>;
}
