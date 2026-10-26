"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { BotaoSigilo, useValoresVisiveis } from "@/components/botao-sigilo";
import { Dinheiro, Sigilo, btnPrimario, btnSecundario, inputBase } from "@/components/ui";
import { carregarRateioDespesa, procurarPagamentoDespesa, salvarRateioDespesa } from "@/app/(app)/financeiro/contas-a-pagar/rateio-actions";
import type { DespesaEditor, PagamentoDisponivel, PagamentoDespesaEntrada, SalvarDespesaEntrada } from "@/lib/despesas/tipos";
import { LIMITE_RATEIOS } from "@/lib/despesas/tipos";
import { conferirValoresRateio, linhasEditaveis, linhaVazia, modoCustoInicial, rateiosDoFormulario, valorEditavel, type ModoCustoDespesa, type RateioEditavel } from "./rateio-formulario";
import { EditorCategoriaDespesa } from "./editor-categoria-despesa";
import { SeletorFornecedorDespesa } from "./seletor-fornecedor-despesa";
import { RevisaoDespesa } from "./revisao-despesa";

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
      <div className="min-w-0 flex-[1_1_24rem]"><p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-oliva">Contas a pagar</p><h2 id={tituloId} ref={titulo} tabIndex={-1} className="text-lg font-bold outline-none">{selecao.id || selecao.origemChave ? "Organizar despesa" : "Nova despesa"}</h2><p className="mt-1 text-xs text-tinta-suave">Informe o gasto, quem assume o custo e a situação do pagamento.</p></div>
      <div className="flex shrink-0 flex-wrap gap-2"><BotaoSigilo /><button type="button" disabled={ocupado} onClick={fechar} className={btnSecundario} aria-label="Fechar despesa">Fechar ×</button></div>
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
    {[{ nome: "Total da despesa", valor: resumo.total }, { nome: "Distribuído", valor: resumo.distribuido }, { nome: resumo.restante < 0 ? "Acima do total" : "Falta distribuir", valor: Math.abs(resumo.restante) }].map(item => <div key={item.nome} className="min-w-0 rounded-lg bg-carta p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-tinta-suave">{item.nome}</p><p className={`mt-1 max-w-full break-words text-lg font-semibold ${item.nome === "Acima do total" ? "text-erro" : ""}`}><Sigilo><Dinheiro centavos={item.valor} /></Sigilo></p></div>)}
    <p className="text-xs leading-relaxed text-tinta-suave sm:col-span-3">{resumo.completo ? "Os valores fecham. Confira os empreendimentos e as descrições antes de confirmar." : "Informe o valor de cada serviço. A conferência só é concluída quando a soma fecha exatamente; você pode salvar um rascunho."}</p>
  </div>;
}

