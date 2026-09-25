"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { Card, Selo, Sigilo, btnPrimario, btnSecundario, inputBase } from "@/components/ui";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { renderizarMensagem, type ConfigCobranca, type DadosMensagemCobranca } from "@/lib/comunicacoes/dominio";
import { cancelarMensagem, prepararMensagem, revogarContato, salvarConfiguracao, salvarContato } from "./actions";
import type { ContatoComunicacao, EstadoAcao, MensagemComunicacao, PainelAutomacoes, TituloComunicacao } from "./tipos";

const abas = ["Canais e mensagens", "Régua de cobrança", "Destinatários", "Fila e histórico"] as const;
type Aba = typeof abas[number];
const campoClasse = `${inputBase} mt-1.5 block w-full min-w-0`;
const estadoInicial: EstadoAcao = {};
const exemplo: DadosMensagemCobranca = { nome: "Cliente exemplo", documento: "COB-EXEMPLO-001", vencimento: "2026-10-10", valorCentavos: 125000, empresa: "Brisa" };

function Campo({ titulo, ajuda, children }: { titulo: string; ajuda?: string; children: ReactNode }) {
  return <label className="block min-w-0 text-[12px] font-semibold text-tinta">{titulo}{children}{ajuda ? <span className="mt-1.5 block text-[11px] font-normal leading-relaxed text-tinta-suave">{ajuda}</span> : null}</label>;
}

function Aviso({ estado }: { estado: EstadoAcao }) {
  return estado.erro ? <p role="alert" className="rounded-lg border border-erro/25 bg-erro/5 p-3 text-[12px] leading-relaxed text-erro">{estado.erro}</p> : estado.ok ? <p role="status" className="rounded-lg border border-oliva/25 bg-oliva/5 p-3 text-[12px] leading-relaxed text-oliva-escura">{estado.ok}</p> : null;
}

function Marcacao({ nome, titulo, descricao, checked, onChange }: { nome: string; titulo: string; descricao?: string; checked?: boolean; onChange?: (valor: boolean) => void }) {
  return <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-contorno p-3 text-[12px]">
    <input type="checkbox" name={nome} checked={checked} onChange={onChange ? (e) => onChange(e.target.checked) : undefined} className="mt-0.5 h-4 w-4 shrink-0 accent-oliva" />
    <span><span className="block font-semibold text-tinta">{titulo}</span>{descricao ? <span className="mt-1 block text-[11px] leading-relaxed text-tinta-suave">{descricao}</span> : null}</span>
  </label>;
}

function Simbolo({ canal }: { canal: "email" | "whatsapp" }) {
  return <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-contorno bg-fundo text-oliva" aria-hidden="true">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {canal === "email" ? <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></> : <><path d="M20 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20l1.2-4.4A8.5 8.5 0 1 1 20 11.5Z" /><path d="M8 8c0 4 2 6 6 7l2-2-2-1-1 1-2-2 1-1-2-2Z" /></>}
    </svg>
  </span>;
}

function Previa({ canal, corpo, assunto, empresa, dados }: { canal: "email" | "whatsapp"; corpo: string; assunto?: string; empresa: string; dados?: DadosMensagemCobranca }) {
  let texto = "";
  let titulo = "";
  let erro = false;
  try {
    const contexto = { ...(dados ?? exemplo), empresa: empresa || "Brisa" };
    texto = renderizarMensagem(corpo, contexto);
    titulo = assunto ? renderizarMensagem(assunto, contexto) : "";
  } catch {
    erro = true;
  }
  return <div className="rounded-xl border border-contorno bg-[#f5f8f7] p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.11em] text-tinta-suave"><span>Prévia · {canal === "email" ? "E-mail" : "WhatsApp"}</span><span>{dados ? "Título selecionado" : "Exemplo fictício"}</span></div>
    <div className={`ml-auto max-w-full break-words rounded-xl border border-contorno bg-white p-4 text-[12px] leading-relaxed shadow-sm ${canal === "whatsapp" ? "rounded-tr-sm" : ""}`}>
      {erro ? <span className="text-erro">Confira o texto e as variáveis para visualizar a mensagem.</span> : <>{titulo ? <strong className="mb-3 block border-b border-contorno pb-3">{titulo}</strong> : null}<div className="whitespace-pre-wrap">{dados ? <Sigilo>{texto}</Sigilo> : texto}</div></>}
    </div>
    <p className="mt-3 text-[10px] leading-relaxed text-tinta-suave">{canal === "whatsapp" ? "A API envia o modelo aprovado pela Meta. Este texto deve corresponder exatamente ao corpo desse modelo." : "O envio usa texto e versão HTML com conteúdo escapado. Nenhum disparo é feito nesta prévia."}</p>
  </div>;
}

