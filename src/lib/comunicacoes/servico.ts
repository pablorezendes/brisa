import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { lerOperacaoUnificada } from "../unificacao/servico";
import { normalizar } from "../dominio/normalizacao";
import {
  CONFIG_COBRANCA_PADRAO, validarConfigCobranca, normalizarEmail, normalizarTelefoneBR,
  renderizarEmail, renderizarMensagem, dentroJanelaEnvio, diasDesdeVencimento,
  type ConfigCobranca, type DadosMensagemCobranca,
} from "./dominio";
import { cifrarSegredo, decifrarSegredo, chaveAutomacoesConfigurada } from "./segredos";
import { enviarEmailResend, enviarWhatsAppMeta, type ResultadoEnvio } from "./provedores";
import { aplicarRetornos } from "./retornos";

type Canal = "EMAIL" | "WHATSAPP";
type Banco = PrismaClient | Prisma.TransactionClient;
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export class ErroComunicacao extends Error {
  constructor(public codigo: string, mensagem: string) { super(mensagem); }
}
function erro(codigo: string, mensagem: string): never { throw new ErroComunicacao(codigo, mensagem); }
async function admin(db: Banco, id: string) {
  if ((await db.usuario.findUnique({ where: { id }, select: { perfil: true } }))?.perfil !== "ADMINISTRADOR")
    erro("ACESSO_NEGADO", "Somente administradores podem configurar ou preparar envios.");
}
function canalValido(canal: string): asserts canal is Canal {
  if (canal !== "EMAIL" && canal !== "WHATSAPP") erro("CANAL_INVALIDO", "Escolha e-mail ou WhatsApp.");
}
const configSalva = (dados?: string) => validarConfigCobranca(dados ? JSON.parse(dados) : CONFIG_COBRANCA_PADRAO);

export type TituloComunicacao = {
  chave: string; pessoaChave: string; nome: string; documento: string; vencimento: string;
  aberto: number; email?: string; telefone?: string; fonteHash: string; legado: boolean; fontes: string[];
};

/** Projeção mínima: jamais exporta observações, comissão, dados bancários ou snapshot bruto. */
export async function titulosComunicacao(db: PrismaClient, agora = new Date()): Promise<TituloComunicacao[]> {
  const [{ linhas }, bloqueios, legados] = await Promise.all([
    lerOperacaoUnificada(db),
    db.boleto.findMany({ where: { OR: [{ status: { in: ["PAGAMENTO_REPORTADO", "RESULTADO_DESCONHECIDO"] } }, { conciliacaoStatus: "DIVERGENTE" }] }, select: { recebimentoId: true } }),
    db.tituloFinanceiroLegado.findMany({ where: { natureza: "RECEBER" }, select: { id: true, capturadoEm: true } }),
  ]);
  const bloqueados = new Set(bloqueios.map(b => `BRISA:RECEBER:${b.recebimentoId}`));
  const capturas = new Map(legados.map(l => [l.id, l.capturadoEm.getTime()]));
  const pessoas = new Map<string, typeof linhas[number]>();
  for (const p of linhas) if (p.dominio === "PESSOA" && p.estado === "ATIVO")
    for (const chave of p.fontes) pessoas.set(chave, p);
  const saida: TituloComunicacao[] = [];
  for (const t of linhas) {
    if (t.dominio !== "RECEBER" || t.estado !== "ATIVO" || !t.contabiliza || t.cancelado || t.informativo || !t.pessoaChave || !t.vencimento || !Number.isSafeInteger(t.aberto) || t.aberto! <= 0) continue;
    if (t.campos.origemAgregada?.valor === "Sim" || t.fontes.some(f => bloqueados.has(f))) continue;
    // Recebíveis de remuneração interna permanecem no fluxo restrito de comissões/fiscal.
    if (/COMISS|TAXA.{0,20}ADMINISTR/.test(normalizar(`${t.titulo} ${t.descricao}`))) continue;
    // Uma captura histórica não comprova saldo atual no legado.
    if (t.origem === "WIDESYS" && (agora.getTime() - (capturas.get(t.origemId) ?? 0) > 86_400_000 || (capturas.get(t.origemId) ?? 0) > agora.getTime())) continue;
    const pessoa = pessoas.get(t.pessoaChave);
    if (!pessoa) continue;
    const documento = String(t.campos.documento?.valor ?? `Competência ${t.competencia ?? t.vencimento.slice(0,7)}`);
    const dados = { chave: t.chave, pessoaChave: pessoa.chave, nome: pessoa.titulo, documento, vencimento: t.vencimento, aberto: t.aberto! };
    // Inclui identidade das fontes; unificar/reabrir torna a prévia antiga inválida.
    saida.push({ ...dados, fontes: [...t.fontes].sort(), fonteHash: hash({ ...dados, fontes: [...t.fontes].sort() }), legado: t.origem === "WIDESYS",
      email: typeof pessoa.campos.email?.valor === "string" ? pessoa.campos.email.valor : undefined,
      telefone: typeof pessoa.campos.telefone?.valor === "string" ? pessoa.campos.telefone.valor : undefined });
  }
  return saida.sort((a,b) => a.vencimento.localeCompare(b.vencimento) || a.nome.localeCompare(b.nome));
}

