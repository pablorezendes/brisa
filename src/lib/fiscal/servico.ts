import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { exigirAcessoFiscal } from "./acesso";
import {
  ErroFiscal, MUNICIPIO_GOIANIA, ambienteFiscal, chaveFiscal, documentoFiscal, hashConfiguracaoFiscal,
  hashFiscal, lerParametrosFiscais, montarPayloadFiscal, textoFiscal, validarEmitente, valorFiscal,
  type ConfigFiscalBase, type ParametrosFiscais, type PayloadFiscal, type RascunhoFiscal,
} from "./dominio";
import { chamarFocusFiscal, infraestruturaFiscal, type RetornoFiscal } from "./focus";

export async function obterConfiguracaoFiscal() {
  await exigirAcessoFiscal();
  return prisma.configuracaoFiscal.findUnique({ where: { id: "goiania" } });
}

type AtualizacaoConfiguracao = ConfigFiscalBase & { habilitada: boolean; homologacaoValidada: boolean; confirmarProducao: boolean; versao: string };

export async function salvarConfiguracaoFiscal(dados: AtualizacaoConfiguracao) {
  const sessao = await exigirAcessoFiscal();
  const ambiente = ambienteFiscal(dados.ambiente);
  const base: ConfigFiscalBase = { ambiente, emitenteCnpj: documentoFiscal(dados.emitenteCnpj, true), inscricaoMunicipal: textoFiscal(dados.inscricaoMunicipal, "Inscrição municipal", 15), razaoSocial: textoFiscal(dados.razaoSocial, "Razão social", 150), codigoMunicipio: MUNICIPIO_GOIANIA, parametros: JSON.stringify(lerParametrosFiscais(dados.parametros)) };
  validarEmitente(base);
  const infra = infraestruturaFiscal(ambiente);
  if (dados.habilitada && !infra.token) throw new ErroFiscal("Token deste ambiente ainda não configurado no servidor. Salve sem habilitar a transmissão.");
  if (dados.habilitada && ambiente === "PRODUCAO" && (!infra.producaoLiberada || !dados.confirmarProducao || !dados.homologacaoValidada)) throw new ErroFiscal("Produção exige liberação no servidor, homologação validada e confirmação explícita.");
  await prisma.$transaction(async (tx) => {
    const atual = await tx.configuracaoFiscal.findUnique({ where: { id: "goiania" } });
    if ((atual?.atualizadoEm.toISOString() ?? "") !== dados.versao) throw new ErroFiscal("A configuração mudou em outra sessão. Atualize a tela.");
    if (dados.homologacaoValidada) {
      const teste = await tx.notaFiscalServico.count({ where: { ambiente: "HOMOLOGACAO", emitenteCnpj: base.emitenteCnpj, status: "AUTORIZADA", configHash: hashConfiguracaoFiscal({ ...base, ambiente: "HOMOLOGACAO" }) } });
      if (!teste) throw new ErroFiscal("Autorize e confira uma nota em homologação com estes mesmos parâmetros antes de validar a homologação.");
    }
    if (atual) {
      const existeNota = await tx.notaFiscalServico.count();
      const anterior = lerParametrosFiscais(atual.parametros);
      const proximo = lerParametrosFiscais(base.parametros);
      if (existeNota && (atual.emitenteCnpj !== base.emitenteCnpj || anterior.serieDps !== proximo.serieDps)) throw new ErroFiscal("Emitente e série não podem ser trocados após reservar documentos. Solicite implantação de outro perfil fiscal.");
      if (Number(proximo.proximoDps) < Number(anterior.proximoDps)) throw new ErroFiscal("O próximo DPS não pode retroceder. Numerações reservadas nunca são reutilizadas.");
    }
    await tx.configuracaoFiscal.upsert({ where: { id: "goiania" }, create: { id: "goiania", ...base, habilitada: dados.habilitada, homologacaoValidada: dados.homologacaoValidada, atualizadoPor: sessao.sub }, update: { ...base, habilitada: dados.habilitada, homologacaoValidada: dados.homologacaoValidada, atualizadoPor: sessao.sub } });
  });
}

