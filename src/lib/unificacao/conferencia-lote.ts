import type { Prisma, PrismaClient } from "@prisma/client";
import { pode, type PoliticaAcesso } from "../acesso/politica";
import { STATUS_BOLETO_ATIVOS } from "../dominio/boletos";
import { filtrarFontesGovernadas } from "../governanca/filtros";
import { criarIndiceCandidatos } from "./candidatos-indice";
import { carregarDadosFontesUnificacao, derivarFontesUnificacao, hashUnificacao } from "./fontes";
import { hashFonteCorresponde } from "./hashes";
import { chavesRestritasUnificacao } from "./privacidade";
import { candidatosPara, projetarUnificados } from "./reconciliacao";
import { autorizarRevisaoFinanceira } from "./revisao-financeira";
import { ErroUnificacao } from "./servico";
import type { DecisaoUnificacao, FonteUnificacao, LinhaUnificada } from "./tipos";
import { LIMITE_CONFERENCIA_LOTE, type EntradaConferenciaLote, type ItemPreviaConferenciaLote, type PreviaConferenciaLote, type ResultadoConferenciaLote, type SelecaoConferenciaLote } from "./tipos-conferencia-lote";

type Tx = Prisma.TransactionClient;
type Ator = { id: string };
type Fotografia = {
  fontes: FonteUnificacao[];
  decisoes: DecisaoUnificacao[];
  protecoes: Map<string, string>;
};
const ACAO_LOTE = "CONFERIR_LOTE";
const MOTIVO = "REGISTRO_DISTINTO_CONFIRMADO";
const valorValido = (valor: number | null | undefined): valor is number => Number.isSafeInteger(valor) && valor! >= 0;
const assinaturaDecisao = (d?: DecisaoUnificacao) => d ? ({ chave: d.chave, status: d.status, decisao: d.decisao, versao: d.versao,
  hashFonte: d.hashFonte, destinoChave: d.destinoChave, hashDestino: d.hashDestino, motivos: d.motivos, candidatos: d.candidatos }) : null;

function selecaoValida(entrada: SelecaoConferenciaLote): SelecaoConferenciaLote {
  if (!entrada || !["PAGAR", "RECEBER"].includes(entrada.dominio) || !Array.isArray(entrada.chaves)
    || !entrada.chaves.length || entrada.chaves.length > LIMITE_CONFERENCIA_LOTE
    || entrada.chaves.some(chave => typeof chave !== "string" || !/^(BRISA|WIDESYS):(PAGAR|RECEBER):[^\s:]{1,150}$/.test(chave) || chave.split(":")[1] !== entrada.dominio)) {
    throw new ErroUnificacao("SELECAO_INVALIDA", `Selecione de 1 a ${LIMITE_CONFERENCIA_LOTE} lançamentos da mesma lista.`);
  }
  return { dominio: entrada.dominio, chaves: [...new Set(entrada.chaves)].sort() };
}

async function fotografia(tx: Tx, selecao: SelecaoConferenciaLote): Promise<Fotografia> {
  const [dados, decisoes, governados] = await Promise.all([
    carregarDadosFontesUnificacao(tx, selecao.dominio), tx.unificacaoRegistro.findMany(),
    tx.recursoGovernado.findMany({ select: { tipo: true, origemId: true, status: true } }),
  ]);
  const fontes = filtrarFontesGovernadas(await derivarFontesUnificacao(dados), governados);
  const protecoes = new Map<string, string>();
  const ids = selecao.chaves.filter(chave => chave.startsWith("BRISA:RECEBER:")).map(chave => chave.slice("BRISA:RECEBER:".length));
  if (ids.length) {
    const [recebimentos, fechamentos] = await Promise.all([
      tx.recebimento.findMany({ where: { id: { in: ids } }, select: { id: true, mesLancamento: true, reservaEmissaoToken: true,
        boletos: { where: { status: { in: [...STATUS_BOLETO_ATIVOS] } }, select: { id: true }, take: 1 } } }),
      tx.fechamentoMensal.findMany({ select: { mesLancamento: true } }),
    ]);
    const mesesFechados = new Set(fechamentos.map(f => f.mesLancamento));
    for (const r of recebimentos) {
      const motivo = mesesFechados.has(r.mesLancamento) ? "Mês fechado: use a conferência individual após reabrir o mês."
        : r.reservaEmissaoToken || r.boletos.length ? "Cobrança bancária ativa ou em emissão: confira este lançamento individualmente." : null;
      if (motivo) protecoes.set(`BRISA:RECEBER:${r.id}`, motivo);
    }
  }
  return { fontes, decisoes, protecoes };
}