export async function lerPainelComunicacoes(db: PrismaClient) {
  const [salva, titulos, contatos, mensagens, eventos] = await Promise.all([
    db.configuracaoComunicacao.findUnique({ where: { id: "cobranca" } }), titulosComunicacao(db),
    db.contatoCobranca.findMany({ orderBy: { atualizadoEm: "desc" } }),
    db.mensagemCobranca.findMany({ orderBy: { criadoEm: "desc" }, take: 100, select: { id: true, tituloChave: true, canal: true, destino: true, status: true, criadoEm: true, enviadoEm: true, erroCodigo: true, etapa: true, conteudo: true } }),
    db.eventoComunicacao.findMany({ orderBy: { criadoEm: "desc" }, take: 40 }),
  ]);
  return { config: configSalva(salva?.dados), versao: salva?.versao ?? 0, titulos, contatos, mensagens, eventos,
    segredos: { email: Boolean(salva?.emailTokenCifrado), whatsapp: Boolean(salva?.whatsappTokenCifrado), chave: chaveAutomacoesConfigurada(), envio: process.env.AUTOMACOES_ENVIO_HABILITADO === "1" } };
}

export async function salvarConfigComunicacoes(db: PrismaClient, entrada: ConfigCobranca, versao: number, segredos: { emailToken?: string; whatsappToken?: string }, usuarioId: string) {
  await admin(db, usuarioId);
  if (!Number.isSafeInteger(versao) || versao < 0) erro("VERSAO_INVALIDA", "Recarregue a configuração.");
  const config = validarConfigCobranca(entrada);
  const tokens = {
    ...(segredos.emailToken?.trim() ? { emailTokenCifrado: cifrarSegredo(segredos.emailToken.trim(), "cobranca:email") } : {}),
    ...(segredos.whatsappToken?.trim() ? { whatsappTokenCifrado: cifrarSegredo(segredos.whatsappToken.trim(), "cobranca:whatsapp") } : {}),
  };
  return db.$transaction(async tx => {
    const anterior = await tx.configuracaoComunicacao.findUnique({ where: { id: "cobranca" } });
    if ((anterior?.versao ?? 0) !== versao) erro("CONFIG_DESATUALIZADA", "A configuração mudou. Recarregue antes de salvar.");
    if (config.emailAtivo && !tokens.emailTokenCifrado && !anterior?.emailTokenCifrado) erro("EMAIL_SEM_TOKEN", "Cadastre a chave de envio de e-mail antes de ativar o canal.");
    if (config.whatsappAtivo && !tokens.whatsappTokenCifrado && !anterior?.whatsappTokenCifrado) erro("WHATSAPP_SEM_TOKEN", "Cadastre o token oficial do WhatsApp antes de ativar o canal.");
    const dados = { dados: JSON.stringify(config), atualizadoPor: usuarioId, ...tokens };
    if (anterior) {
      const salvo = await tx.configuracaoComunicacao.updateMany({ where: { id: "cobranca", versao }, data: { ...dados, versao: { increment: 1 } } });
      if (salvo.count !== 1) erro("CONFIG_DESATUALIZADA", "A configuração mudou. Recarregue antes de salvar.");
    } else await tx.configuracaoComunicacao.create({ data: { id: "cobranca", ...dados } });
    // Aprovações se referem a uma versão exata: mudar texto/remetente invalida a fila anterior.
    await tx.mensagemCobranca.updateMany({ where: { status: "AGENDADA" }, data: { status: "CANCELADA", erroCodigo: "CONFIG_ALTERADA" } });
    await tx.eventoComunicacao.create({ data: { tipo: "CONFIGURACAO_SALVA", usuarioId } });
    return { versao: versao + 1 };
  });
}