/** A única criação possível é um rascunho revisável. Nunca emite ao salvar. */
export async function salvarRascunhoFiscal(dados: RascunhoFiscal, id?: string, versao?: string) {
  const sessao = await exigirAcessoFiscal();
  return prisma.$transaction(async (tx) => {
    const config = await tx.configuracaoFiscal.findUnique({ where: { id: "goiania" } });
    if (!config) throw new ErroFiscal("Cadastre primeiro o emitente e o enquadramento fiscal.");
    const origemChave = textoFiscal(dados.origemChave, "Identificador da prestação", 140).normalize("NFKC").toUpperCase().replace(/\s+/g, " ");
    const chaveIdempotencia = chaveFiscal(config, origemChave);
    const existente = await tx.notaFiscalServico.findUnique({ where: { chaveIdempotencia } });
    if (!id && existente) throw new ErroFiscal("Esta prestação já tem um documento neste ambiente. Localize o identificador no histórico e use o mesmo rascunho.");
    const atual = id ? await tx.notaFiscalServico.findUnique({ where: { id } }) : null;
    if (id && (!atual || !["RASCUNHO", "REJEITADA"].includes(atual.status) || atual.payloadHash !== versao)) throw new ErroFiscal("Rascunho alterado ou já enviado. Atualize a página antes de continuar.");
    if (atual && (atual.chaveIdempotencia !== chaveIdempotencia || atual.ambiente !== config.ambiente)) throw new ErroFiscal("Identificador da prestação e ambiente são permanentes. Volte à configuração original para corrigir.");
    const payload = montarPayloadFiscal(config, dados, new Date());
    if (atual) {
      const original = JSON.parse(atual.payload) as PayloadFiscal;
      payload.numero_dps = original.numero_dps;
      payload.serie_dps = original.serie_dps;
    }
    const conteudo = { origemChave, competencia: dados.competencia, tomadorNome: String(payload.razao_social_tomador), tomadorDocumento: documentoFiscal(dados.tomadorDocumento), valorServico: valorFiscal(dados.valorServico), descricao: String(payload.descricao_servico), payload: JSON.stringify(payload), payloadHash: hashFiscal(payload), configHash: hashConfiguracaoFiscal(config) };
    if (atual) {
      const mudado = await tx.notaFiscalServico.updateMany({ where: { id: atual.id, payloadHash: versao, status: { in: ["RASCUNHO", "REJEITADA"] } }, data: { ...conteudo, status: "RASCUNHO", erroCodigo: null, erroMensagem: null, aprovadoPor: null, aprovadoEm: null } });
      if (!mudado.count) throw new ErroFiscal("Outro processo alterou o documento. Atualize a tela.");
      await tx.eventoFiscal.create({ data: { notaFiscalId: atual.id, tipo: "RASCUNHO_CORRIGIDO", mensagem: "Conteúdo corrigido; exige nova aprovação. Referência e DPS preservadas.", usuarioId: sessao.sub } });
      return atual.id;
    }
    const p: ParametrosFiscais = lerParametrosFiscais(config.parametros);
    const proximo = Number(p.proximoDps) + 1;
    if (proximo >= 1_000_000_000_000_000) throw new ErroFiscal("Faixa DPS esgotada.");
    const reserva = await tx.configuracaoFiscal.updateMany({ where: { id: config.id, atualizadoEm: config.atualizadoEm }, data: { parametros: JSON.stringify({ ...p, proximoDps: String(proximo) }) } });
    if (!reserva.count) throw new ErroFiscal("Outra reserva DPS ocorreu. Tente salvar o rascunho novamente.");
    const nota = await tx.notaFiscalServico.create({ data: { ...conteudo, chaveIdempotencia, referencia: `BRISA${randomUUID().replaceAll("-", "")}`, emitenteCnpj: config.emitenteCnpj, ambiente: config.ambiente, criadoPor: sessao.sub, eventos: { create: { tipo: "RASCUNHO_CRIADO", mensagem: "DPS reservada e prestação identificada. Nenhuma transmissão realizada.", usuarioId: sessao.sub } } } });
    return nota.id;
  });
}

