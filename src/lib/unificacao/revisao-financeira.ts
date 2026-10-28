import type { Prisma, PrismaClient } from "@prisma/client";
import { carteiraIrrestrita, montarPolitica, pode, type PoliticaAcesso } from "../acesso/politica";
import { filtrarFontesGovernadas } from "../governanca/filtros";
import { carregarDadosFontesUnificacao, derivarFontesUnificacao, hashUnificacao } from "./fontes";
import { hashFonteCorresponde } from "./hashes";
import { chavesRestritasUnificacao } from "./privacidade";
import { candidatosPara, projetarUnificados } from "./reconciliacao";
import { decidirUnificacaoNaTransacao, ErroUnificacao } from "./servico";
import type { FonteUnificacao } from "./tipos";
import type { ConcluirRevisaoFinanceiraEntrada, ResumoRevisaoFinanceira, RevisaoFinanceira, DominioRevisaoFinanceira } from "./tipos-revisao-financeira";

type Tx = Prisma.TransactionClient;
type Ator = { id: string };
const podeDecidir = (p: PoliticaAcesso) => pode(p, "unificacao.editar") && pode(p, "pagamentos.conciliar");

export async function autorizarRevisaoFinanceira(tx: Tx, ator: Ator, dominio: DominioRevisaoFinanceira, editar = false) {
  const usuario = await tx.usuario.findUnique({ where: { id: ator.id }, select: {
    id: true, perfil: true, ativo: true, acessoGlobal: true, permissoesExtras: true, permissoesNegadas: true,
    papelAcesso: { select: { ativo: true, permissoes: true } }, regrasAcesso: { select: { tipo: true, recursoId: true, efeito: true } },
  } });
  const politica = usuario ? montarPolitica(usuario) : null;
  if (!politica || !["ADMINISTRADOR", "FINANCEIRO"].includes(politica.perfil) || !carteiraIrrestrita(politica)
    || !pode(politica, dominio === "PAGAR" ? "despesas.ver" : "financeiro.ver")
    || (dominio === "RECEBER" && !pode(politica, "unificacao.ver")) || !pode(politica, "cadastros.sensiveis") || (editar && !podeDecidir(politica))) {
    throw new ErroUnificacao("SEM_PERMISSAO", "Você não tem permissão para conferir este lançamento integralmente.");
  }
  return politica;
}

async function fotografia(tx: Tx, dominio: DominioRevisaoFinanceira) {
  const [dados, decisoes, governados] = await Promise.all([
    carregarDadosFontesUnificacao(tx, dominio),
    tx.unificacaoRegistro.findMany(),
    tx.recursoGovernado.findMany({ select: { tipo: true, origemId: true, status: true } }),
  ]);
  const fontes = filtrarFontesGovernadas(await derivarFontesUnificacao(dados), governados);
  const linhas = projetarUnificados(fontes, decisoes);
  const restritas = chavesRestritasUnificacao(fontes, decisoes);
  return { fontes, decisoes, linhas, restritas };
}
type Fotografia = Awaited<ReturnType<typeof fotografia>>;

function resumo(f: FonteUnificacao): ResumoRevisaoFinanceira {
  return { chave: f.chave, hash: f.hash, titulo: f.titulo, descricao: f.descricao, origem: f.origem,
    competencia: f.competencia ?? null, data: f.vencimento ?? f.data ?? null,
    valor: f.valor ?? 0, pago: f.pago ?? 0, aberto: f.aberto ?? 0 };
}