export async function registrarContatoCobranca(db: PrismaClient, entrada: { tituloChave: string; canal: Canal; destino: string; evidencia: string; autorizado: boolean }, usuarioId: string) {
  await admin(db, usuarioId); canalValido(entrada.canal);
  const destino = entrada.canal === "EMAIL" ? normalizarEmail(entrada.destino) : normalizarTelefoneBR(entrada.destino);
  if (entrada.evidencia.trim().length < 10 || entrada.evidencia.length > 500) erro("EVIDENCIA_OBRIGATORIA", "Descreva como o titular autorizou este canal (10 a 500 caracteres).");
  const titulo = (await titulosComunicacao(db)).find(t => t.chave === entrada.tituloChave);
  if (!titulo) erro("TITULO_INELEGIVEL", "Título indisponível: confira saldo, unificação e atualização da origem.");
  return db.$transaction(async tx => {
    // Apenas um destino autorizado por pessoa/canal: trocar contato revoga o anterior e sua fila.
    const anteriores = await tx.contatoCobranca.findMany({ where: { pessoaChave: titulo.pessoaChave, canal: entrada.canal }, select: { id: true } });
    await tx.contatoCobranca.updateMany({ where: { pessoaChave: titulo.pessoaChave, canal: entrada.canal }, data: { autorizado: false, revisadoPor: usuarioId } });
    await tx.mensagemCobranca.updateMany({ where: { contatoId: { in: anteriores.map(c => c.id) }, status: "AGENDADA" }, data: { status: "CANCELADA", erroCodigo: "CONTATO_REVISADO" } });
    const contato = await tx.contatoCobranca.upsert({ where: { pessoaChave_canal_destino: { pessoaChave: titulo.pessoaChave, canal: entrada.canal, destino } },
      create: { pessoaChave: titulo.pessoaChave, canal: entrada.canal, destino, autorizado: entrada.autorizado === true, evidencia: entrada.evidencia.trim(), revisadoPor: usuarioId },
      update: { autorizado: entrada.autorizado === true, evidencia: entrada.evidencia.trim(), revisadoPor: usuarioId } });
    await tx.eventoComunicacao.create({ data: { tipo: entrada.autorizado ? "CONTATO_AUTORIZADO" : "CONTATO_REVOGADO", usuarioId } });
    return { id: contato.id };
  });
}

function dadosMensagem(t: TituloComunicacao, c: ConfigCobranca): DadosMensagemCobranca {
  return { nome: t.nome, documento: t.documento, vencimento: t.vencimento, valorCentavos: t.aberto, empresa: c.empresa };
}

function temFonteComum(fontes: string[], anterior: { tituloChave: string; fontes: string }): boolean {
  let origens: unknown;
  try { origens = JSON.parse(anterior.fontes); } catch { origens = []; }
  return fontes.includes(anterior.tituloChave) || (Array.isArray(origens) && origens.some(f => typeof f === "string" && fontes.includes(f)));
}

