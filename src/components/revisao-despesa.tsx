"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { carregarRevisaoDespesa, confirmarRevisaoDespesa } from "@/app/(app)/financeiro/contas-a-pagar/rateio-actions";
import { carregarRevisaoRecebimento, confirmarRevisaoRecebimento } from "@/app/(app)/recebimentos/revisao-actions";
import type { ConcluirRevisaoFinanceiraEntrada as EntradaConcluirRevisaoFinanceira, ResumoRevisaoFinanceira, RevisaoFinanceira as DadosRevisao } from "@/lib/unificacao/tipos-revisao-financeira";
import { useValoresVisiveis } from "./botao-sigilo";
import { Dinheiro, Sigilo, btnPrimario, btnSecundario, inputBase } from "./ui";

type Selecao = { id?: string; origemChave?: string | null };

export function RevisaoDespesa({ selecao, alterado, bloqueado, aoOcupar }: { selecao: Selecao; alterado: boolean; bloqueado: boolean; aoOcupar: (valor: boolean) => void }) {
  return <PainelRevisaoFinanceira selecao={selecao} dominio="PAGAR" alterado={alterado} bloqueado={bloqueado} aoOcupar={aoOcupar} />;
}

export function RevisaoRecebimento({ chave, aoOcupar }: { chave: string; aoOcupar: (valor: boolean) => void }) {
  return <PainelRevisaoFinanceira chave={chave} dominio="RECEBER" alterado={false} bloqueado={false} aoOcupar={aoOcupar} />;
}

function PainelRevisaoFinanceira({ selecao, chave, dominio, alterado, bloqueado, aoOcupar }: { selecao?: Selecao; chave?: string; dominio: "PAGAR" | "RECEBER"; alterado: boolean; bloqueado: boolean; aoOcupar: (valor: boolean) => void }) {
  const [revisao, setRevisao] = useState<DadosRevisao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const consulta = useRef(0);
  const enviando = useRef(false);
  const id = selecao?.id;
  const origemChave = selecao?.origemChave || undefined;
  const carregar = useCallback(async () => {
    const versao = ++consulta.current;
    setCarregando(true); setErro(""); setSucesso("");
    try {
      const resposta = dominio === "RECEBER" ? await carregarRevisaoRecebimento({ chave: chave! }) : await carregarRevisaoDespesa({ id, origemChave });
      if (consulta.current !== versao) return;
      if (resposta.ok) setRevisao(resposta.revisao);
      else setErro(resposta.mensagem);
    } catch { if (consulta.current === versao) setErro("Não foi possível consultar a situação financeira. Atualize a conferência antes de concluir."); }
    finally { if (consulta.current === versao) setCarregando(false); }
  }, [id, origemChave, chave, dominio]);
  useEffect(() => {
    const requisicao = consulta;
    let ativo = true;
    if (id || origemChave || chave) queueMicrotask(() => { if (ativo) void carregar(); });
    return () => { ativo = false; requisicao.current++; };
  }, [carregar, id, origemChave, chave]);

  async function confirmar(entrada: EntradaConcluirRevisaoFinanceira) {
    if (enviando.current || alterado || bloqueado || carregando || !revisao?.podeConcluir) return;
    enviando.current = true; setConfirmando(true); aoOcupar(true); setErro(""); setSucesso("");
    try {
      const resposta = dominio === "RECEBER" ? await confirmarRevisaoRecebimento(entrada) : await confirmarRevisaoDespesa(entrada);
      if (!resposta.ok) { setErro(resposta.mensagem); return; }
      setRevisao(resposta.revisao);
      setSucesso((resposta.revisao?.conferidoManualmente || resposta.revisao?.conferidoPorRegra) && !resposta.revisao.pendente && ["ATIVO", "VINCULADO"].includes(resposta.revisao.estado)
        ? "Conferência concluída. A situação e os totais da lista foram atualizados. Nenhum título ou pagamento foi criado."
        : "Decisão registrada. Confira abaixo a situação atual antes de encerrar.");
    } catch { setErro("Não foi possível confirmar o resultado. Atualize a conferência para verificar se a decisão foi registrada antes de tentar de novo."); }
    finally { enviando.current = false; setConfirmando(false); aoOcupar(false); }
  }

  if (!id && !origemChave && !chave) return null;
  return <section className="scroll-mt-6 rounded-xl border border-contorno p-4" aria-busy={carregando || confirmando} aria-label="Conferência de duplicidade">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-bold">{dominio === "PAGAR" ? "4. Conferência de duplicidade" : "Conferência do lançamento"}</h3><p className="mt-1 text-xs leading-relaxed text-tinta-suave">{dominio === "PAGAR" ? "Salvar os dados organiza a despesa. A decisão abaixo define se ela entra nos totais ou corresponde a outro lançamento." : "Confira os dados e confirme se este título é único ou corresponde a outro registro. Esta conferência não cria outra cobrança nem registra um novo recebimento."}</p></div><button type="button" className={btnSecundario} disabled={carregando || confirmando || bloqueado} onClick={() => void carregar()}>Atualizar conferência</button></div>
    {carregando && <p role="status" className="mt-4 text-sm">Consultando a situação financeira deste lançamento…</p>}
    {erro && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{erro}</p>}
    {sucesso && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{sucesso}</p>}
    {!carregando && revisao && <ConteudoRevisaoFinanceira key={`${revisao.chave}:${revisao.assinatura}`} revisao={revisao} alterado={alterado} bloqueado={bloqueado || confirmando || Boolean(erro)} confirmando={confirmando} aoConfirmar={confirmar} />}
    {!carregando && !erro && !revisao && <p className="mt-4 text-sm text-tinta-suave">A situação ainda não está disponível. Salve os dados e atualize a conferência.</p>}
  </section>;
}