function decisaoConferida(fonte: FonteUnificacao, anterior?: DecisaoUnificacao): DecisaoUnificacao {
  return { chave: fonte.chave, dominio: fonte.dominio, origem: fonte.origem, origemId: fonte.origemId,
    status: "ATIVO", destinoChave: null, hashFonte: fonte.hash, hashDestino: null, candidatos: "[]",
    motivos: JSON.stringify([MOTIVO]), proveniencia: anterior?.proveniencia ?? JSON.stringify(fonte.proveniencia ?? {}),
    decisao: "MANUAL", versao: anterior ? anterior.versao + 1 : 1 };
}

function somar(linhas: LinhaUnificada[], dominio: SelecaoConferenciaLote["dominio"]) {
  return linhas.filter(l => l.dominio === dominio && l.contabiliza).reduce((soma, l) => ({
    devido: soma.devido + (l.valor ?? 0), pago: soma.pago + (l.pago ?? 0), aberto: soma.aberto + (l.aberto ?? 0),
  }), { devido: 0, pago: 0, aberto: 0 });
}

function planejar(atual: Fotografia, selecao: SelecaoConferenciaLote, politica: PoliticaAcesso) {
  const fontes = new Map(atual.fontes.map(f => [f.chave, f]));
  const decisoes = new Map(atual.decisoes.map(d => [d.chave, d]));
  const linhas = projetarUnificados(atual.fontes, atual.decisoes);
  const porChave = new Map(linhas.map(l => [l.chave, l]));
  const restritas = chavesRestritasUnificacao(atual.fontes, atual.decisoes);
  const destinos = new Map<string, string>();
  for (const f of atual.fontes) if (f.vinculoExplicito) destinos.set(f.chave, f.vinculoExplicito);
  for (const d of atual.decisoes) if (d.status === "VINCULADO" && d.destinoChave
    && hashFonteCorresponde(fontes.get(d.chave), d.hashFonte) && hashFonteCorresponde(fontes.get(d.destinoChave), d.hashDestino)) destinos.set(d.chave, d.destinoChave);
  const indice = criarIndiceCandidatos(atual.fontes, destinos);
  const novas = new Map<string, DecisaoUnificacao>();
  const provas: unknown[] = [];
  const itens: ItemPreviaConferenciaLote[] = selecao.chaves.map(chave => {
    const f = fontes.get(chave), d = decisoes.get(chave), linha = porChave.get(chave);
    // Não distinguir chave forjada, excluída ou restrita nem expor seus valores.
    if (!f || !linha || f.dominio !== selecao.dominio || (!pode(politica, "comissoes.ver") && restritas.has(chave))) {
      provas.push({ chave, indisponivel: true });
      return { chave, titulo: "Registro indisponível", valor: null, pago: null, aberto: null, estado: "BLOQUEADO", motivo: "Não está disponível na operação ou no seu acesso. Atualize a lista." };
    }
    const candidatos = candidatosPara(f, indice.para(f), destinos);
    provas.push({ chave, hash: f.hash, decisao: assinaturaDecisao(d), protecao: atual.protecoes.get(chave) ?? null,
      candidatos: candidatos.map(c => ({ chave: c.chave, hash: fontes.get(c.chave)?.hash, decisao: assinaturaDecisao(decisoes.get(c.chave)) })) });
    const item = { chave, titulo: f.titulo, valor: f.valor ?? null, pago: f.pago ?? null, aberto: f.aberto ?? null };
    if (d?.destinoChave || f.vinculoExplicito || linha.estado === "VINCULADO") return { ...item, estado: "BLOQUEADO", motivo: "Já vinculado a outro lançamento. O vínculo foi preservado para não somar uma cópia." };
    if (f.qualidade !== "OK" || !["ATIVO", "PENDENTE", "REVISAR"].includes(linha.estado)) return { ...item, estado: "BLOQUEADO", motivo: "Há uma inconsistência ou ausência na origem. Resolva individualmente." };
    if (f.cancelado || f.informativo) return { ...item, estado: "BLOQUEADO", motivo: "Registro cancelado ou informativo. Não será incluído nos totais." };
    if (!valorValido(f.valor) || !valorValido(f.pago) || !valorValido(f.aberto)) return { ...item, estado: "BLOQUEADO", motivo: "Os valores precisam ser corrigidos antes da conferência." };
    if (linha.conferidoManualmente || linha.conferidoPorRegra) return { ...item, estado: "JA_CONFERIDO", motivo: "Já conferido. Não será somado nem confirmado novamente." };
    const protecao = atual.protecoes.get(chave);
    if (protecao) return { ...item, estado: "BLOQUEADO", motivo: protecao };
    novas.set(chave, decisaoConferida(f, d));
    return { ...item, estado: "CONFERIR", motivo: linha.contabiliza
      ? "Já incluído nos totais. Apenas o status mudará para Conferido."
      : "Será confirmado como lançamento separado e incluído uma única vez nos totais." };
  });
  const depois = [...atual.decisoes.filter(d => !novas.has(d.chave)), ...novas.values()];
  const linhasDepois = projetarUnificados(atual.fontes, depois);
  if (linhasDepois.some(l => l.dominio === selecao.dominio && !novas.has(l.chave)
    && (l.contabiliza !== porChave.get(l.chave)?.contabiliza || l.estado !== porChave.get(l.chave)?.estado))) {
    throw new ErroUnificacao("EFEITO_FORA_SELECAO", "Há correspondência fora da seleção. Selecione os lançamentos envolvidos ou confira individualmente.");
  }
  const visiveis = (lista: LinhaUnificada[]) => pode(politica, "comissoes.ver") ? lista : lista.filter(l => !restritas.has(l.chave));
  const totaisAntes = somar(visiveis(linhas), selecao.dominio), totaisDepois = somar(visiveis(linhasDepois), selecao.dominio);
  const impacto = { devido: totaisDepois.devido - totaisAntes.devido, pago: totaisDepois.pago - totaisAntes.pago, aberto: totaisDepois.aberto - totaisAntes.aberto };
  const previa: PreviaConferenciaLote = { dominio: selecao.dominio,
    assinatura: hashUnificacao({ dominio: selecao.dominio, provas, impacto }), itens,
    resumo: { selecionados: itens.length, conferiveis: novas.size, jaConferidos: itens.filter(i => i.estado === "JA_CONFERIDO").length, bloqueados: itens.filter(i => i.estado === "BLOQUEADO").length },
    impacto };
  return { previa, novas, depois, fontes, decisoes, linhas: porChave };
}