function Variaveis() {
  return <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Variáveis disponíveis">{["nome", "documento", "vencimento", "valor", "empresa"].map((item) => <code key={item} className="rounded border border-contorno bg-fundo px-2 py-1 text-[10px] text-tinta-suave">{`{${item}}`}</code>)}</div>;
}

function Configuracao({ painel, aba }: { painel: PainelAutomacoes; aba: Aba }) {
  const [config, setConfig] = useState(painel.config);
  const [estado, acao, pendente] = useActionState(salvarConfiguracao, estadoInicial);
  const emailToken = useRef<HTMLInputElement>(null);
  const whatsappToken = useRef<HTMLInputElement>(null);
  const confirmar = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (estado.ok) {
      if (emailToken.current) emailToken.current.value = "";
      if (whatsappToken.current) whatsappToken.current.value = "";
      if (confirmar.current) confirmar.current.checked = false;
    }
  }, [estado]);
  const atualizar = <K extends keyof ConfigCobranca>(chave: K, valor: ConfigCobranca[K]) => setConfig((atual) => ({ ...atual, [chave]: valor, ...(["whatsappCorpo", "whatsappTemplate"].includes(chave) ? { whatsappTemplateAprovado: false } : {}) }));

  return <form action={acao} noValidate hidden={aba !== "Canais e mensagens" && aba !== "Régua de cobrança"} className="space-y-4">
    <input type="hidden" name="versao" value={estado.versao ?? painel.versao} />
    <div hidden={aba !== "Canais e mensagens"} className="space-y-4">
      <Card className="p-5">
        <div className="grid items-start gap-5 lg:grid-cols-[1fr_1.4fr]">
          <div><Selo nivel="info">Identidade de cobrança</Selo><h2 className="mt-3 text-lg font-bold tracking-tight">Uma conversa clara, em todos os canais.</h2><p className="mt-2 max-w-lg text-[12px] leading-relaxed text-tinta-suave">Personalize o remetente e a mensagem. Apenas dados do título entram na comunicação; dados internos de remuneração não são utilizados.</p></div>
          <div className="space-y-3"><Campo titulo="Nome da empresa nas mensagens"><input name="empresa" value={config.empresa} onChange={(e) => atualizar("empresa", e.target.value)} maxLength={120} className={campoClasse} /></Campo><div className="rounded-lg bg-fundo p-3 text-[11px] leading-relaxed text-tinta-suave">A configuração é exclusiva de administradores. Tokens salvos são criptografados e não voltam para o navegador. Campos de token vazios preservam a credencial existente.</div></div>
        </div>
      </Card>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <div className="mb-5 flex items-center gap-3"><Simbolo canal="email" /><div className="min-w-0 flex-1"><h2 className="text-base font-bold">E-mail transacional</h2><p className="mt-0.5 text-[11px] text-tinta-suave">Resend · domínio remetente verificado</p></div><Selo nivel={painel.segredos.email ? "otimo" : "atencao"}>{painel.segredos.email ? "token salvo" : "sem token"}</Selo></div>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2"><Campo titulo="E-mail remetente"><input type="email" name="emailRemetente" value={config.emailRemetente} onChange={(e) => atualizar("emailRemetente", e.target.value)} placeholder="cobranca@suaempresa.com.br" maxLength={254} className={campoClasse} /></Campo><Campo titulo="Responder para"><input type="email" name="emailResposta" value={config.emailResposta} onChange={(e) => atualizar("emailResposta", e.target.value)} maxLength={254} className={campoClasse} /></Campo></div>
            <Campo titulo="Token da API Resend" ajuda="Insira somente para cadastrar ou substituir. Nunca use uma senha pessoal de e-mail."><input ref={emailToken} type="password" name="emailToken" autoComplete="new-password" maxLength={4096} placeholder={painel.segredos.email ? "Credencial protegida · manter como está" : "Cole a chave da API"} className={campoClasse} /></Campo>
            <Campo titulo="Assunto"><input name="emailAssunto" value={config.emailAssunto} onChange={(e) => atualizar("emailAssunto", e.target.value)} maxLength={180} className={campoClasse} /></Campo>
            <Campo titulo="Mensagem"><textarea name="emailCorpo" value={config.emailCorpo} onChange={(e) => atualizar("emailCorpo", e.target.value)} rows={7} maxLength={4000} className={`${campoClasse} resize-y`} /></Campo>
            <Variaveis />
            <Previa canal="email" corpo={config.emailCorpo} assunto={config.emailAssunto} empresa={config.empresa} />
            <Marcacao nome="emailAtivo" checked={config.emailAtivo} onChange={(valor) => atualizar("emailAtivo", valor)} titulo="Autorizar canal de e-mail" descricao="Com credencial e servidor liberados, mensagens da fila poderão ser enviadas a destinatários autorizados." />
          </div>
        </Card>
        <Card className="p-5">
          <div className="mb-5 flex items-center gap-3"><Simbolo canal="whatsapp" /><div className="min-w-0 flex-1"><h2 className="text-base font-bold">WhatsApp de cobrança</h2><p className="mt-0.5 text-[11px] text-tinta-suave">WhatsApp Business Platform · API oficial Meta</p></div><Selo nivel={painel.segredos.whatsapp ? "otimo" : "atencao"}>{painel.segredos.whatsapp ? "token salvo" : "sem token"}</Selo></div>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2"><Campo titulo="Número de cobrança" ajuda="Número comercial registrado na Meta, com DDI 55 e DDD."><input type="tel" name="whatsappNumero" value={config.whatsappNumero} onChange={(e) => atualizar("whatsappNumero", e.target.value)} placeholder="+55 62 99999-9999" maxLength={30} className={campoClasse} /></Campo><Campo titulo="Phone Number ID" ajuda="Identificador da API, diferente do número de telefone."><input name="whatsappPhoneNumberId" value={config.whatsappPhoneNumberId} onChange={(e) => atualizar("whatsappPhoneNumberId", e.target.value)} inputMode="numeric" maxLength={40} className={campoClasse} /></Campo></div>
            <Campo titulo="Token da API Meta" ajuda="Token de usuário do sistema autorizado para o número empresarial."><input ref={whatsappToken} type="password" name="whatsappToken" autoComplete="new-password" maxLength={4096} placeholder={painel.segredos.whatsapp ? "Credencial protegida · manter como está" : "Cole o token de acesso"} className={campoClasse} /></Campo>
            <div className="grid gap-4 sm:grid-cols-[1fr_100px]"><Campo titulo="Nome exato do modelo aprovado"><input name="whatsappTemplate" value={config.whatsappTemplate} onChange={(e) => atualizar("whatsappTemplate", e.target.value)} placeholder="lembrete_cobranca" maxLength={100} className={campoClasse} /></Campo><Campo titulo="Idioma"><input value="pt_BR" readOnly className={`${campoClasse} bg-fundo`} /></Campo></div>
            <Campo titulo="Texto do modelo para conferência" ajuda="Use as cinco variáveis uma vez, nesta ordem: nome, documento, vencimento, valor, empresa. Na Meta, correspondem a {{1}} até {{5}}."><textarea name="whatsappCorpo" value={config.whatsappCorpo} onChange={(e) => atualizar("whatsappCorpo", e.target.value)} rows={6} maxLength={1024} className={`${campoClasse} resize-y`} /></Campo>
            <Variaveis />
            <Previa canal="whatsapp" corpo={config.whatsappCorpo} empresa={config.empresa} />
            <Marcacao nome="whatsappTemplateAprovado" checked={config.whatsappTemplateAprovado} onChange={(valor) => atualizar("whatsappTemplateAprovado", valor)} titulo="Conferi a aprovação e o texto do modelo na Meta" descricao="Esta declaração não verifica aprovação automaticamente. Nome, idioma, texto e ordem das variáveis precisam corresponder ao modelo autorizado." />
            <Marcacao nome="whatsappAtivo" checked={config.whatsappAtivo} onChange={(valor) => atualizar("whatsappAtivo", valor)} titulo="Autorizar canal de WhatsApp" descricao="Cadastrar o telefone não conecta o aplicativo pessoal. É necessário número registrado, token e modelo aprovado na plataforma Meta." />
          </div>
        </Card>
      </div>
    </div>

    <div hidden={aba !== "Régua de cobrança"}>
      <Card className="p-5 sm:p-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold tracking-tight">Um lembrete no momento certo.</h2><p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-tinta-suave">A régua usa o vencimento e o saldo do título unificado, respeitando destinatário autorizado, janela de envio e limite diário.</p></div><Selo nivel={config.automacaoAtiva ? "info" : "neutro"}>{config.automacaoAtiva ? "ativação solicitada" : "automação pausada"}</Selo></div>
        <div className="mb-6 grid gap-2 sm:grid-cols-4">{[{dia:"Antes",texto:"Lembrete amigável",numero:"01"},{dia:"No vencimento",texto:"Aviso objetivo",numero:"02"},{dia:"Após vencer",texto:"Regularização",numero:"03"},{dia:"Pago ou revogado",texto:"Interromper o envio",numero:"04"}].map((etapa) => <div key={etapa.numero} className="relative rounded-xl border border-contorno bg-fundo p-4"><span className="font-mono text-[10px] text-oliva">{etapa.numero}</span><h3 className="mt-3 text-[13px] font-bold">{etapa.dia}</h3><p className="mt-1 text-[11px] text-tinta-suave">{etapa.texto}</p></div>)}</div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <Campo titulo="Dias em relação ao vencimento" ajuda="Separe por vírgula. Ex.: -3, 0, 3, 7 significa três dias antes, no vencimento, três e sete dias depois."><input name="diasRelativos" defaultValue={config.diasRelativos.join(", ")} maxLength={100} className={campoClasse} /></Campo>
            <div className="grid gap-3 sm:grid-cols-3"><Campo titulo="A partir das"><input type="number" name="horaInicio" value={config.horaInicio} onChange={(e) => atualizar("horaInicio", Number(e.target.value))} min={8} max={19} className={campoClasse} /></Campo><Campo titulo="Até as"><input type="number" name="horaFim" value={config.horaFim} onChange={(e) => atualizar("horaFim", Number(e.target.value))} min={9} max={20} className={campoClasse} /></Campo><Campo titulo="Limite diário"><input type="number" name="limiteDiario" value={config.limiteDiario} onChange={(e) => atualizar("limiteDiario", Number(e.target.value))} min={1} max={500} className={campoClasse} /></Campo></div>
            <p className="text-[11px] text-tinta-suave">Horários inteiros · fuso America/Sao_Paulo. A janela e o limite também se aplicam às mensagens preparadas manualmente.</p>
            <Marcacao nome="apenasDiasUteis" checked={config.apenasDiasUteis} onChange={(valor) => atualizar("apenasDiasUteis", valor)} titulo="Enviar somente de segunda a sexta" descricao="Não utiliza calendário de feriados. Pause a automação quando a operação exigir." />
            <Marcacao nome="automacaoAtiva" checked={config.automacaoAtiva} onChange={(valor) => atualizar("automacaoAtiva", valor)} titulo="Ativar criação automática de lembretes" descricao="O processador do servidor passa a avaliar os títulos elegíveis nos dias definidos. Nenhuma cobrança retroativa é disparada em massa ao salvar." />
          </div>
          <div className="rounded-xl border border-contorno p-5"><h3 className="text-sm font-bold">Proteções da operação</h3><ul className="mt-4 space-y-4 text-[12px] leading-relaxed text-tinta-suave">{["Uma chave identifica título, canal e etapa para impedir duplicidade de preparação.","O contato precisa de autorização explícita. Revogar o contato bloqueia novos envios.","Títulos quitados, ambíguos, em quarentena ou fora da base validada não devem gerar cobrança.","Dados legados precisam estar atualizados. Fotografias antigas do Widesys não comprovam saldo atual.","Uma resposta incerta do provedor exige revisão; não significa que a mensagem falhou."] .map((texto) => <li key={texto} className="flex gap-3"><span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-oliva" />{texto}</li>)}</ul></div>
        </div>
      </Card>
    </div>

    <Card className="p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <label className="flex max-w-3xl items-start gap-3 text-[12px] leading-relaxed text-tinta-suave"><input ref={confirmar} type="checkbox" name="confirmarAtivacao" className="mt-1 h-4 w-4 shrink-0 accent-oliva" /><span>Se algum canal ou a automação estiver ativo, autorizo o processamento e o envio externo aos destinatários com contato confirmado. Conferi remetentes, modelos e regras.</span></label>
        <button type="submit" disabled={pendente} className={`${btnPrimario} justify-center whitespace-nowrap`}>{pendente ? "Salvando…" : "Salvar configuração"}</button>
      </div>
      <div className="mt-4"><Aviso estado={estado} /></div>
    </Card>
  </form>;
}

function FormContato({ titulo, canal, contato }: { titulo: TituloComunicacao; canal: "EMAIL" | "WHATSAPP"; contato?: ContatoComunicacao }) {
  const [estado, acao, pendente] = useActionState(salvarContato, estadoInicial);
  return <form action={acao} className="space-y-4">
    <input type="hidden" name="tituloChave" value={titulo.chave} /><input type="hidden" name="canal" value={canal} />
    <Campo titulo={canal === "EMAIL" ? "E-mail do destinatário" : "WhatsApp do destinatário"} ajuda="Conferir é obrigatório: o contato importado é uma sugestão, não uma autorização de envio."><input type={canal === "EMAIL" ? "email" : "tel"} name="destino" required defaultValue={contato?.destino ?? (canal === "EMAIL" ? titulo.email : titulo.telefone) ?? ""} maxLength={254} className={campoClasse} /></Campo>
    <Campo titulo="Permissão de contato"><select name="autorizacao" defaultValue={contato?.autorizado ? "AUTORIZADO" : "REVOGADO"} className={campoClasse}><option value="REVOGADO">Não autorizar / revogar contato</option><option value="AUTORIZADO">Destinatário confirmou o recebimento de cobranças</option></select></Campo>
    <Campo titulo="Evidência da autorização ou motivo da revogação" ajuda="Ex.: atendimento, data, origem da confirmação e referência do documento. Não inclua senhas."><textarea name="evidencia" required minLength={10} maxLength={500} defaultValue={contato?.evidencia ?? ""} rows={3} className={campoClasse} /></Campo>
    <Marcacao nome="confirmarContato" titulo="Conferi o destinatário e a evidência" descricao="A preferência será aplicada à pessoa vinculada, neste canal; não somente ao título selecionado." />
    <button type="submit" disabled={pendente} className={btnSecundario}>{pendente ? "Registrando…" : "Salvar preferência de contato"}</button><Aviso estado={estado} />
  </form>;
}

function FormPreparar({ titulo, canal, autorizado }: { titulo: TituloComunicacao; canal: "EMAIL" | "WHATSAPP"; autorizado: boolean }) {
  const [estado, acao, pendente] = useActionState(prepararMensagem, estadoInicial);
  return <form action={acao} className="mt-4 space-y-3 border-t border-contorno pt-4"><input type="hidden" name="tituloChave" value={titulo.chave} /><input type="hidden" name="canal" value={canal} />
    {!autorizado ? <p className="text-[11px] leading-relaxed text-tinta-suave">Autorize e salve o contato ao lado antes de preparar a mensagem.</p> : null}
    <Marcacao nome="confirmarMensagem" titulo="Conferi título, saldo e prévia" descricao="Preparar coloca a mensagem na fila. Se o canal e o servidor estiverem liberados, o processador poderá enviá-la na janela configurada." />
    <button type="submit" disabled={!autorizado || pendente} className={btnPrimario}>{pendente ? "Preparando…" : "Preparar mensagem"}</button><Aviso estado={estado} />
  </form>;
}

function Destinatarios({ painel }: { painel: PainelAutomacoes }) {
  const [busca, setBusca] = useState("");
  const [selecionado, setSelecionado] = useState(painel.titulos[0]?.chave ?? "");
  const [canal, setCanal] = useState<"EMAIL" | "WHATSAPP">("EMAIL");
  const titulo = painel.titulos.find((item) => item.chave === selecionado);
  const contato = titulo ? painel.contatos.find((item) => item.pessoaChave === titulo.pessoaChave && item.canal === canal) : undefined;
  const titulos = painel.titulos.filter((item) => item.chave === selecionado || `${item.nome} ${item.documento}`.toLocaleLowerCase("pt-BR").includes(busca.toLocaleLowerCase("pt-BR")));
  return <Card className="p-5">
    <div className="mb-5"><h2 className="text-lg font-bold tracking-tight">Pessoas certas. Cobranças conferidas.</h2><p className="mt-1 text-[12px] leading-relaxed text-tinta-suave">Escolha um título elegível da base unificada, confirme o canal e confira a mensagem antes de colocá-la na fila.</p></div>
    {painel.titulos.length === 0 ? <div className="rounded-xl border border-dashed border-contorno bg-fundo p-8 text-center"><h3 className="text-sm font-bold">Nenhum título elegível disponível</h3><p className="mx-auto mt-2 max-w-lg text-[12px] text-tinta-suave">Títulos precisam ter saldo em aberto e identidade reconciliada. Revise a base unificada e atualize a captura do legado antes de cobrar.</p></div> : <>
      <div className="grid gap-3 lg:grid-cols-[1fr_1.6fr_180px]"><Campo titulo="Localizar título"><input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou documento" className={campoClasse} /></Campo><Campo titulo="Título a conferir"><select value={selecionado} onChange={(e) => setSelecionado(e.target.value)} className={campoClasse}>{titulos.map((item) => <option key={item.chave} value={item.chave}>{item.nome} · {item.documento || "Sem documento"}</option>)}</select></Campo><Campo titulo="Canal"><select value={canal} onChange={(e) => setCanal(e.target.value as "EMAIL" | "WHATSAPP")} className={campoClasse}><option value="EMAIL">E-mail</option><option value="WHATSAPP">WhatsApp</option></select></Campo></div>
      {titulo ? <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <div className="rounded-xl border border-contorno p-4 sm:p-5"><div className="mb-5 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold">Preferência do destinatário</h3><Selo nivel={contato?.autorizado ? "otimo" : "atencao"}>{contato?.autorizado ? "autorizado" : "não autorizado"}</Selo></div><FormContato key={`${titulo.chave}:${canal}:${contato?.id ?? "novo"}:${contato?.autorizado}`} titulo={titulo} canal={canal} contato={contato} /></div>
        <div className="min-w-0"><div className="mb-4 grid grid-cols-2 gap-3"><div className="rounded-lg border border-contorno p-3"><p className="text-[10px] uppercase tracking-wider text-tinta-suave">Saldo do título</p><p className="numero-card numero-card--compacto mt-2 font-mono font-semibold"><Sigilo>{formatarBRL(titulo.aberto)}</Sigilo></p></div><div className="rounded-lg border border-contorno p-3"><p className="text-[10px] uppercase tracking-wider text-tinta-suave">Vencimento</p><p className="mt-2 font-mono text-[14px] font-semibold">{titulo.vencimento.slice(0, 10).split("-").reverse().join("/")}</p></div></div>
          <Previa canal={canal === "EMAIL" ? "email" : "whatsapp"} corpo={canal === "EMAIL" ? painel.config.emailCorpo : painel.config.whatsappCorpo} assunto={canal === "EMAIL" ? painel.config.emailAssunto : undefined} empresa={painel.config.empresa} dados={{ nome: titulo.nome, documento: titulo.documento, vencimento: titulo.vencimento.slice(0, 10), valorCentavos: titulo.aberto, empresa: painel.config.empresa }} />
          <FormPreparar key={`${titulo.chave}:${canal}`} titulo={titulo} canal={canal} autorizado={contato?.autorizado ?? false} />
        </div>
      </div> : null}
    </>}
  </Card>;
}

function Cancelar({ id }: { id: string }) {
  const [estado, acao, pendente] = useActionState(cancelarMensagem, estadoInicial);
  return <form action={acao} className="space-y-2"><input type="hidden" name="id" value={id} /><button type="submit" disabled={pendente} className="text-[11px] font-semibold text-erro underline underline-offset-4">{pendente ? "Cancelando…" : "Cancelar pendência"}</button><Aviso estado={estado} /></form>;
}

function Revogar({ id }: { id: string }) {
  const [estado, acao, pendente] = useActionState(revogarContato, estadoInicial);
  return <form action={acao} className="space-y-2"><input type="hidden" name="id" value={id} /><button type="submit" disabled={pendente} className="text-[11px] font-semibold text-erro underline underline-offset-4">{pendente ? "Revogando…" : "Revogar autorização"}</button><Aviso estado={estado} /></form>;
}

function ContatosRegistrados({ contatos }: { contatos: ContatoComunicacao[] }) {
  return <Card className="mt-4 p-5"><h2 className="text-base font-bold">Contatos registrados</h2><p className="mt-1 text-[12px] leading-relaxed text-tinta-suave">Revogue a autorização a qualquer momento, mesmo após o pagamento ou quando o título não estiver mais disponível.</p>{contatos.length === 0 ? <p className="mt-5 rounded-lg bg-fundo p-4 text-[12px] text-tinta-suave">Nenhum contato confirmado ou revogado nesta central.</p> : <div className="mt-4 divide-y divide-contorno">{contatos.map((contato) => <div key={contato.id} className="flex flex-col justify-between gap-3 py-4 sm:flex-row"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-[12px] font-bold">{contato.canal === "EMAIL" ? "E-mail" : "WhatsApp"}</span><Selo nivel={contato.autorizado ? "otimo" : "neutro"}>{contato.autorizado ? "autorizado" : "revogado"}</Selo></div><p className="mt-2 break-all text-[12px]"><Sigilo>{contato.destino}</Sigilo></p><details className="mt-2"><summary className="cursor-pointer text-[10px] text-tinta-suave">Evidência registrada</summary><p className="mt-2 max-w-2xl whitespace-pre-wrap break-words text-[11px] text-tinta-suave">{contato.evidencia}</p></details></div>{contato.autorizado ? <Revogar id={contato.id} /> : null}</div>)}</div>}</Card>;
}

function textoPreparado(conteudo: string) {
  try {
    const dados: unknown = JSON.parse(conteudo);
    if (!dados || typeof dados !== "object") return "Conteúdo indisponível para visualização.";
    const texto = "texto" in dados && typeof dados.texto === "string" ? dados.texto : "";
    const assunto = "assunto" in dados && typeof dados.assunto === "string" ? dados.assunto : "";
    return [assunto, texto].filter(Boolean).join("\n\n") || "Conteúdo indisponível para visualização.";
  } catch {
    return "Conteúdo indisponível para visualização.";
  }
}

function Auditoria({ eventos }: { eventos: PainelAutomacoes["eventos"] }) {
  return <Card className="mt-4 p-5"><details><summary className="cursor-pointer text-sm font-bold">Trilha de configuração e processamento · {eventos.length} eventos recentes</summary><p className="mt-2 text-[11px] text-tinta-suave">A trilha registra alterações de configuração, preferências e processamento. Credenciais não são exibidas.</p><ol className="mt-4 space-y-3">{eventos.map((evento) => <li key={evento.id} className="flex flex-wrap justify-between gap-2 border-t border-contorno pt-3 text-[11px]"><span>{evento.tipo.toLowerCase().replaceAll("_", " ")}{evento.codigo ? <code className="ml-2 text-tinta-suave">{evento.codigo}</code> : null}</span><time dateTime={evento.criadoEm} className="font-mono text-tinta-suave">{dataHora(evento.criadoEm)}</time></li>)}</ol>{eventos.length === 0 ? <p className="mt-4 text-[12px] text-tinta-suave">Nenhum evento registrado.</p> : null}</details></Card>;
}

const rotulosStatus: Record<string, string> = { PENDENTE: "Na fila", AGENDADA: "Agendada", PREPARADA: "Preparada", PROCESSANDO: "Processando", ENVIANDO: "Transmitindo", ENVIADA: "Aceita pelo provedor", ENTREGUE: "Entregue", LIDA: "Lida", FALHOU: "Falha", FALHA: "Falha", INCERTA: "Conferir no provedor", REVISAO: "Revisão necessária", CANCELADA: "Cancelada", BLOQUEADA: "Bloqueada" };
const dataHora = (valor: string) => new Date(valor).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

function Historico({ mensagens }: { mensagens: MensagemComunicacao[] }) {
  const [filtro, setFiltro] = useState("TODOS");
  const visiveis = mensagens.filter((mensagem) => filtro === "TODOS" || mensagem.canal === filtro);
  return <Card>
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-contorno p-5"><div><h2 className="text-lg font-bold tracking-tight">Cada envio tem uma trilha.</h2><p className="mt-1 text-[12px] text-tinta-suave">Histórico recente. Aceite da API não é confirmação de leitura ou de pagamento.</p></div><label className="text-[11px] font-semibold">Canal<select value={filtro} onChange={(e) => setFiltro(e.target.value)} className={`${inputBase} ml-2`}><option value="TODOS">Todos</option><option value="EMAIL">E-mail</option><option value="WHATSAPP">WhatsApp</option></select></label></div>
    {visiveis.length === 0 ? (
      <div className="p-12 text-center">
        <span className="font-mono text-[11px] text-oliva">FILA TRANQUILA</span>
        <h3 className="mt-3 text-base font-bold">Nenhuma mensagem neste filtro</h3>
        <p className="mt-2 text-[12px] text-tinta-suave">A preparação e os resultados de processamento aparecerão aqui.</p>
      </div>
    ) : (
      <div className="divide-y divide-contorno">
        {visiveis.map((mensagem) => (
          <div key={mensagem.id} className="p-4 sm:p-5">
            <div className="flex flex-col justify-between gap-3 md:flex-row">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-bold">{mensagem.canal === "EMAIL" ? "E-mail" : "WhatsApp"}</span>
                  <Selo nivel={["ENVIADA", "ENTREGUE", "LIDA"].includes(mensagem.status) ? "otimo" : ["INCERTA", "REVISAO", "FALHA", "FALHOU", "RESULTADO_DESCONHECIDO"].includes(mensagem.status) ? "atencao" : "neutro"}>
                    {rotulosStatus[mensagem.status] ?? mensagem.status.toLowerCase().replaceAll("_", " ")}
                  </Selo>
                </div>
                <p className="mt-2 break-all text-[12px] text-tinta-suave"><Sigilo>{mensagem.destino}</Sigilo></p>
                <p className="mt-1 text-[10px] text-tinta-suave">Criada {dataHora(mensagem.criadoEm)} · {mensagem.etapa}{mensagem.enviadoEm ? ` · enviada ${dataHora(mensagem.enviadoEm)}` : ""}</p>
              </div>
              {mensagem.status === "AGENDADA" ? <Cancelar id={mensagem.id} /> : null}
            </div>
            {mensagem.erroCodigo && !["ENVIADA", "ENTREGUE", "LIDA"].includes(mensagem.status) ? <p className="mt-3 rounded-lg bg-ambar/5 p-3 text-[11px] text-tinta-suave">Código de acompanhamento: <code>{mensagem.erroCodigo}</code>. Consulte a configuração e o provedor antes de repetir um envio.</p> : null}
            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] font-semibold text-oliva-escura">Conferir conteúdo preparado</summary>
              <pre className="mt-2 overflow-hidden whitespace-pre-wrap break-words rounded-lg bg-fundo p-3 text-[11px] leading-relaxed"><Sigilo>{textoPreparado(mensagem.conteudo)}</Sigilo></pre>
            </details>
          </div>
        ))}
      </div>
    )}
  </Card>;
}

export function PainelAutomacoesClient({ painel }: { painel: PainelAutomacoes }) {
  const [aba, setAba] = useState<Aba>("Canais e mensagens");
  const canais = Number(painel.config.emailAtivo) + Number(painel.config.whatsappAtivo);
  const pendentes = painel.mensagens.filter((m) => ["PENDENTE", "AGENDADA", "PREPARADA", "PROCESSANDO", "ENVIANDO"].includes(m.status)).length;
  const revisao = painel.mensagens.filter((m) => ["INCERTA", "REVISAO", "FALHA", "FALHOU", "BLOQUEADA"].includes(m.status)).length;
  return <div className="space-y-5">
    <section className="rounded-xl border border-contorno bg-[#14282b] p-5 text-white sm:p-6" aria-label="Estado da operação"><div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center"><div className="max-w-2xl"><div className="text-[9px] font-bold uppercase tracking-[0.17em] text-[#a9ccc1]">Central de relacionamento financeiro</div><h2 className="mt-2 text-xl font-bold tracking-tight">Automação com controle, do início à entrega.</h2><p className="mt-2 text-[12px] leading-relaxed text-[#bdd0d2]">Configure os canais, confirme os destinatários e acompanhe a fila. Envio automático só ocorre com as autorizações e a liberação do servidor.</p></div><div className="shrink-0 rounded-xl border border-white/15 bg-white/5 p-4"><div className="flex items-center gap-2 text-[12px] font-semibold"><span className={`h-2 w-2 rounded-full ${painel.segredos.envio ? "bg-[#98c5ad]" : "bg-[#dfbd79]"}`} />{painel.segredos.envio ? "Envio externo liberado no servidor" : "Envio externo pausado no servidor"}</div><p className="mt-2 max-w-xs text-[10px] leading-relaxed text-[#bdd0d2]">{painel.segredos.envio ? "Canais, contatos e regras continuam sendo validados antes de cada envio." : "Você pode preparar configurações e mensagens sem transmitir aos provedores."}</p></div></div></section>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[{rotulo:"Canais autorizados",valor:`${canais} / 2`,texto:"e-mail e WhatsApp"},{rotulo:"Títulos disponíveis",valor:painel.titulos.length,texto:"base unificada elegível"},{rotulo:"Na fila recente",valor:pendentes,texto:"preparação não é entrega"},{rotulo:"Precisam de atenção",valor:revisao,texto:"conferência antes de repetir"}].map((item) => <Card key={item.rotulo} className="p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-tinta-suave">{item.rotulo}</p><p className="numero-card numero-card--compacto mt-2 font-mono font-bold">{item.valor}</p><p className="mt-1 text-[10px] text-tinta-suave">{item.texto}</p></Card>)}</div>
    {!painel.segredos.chave ? <p role="status" className="rounded-xl border border-ambar/30 bg-ambar/5 p-4 text-[12px] leading-relaxed text-tinta">O cofre de integração ainda não tem a chave de criptografia no servidor. Cadastre a infraestrutura antes de salvar credenciais. Nunca envie tokens por mensagens ou pelo Git.</p> : null}
    <nav aria-label="Seções da automação" className="flex gap-1 overflow-x-auto border-b border-contorno">{abas.map((item) => <button key={item} type="button" onClick={() => setAba(item)} aria-current={aba === item ? "page" : undefined} className={`shrink-0 border-b-2 px-4 py-3 text-[12px] font-semibold transition-colors ${aba === item ? "border-oliva text-oliva-escura" : "border-transparent text-tinta-suave hover:text-tinta"}`}>{item}</button>)}</nav>
    <Configuracao painel={painel} aba={aba} />
    {aba === "Destinatários" ? <div><Destinatarios painel={painel} /><ContatosRegistrados contatos={painel.contatos} /></div> : null}
    {aba === "Fila e histórico" ? <div><Historico mensagens={painel.mensagens} /><Auditoria eventos={painel.eventos} /></div> : null}
  </div>;
}