function ResumoRegistro({ registro, titulo, receber }: { registro: ResumoRevisaoFinanceira; titulo: string; receber: boolean }) {
  return <div className="min-w-0 rounded-lg border border-contorno bg-carta p-3">
    <p className="text-[10px] font-bold uppercase tracking-wide text-tinta-suave">{titulo} · {registro.origem === "WIDESYS" ? "Widesys" : "Brisa"}</p>
    <p className="mt-2 break-words text-sm font-semibold">{registro.titulo}</p><p className="mt-1 break-words text-xs text-tinta-suave">{registro.descricao}</p>
    <p className="mt-2 text-xs text-tinta-suave">Competência: {registro.competencia || "Não informada"} · Data: {registro.data || "Não informada"}</p>
    <dl className="mt-3 grid grid-cols-1 gap-2 min-[440px]:grid-cols-3">{[{ nome: "Devido", valor: registro.valor }, { nome: receber ? "Recebido" : "Pago", valor: registro.pago }, { nome: "Em aberto", valor: registro.aberto }].map(item => <div key={item.nome} className="min-w-0"><dt className="text-[10px] text-tinta-suave">{item.nome}</dt><dd className="mt-1 break-words text-xs font-semibold"><Sigilo><Dinheiro centavos={item.valor} /></Sigilo></dd></div>)}</dl>
  </div>;
}

export const ConteudoRevisaoDespesa = ConteudoRevisaoFinanceira;