async function preparar(db: PrismaClient, titulo: TituloComunicacao, canal: Canal, usuarioId: string, etapa: string, versaoEsperada?: number) {
  const salva = await db.configuracaoComunicacao.findUnique({ where: { id: "cobranca" } });
  if (!salva) erro("CONFIGURAR_PRIMEIRO", "Salve a configuração de comunicação primeiro.");
  const config = configSalva(salva.dados);
  if (versaoEsperada !== undefined && (salva.versao !== versaoEsperada || !config.automacaoAtiva || !(canal === "EMAIL" ? config.emailAtivo : config.whatsappAtivo)))
    erro("CONFIG_ALTERADA", "A automação foi alterada durante a preparação. Aguarde a próxima execução.");
  const contato = await db.contatoCobranca.findFirst({ where: { pessoaChave: titulo.pessoaChave, canal, autorizado: true }, orderBy: { atualizadoEm: "desc" } });
  if (!contato) erro("CONTATO_NAO_AUTORIZADO", "Confirme o destino e registre a autorização do titular antes de preparar a mensagem.");
  const dados = dadosMensagem(titulo, config);
  const conteudo = JSON.stringify(canal === "EMAIL" ? renderizarEmail(config.emailAssunto, config.emailCorpo, dados) : { texto: renderizarMensagem(config.whatsappCorpo, dados) });
  const chave = hash({ titulo: titulo.chave, canal, etapa });
  return db.$transaction(async tx => {
    // A preparação também tem corte atômico: pausa/revogação não gera fila nova por uma leitura antiga.
    const configuracaoAtual = await tx.configuracaoComunicacao.findUnique({ where: { id: "cobranca" } });
    const contatoAtual = await tx.contatoCobranca.findUnique({ where: { id: contato.id } });
    if (configuracaoAtual?.versao !== salva.versao) erro("CONFIG_ALTERADA", "A configuração mudou durante a preparação. Recarregue a página.");
    if (!contatoAtual?.autorizado || contatoAtual.destino !== contato.destino || contatoAtual.pessoaChave !== titulo.pessoaChave)
      erro("CONTATO_NAO_AUTORIZADO", "O contato foi revogado ou alterado durante a preparação.");
    await admin(tx, usuarioId);
    const anterior = await tx.mensagemCobranca.findUnique({ where: { chave } });
    // Uma entrega/incerteza nunca é reemitida por clique ou execução repetida do cron.
    if (anterior && anterior.status !== "CANCELADA") return { id: anterior.id, status: anterior.status };
    const tentadas = await tx.mensagemCobranca.findMany({ where: { canal, etapa, tentativas: { gt: 0 } }, select: { id: true, status: true, tituloChave: true, fontes: true } });
    const mesmaOrigem = tentadas.find(m => temFonteComum(titulo.fontes, m));
    if (mesmaOrigem) return { id: mesmaOrigem.id, status: mesmaOrigem.status };
    const registro = { tituloChave: titulo.chave, fontes: JSON.stringify(titulo.fontes), pessoaChave: titulo.pessoaChave, contatoId: contato.id, canal, etapa, destino: contato.destino, conteudo,
      fonteHash: titulo.fonteHash, configVersao: salva.versao, criadoPor: usuarioId, status: "AGENDADA", erroCodigo: null, tentativas: 0, proximoEnvio: new Date() };
    // Cancelada após tentativa remota também é imutável.
    if (anterior?.tentativas) return { id: anterior.id, status: anterior.status };
    const mensagem = anterior ? await tx.mensagemCobranca.update({ where: { id: anterior.id }, data: registro }) : await tx.mensagemCobranca.create({ data: { chave, ...registro } });
    await tx.eventoComunicacao.create({ data: { mensagemId: mensagem.id, tipo: "MENSAGEM_PREPARADA", usuarioId } });
    return { id: mensagem.id, status: mensagem.status };
  });
}

export async function prepararMensagemCobranca(db: PrismaClient, entrada: { tituloChave: string; canal: Canal }, usuarioId: string) {
  await admin(db, usuarioId); canalValido(entrada.canal);
  const titulo = (await titulosComunicacao(db)).find(t => t.chave === entrada.tituloChave);
  if (!titulo) erro("TITULO_INELEGIVEL", "Título indisponível: confira saldo, unificação e atualização da origem.");
  return preparar(db, titulo, entrada.canal, usuarioId, "MANUAL");
}

export async function cancelarMensagemCobranca(db: PrismaClient, id: string, usuarioId: string) {
  await admin(db, usuarioId);
  return db.$transaction(async tx => {
    const result = await tx.mensagemCobranca.updateMany({ where: { id, status: "AGENDADA" }, data: { status: "CANCELADA", erroCodigo: "CANCELADA_PELO_ADMIN" } });
    if (result.count) await tx.eventoComunicacao.create({ data: { mensagemId: id, tipo: "CANCELADA", usuarioId } });
    return { canceladas: result.count };
  });
}