function montarRevisao(atual: Fotografia, chave: string, dominio: DominioRevisaoFinanceira, politica: PoliticaAcesso): RevisaoFinanceira {
  const fonte = atual.fontes.find(f => f.chave === chave && f.dominio === dominio);
  const linha = atual.linhas.find(f => f.chave === chave);
  if (!fonte || !linha || (!pode(politica, "comissoes.ver") && atual.restritas.has(chave))) {
    throw new ErroUnificacao("NAO_ENCONTRADA", "O lançamento não está disponível para conferência.");
  }
  const porChave = new Map(atual.fontes.map(f => [f.chave, f]));
  const decisoes = new Map(atual.decisoes.map(d => [d.chave, d]));
  const destinos = new Map<string, string>();
  for (const f of atual.fontes) if (f.vinculoExplicito) destinos.set(f.chave, f.vinculoExplicito);
  for (const d of atual.decisoes) if (d.status === "VINCULADO" && d.destinoChave
    && hashFonteCorresponde(porChave.get(d.chave), d.hashFonte) && hashFonteCorresponde(porChave.get(d.destinoChave), d.hashDestino)) destinos.set(d.chave, d.destinoChave);
  const semelhantes = candidatosPara(fonte, atual.fontes, destinos);
  const candidatoIds = new Set(semelhantes.map(c => c.chave));
  const anterior = decisoes.get(chave);
  if (anterior?.destinoChave) candidatoIds.add(anterior.destinoChave);
  const candidatos = atual.linhas.filter(f => candidatoIds.has(f.chave) && f.chave !== chave && f.dominio === dominio
    && f.estado === "ATIVO" && !decisoes.get(f.chave)?.destinoChave && !!decisoes.get(f.chave)
    && (pode(politica, "comissoes.ver") || !atual.restritas.has(f.chave))
    && !(fonte.origem === "BRISA" && f.origem === "WIDESYS")
    && Boolean(fonte.cancelado) === Boolean(f.cancelado));
  const candidatosIndisponiveis = atual.linhas.filter(f => candidatoIds.has(f.chave) && f.chave !== chave && f.dominio === dominio
    && (pode(politica, "comissoes.ver") || !atual.restritas.has(f.chave)) && !candidatos.some(c => c.chave === f.chave)).length;
  const pendente = ["PENDENTE", "REVISAR"].includes(linha.estado);
  const conferidoManualmente = Boolean(linha.conferidoManualmente);
  const conferidoPorRegra = Boolean(linha.conferidoPorRegra) && linha.estado === "ATIVO";
  const podeConcluir = podeDecidir(politica) && (pendente || (linha.estado === "ATIVO" && !conferidoManualmente && !conferidoPorRegra));
  const motivo = linha.conferidoNaOrigem ? (linha.contabiliza ? "Conferido pela origem Widesys e incluído uma única vez nos totais."
    : "Conferido no Widesys. Concilie com a base Brisa/planilhas para não contar a mesma operação duas vezes.")
    : conferidoPorRegra ? "Conferido pela regra: valores totais diferentes. São lançamentos separados; a regra não cria títulos nem pagamentos."
    : conferidoManualmente ? "Conferência concluída. Sua decisão está registrada."
    : linha.estado === "ATIVO" ? "Este lançamento já está disponível. Confira os dados e confirme abaixo para marcá-lo como conferido."
    : linha.estado === "VINCULADO" ? "O registro está vinculado ao principal e não soma novamente."
    : linha.estado === "QUARENTENA" || linha.estado === "AUSENTE" ? "Há uma inconsistência na origem. Resolva em Revisar e resolver antes de concluir a conferência."
    : dominio === "PAGAR" ? "Salvar a categoria e o rateio organiza a despesa. Para retirar a pendência, confirme abaixo se é uma despesa distinta ou uma cópia de outro lançamento."
    : "Compare o valor, o pagamento e a competência. Confirme se é uma cobrança distinta ou uma cópia de outro lançamento.";
  const assinatura = hashUnificacao({ chave, hash: fonte.hash, versao: anterior?.versao ?? 0, estado: linha.estado, conferidoManualmente, conferidoPorRegra,
    comparacao: [...candidatoIds].sort().map(id => ({ chave: id, hash: porChave.get(id)?.hash, versao: decisoes.get(id)?.versao, status: atual.linhas.find(l => l.chave === id)?.estado })) });
  return { chave, dominio, estado: linha.estado, pendente, podeConcluir, conferidoManualmente, conferidoPorRegra, motivo,
    incluidoNosTotais: linha.contabiliza, candidatosIndisponiveis,
    versao: anterior?.versao ?? 0, hashFonte: fonte.hash, assinatura, registro: resumo(fonte), candidatos: candidatos.map(resumo) };
}

function dominioDaChave(chave: string): DominioRevisaoFinanceira {
  const dominio = /^(BRISA|WIDESYS):(PAGAR|RECEBER):[^\s:]{1,150}$/.exec(chave)?.[2];
  if (!dominio) throw new ErroUnificacao("ORIGEM_INVALIDA", "Reabra uma conta a pagar ou a receber válida.");
  return dominio as DominioRevisaoFinanceira;
}