export function ConteudoRevisaoFinanceira({ revisao, alterado, bloqueado, confirmando = false, aoConfirmar }: { revisao: DadosRevisao; alterado: boolean; bloqueado: boolean; confirmando?: boolean; aoConfirmar: (entrada: EntradaConcluirRevisaoFinanceira) => Promise<void> }) {
  const visiveis = useValoresVisiveis();
  const nomeSelecao = useId();
  const [destinoChave, setDestinoChave] = useState("");
  const [acao, setAcao] = useState<"DISTINTO" | "VINCULAR" | "">("");
  const [justificativa, setJustificativa] = useState("");
  const [ciente, setCiente] = useState(false);
  const destino = revisao.candidatos.find(item => item.chave === destinoChave);
  const impedido = alterado || bloqueado || !visiveis;
  const receber = revisao.dominio === "RECEBER";
  const nomeRegistro = receber ? "este título" : "esta despesa";
  const conferidoPelaRegra = !!revisao.conferidoPorRegra && !revisao.pendente && revisao.estado === "ATIVO";
  const concluida = conferidoPelaRegra || (revisao.conferidoManualmente && !revisao.pendente && (revisao.estado === "ATIVO" || revisao.estado === "VINCULADO"));
  const automatico = !concluida && !revisao.pendente && (revisao.estado === "ATIVO" || revisao.estado === "VINCULADO");
  const podeConcluir = revisao.podeConcluir && !concluida;
  const podeEnviar = !impedido && podeConcluir && Boolean(acao) && (acao !== "VINCULAR" || Boolean(destino)) && justificativa.trim().length >= 8 && ciente;
  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!podeEnviar || !acao) return;
    await aoConfirmar({ chave: revisao.chave, versao: revisao.versao, hashFonte: revisao.hashFonte, assinatura: revisao.assinatura, acao, justificativa: justificativa.trim(), ...(acao === "VINCULAR" && destino ? { destinoChave: destino.chave, hashDestino: destino.hash } : {}) });
  }
  return <div className="mt-4 space-y-4">
    <div className={`rounded-lg border p-3 ${concluida ? "border-emerald-200 bg-emerald-50 text-emerald-950" : automatico ? "border-contorno bg-slate-50 text-tinta" : "border-amber-200 bg-amber-50 text-amber-950"}`}>
      <p className="text-sm font-semibold">{conferidoPelaRegra ? "Conferido pela regra de valores diferentes" : concluida ? "Conferido" : automatico ? "Ainda não conferido manualmente" : revisao.estado === "QUARENTENA" ? "Dados inconsistentes: ainda fora dos totais" : "Ainda precisa de uma decisão"}</p>
      <p className="mt-1 text-xs leading-relaxed">{revisao.motivo}</p>
      {concluida && <p className="mt-1 text-xs leading-relaxed">{revisao.estado === "VINCULADO" ? "Esta origem está vinculada a um registro principal e não soma novamente." : revisao.incluidoNosTotais ? "Este lançamento está incluído uma única vez nos totais." : "A decisão de duplicidade está concluída. Este registro permanece fora dos totais por sua situação financeira."}</p>}
      {automatico && <p className="mt-1 text-xs leading-relaxed">{revisao.incluidoNosTotais ? "Este lançamento já participa dos totais por uma regra automática. Conferir não soma seu valor de novo." : "A situação foi definida por uma regra automática. Não há uma conferência manual registrada para esta versão dos dados."}</p>}
    </div>
    {alterado && <p role="status" className="rounded-lg bg-slate-100 p-3 text-xs">Você alterou os dados. Clique em <strong>Salvar dados da despesa</strong>{concluida ? " para atualizar a organização desta despesa." : " antes de tomar a decisão abaixo."}</p>}
    {!visiveis && podeConcluir && <p className="text-xs text-tinta-suave">Revele os valores para comparar os lançamentos e confirmar a decisão.</p>}
    {(revisao.pendente || automatico) && !podeConcluir && <p className="text-xs leading-relaxed text-tinta-suave">Seu acesso permite consultar este lançamento. A conclusão exige permissão para conciliar pagamentos e revisar duplicidades.</p>}
    {!podeConcluir && <ResumoRegistro registro={revisao.registro} titulo={receber ? "Este título" : "Esta despesa"} receber={receber} />}
    {podeConcluir && <form onSubmit={event => void enviar(event)} className="space-y-4">
      <fieldset disabled={impedido} className="min-w-0 space-y-4 disabled:opacity-60">
        {revisao.candidatosIndisponiveis > 0 && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">Há {revisao.candidatosIndisponiveis} registro(s) semelhante(s) que precisam ser conferidos antes de vincular. Eles ainda não podem ser usados como principal. Confira sua origem antes de decidir que {nomeRegistro} é um lançamento separado.</p>}
        {revisao.candidatos.length > 0 ? <div className="space-y-3"><p className="text-sm font-semibold">Compare os possíveis repetidos</p><p className="text-xs text-tinta-suave">Selecione um registro para comparar lado a lado. Nome ou valor parecido não confirma duplicidade: confira a competência, o documento e o pagamento.</p><div className="max-h-72 space-y-2 overflow-y-auto rounded-lg">{revisao.candidatos.map(item => <label key={item.chave} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-xs ${destinoChave === item.chave ? "border-oliva bg-oliva/5" : "border-contorno"}`}><input type="radio" name={`${nomeSelecao}-destino`} checked={destinoChave === item.chave} onChange={() => { setDestinoChave(item.chave); setCiente(false); }} className="mt-1" /><span className="min-w-0 flex-1"><strong className="block break-words">{item.titulo}</strong><span className="mt-1 block break-words text-tinta-suave">{item.origem} · {item.competencia || "Sem competência"} · {item.descricao}</span><span className="mt-1 block"><Sigilo><Dinheiro centavos={item.valor} /></Sigilo></span></span></label>)}</div></div>
          : revisao.candidatosIndisponiveis === 0 && <p className="text-xs leading-relaxed text-tinta-suave">Não foram encontrados possíveis repetidos. Confirme abaixo somente depois de conferir que {nomeRegistro} representa um lançamento próprio.</p>}
        <div className={`grid gap-3 ${destino ? "lg:grid-cols-2" : ""}`}><ResumoRegistro registro={revisao.registro} titulo={receber ? "Este título" : "Esta despesa"} receber={receber} />{destino && <ResumoRegistro registro={destino} titulo="Registro selecionado para comparar" receber={receber} />}</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {revisao.candidatos.length > 0 && <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-xs ${acao === "VINCULAR" ? "border-oliva bg-oliva/5" : "border-contorno"}`}><input type="radio" name={`${nomeSelecao}-decisao`} checked={acao === "VINCULAR"} disabled={!destino} onChange={() => { setAcao("VINCULAR"); setCiente(false); }} className="mt-0.5" /><span><strong className="block">Mesmo lançamento</strong><span className="mt-1 block text-tinta-suave">{destino ? "Manter o registro selecionado nos totais e vincular esta origem, sem somar novamente." : "Selecione um possível repetido acima para comparar."}</span></span></label>}
          <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-xs ${acao === "DISTINTO" ? "border-oliva bg-oliva/5" : "border-contorno"}`}><input type="radio" name={`${nomeSelecao}-decisao`} checked={acao === "DISTINTO"} disabled={revisao.candidatos.length > 0 && !destino} onChange={() => { setAcao("DISTINTO"); setCiente(false); }} className="mt-0.5" /><span><strong className="block">{revisao.candidatos.length || revisao.candidatosIndisponiveis ? "São lançamentos diferentes" : "Conferi: este lançamento é único"}</strong><span className="mt-1 block text-tinta-suave">Manter {nomeRegistro} como um lançamento separado, sem unir a outro registro.</span></span></label>
        </div>
        {acao && <div className="space-y-3 rounded-lg border border-contorno bg-slate-50 p-3"><p className="text-xs leading-relaxed"><strong>Efeito da decisão:</strong> {acao === "VINCULAR" ? "esta origem ficará vinculada ao registro selecionado e não somará novamente nos totais." : `a conferência será registrada e ${nomeRegistro} será tratado como um lançamento separado. Sua situação financeira define se participa dos totais; o resultado será mostrado após confirmar.`} Nenhum título ou pagamento será criado.</p><label className="block text-xs font-semibold">O que você conferiu?<textarea required minLength={8} maxLength={500} value={justificativa} onChange={event => setJustificativa(event.target.value)} rows={2} className={`${inputBase} mt-1.5 w-full`} placeholder="Ex.: conferi o documento, a competência e o comprovante de pagamento." /></label><label className="flex items-start gap-2 text-xs leading-relaxed"><input type="checkbox" checked={ciente} onChange={event => setCiente(event.target.checked)} className="mt-1" /><span>Comparei os dados e confirmo o efeito desta decisão nos totais.</span></label></div>}
        <button type="submit" className={btnPrimario} disabled={!podeEnviar}>{confirmando ? "Confirmando…" : "Confirmar decisão e concluir"}</button>
      </fieldset>
    </form>}
  </div>;
}