export async function revogarContatoCobranca(db: PrismaClient, id: string, usuarioId: string) {
  await admin(db, usuarioId);
  await db.$transaction(async tx => {
    await tx.contatoCobranca.updateMany({ where: { id }, data: { autorizado: false, revisadoPor: usuarioId } });
    await tx.mensagemCobranca.updateMany({ where: { contatoId: id, status: "AGENDADA" }, data: { status: "CANCELADA", erroCodigo: "CONTATO_REVOGADO" } });
    await tx.eventoComunicacao.create({ data: { tipo: "CONTATO_REVOGADO", usuarioId } });
  });
}

/** Chamado pelo scheduler; não possui endpoint público de disparo. Nenhum envio por GET. */
export async function processarComunicacoes(db: PrismaClient, opcoes: { agora?: Date; limite?: number; email?: typeof enviarEmailResend; whatsapp?: typeof enviarWhatsAppMeta } = {}) {
  if (process.env.AUTOMACOES_ENVIO_HABILITADO !== "1") return { estado: "PAUSADO", processadas: 0 };
  const agora = opcoes.agora ?? new Date(); const token = randomUUID();
  const expiraEm = new Date(Date.now() + 180_000);
  try {
    const atualizado = await db.travaAutomacao.updateMany({ where: { id: "cobranca", expiraEm: { lt: new Date() } }, data: { token, expiraEm } });
    if (!atualizado.count) await db.travaAutomacao.create({ data: { id: "cobranca", token, expiraEm } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { estado: "OCUPADO", processadas: 0 };
    throw e;
  }
  let processadas = 0;
  try {
    const salva = await db.configuracaoComunicacao.findUnique({ where: { id: "cobranca" } });
    if (!salva) return { estado: "SEM_CONFIGURACAO", processadas };
    await admin(db, salva.atualizadoPor);
    const config = configSalva(salva.dados);
    // A queda do processo após o pedido remoto não prova falha. Não reenviar automaticamente.
    await db.mensagemCobranca.updateMany({ where: { status: "ENVIANDO", reservadoEm: { lt: new Date(agora.getTime() - 180_000) } }, data: { status: "INCERTA", erroCodigo: "PROCESSO_INTERROMPIDO" } });
    if (!dentroJanelaEnvio(config, agora)) return { estado: "FORA_DA_JANELA", processadas };
    if (config.automacaoAtiva) {
      const titulos = await titulosComunicacao(db, agora);
      const autorizados = await db.contatoCobranca.findMany({ where: { autorizado: true }, select: { pessoaChave: true, canal: true } });
      const contatos = new Set(autorizados.map(c => `${c.pessoaChave}:${c.canal}`));
      for (const t of titulos) {
        const dia = diasDesdeVencimento(t.vencimento, agora);
        if (!config.diasRelativos.includes(dia)) continue;
        for (const canal of ["EMAIL", "WHATSAPP"] as const) {
          if ((canal === "EMAIL" ? config.emailAtivo : config.whatsappAtivo) && contatos.has(`${t.pessoaChave}:${canal}`)) {
            try { await preparar(db, t, canal, salva.atualizadoPor, `D${dia}`, salva.versao); }
            catch (e) {
              if (e instanceof ErroComunicacao && ["CONFIG_ALTERADA", "CONTATO_NAO_AUTORIZADO", "ACESSO_NEGADO"].includes(e.codigo)) return { estado: e.codigo, processadas };
              throw e;
            }
          }
        }
      }
    }
    // Limite móvel de 24 h é conservador e independe de virada UTC/DST.
    const tentadas = await db.mensagemCobranca.count({ where: { reservadoEm: { gte: new Date(agora.getTime() - 86_400_000) } } });
    const limite = Math.max(0, Math.min(opcoes.limite ?? 10, 20, config.limiteDiario - tentadas));
    if (!limite) return { estado: "LIMITE_ATINGIDO", processadas };
    const canais = [...(config.emailAtivo ? ["EMAIL"] : []), ...(config.whatsappAtivo ? ["WHATSAPP"] : [])];
    const fila = await db.mensagemCobranca.findMany({ where: { status: "AGENDADA", canal: { in: canais }, proximoEnvio: { lte: agora } }, orderBy: { proximoEnvio: "asc" }, take: limite });
    for (const m of fila) {
      // Lease é renovado antes de cada envio. Não há chamada remota segurando transação SQLite.
      const lease = await db.travaAutomacao.updateMany({ where: { id: "cobranca", token, expiraEm: { gt: new Date() } }, data: { expiraEm: new Date(Date.now() + 180_000) } });
      if (!lease.count) break;
      const atual = await db.configuracaoComunicacao.findUniqueOrThrow({ where: { id: "cobranca" } });
      const configAtual = configSalva(atual.dados);
      const instanteEnvio = opcoes.agora ?? new Date();
      if (process.env.AUTOMACOES_ENVIO_HABILITADO !== "1" || !dentroJanelaEnvio(configAtual, instanteEnvio)) break;
      const contato = await db.contatoCobranca.findUnique({ where: { id: m.contatoId } });
      const titulo = (await titulosComunicacao(db, opcoes.agora ?? new Date())).find(t => t.chave === m.tituloChave);
      const responsavel = await db.usuario.findUnique({ where: { id: m.criadoPor }, select: { perfil: true } });
      const invalida = atual.versao !== m.configVersao ? "CONFIG_ALTERADA" : !(m.canal === "EMAIL" ? configAtual.emailAtivo : configAtual.whatsappAtivo) || (m.etapa !== "MANUAL" && !configAtual.automacaoAtiva) ? "CANAL_OU_AUTOMACAO_PAUSADA" : !contato?.autorizado || contato.destino !== m.destino || contato.pessoaChave !== m.pessoaChave ? "CONTATO_REVOGADO" : !titulo || titulo.fonteHash !== m.fonteHash ? "SALDO_OU_ORIGEM_ALTERADO" : responsavel?.perfil !== "ADMINISTRADOR" ? "PERMISSAO_REVOGADA" : null;
      if (invalida) { await db.mensagemCobranca.updateMany({ where: { id: m.id, status: "AGENDADA" }, data: { status: "CANCELADA", erroCodigo: invalida } }); continue; }
      const ultima = await db.mensagemCobranca.findFirst({ where: { id: { not: m.id }, canal: m.canal, destino: m.destino, reservadoEm: { gte: new Date(agora.getTime() - 86_400_000) } }, orderBy: { reservadoEm: "desc" } });
      if (ultima?.reservadoEm) {
        await db.mensagemCobranca.updateMany({ where: { id: m.id, status: "AGENDADA" }, data: { proximoEnvio: new Date(ultima.reservadoEm.getTime() + 86_400_000), erroCodigo: "INTERVALO_POR_DESTINATARIO" } });
        continue;
      }
      // Tentativas adiadas conservam chave, corpo e remetente; após 23h, exigem conferência.
      if (m.tentativas && (agora.getTime() - m.criadoEm.getTime() > 82_800_000 || m.tentativas >= 4)) {
        await db.mensagemCobranca.updateMany({ where: { id: m.id, status: "AGENDADA" }, data: { status: "INCERTA", erroCodigo: "CONFERIR_NO_PROVEDOR" } }); continue;
      }
      let credencial: string;
      try { credencial = decifrarSegredo((m.canal === "EMAIL" ? atual.emailTokenCifrado : atual.whatsappTokenCifrado) ?? "", m.canal === "EMAIL" ? "cobranca:email" : "cobranca:whatsapp"); }
      catch { return { estado: "CREDENCIAL_INDISPONIVEL", processadas }; }
      const reserva = await db.$transaction(async tx => {
        const vigente = await tx.configuracaoComunicacao.findUnique({ where: { id: "cobranca" } });
        const autorizado = await tx.contatoCobranca.findUnique({ where: { id: m.contatoId } });
        const operador = await tx.usuario.findUnique({ where: { id: m.criadoPor }, select: { perfil: true } });
        const cfg = vigente ? configSalva(vigente.dados) : null;
        // Cancelar/revogar antes deste ponto impede o envio; após ENVIANDO pode haver pedido em trânsito.
        const bloqueio = vigente?.versao !== m.configVersao ? "CONFIG_ALTERADA" : !autorizado?.autorizado || autorizado.destino !== m.destino || autorizado.pessoaChave !== m.pessoaChave ? "CONTATO_REVOGADO" : operador?.perfil !== "ADMINISTRADOR" ? "PERMISSAO_REVOGADA" : !cfg || !(m.canal === "EMAIL" ? cfg.emailAtivo : cfg.whatsappAtivo) || (m.etapa !== "MANUAL" && !cfg.automacaoAtiva) ? "CANAL_OU_AUTOMACAO_PAUSADA" : null;
        if (bloqueio) { await tx.mensagemCobranca.updateMany({ where: { id: m.id, status: "AGENDADA" }, data: { status: "CANCELADA", erroCodigo: bloqueio } }); return false; }
        if (process.env.AUTOMACOES_ENVIO_HABILITADO !== "1" || !dentroJanelaEnvio(cfg!, opcoes.agora ?? new Date())) return false;
        const tentadasAgora = await tx.mensagemCobranca.count({ where: { id: { not: m.id }, reservadoEm: { gte: new Date(instanteEnvio.getTime() - 86_400_000) } } });
        if (tentadasAgora >= cfg!.limiteDiario) return false;
        const anteriores = await tx.mensagemCobranca.findMany({ where: { id: { not: m.id }, canal: m.canal, etapa: m.etapa, tentativas: { gt: 0 } }, select: { tituloChave: true, fontes: true } });
        if (anteriores.some(a => temFonteComum(titulo!.fontes, a))) {
          await tx.mensagemCobranca.updateMany({ where: { id: m.id, status: "AGENDADA" }, data: { status: "CANCELADA", erroCodigo: "ETAPA_JA_TENTADA_NA_ORIGEM" } });
          return false;
        }
        return (await tx.mensagemCobranca.updateMany({ where: { id: m.id, status: "AGENDADA" }, data: { status: "ENVIANDO", reservadoEm: new Date(), tentativas: { increment: 1 } } })).count === 1;
      });
      if (!reserva) continue;
      let resultado: ResultadoEnvio;
      try {
        if (m.canal === "EMAIL") {
          const conteudo = JSON.parse(m.conteudo) as ReturnType<typeof renderizarEmail>;
          resultado = await (opcoes.email ?? enviarEmailResend)({ apiKey: credencial, remetente: configAtual.emailRemetente, resposta: configAtual.emailResposta || undefined, destinatario: m.destino, ...conteudo, chaveIdempotencia: m.chave });
        } else resultado = await (opcoes.whatsapp ?? enviarWhatsAppMeta)({ token: credencial, phoneNumberId: configAtual.whatsappPhoneNumberId, destinatario: m.destino, template: configAtual.whatsappTemplate, idioma: configAtual.whatsappIdioma, dados: dadosMensagem(titulo!, configAtual) });
      } catch { resultado = { status: "INCERTO", codigo: "RESULTADO_DESCONHECIDO" }; }
      const status = resultado.status === "ACEITO" ? "ENVIADA" : resultado.status === "REPETIR" ? "AGENDADA" : resultado.status === "INCERTO" ? "INCERTA" : "FALHOU";
      await db.$transaction(async tx => {
        // Não sobrescreve webhook que porventura tenha confirmado a entrega primeiro.
        await tx.mensagemCobranca.updateMany({ where: { id: m.id, status: "ENVIANDO" }, data: { status, providerId: resultado.provedorId, erroCodigo: resultado.codigo,
          enviadoEm: status === "ENVIADA" ? new Date() : undefined, proximoEnvio: new Date(Date.now() + 60_000 * 2 ** m.tentativas) } });
        await tx.eventoComunicacao.create({ data: { mensagemId: m.id, tipo: status, codigo: resultado.codigo } });
      });
      if (resultado.provedorId && m.canal === "WHATSAPP") await aplicarRetornos(db, resultado.provedorId);
      processadas++;
    }
    return { estado: "CONCLUIDO", processadas };
  } finally { await db.travaAutomacao.deleteMany({ where: { id: "cobranca", token } }); }
}