export async function aprovarNotaFiscal(id: string, payloadHash: string, confirmacao: boolean) {
  const sessao = await exigirAcessoFiscal();
  if (!confirmacao) throw new ErroFiscal("Confirme a revisão fiscal antes de aprovar.");
  await prisma.$transaction(async (tx) => {
    const nota = await tx.notaFiscalServico.findUnique({ where: { id } });
    const config = await tx.configuracaoFiscal.findUnique({ where: { id: "goiania" } });
    if (!nota || !config || nota.status !== "RASCUNHO" || nota.payloadHash !== payloadHash) throw new ErroFiscal("Somente a versão atual de um rascunho pode ser aprovada.");
    if (nota.configHash !== hashConfiguracaoFiscal(config)) throw new ErroFiscal("A configuração fiscal mudou. Revise e salve o rascunho novamente.");
    const resultado = await tx.notaFiscalServico.updateMany({ where: { id, status: "RASCUNHO", payloadHash }, data: { status: "APROVADA", aprovadoPor: sessao.sub, aprovadoEm: new Date() } });
    if (!resultado.count) throw new ErroFiscal("Documento alterado por outra sessão.");
    await tx.eventoFiscal.create({ data: { notaFiscalId: id, tipo: "APROVADA", mensagem: "Revisão explícita do serviço, tomador, valor e tributação registrada. Ainda não transmitida.", usuarioId: sessao.sub } });
  });
}

function guardasEmissao(config: ConfigFiscalBase & { habilitada: boolean; homologacaoValidada: boolean }, configHash: string, ambiente: string) {
  if (!config.habilitada || config.ambiente !== ambiente) throw new ErroFiscal("Transmissão desabilitada ou ambiente diferente do documento.");
  if (hashConfiguracaoFiscal(config) !== configHash) throw new ErroFiscal("Configuração modificada após a revisão. Interrompa e revise o documento antes de emitir.");
  const infra = infraestruturaFiscal(ambiente);
  if (!infra.token || (ambiente === "PRODUCAO" && (!infra.producaoLiberada || !config.homologacaoValidada))) throw new ErroFiscal("Infraestrutura fiscal ou homologação ainda não liberada.");
}

async function registrarRetorno(tx: Prisma.TransactionClient, id: string, retorno: RetornoFiscal, usuarioId: string, tipo: string) {
  await tx.notaFiscalServico.update({ where: { id }, data: { status: retorno.status, numero: retorno.numero, codigoVerificacao: retorno.codigoVerificacao, protocolo: retorno.protocolo, urlDocumento: retorno.urlDocumento, erroCodigo: retorno.erroCodigo ?? null, erroMensagem: retorno.erroMensagem ?? null, lockEm: null, consultadoEm: new Date() } });
  await tx.eventoFiscal.create({ data: { notaFiscalId: id, tipo, mensagem: `Resultado: ${retorno.status}${retorno.erroCodigo ? ` · ${retorno.erroCodigo}` : ""}.`, usuarioId } });
}

/** Compare-and-set antes do efeito externo: duas submissões não fazem dois POSTs. */
export async function transmitirNotaFiscal(id: string, payloadHash: string, confirmacao: boolean) {
  const sessao = await exigirAcessoFiscal();
  if (!confirmacao) throw new ErroFiscal("Confirme a transmissão fiscal deste documento.");
  const nota = await prisma.$transaction(async (tx) => {
    const usuario = await tx.usuario.findUnique({ where: { id: sessao.sub }, select: { perfil: true } });
    if (usuario?.perfil !== "ADMINISTRADOR") throw new ErroFiscal("A autorização administrativa foi revogada. Transmissão bloqueada.");
    const config = await tx.configuracaoFiscal.findUnique({ where: { id: "goiania" } });
    const atual = await tx.notaFiscalServico.findUnique({ where: { id } });
    if (!atual || !config || atual.status !== "APROVADA" || atual.payloadHash !== payloadHash) throw new ErroFiscal("Documento não está aprovado nesta versão. Não haverá nova transmissão.");
    if (hashFiscal(JSON.parse(atual.payload)) !== atual.payloadHash) throw new ErroFiscal("Integridade do conteúdo fiscal divergente. Bloqueado para revisão técnica.");
    guardasEmissao(config, atual.configHash, atual.ambiente);
    const lockEm = new Date();
    const reserva = await tx.notaFiscalServico.updateMany({ where: { id, status: "APROVADA", payloadHash }, data: { status: "TRANSMITINDO", lockEm, tentativas: { increment: 1 }, transmitidoEm: lockEm } });
    if (!reserva.count) throw new ErroFiscal("Outro processo já reservou a transmissão.");
    await tx.eventoFiscal.create({ data: { notaFiscalId: id, tipo: "TRANSMISSAO_RESERVADA", mensagem: "Envio autorizado explicitamente. Falha ambígua exigirá consulta; não há repetição automática.", usuarioId: sessao.sub } });
    return { ...atual, lockEm };
  });
  let retorno: RetornoFiscal;
  try { retorno = await chamarFocusFiscal("EMITIR", nota.ambiente, nota.referencia, nota.emitenteCnpj, JSON.parse(nota.payload)); }
  catch { retorno = { status: "INCERTA", erroCodigo: "ENVIO_INTERROMPIDO", erroMensagem: "Envio não confirmado. Consulte a referência original antes de qualquer outra ação." }; }
  await prisma.$transaction(async (tx) => {
    const atual = await tx.notaFiscalServico.findUnique({ where: { id } });
    if (atual?.status === "TRANSMITINDO" && atual.lockEm?.getTime() === nota.lockEm.getTime()) await registrarRetorno(tx, id, retorno, sessao.sub, "RETORNO_TRANSMISSAO");
  });
}