function resultado(previa: PreviaConferenciaLote, conferidos: number): ResultadoConferenciaLote {
  return { conferidos, jaConferidos: previa.resumo.jaConferidos, bloqueados: previa.resumo.bloqueados,
    mensagem: `${conferidos} lançamento(s) conferido(s). ${previa.resumo.jaConferidos} já estava(m) conferido(s); ${previa.resumo.bloqueados} preservado(s) para revisão individual. Nenhum título ou pagamento foi criado.` };
}

export async function prepararConferenciaLote(db: PrismaClient, entrada: SelecaoConferenciaLote, ator: Ator): Promise<PreviaConferenciaLote> {
  const selecao = selecaoValida(entrada);
  return db.$transaction(async tx => {
    const politica = await autorizarRevisaoFinanceira(tx, ator, selecao.dominio, true);
    return planejar(await fotografia(tx, selecao), selecao, politica).previa;
  }, { maxWait: 5000, timeout: 30000 });
}

export async function concluirConferenciaLote(db: PrismaClient, entrada: EntradaConferenciaLote, ator: Ator): Promise<ResultadoConferenciaLote> {
  const selecao = selecaoValida(entrada);
  if (entrada.confirmado !== true || typeof entrada.assinatura !== "string" || !/^[a-f0-9]{64}$/.test(entrada.assinatura)
    || (entrada.justificativa !== undefined && (typeof entrada.justificativa !== "string" || entrada.justificativa.length > 500))) {
    throw new ErroUnificacao("CONFIRMACAO_OBRIGATORIA", "Confira a seleção e confirme que os lançamentos são separados antes de concluir.");
  }
  return db.$transaction(async tx => {
    const politica = await autorizarRevisaoFinanceira(tx, ator, selecao.dominio, true);
    const atual = await fotografia(tx, selecao);
    const plano = planejar(atual, selecao, politica);
    if (entrada.assinatura !== plano.previa.assinatura) {
      // O recibo do lote reconhece repetição da mesma requisição, mas somente
      // enquanto a fotografia posterior continua exatamente igual.
      const recibo = await tx.unificacaoDecisao.findFirst({ where: { acao: ACAO_LOTE, usuarioId: ator.id,
        registroChave: { in: selecao.chaves }, justificativa: { contains: `"antes":"${entrada.assinatura}"` } }, orderBy: { criadoEm: "desc" } });
      if (recibo && !plano.novas.size) {
        try {
          const dados = JSON.parse(recibo.justificativa);
          if (dados.antes === entrada.assinatura && dados.depois === plano.previa.assinatura) return resultado(plano.previa, 0);
        } catch { /* Recibos antigos/malformados não autorizam reaplicação. */ }
      }
      throw new ErroUnificacao("DECISAO_DESATUALIZADA", "Os lançamentos ou suas correspondências mudaram. Confira novamente a seleção; nada foi alterado.");
    }
    if (!plano.novas.size) return resultado(plano.previa, 0);
    const decididoEm = new Date();
    for (const [chave, decisao] of plano.novas) {
      const anterior = plano.decisoes.get(chave);
      if (anterior) {
        const atualizado = await tx.unificacaoRegistro.updateMany({ where: { chave, versao: anterior.versao, hashFonte: anterior.hashFonte },
          data: { ...decisao, decididoPor: ator.id, decididoEm } });
        if (atualizado.count !== 1) throw new ErroUnificacao("DECISAO_DESATUALIZADA", "Outra pessoa alterou a seleção. Atualize a conferência; nada foi alterado.");
      } else await tx.unificacaoRegistro.create({ data: { ...decisao, decididoPor: ator.id, decididoEm } });
    }
    // Usa o mesmo conteúdo persistido e não recarrega fontes por lançamento.
    const assinadaDepois = planejar({ ...atual, decisoes: plano.depois }, selecao, politica).previa.assinatura;
    await tx.unificacaoDecisao.createMany({ data: [...plano.novas].map(([chave, decisao]) => ({
      registroChave: chave, acao: ACAO_LOTE, estadoAnterior: plano.linhas.get(chave)?.estado ?? "NAO_ANALISADO", estadoNovo: "ATIVO",
      hashFonte: decisao.hashFonte, usuarioId: ator.id,
      justificativa: JSON.stringify({ antes: entrada.assinatura, depois: assinadaDepois,
        criterio: "Conferência manual em lote: o usuário confirmou os selecionados elegíveis como lançamentos separados.",
        observacao: entrada.justificativa?.trim() || null }),
    })) });
    return resultado(plano.previa, plano.novas.size);
  }, { maxWait: 5000, timeout: 30000 });
}