/** Reutilizado pelo editor de despesas sem abrir uma segunda transação. */
export async function obterRevisaoFinanceiraNaTransacao(tx: Tx, selecao: { chave: string }, ator: Ator): Promise<RevisaoFinanceira> {
  const dominio = dominioDaChave(selecao.chave);
  const politica = await autorizarRevisaoFinanceira(tx, ator, dominio);
  return montarRevisao(await fotografia(tx, dominio), selecao.chave, dominio, politica);
}

export async function obterRevisaoFinanceira(db: PrismaClient, selecao: { chave: string }, ator: Ator): Promise<RevisaoFinanceira> {
  return db.$transaction(tx => obterRevisaoFinanceiraNaTransacao(tx, selecao, ator), { maxWait: 5000, timeout: 20000 });
}

export async function concluirRevisaoFinanceira(db: PrismaClient, entrada: ConcluirRevisaoFinanceiraEntrada, ator: Ator): Promise<{ estado: "ATIVO" | "VINCULADO"; revisao: RevisaoFinanceira }> {
  if (!entrada || !/^(BRISA|WIDESYS):(PAGAR|RECEBER):[^\s:]{1,150}$/.test(entrada.chave) || !["DISTINTO", "VINCULAR"].includes(entrada.acao)
    || !Number.isSafeInteger(entrada.versao) || entrada.versao < 0 || typeof entrada.justificativa !== "string"
    || entrada.justificativa.trim().length < 8 || entrada.justificativa.length > 500) throw new ErroUnificacao("DADOS_INVALIDOS", "Confira a decisão e descreva o motivo com 8 a 500 caracteres.");
  return db.$transaction(async tx => {
    const dominio = dominioDaChave(entrada.chave);
    const politica = await autorizarRevisaoFinanceira(tx, ator, dominio, true);
    const atual = await fotografia(tx, dominio);
    const revisao = montarRevisao(atual, entrada.chave, dominio, politica);
    if (entrada.versao !== revisao.versao || entrada.hashFonte !== revisao.hashFonte || entrada.assinatura !== revisao.assinatura) throw new ErroUnificacao("DECISAO_DESATUALIZADA", "Os dados da comparação mudaram. Reabra a conferência antes de confirmar.");
    if (!revisao.podeConcluir) throw new ErroUnificacao("REVISAO_INDISPONIVEL", "Este lançamento não possui uma conferência que possa ser concluída aqui.");
    if (entrada.acao === "VINCULAR" && !revisao.candidatos.some(c => c.chave === entrada.destinoChave && c.hash === entrada.hashDestino)) throw new ErroUnificacao("DESTINO_INVALIDO", "Escolha um dos lançamentos principais disponíveis nesta comparação.");
    const fonte = atual.fontes.find(f => f.chave === entrada.chave)!;
    const anterior = atual.decisoes.find(d => d.chave === entrada.chave);
    // Atualiza somente a fotografia que o usuário acabou de conferir. A
    // decisão e esta atualização são atômicas; nenhuma origem é modificada.
    if (anterior) {
      const atualizacao = await tx.unificacaoRegistro.updateMany({ where: { chave: entrada.chave, versao: entrada.versao }, data: { hashFonte: fonte.hash } });
      if (atualizacao.count !== 1) throw new ErroUnificacao("DECISAO_DESATUALIZADA", "Outra pessoa alterou esta conferência. Reabra a comparação.");
    } else await tx.unificacaoRegistro.create({ data: { chave: fonte.chave, dominio: fonte.dominio, origem: fonte.origem, origemId: fonte.origemId, hashFonte: fonte.hash, status: "PENDENTE" } });
    const resultado = await decidirUnificacaoNaTransacao(tx, { ...entrada, versao: anterior?.versao ?? 1 }, ator.id, atual.fontes);
    const registro = await tx.unificacaoRegistro.findUniqueOrThrow({ where: { chave: entrada.chave } });
    atual.decisoes = [...atual.decisoes.filter(d => d.chave !== entrada.chave), registro];
    atual.linhas = projetarUnificados(atual.fontes, atual.decisoes);
    return { estado: resultado.status as "ATIVO" | "VINCULADO", revisao: montarRevisao(atual, entrada.chave, dominio, politica) };
  }, { maxWait: 5000, timeout: 20000 });
}