export async function consultarNotaFiscal(id: string) {
  const sessao = await exigirAcessoFiscal();
  const lock = new Date();
  const nota = await prisma.$transaction(async (tx) => {
    const atual = await tx.notaFiscalServico.findUnique({ where: { id } });
    if (!atual || !["PROCESSANDO", "INCERTA", "TRANSMITINDO", "AUTORIZADA", "CANCELADA"].includes(atual.status)) throw new ErroFiscal("Este documento ainda não tem transmissão para consultar.");
    if (atual.lockEm && atual.lockEm.getTime() > Date.now() - 120_000) throw new ErroFiscal("Já existe uma operação em andamento. Aguarde dois minutos antes de recuperar.");
    if (atual.consultadoEm && atual.consultadoEm.getTime() > Date.now() - 15_000) throw new ErroFiscal("Aguarde 15 segundos entre consultas.");
    const reserva = await tx.notaFiscalServico.updateMany({ where: { id, status: atual.status, lockEm: atual.lockEm, atualizadoEm: atual.atualizadoEm }, data: { lockEm: lock } });
    if (!reserva.count) throw new ErroFiscal("Outra consulta já está em andamento.");
    return atual;
  });
  let retorno: RetornoFiscal;
  try { retorno = await chamarFocusFiscal("CONSULTAR", nota.ambiente, nota.referencia, nota.emitenteCnpj); }
  catch { retorno = { status: "INCERTA", erroCodigo: "CONSULTA_INDISPONIVEL", erroMensagem: "Consulta indisponível. Verifique o token deste ambiente no servidor." }; }
  await prisma.$transaction(async (tx) => {
    const atual = await tx.notaFiscalServico.findUnique({ where: { id } });
    if (!atual || atual.lockEm?.getTime() !== lock.getTime()) return;
    // Uma consulta inconclusiva nunca apaga autorização/cancelamento já provados.
    if ((["AUTORIZADA", "CANCELADA"].includes(nota.status) && retorno.status !== "CANCELADA" && retorno.status !== "AUTORIZADA") || (nota.status === "CANCELADA" && retorno.status === "AUTORIZADA")) {
      await tx.notaFiscalServico.update({ where: { id }, data: { lockEm: null, consultadoEm: new Date() } });
      await tx.eventoFiscal.create({ data: { notaFiscalId: id, tipo: "CONSULTA_SEM_ALTERACAO", mensagem: "Consulta não substitui situação fiscal final já confirmada.", usuarioId: sessao.sub } });
      return;
    }
    await registrarRetorno(tx, id, retorno, sessao.sub, "CONSULTA_PROVEDOR");
  });
}

export async function devolverRascunhoFiscal(id: string, payloadHash: string) {
  const sessao = await exigirAcessoFiscal();
  await prisma.$transaction(async (tx) => {
    const resultado = await tx.notaFiscalServico.updateMany({ where: { id, status: "APROVADA", payloadHash }, data: { status: "RASCUNHO", aprovadoPor: null, aprovadoEm: null } });
    if (!resultado.count) throw new ErroFiscal("Somente documento aprovado e não transmitido pode voltar para revisão.");
    await tx.eventoFiscal.create({ data: { notaFiscalId: id, tipo: "REVISAO_REABERTA", mensagem: "Aprovação retirada antes da transmissão. Exige nova revisão.", usuarioId: sessao.sub } });
  });
}