export function FormularioRateioDespesa({ inicial, aoOcupar, aoAlterar: informarAlteracao, aoFechar }: { inicial: DespesaEditor; aoOcupar: (valor: boolean) => void; aoAlterar: (valor: boolean) => void; aoFechar: () => void }) {
  const visiveis = useValoresVisiveis();
  const [editor, setEditor] = useState(inicial);
  const [documento, setDocumento] = useState({ ...inicial.documento, descricao: inicial.documento.descricao ?? (inicial.documento.rateios.length === 1 ? inicial.documento.rateios[0].descricao : ""), totalTexto: valorEditavel(inicial.documento.total) });
  const [linhas, setLinhas] = useState(() => linhasEditaveis(inicial));
  const [modoCusto, setModoCusto] = useState<ModoCustoDespesa>(() => modoCustoInicial(inicial.documento));
  const [destinoUnico, setDestinoUnico] = useState(() => ({ empreendimentoId: inicial.documento.rateios[0]?.empreendimentoId ?? "", unidadeId: inicial.documento.rateios[0]?.unidadeId ?? "", categoria: inicial.documento.rateios[0]?.categoria ?? null }));
  const [documentoAberto, setDocumentoAberto] = useState(inicial.documento.tipoDocumento !== "SEM_DOCUMENTO");
  const [novaCategoria, setNovaCategoria] = useState(false);
  const [catalogoOcupado, setCatalogoOcupado] = useState(false);
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
  const [alterado, setAlterado] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const [atualizacaoRevisao, setAtualizacaoRevisao] = useState(0);
  const [corrigirSigiloHonorarios, setCorrigirSigiloHonorarios] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const envio = useRef(false);
  const aviso = useRef<HTMLParagraphElement>(null);
  const versaoBusca = useRef(0);
  const painelRevisao = useRef<HTMLDivElement>(null);
  const legado = Boolean(editor.documento.origemChave);
  const temPagamento = editor.pagamento.origem !== "NENHUM";
  const resumo = conferirValoresRateio(documento.totalTexto, linhas);
  const categoria = editor.categorias.find(item => item.codigo === documento.categoriaCodigo);
  const permiteClassificacaoAnterior = Boolean(editor.documento.id || editor.documento.origemChave) && !editor.documento.categoriaCodigo;
  const conferenciaCompleta = resumo.total !== null && resumo.total > 0 && (modoCusto === "ADMINISTRADORA" || (modoCusto === "UM_EMPREENDIMENTO" ? Boolean(destinoUnico.empreendimentoId && documento.descricao.trim()) : resumo.completo));
  const unidadesDestino = editor.empreendimentos.find(item => item.id === destinoUnico.empreendimentoId)?.unidades ?? [];
  useEffect(() => { if (erro) aviso.current?.focus(); }, [erro]);
  useEffect(() => { if (atualizacaoRevisao > 0) painelRevisao.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [atualizacaoRevisao]);
  function aoAlterar(valor: boolean) { setAlterado(valor); informarAlteracao(valor); }
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
    if (envio.current || salvando || anexando || catalogoOcupado || revisando || reabrirNecessario) return;
    const statusRateio = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "CONFERIDO" ? "CONFERIDO" : "RASCUNHO";
    setErro(""); setSucesso("");
    if (resumo.total === null || resumo.total <= 0) { setErro("Informe um total válido, maior que zero, com no máximo dois centavos decimais."); return; }
    if (statusRateio === "CONFERIDO" && !conferenciaCompleta) { setErro(modoCusto === "VARIOS" ? "A soma do rateio precisa fechar exatamente com o total da despesa." : "Informe quem assume o custo e a descrição da despesa."); return; }
    let rateios: SalvarDespesaEntrada["rateios"];
    try { rateios = rateiosDoFormulario({ modo: modoCusto, total: documento.totalTexto, descricao: documento.descricao, categoria: categoria?.rotulo ?? null, unico: destinoUnico, linhas }); }
    catch (falha) { setErro(falha instanceof Error ? falha.message : "Confira a distribuição dos custos."); return; }
    let pagamento: PagamentoDespesaEntrada = { modo: "MANTER" };
    if (modoPagamento === "VINCULAR") {
      if (!pagamentoSelecionado) { setErro("Busque e selecione a saída já existente no caixa."); return; }
      pagamento = { modo: "VINCULAR", lancamentoCaixaId: pagamentoSelecionado.id, assinatura: pagamentoSelecionado.assinatura };
    } else if (modoPagamento === "REGISTRAR") {
      if (!cientePagamento) { setErro("Confirme que o pagamento já aconteceu e não existe no caixa."); return; }
      pagamento = { modo: "REGISTRAR", ...pagamentoNovo, categoria: categoria?.rotulo ?? pagamentoNovo.categoria, contaBancariaId: pagamentoNovo.contaBancariaId || null };
    }
    const entrada: SalvarDespesaEntrada = {
      requestId, id: documento.id, origemChave: documento.origemChave, origemHash: documento.origemHash, versao: documento.versao,
      confirmarFonteAlterada: confirmaFonte, fornecedorPessoaId: documento.fornecedorPessoaId ?? null, fornecedorNome: documento.fornecedorNome, fornecedorDocumento: documento.fornecedorDocumento,
      numero: documento.tipoDocumento === "SEM_DOCUMENTO" ? "" : documento.numero, serie: documento.tipoDocumento === "SEM_DOCUMENTO" ? null : documento.serie, tomadorNome: documento.tomadorNome, tomadorDocumento: documento.tomadorDocumento,
      emissao: documento.tipoDocumento === "SEM_DOCUMENTO" ? "" : documento.emissao, competencia: documento.competencia, vencimento: documento.vencimento,
      categoriaCodigo: documento.categoriaCodigo || null, descricao: documento.descricao || null, tipoDocumento: documento.tipoDocumento,
      destinoCusto: modoCusto === "ADMINISTRADORA" ? "ADMINISTRADORA" : "EMPREENDIMENTOS",
      total: resumo.total, statusRateio, rateios, pagamento,
      corrigirSigiloHonorarios,
    };
    envio.current = true; setSalvando(true); aoOcupar(true);
    try {
      const resposta = await salvarRateioDespesa(entrada);
      if (!resposta.ok) { setErro(resposta.mensagem); return; }
      const atualizado = await carregarRateioDespesa({ id: resposta.resultado.id }).catch(() => null);
      if (atualizado?.ok) {
        setEditor(atualizado.editor); setDocumento({ ...atualizado.editor.documento, descricao: atualizado.editor.documento.descricao ?? (atualizado.editor.documento.rateios.length === 1 ? atualizado.editor.documento.rateios[0].descricao : ""), totalTexto: valorEditavel(atualizado.editor.documento.total) });
        setLinhas(linhasEditaveis(atualizado.editor));
        setModoCusto(modoCustoInicial(atualizado.editor.documento));
        setDestinoUnico({ empreendimentoId: atualizado.editor.documento.rateios[0]?.empreendimentoId ?? "", unidadeId: atualizado.editor.documento.rateios[0]?.unidadeId ?? "", categoria: atualizado.editor.documento.rateios[0]?.categoria ?? null });
      } else {
        setDocumento(atual => ({ ...atual, id: resposta.resultado.id, versao: resposta.resultado.versao }));
        setReabrirNecessario(true);
        setErro("A despesa foi salva, mas não foi possível recarregar os detalhes. Feche e abra novamente antes de editar.");
      }
      setModoPagamento("MANTER"); setCientePagamento(false); setPagamentoSelecionado(null); setConfirmaFonte(false); setCorrigirSigiloHonorarios(false); setRequestId(crypto.randomUUID()); aoAlterar(false);
      setAtualizacaoRevisao(atual => atual + 1);
      setSucesso(statusRateio === "CONFERIDO" ? "Dados da despesa salvos. Veja no passo 4 se ainda há uma decisão de duplicidade para concluir." : "Rascunho salvo. A conferência de duplicidade é uma etapa separada, exibida no passo 4.");
    } catch { setErro("Não foi possível confirmar o resultado. Você pode tentar salvar novamente sem duplicar a operação; não altere os dados antes de confirmar."); }
    finally { envio.current = false; setSalvando(false); aoOcupar(false); }
  }
  return <div className="space-y-5">
    <form onSubmit={event => void salvar(event)} className="space-y-5" aria-busy={salvando}>
      {erro && <p ref={aviso} tabIndex={-1} role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{erro}</p>}
      {sucesso && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{sucesso}</p>}
      {editor.documento.fonteAlterada && <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><input type="checkbox" checked={confirmaFonte} onChange={event => setConfirmaFonte(event.target.checked)} className="mt-1 shrink-0" /><span>A origem foi atualizada depois do último rateio. Conferi novamente os dados e autorizo salvar o rateio sobre os valores atuais.</span></label>}
      <fieldset disabled={salvando || anexando || catalogoOcupado || revisando || reabrirNecessario} className="min-w-0 space-y-5 disabled:opacity-60">
        <section className="rounded-xl border border-contorno p-4">
          <h3 className="text-sm font-bold">1. O que será pago?</h3>
          {legado && <p className="mt-1 text-xs leading-relaxed text-tinta-suave">Este título veio do Widesys. Você pode completar os dados locais da despesa. O valor, o pagamento e o registro de origem permanecem preservados.</p>}
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="min-w-0"><label className={rotulo}>Categoria<select value={documento.categoriaCodigo ?? ""} onChange={event => alterarDocumento("categoriaCodigo", event.target.value)} required={!permiteClassificacaoAnterior || modoCusto === "ADMINISTRADORA" || documento.tipoDocumento !== "NOTA_FISCAL"} className={campo}><option value="">{permiteClassificacaoAnterior ? "Manter classificação anterior" : "Selecione a categoria…"}</option>{editor.categorias.filter(item => item.ativa !== false || item.codigo === documento.categoriaCodigo).map(item => <option key={item.codigo} value={item.codigo}>{item.rotulo}{item.restrita ? " · restrita" : ""}{item.ativa === false ? " · inativa (já vinculada)" : ""}</option>)}</select></label>{editor.gerenciaCategorias && <button type="button" className="mt-1 min-h-8 rounded px-1 text-xs font-semibold text-oliva-escura hover:underline" aria-expanded={novaCategoria} onClick={() => setNovaCategoria(!novaCategoria)}>+ Nova categoria</button>}{categoria?.ativa === false && <p className="mt-1 text-[11px] leading-relaxed text-tinta-suave">Esta categoria está inativa. Você pode mantê-la nesta despesa ou escolher uma ativa.</p>}</div>
            <div className="min-w-0 lg:col-span-2"><SeletorFornecedorDespesa valor={{ id: documento.fornecedorPessoaId ?? null, nome: documento.fornecedorNome, cpfCnpj: documento.fornecedorDocumento }} permiteCadastrar={editor.permiteCadastrarFornecedor} disabled={salvando || anexando || catalogoOcupado || reabrirNecessario} aoOcupar={valor => { setCatalogoOcupado(valor); aoOcupar(valor); }} onChange={fornecedor => { setDocumento(atual => ({ ...atual, fornecedorPessoaId: fornecedor.id, fornecedorNome: fornecedor.nome, fornecedorDocumento: fornecedor.cpfCnpj })); aoAlterar(true); setSucesso(""); }} /></div>
            {novaCategoria && editor.gerenciaCategorias && <div className="sm:col-span-2 lg:col-span-3"><EditorCategoriaDespesa aoCancelar={() => setNovaCategoria(false)} aoOcupar={valor => { setCatalogoOcupado(valor); aoOcupar(valor); }} aoSalvar={(nova, todas) => { setEditor(atual => ({ ...atual, categorias: todas })); alterarDocumento("categoriaCodigo", nova.codigo); setNovaCategoria(false); setSucesso(`Categoria “${nova.rotulo}” cadastrada e selecionada. Complete a despesa para salvar o lançamento.`); }} /></div>}
            <label className={`${rotulo} sm:col-span-2 lg:col-span-3`}>Descrição da despesa<input value={documento.descricao} onChange={event => alterarDocumento("descricao", event.target.value)} required={Boolean(documento.categoriaCodigo) || modoCusto !== "VARIOS" || !permiteClassificacaoAnterior} maxLength={1000} className={campo} placeholder="Ex.: mensalidade do sistema de outubro" /></label>
            <label className={rotulo}>Valor total (R$)<input type={visiveis ? "text" : "password"} inputMode="decimal" autoComplete="off" required readOnly={!visiveis || legado || temPagamento} value={documento.totalTexto} onChange={event => alterarDocumento("totalTexto", event.target.value)} className={`${campo} font-mono`} aria-describedby={!visiveis ? "rateio-valor-aviso" : undefined} /></label>
            <label className={rotulo}>Competência<input type="month" required value={documento.competencia} onChange={event => alterarDocumento("competencia", event.target.value)} className={campo} /><span className="mt-1 block text-[11px] font-normal text-tinta-suave">Mês a que a despesa pertence.</span></label>
            <label className={rotulo}>Vencimento (opcional)<input type="date" value={documento.vencimento ?? ""} onChange={event => alterarDocumento("vencimento", event.target.value)} className={campo} /></label>
          </div>
          {!visiveis && <p id="rateio-valor-aviso" className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-tinta-suave">Os valores estão ocultos. Use “Ver valores” no topo desta janela para preencher e conferir a despesa.</p>}
          {(categoria?.restrita || editor.sigilo?.restrita) && <div className="mt-3 rounded-lg border border-contorno bg-slate-50 p-3 text-xs leading-relaxed"><p><strong>Acesso restrito.</strong> Esta despesa e seus anexos estão disponíveis somente ao administrador. Isso não impede o administrador de salvar os dados ou concluir a conferência.</p>{editor.sigilo?.motivo && <p className="mt-1 text-tinta-suave">{editor.sigilo.motivo}</p>}</div>}
          {editor.sigilo?.podeCorrigirHonorarios && !categoria?.restrita && <label className="mt-3 flex items-start gap-2 rounded-lg border border-contorno p-3 text-xs leading-relaxed"><input type="checkbox" checked={corrigirSigiloHonorarios} onChange={event => { setCorrigirSigiloHonorarios(event.target.checked); aoAlterar(true); setSucesso(""); }} className="mt-1" /><span><strong className="block">Corrigir restrição indevida de honorários</strong><span className="mt-1 block">Conferi esta despesa e seus anexos: são honorários contábeis ou advocatícios, sem comissão.</span><span className="mt-1 block text-tinta-suave">Libera esta despesa e seus anexos aos perfis que já podem consultar despesas. Não conclui a conferência de duplicidades.</span></span></label>}
          <details open={documentoAberto} onToggle={event => setDocumentoAberto(event.currentTarget.open)} className="mt-4 rounded-lg border border-contorno p-3">
            <summary className="cursor-pointer text-xs font-semibold text-oliva-escura">{documento.tipoDocumento === "SEM_DOCUMENTO" ? "Adicionar documento (opcional)" : "Documento da despesa"}</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className={rotulo}>Tipo de documento<select value={documento.tipoDocumento} onChange={event => alterarDocumento("tipoDocumento", event.target.value)} className={campo}>{[{ codigo: "SEM_DOCUMENTO", nome: "Sem documento informado" }, { codigo: "NOTA_FISCAL", nome: "Nota fiscal" }, { codigo: "BOLETO", nome: "Boleto" }, { codigo: "GUIA", nome: "Guia de pagamento" }, { codigo: "RECIBO", nome: "Recibo" }, { codigo: "OUTRO", nome: "Outro documento" }].map(item => <option key={item.codigo} value={item.codigo}>{item.nome}</option>)}</select></label>
              {documento.tipoDocumento !== "SEM_DOCUMENTO" && <>
                <label className={rotulo}>Número do documento{documento.tipoDocumento !== "NOTA_FISCAL" ? " (opcional)" : ""}<input value={documento.numero} onChange={event => alterarDocumento("numero", event.target.value)} required={documento.tipoDocumento === "NOTA_FISCAL"} maxLength={100} className={campo} /></label>
                <label className={rotulo}>Emissão{documento.tipoDocumento !== "NOTA_FISCAL" ? " (opcional)" : ""}<input type="date" required={documento.tipoDocumento === "NOTA_FISCAL"} value={documento.emissao} onChange={event => alterarDocumento("emissao", event.target.value)} className={campo} /></label>
                {documento.tipoDocumento === "NOTA_FISCAL" && <>
                  <label className={rotulo}>Série (opcional)<input value={documento.serie ?? ""} onChange={event => alterarDocumento("serie", event.target.value)} maxLength={50} className={campo} /></label>
                  <label className={rotulo}>Tomador na nota (opcional)<input value={documento.tomadorNome ?? ""} onChange={event => alterarDocumento("tomadorNome", event.target.value)} maxLength={200} className={campo} placeholder="Como consta na nota original" /></label>
                  <label className={rotulo}>CPF/CNPJ do tomador (opcional)<input value={documento.tomadorDocumento ?? ""} onChange={event => alterarDocumento("tomadorDocumento", event.target.value)} maxLength={30} className={campo} /></label>
                </>}
              </>}
            </div>
            {documento.tipoDocumento === "NOTA_FISCAL" && !documento.fornecedorDocumento?.trim() && <p className="mt-3 text-xs leading-relaxed text-tinta-suave">Informe o CPF/CNPJ do fornecedor para proteção adicional contra nota repetida. Confira o número antes de cadastrar outra nota.</p>}
          </details>
        </section>
        <section className="space-y-4 rounded-xl border border-contorno p-4">
          <h3 className="text-sm font-bold">2. Quem assume o custo?</h3>
          <div className="grid gap-2 sm:grid-cols-3">{[{ valor: "ADMINISTRADORA", titulo: "Administradora", detalhe: "Despesa própria da empresa." }, { valor: "UM_EMPREENDIMENTO", titulo: "Um empreendimento", detalhe: "Todo o valor pertence a ele." }, { valor: "VARIOS", titulo: "Vários empreendimentos", detalhe: "Informar os valores do rateio." }].map(item => <label key={item.valor} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-xs ${modoCusto === item.valor ? "border-oliva bg-oliva/5" : "border-contorno"}`}><input type="radio" name="destinoCusto" value={item.valor} checked={modoCusto === item.valor} onChange={() => { setModoCusto(item.valor as ModoCustoDespesa); aoAlterar(true); setSucesso(""); }} className="mt-0.5" /><span><strong className="block">{item.titulo}</strong><span className="mt-1 block text-tinta-suave">{item.detalhe}</span></span></label>)}</div>
          {modoCusto === "ADMINISTRADORA" && <p className="text-xs leading-relaxed text-tinta-suave">O valor fica nas despesas da administradora, sem distribuir custos para imóveis ou empreendimentos.</p>}
          {modoCusto === "UM_EMPREENDIMENTO" && <div className="grid gap-3 rounded-lg bg-slate-50/60 p-3 sm:grid-cols-2">
            <label className={rotulo}>Empreendimento<select required value={destinoUnico.empreendimentoId} onChange={event => { setDestinoUnico(atual => ({ ...atual, empreendimentoId: event.target.value, unidadeId: "" })); aoAlterar(true); }} className={campo}><option value="">Selecione…</option>{editor.empreendimentos.map(item => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
            <label className={rotulo}>Imóvel (opcional)<select value={destinoUnico.unidadeId} disabled={!destinoUnico.empreendimentoId} onChange={event => { setDestinoUnico(atual => ({ ...atual, unidadeId: event.target.value })); aoAlterar(true); }} className={campo}><option value="">Área comum / sem imóvel</option>{unidadesDestino.map(item => <option key={item.id} value={item.id}>{item.identificacao}</option>)}</select></label>
            <p className="text-xs text-tinta-suave sm:col-span-2">Todo o valor será atribuído a esse empreendimento: <Sigilo><Dinheiro centavos={resumo.total} /></Sigilo>.</p>
          </div>}
          {modoCusto === "VARIOS" && <>
          <p className="text-xs text-tinta-suave">Digite os valores manualmente. A soma deve fechar com a despesa. Você pode detalhar mais de um serviço no mesmo empreendimento.</p>
          <ResumoRateio total={documento.totalTexto} linhas={linhas} />
          <ol className="space-y-3">{linhas.map((linha, indice) => {
            const unidades = editor.empreendimentos.find(item => item.id === linha.empreendimentoId)?.unidades ?? [];
            return <li key={linha.chave} className="min-w-0 rounded-lg border border-contorno bg-slate-50/40 p-3">
              <div className="mb-3 flex items-center justify-between gap-2"><span className="text-xs font-bold text-tinta-suave">Serviço {indice + 1}</span><button type="button" onClick={() => { setLinhas(atuais => atuais.filter(item => item.chave !== linha.chave)); aoAlterar(true); }} className="min-h-8 rounded px-2 text-xs font-semibold text-erro hover:bg-erro/5" aria-label={`Remover serviço ${indice + 1}`}>Remover linha</button></div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className={rotulo}>Empreendimento<select value={linha.empreendimentoId} onChange={event => alterarLinha(linha.chave, { empreendimentoId: event.target.value, unidadeId: "" })} className={campo}><option value="">Selecione…</option>{editor.empreendimentos.map(item => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
                <label className={rotulo}>Imóvel (opcional)<select value={linha.unidadeId ?? ""} disabled={!linha.empreendimentoId} onChange={event => alterarLinha(linha.chave, { unidadeId: event.target.value })} className={campo}><option value="">Área comum / sem imóvel</option>{unidades.map(item => <option key={item.id} value={item.id}>{item.identificacao}</option>)}</select></label>
                <label className={rotulo}>Valor deste serviço (R$)<input type={visiveis ? "text" : "password"} inputMode="decimal" autoComplete="off" readOnly={!visiveis} value={linha.valor} onChange={event => alterarLinha(linha.chave, { valor: event.target.value })} className={`${campo} font-mono`} placeholder={visiveis ? "0,00" : ""} /></label>
                <label className={`${rotulo} sm:col-span-2 lg:col-span-3`}>Descrição deste custo<input value={linha.descricao} onChange={event => alterarLinha(linha.chave, { descricao: event.target.value })} maxLength={1000} className={campo} placeholder="O que pertence a este empreendimento" /></label>
                {(!categoria || linha.categoria && linha.categoria !== categoria.rotulo) && <details className="sm:col-span-2 lg:col-span-3"><summary className="cursor-pointer text-xs text-tinta-suave">Classificação desta linha{linha.categoria ? `: ${linha.categoria}` : " (opcional)"}</summary><label className={`${rotulo} mt-2`}>Categoria anterior / detalhamento<input value={linha.categoria ?? ""} onChange={event => alterarLinha(linha.chave, { categoria: event.target.value })} maxLength={100} className={campo} placeholder={categoria?.rotulo ?? "Ex.: manutenção elétrica"} /></label></details>}
              </div>
            </li>;
          })}</ol>
          <button type="button" disabled={linhas.length >= LIMITE_RATEIOS} onClick={() => { setLinhas(atuais => [...atuais, linhaVazia()]); aoAlterar(true); }} className={btnSecundario}>+ Adicionar empreendimento ou serviço</button>
          </>}
        </section>
        <section className="rounded-xl border border-contorno p-4">
          <h3 className="text-sm font-bold">3. Já foi pago?</h3>
          {temPagamento ? <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><p className="font-semibold">{editor.pagamento.origem === "WIDESYS" ? "Situação do pagamento preservada do Widesys" : "Saída já vinculada no caixa"}</p><p className="mt-2 flex flex-wrap gap-2 text-xs text-tinta-suave"><span>{editor.pagamento.situacao}</span><span>{editor.pagamento.data || "Sem data informada"}</span><Sigilo><Dinheiro centavos={editor.pagamento.valor} /></Sigilo></p><p className="mt-2 text-xs text-tinta-suave">Salvar a despesa não registra outro pagamento.{!editor.pagamento.ativo ? " Atenção: o movimento vinculado não está ativo. Confira a origem." : ""}</p></div>
            : !editor.permitePagamento || legado ? <p className="mt-2 text-xs text-tinta-suave">{legado ? "O pagamento segue o registro de origem. Nenhuma saída será criada ao organizar esta despesa." : "Seu acesso permite organizar os custos, mas não registrar pagamentos no caixa."}</p>
              : <div className="mt-3 space-y-4">
                <div className="grid gap-2 sm:grid-cols-3">{[{ valor: "MANTER", titulo: "Ainda não foi pago", detalhe: "Somente a conta a pagar." }, { valor: "VINCULAR", titulo: "Já está no caixa", detalhe: "Vincular uma saída existente, sem repetir." }, { valor: "REGISTRAR", titulo: "Foi pago, mas não está no caixa", detalhe: "Registrar uma única saída." }].map(item => <label key={item.valor} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-xs ${modoPagamento === item.valor ? "border-oliva bg-oliva/5" : "border-contorno"}`}><input type="radio" name="modoPagamento" value={item.valor} checked={modoPagamento === item.valor} onChange={() => { setModoPagamento(item.valor as PagamentoDespesaEntrada["modo"]); setCientePagamento(false); aoAlterar(true); }} className="mt-0.5" /><span><strong className="block">{item.titulo}</strong><span className="mt-1 block text-tinta-suave">{item.detalhe}</span></span></label>)}</div>
                {modoPagamento === "VINCULAR" && <div className="space-y-3"><div className="flex flex-wrap items-end gap-2"><label className={`${rotulo} min-w-48 flex-1`}>Localizar saída com o mesmo valor<input value={busca} onChange={event => setBusca(event.target.value)} className={campo} maxLength={100} placeholder="Descrição ou fornecedor" /></label><button type="button" disabled={buscando || !resumo.total} onClick={() => void buscar()} className={btnSecundario}>{buscando ? "Buscando…" : "Buscar no caixa"}</button></div>
                  {buscou && !pagamentos.length && <p role="status" className="text-xs text-tinta-suave">Nenhuma saída disponível encontrada com este valor. Confira a busca e os registros antes de criar outro pagamento.</p>}
                  <div className="max-h-64 space-y-2 overflow-y-auto">{pagamentos.map(item => <label key={item.id} className={`flex items-start gap-3 rounded-lg border p-3 text-xs ${pagamentoSelecionado?.id === item.id ? "border-oliva bg-oliva/5" : "border-contorno"}`}><input type="radio" name="pagamentoExistente" checked={pagamentoSelecionado?.id === item.id} onChange={() => { setPagamentoSelecionado(item); aoAlterar(true); }} className="mt-1" /><span className="min-w-0 flex-1"><strong className="block break-words">{item.descricao || "Saída sem descrição"}</strong><span className="mt-1 block text-tinta-suave">{item.data || "Sem data"} · {item.centroCusto}{item.caixaOrigem ? ` · ${item.caixaOrigem}` : ""}</span></span><Sigilo><Dinheiro centavos={item.valor} /></Sigilo></label>)}</div>
                </div>}
                {modoPagamento === "REGISTRAR" && <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3"><p className="text-xs leading-relaxed text-amber-950">Este registro é interno: não envia PIX nem movimenta sua conta bancária. Use somente para um pagamento já realizado e ainda ausente do caixa.</p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <label className={rotulo}>Data real do pagamento<input type="date" required value={pagamentoNovo.data} onChange={event => { setPagamentoNovo(atual => ({ ...atual, data: event.target.value })); aoAlterar(true); }} className={campo} /></label>
                    <label className={rotulo}>Caixa que pagou<select required value={pagamentoNovo.centroCusto} onChange={event => { setPagamentoNovo(atual => ({ ...atual, centroCusto: event.target.value })); aoAlterar(true); }} className={campo}><option value="">Selecione…</option><option value="AL">A. Camargo</option><option value="CH">Chácara</option><option value="BRISA">Brisa Azul</option></select><span className="mt-1 block text-[11px] font-normal text-tinta-suave">Quem assume o custo foi definido no passo 2.</span></label>
                    {!categoria && <label className={rotulo}>Categoria no caixa<input required value={pagamentoNovo.categoria} maxLength={100} onChange={event => { setPagamentoNovo(atual => ({ ...atual, categoria: event.target.value })); aoAlterar(true); }} className={campo} placeholder="Ex.: manutenção" /></label>}
                    <label className={rotulo}>Forma de pagamento<select value={pagamentoNovo.via} onChange={event => { setPagamentoNovo(atual => ({ ...atual, via: event.target.value })); aoAlterar(true); }} className={campo}>{[{ codigo: "PIX", nome: "PIX" }, { codigo: "TRANSFERENCIA", nome: "Transferência" }, { codigo: "BOLETO", nome: "Boleto" }, { codigo: "DINHEIRO", nome: "Dinheiro" }, { codigo: "CARTAO_CREDITO", nome: "Cartão de crédito" }, { codigo: "CARTAO_DEBITO", nome: "Cartão de débito" }].map(via => <option key={via.codigo} value={via.codigo}>{via.nome}</option>)}</select></label>
                    <label className={`${rotulo} lg:col-span-2`}>Conta bancária pagadora (opcional)<select value={pagamentoNovo.contaBancariaId} onChange={event => { setPagamentoNovo(atual => ({ ...atual, contaBancariaId: event.target.value })); aoAlterar(true); }} className={campo}><option value="">Não informada</option>{editor.contas.map(conta => <option key={conta.id} value={conta.id}>{conta.apelido}</option>)}</select></label>
                  </div>
                  {categoria && <p className="text-xs text-tinta-suave">Categoria do pagamento: <strong>{categoria.rotulo}</strong>, a mesma da despesa.</p>}
                  <label className="flex items-start gap-2 text-xs leading-relaxed"><input type="checkbox" checked={cientePagamento} onChange={event => setCientePagamento(event.target.checked)} className="mt-1" /><span>Conferi: este pagamento já aconteceu, pelo valor integral da despesa, e ainda não existe no caixa.</span></label>
                </div>}
              </div>}
        </section>
        {modoCusto === "VARIOS" && <p className="text-xs leading-relaxed text-tinta-suave">O rateio separa custos por empreendimento. O documento e o pagamento continuam únicos.</p>}
        <div className="border-t border-contorno pt-4"><p className="mb-3 text-xs leading-relaxed text-tinta-suave">Categoria e distribuição do custo são salvas aqui. Se houver uma pendência de duplicidade, conclua a decisão no passo 4, nesta mesma janela.</p><div className="flex flex-wrap items-center gap-3"><button type="submit" value="CONFERIDO" className={btnPrimario} disabled={!visiveis || !conferenciaCompleta || editor.documento.fonteAlterada && !confirmaFonte}>{salvando ? "Salvando…" : "Salvar dados da despesa"}</button><button type="submit" value="RASCUNHO" className={btnSecundario} disabled={!visiveis || editor.documento.fonteAlterada && !confirmaFonte}>Salvar rascunho</button><button type="button" className={btnSecundario} onClick={aoFechar}>Fechar</button></div></div>
      </fieldset>
    </form>
    <div ref={painelRevisao}><RevisaoDespesa key={`${documento.id ?? ""}:${documento.origemChave ?? ""}:${atualizacaoRevisao}`} selecao={{ id: documento.id, origemChave: documento.origemChave }} alterado={alterado} bloqueado={salvando || anexando || catalogoOcupado || reabrirNecessario} aoOcupar={valor => { setRevisando(valor); aoOcupar(valor); }} /></div>
    <AnexosDespesa despesaId={documento.id} iniciais={editor.anexos} bloqueado={salvando || revisando || reabrirNecessario} aoOcupar={valor => { setAnexando(valor); aoOcupar(valor); }} />
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
  return <details className="rounded-xl border border-contorno p-4"><summary className="cursor-pointer text-sm font-bold">Documentos e comprovantes (opcional){anexos.length > 0 ? ` · ${anexos.length} arquivo(s)` : ""}</summary><p className="mt-3 text-xs leading-relaxed text-tinta-suave">Acesso restrito ao documento completo. Os anexos não são compartilhados com a visão de carteira dos sócios.</p>
    {!despesaId ? <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-tinta-suave">Salve a despesa primeiro para anexar documentos e comprovantes (PDF, JPG ou PNG, até 5 MB cada).</p> : <>
      <ul className="mt-3 space-y-2">{anexos.map(anexo => <li key={anexo.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-xs"><span className="min-w-0 break-all font-semibold">{anexo.nomeOriginal}<span className="ml-2 font-normal text-tinta-suave">{Math.ceil(anexo.tamanho / 1024)} KB</span></span><a href={`/financeiro/contas-a-pagar/anexos?id=${encodeURIComponent(anexo.id)}`} className="font-semibold text-oliva-escura underline" download>Baixar arquivo</a></li>)}</ul>
      <form onSubmit={event => void enviar(event)} className="mt-3 flex flex-wrap items-end gap-3"><label className={`${rotulo} min-w-0 flex-1`}>Anexar documento ou comprovante<input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={enviando || bloqueado} onChange={event => setArquivo(event.target.files?.[0] ?? null)} className="mt-2 block w-full min-w-0 text-xs" /></label><button type="submit" disabled={!arquivo || enviando || bloqueado || anexos.length >= 10} className={btnSecundario}>{enviando ? "Enviando…" : "Anexar arquivo"}</button></form>
      <p className="mt-2 text-[11px] text-tinta-suave">Até 10 arquivos de 5 MB. PDFs ou imagens JPG/PNG.</p>
      {mensagem && <p role={erro ? "alert" : "status"} className={`mt-3 text-xs ${erro ? "text-erro" : "text-oliva-escura"}`}>{mensagem}</p>}
    </>}
  </details>;
}
