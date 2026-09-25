"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { exigirSessao } from "@/lib/auth";
import { perfilAtual } from "@/lib/autorizacao";
import { prisma } from "@/lib/db";
import { normalizarEmail, normalizarTelefoneBR, validarConfigCobranca, type ConfigCobranca } from "@/lib/comunicacoes/dominio";
import {
  cancelarMensagemCobranca,
  ErroComunicacao,
  prepararMensagemCobranca,
  registrarContatoCobranca,
  revogarContatoCobranca,
  salvarConfigComunicacoes,
} from "@/lib/comunicacoes/servico";
import type { EstadoAcao } from "./tipos";

const ROTA = "/financeiro/automacoes";

function campo(form: FormData, chave: string) {
  const valor = form.get(chave);
  return typeof valor === "string" ? valor.trim() : "";
}

function marcado(form: FormData, chave: string) {
  return campo(form, chave) === "on";
}

async function administrador() {
  const sessao = await exigirSessao();
  if ((await perfilAtual()) !== "ADMINISTRADOR") notFound();
  return sessao.sub;
}

function erroSeguro(erro?: unknown): EstadoAcao {
  if (erro instanceof ErroComunicacao) return { erro: erro.message };
  return { erro: "Não foi possível concluir. Confira os campos, as autorizações e a configuração do servidor. Se outra pessoa editou a configuração, recarregue a página." };
}

export async function salvarConfiguracao(_anterior: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const usuarioId = await administrador();
  try {
    const versao = Number(campo(form, "versao"));
    if (!Number.isSafeInteger(versao) || versao < 0) return erroSeguro();
    const etapas = campo(form, "diasRelativos");
    if (!/^-?\d{1,2}(?:\s*,\s*-?\d{1,2})*$/.test(etapas)) {
      return { erro: "Informe os dias da régua separados por vírgula, por exemplo: -3, 0, 3, 7." };
    }
    let config: ConfigCobranca;
    try { config = validarConfigCobranca({
      empresa: campo(form, "empresa"),
      emailAtivo: marcado(form, "emailAtivo"),
      whatsappAtivo: marcado(form, "whatsappAtivo"),
      emailRemetente: campo(form, "emailRemetente"),
      emailResposta: campo(form, "emailResposta"),
      emailAssunto: campo(form, "emailAssunto"),
      emailCorpo: campo(form, "emailCorpo"),
      whatsappNumero: campo(form, "whatsappNumero"),
      whatsappPhoneNumberId: campo(form, "whatsappPhoneNumberId"),
      whatsappTemplate: campo(form, "whatsappTemplate"),
      whatsappTemplateAprovado: marcado(form, "whatsappTemplateAprovado"),
      whatsappIdioma: "pt_BR",
      whatsappCorpo: campo(form, "whatsappCorpo"),
      automacaoAtiva: marcado(form, "automacaoAtiva"),
      diasRelativos: etapas.split(",").map((dia) => Number(dia.trim())),
      horaInicio: Number(campo(form, "horaInicio")),
      horaFim: Number(campo(form, "horaFim")),
      apenasDiasUteis: marcado(form, "apenasDiasUteis"),
      limiteDiario: Number(campo(form, "limiteDiario")),
    }); } catch (erro) {
      // O validador do domínio só produz mensagens estáticas, sem valores enviados.
      return { erro: erro instanceof Error ? erro.message : "Configuração inválida." };
    }
    if ((config.emailAtivo || config.whatsappAtivo || config.automacaoAtiva) && !marcado(form, "confirmarAtivacao")) {
      return { erro: "Confirme a autorização de envio externo para salvar com canais ou automação habilitados." };
    }
    const salva = await salvarConfigComunicacoes(prisma, config, versao, {
      emailToken: campo(form, "emailToken") || undefined,
      whatsappToken: campo(form, "whatsappToken") || undefined,
    }, usuarioId);
    revalidatePath(ROTA);
    return { ok: "Configuração salva. A fila da versão anterior foi cancelada e precisa ser preparada novamente. Envios dependem dos canais autorizados e do processador do servidor.", versao: salva.versao };
  } catch (erro) {
    return erroSeguro(erro);
  }
}

export async function salvarContato(_anterior: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const usuarioId = await administrador();
  const canal = campo(form, "canal");
  if (canal !== "EMAIL" && canal !== "WHATSAPP") return erroSeguro();
  if (!marcado(form, "confirmarContato")) return { erro: "Confirme a conferência do destinatário e da evidência antes de salvar." };
  let destino: string;
  try { destino = canal === "EMAIL" ? normalizarEmail(campo(form, "destino")) : normalizarTelefoneBR(campo(form, "destino")); }
  catch (erro) { return { erro: erro instanceof Error ? erro.message : "Destino inválido." }; }
  try {
    await registrarContatoCobranca(prisma, {
      tituloChave: campo(form, "tituloChave"),
      canal,
      destino,
      evidencia: campo(form, "evidencia"),
      autorizado: campo(form, "autorizacao") === "AUTORIZADO",
    }, usuarioId);
    revalidatePath(ROTA);
    return { ok: "Preferência de contato registrada. Autorizar um destinatário não cria uma mensagem por si só." };
  } catch (erro) {
    return erroSeguro(erro);
  }
}

export async function prepararMensagem(_anterior: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const usuarioId = await administrador();
  const canal = campo(form, "canal");
  if (canal !== "EMAIL" && canal !== "WHATSAPP") return erroSeguro();
  if (!marcado(form, "confirmarMensagem")) return { erro: "Confira a prévia e confirme a inclusão na fila." };
  try {
    const mensagem = await prepararMensagemCobranca(prisma, { tituloChave: campo(form, "tituloChave"), canal }, usuarioId);
    revalidatePath(ROTA);
    if (mensagem.status !== "AGENDADA") return { ok: "Este título já possui uma mensagem nesta etapa. Nenhuma duplicata foi criada; consulte o histórico para conferir o estado." };
    return { ok: "Solicitação registrada na fila. Consulte o histórico para acompanhar o resultado; inclusão na fila não significa entrega." };
  } catch (erro) {
    return erroSeguro(erro);
  }
}

export async function cancelarMensagem(_anterior: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const usuarioId = await administrador();
  try {
    const resultado = await cancelarMensagemCobranca(prisma, campo(form, "id"), usuarioId);
    revalidatePath(ROTA);
    if (!resultado.canceladas) return { erro: "Esta mensagem não está mais agendada. Atualize o histórico para conferir o estado atual." };
    return { ok: "Cancelamento registrado. Mensagens em transmissão ou já enviadas não podem ser recolhidas." };
  } catch (erro) {
    return erroSeguro(erro);
  }
}

export async function revogarContato(_anterior: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const usuarioId = await administrador();
  try {
    await revogarContatoCobranca(prisma, campo(form, "id"), usuarioId);
    revalidatePath(ROTA);
    return { ok: "Contato revogado e mensagens agendadas canceladas. Envios em transmissão ou já enviados não podem ser recolhidos." };
  } catch (erro) {
    return erroSeguro(erro);
  }
}
