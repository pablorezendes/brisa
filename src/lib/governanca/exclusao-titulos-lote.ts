import { createHash, randomUUID } from "node:crypto";
import { referenciaDocumentoDespesa } from "../despesas/apresentacao";
import { Prisma, type PrismaClient } from "@prisma/client";
import { carteiraIrrestrita, montarPolitica, pode } from "../acesso/politica";
import { ErroGovernanca } from "./tipos";
import {
  LIMITE_EXCLUSAO_TITULOS,
  type DominioExclusaoTitulos,
  type ItemConfirmacaoExclusaoTitulo,
  type ItemPreviaExclusaoTitulo,
  type PreviaExclusaoTitulos,
} from "./exclusao-titulos-lote-tipos";

type Tx = Prisma.TransactionClient;
type Ator = { id: string };
type Identidade = { chave: string; origem: string; dominio: DominioExclusaoTitulos; id: string };
const hash = (dados: unknown) => createHash("sha256").update(JSON.stringify(dados)).digest("hex");

function validarSelecao(dominio: string, chaves: unknown): Identidade[] {
  if (dominio !== "RECEBER" && dominio !== "PAGAR") throw new ErroGovernanca("DOMINIO_INVALIDO", "Escolha contas a pagar ou contas a receber.");
  if (!Array.isArray(chaves) || !chaves.length || chaves.length > LIMITE_EXCLUSAO_TITULOS) {
    throw new ErroGovernanca("LIMITE_LOTE", `Selecione de 1 a ${LIMITE_EXCLUSAO_TITULOS} registros por vez.`);
  }
  const vistos = new Set<string>();
  return chaves.map(chave => {
    const partes = typeof chave === "string" && chave.length <= 250 ? /^(BRISA|WIDESYS):(RECEBER|PAGAR):([^\s:]+)$/.exec(chave) : null;
    if (!partes || partes[2] !== dominio) {
      throw new ErroGovernanca("IDENTIDADE_INVALIDA", "A seleção contém um registro inválido ou de outra lista. Atualize a seleção.");
    }
    if (vistos.has(chave)) throw new ErroGovernanca("SELECAO_REPETIDA", "Há registros repetidos na seleção. Selecione cada registro uma só vez.");
    vistos.add(chave);
    return { chave, origem: partes[1], dominio, id: partes[3] };
  });
}

async function autorizar(tx: Tx, ator: Ator) {
  const usuario = await tx.usuario.findUnique({ where: { id: ator.id }, select: {
    id: true, perfil: true, ativo: true, acessoGlobal: true, permissoesExtras: true, permissoesNegadas: true,
    papelAcesso: { select: { ativo: true, permissoes: true } },
    regrasAcesso: { select: { tipo: true, recursoId: true, efeito: true } },
  } });
  const politica = usuario ? montarPolitica(usuario) : null;
  if (!politica || usuario?.perfil !== "ADMINISTRADOR" || !pode(politica, "governanca.editar") || !carteiraIrrestrita(politica)) {
    throw new ErroGovernanca("SEM_PERMISSAO", "Somente um administrador autorizado pode excluir registros da plataforma.");
  }
}

function agrupar<T>(itens: T[], chave: (item: T) => string) {
  const grupos = new Map<string, T[]>();
  for (const item of itens) {
    const id = chave(item);
    const grupo = grupos.get(id);
    if (grupo) grupo.push(item); else grupos.set(id, [item]);
  }
  return grupos;
}

/** Leituras agrupadas somente dos IDs escolhidos: nunca carrega/reconcilia a operação inteira. */
async function carregarPrevia(tx: Tx, selecao: Identidade[]) {
  const brisaIds = selecao.filter(i => i.origem === "BRISA" && i.dominio === "RECEBER").map(i => i.id);
  const despesasIds = selecao.filter(i => i.origem === "BRISA" && i.dominio === "PAGAR").map(i => i.id);
  const legadoIds = selecao.filter(i => i.origem === "WIDESYS").map(i => i.id);
  const [estados, recebimentos, titulos, pagamentos, boletos, despesas] = await Promise.all([
    tx.recursoGovernado.findMany({ where: { tipo: "TITULO", origemId: { in: selecao.map(i => i.chave) } } }),
    brisaIds.length ? tx.recebimento.findMany({ where: { id: { in: brisaIds } }, include: { contrato: { include: { locatario: true, unidade: true } } } }) : [],
    legadoIds.length ? tx.tituloFinanceiroLegado.findMany({ where: { id: { in: legadoIds } }, select: {
      id: true, origem: true, escopo: true, legadoId: true, natureza: true, pessoaLegadoId: true, contratoLegadoId: true,
      contaBancariaRotulo: true, tipoCobrancaRotulo: true, planoContaRotulo: true, numeroDocumento: true, competencia: true,
      vencimento: true, valorDevido: true, valorPago: true, valorAberto: true,
      situacaoNormalizada: true, statusImportacao: true, snapshotHash: true, atualizadoEm: true,
    } }) : [],
    brisaIds.length ? tx.pagamentoRecebimento.findMany({ where: { recebimentoId: { in: brisaIds } },
      select: { id: true, recebimentoId: true, valor: true, status: true, atualizadoEm: true }, orderBy: { id: "asc" } }) : [],
    brisaIds.length ? tx.boleto.findMany({ where: { recebimentoId: { in: brisaIds } },
      select: { id: true, recebimentoId: true, status: true, conciliacaoStatus: true, atualizadoEm: true }, orderBy: { id: "asc" } }) : [],
    despesasIds.length ? tx.despesaDocumento.findMany({ where: { id: { in: despesasIds }, origemChave: null },
      include: { lancamentoCaixa: true } }) : [],
  ]);
  const contratosWhere = titulos.filter(t => t.contratoLegadoId).map(t => ({ origem: t.origem, legadoId: t.contratoLegadoId! }));
  const contratos = contratosWhere.length ? await tx.contratoLegado.findMany({ where: { OR: contratosWhere }, select: {
    origem: true, legadoId: true, imovelLegadoId: true,
    partes: { orderBy: { ordem: "asc" }, select: { papel: true, pessoaLegadoId: true, statusImportacao: true } },
  } }) : [];
  const contratosPorId = new Map(contratos.map(c => [JSON.stringify([c.origem, c.legadoId]), c]));
  // Mesma identidade apresentada na lista: somente RECEBER sem contraparte
  // explícita usa o primeiro inquilino não quarentenado do contrato.
  const pessoaDoTitulo = (t: typeof titulos[number]) => t.pessoaLegadoId ? t.pessoaLegadoId
    : (t.natureza === "RECEBER" ? contratosPorId.get(JSON.stringify([t.origem, t.contratoLegadoId]))?.partes
      .find(p => p.papel === "INQUILINO" && p.statusImportacao !== "QUARENTENA")?.pessoaLegadoId : null);
  const pessoasWhere = titulos.flatMap(t => {
    const id = pessoaDoTitulo(t);
    return id ? [{ origem: t.origem, legadoId: id }] : [];
  });
  const imoveisWhere = contratos.filter(c => c.imovelLegadoId).map(c => ({ origem: c.origem, legadoId: c.imovelLegadoId! }));
  const [pessoas, imoveis, baixas] = await Promise.all([
    pessoasWhere.length ? tx.pessoa.findMany({ where: { OR: pessoasWhere }, select: { origem: true, legadoId: true, nome: true } }) : [],
    imoveisWhere.length ? tx.imovelLegado.findMany({ where: { OR: imoveisWhere }, select: { origem: true, legadoId: true, nome: true, referencia: true } }) : [],
    titulos.length ? tx.baixaFinanceiraLegado.findMany({ where: { OR: titulos.map(t => ({ origem: t.origem, tituloEscopo: t.escopo, tituloLegadoId: t.legadoId })) },
      select: { id: true, origem: true, tituloEscopo: true, tituloLegadoId: true, valor: true, estornada: true, atualizadoEm: true }, orderBy: { id: "asc" } }) : [],
  ]);
  const estadosPorId = new Map(estados.map(e => [e.origemId, e]));
  const recebimentosPorId = new Map(recebimentos.map(r => [r.id, r]));
  const despesasPorId = new Map(despesas.map(d => [d.id, d]));
  const titulosPorId = new Map(titulos.map(t => [t.id, t]));
  const pessoasPorId = new Map(pessoas.map(p => [JSON.stringify([p.origem, p.legadoId]), p.nome]));
  const imoveisPorId = new Map(imoveis.map(i => [JSON.stringify([i.origem, i.legadoId]), i]));
  const pagamentosPorId = agrupar(pagamentos, p => p.recebimentoId);
  const boletosPorId = agrupar(boletos, b => b.recebimentoId);
  const baixasPorId = agrupar(baixas, b => JSON.stringify([b.origem, b.tituloEscopo, b.tituloLegadoId]));
  const itens: ItemPreviaExclusaoTitulo[] = selecao.map(item => {
    const estado = estadosPorId.get(item.chave);
    let nome: string, referencia: string, valor: number | null, dados: unknown;
    let links: { pagamentos: unknown[]; boletos: unknown[]; baixas: unknown[] };
    if (item.origem === "BRISA" && item.dominio === "PAGAR") {
      const d = despesasPorId.get(item.id);
      if (!d) throw new ErroGovernanca("NAO_ENCONTRADO", "Uma das notas selecionadas não existe mais ou pertence a um título Widesys. Atualize a lista.");
      nome = `${d.fornecedorNome} · ${referenciaDocumentoDespesa(d)}`;
      referencia = `Brisa · competência ${d.competencia} · despesa única${d.lancamentoCaixaId ? " · pagamento preservado no caixa" : ""}`;
      valor = d.total;
      dados = d;
      links = { pagamentos: d.lancamentoCaixa ? [d.lancamentoCaixa] : [], boletos: [], baixas: [] };
    } else if (item.origem === "BRISA") {
      const t = recebimentosPorId.get(item.id);
      if (!t) throw new ErroGovernanca("NAO_ENCONTRADO", "Um dos registros selecionados não existe mais. Atualize a lista antes de continuar.");
      nome = `${t.contrato.locatario?.nome ?? "Recebimento"} · ${t.contrato.unidade.identificacao} · ${t.competencia}`;
      referencia = `Brisa · competência ${t.competencia} · lançamento ${t.mesLancamento}`;
      valor = t.valor + t.iptu + t.cond;
      dados = t;
      links = { pagamentos: pagamentosPorId.get(t.id) ?? [], boletos: boletosPorId.get(t.id) ?? [], baixas: [] };
    } else {
      const t = titulosPorId.get(item.id);
      // A lista conserva naturezas inconsistentes em RECEBER para conferência.
      const mesmoDominio = t && (item.dominio === "PAGAR" ? t.natureza === "PAGAR" : t.natureza !== "PAGAR");
      if (!t || !mesmoDominio || t.origem !== "WIDESYS") throw new ErroGovernanca("NAO_ENCONTRADO", "Um dos registros selecionados não corresponde à lista. Atualize a seleção.");
      const pessoa = pessoasPorId.get(JSON.stringify([t.origem, pessoaDoTitulo(t)]));
      const contrato = contratosPorId.get(JSON.stringify([t.origem, t.contratoLegadoId]));
      const imovel = contrato?.imovelLegadoId ? imoveisPorId.get(JSON.stringify([t.origem, contrato.imovelLegadoId])) : null;
      nome = [pessoa ?? `${t.natureza === "PAGAR" ? "Pagamento" : "Cobrança"} ${t.legadoId}`, pessoa ? t.legadoId : null, item.dominio === "PAGAR" ? "a pagar" : "a receber"].filter(Boolean).join(" · ");
      referencia = ["Widesys", imovel?.nome ?? imovel?.referencia, t.tipoCobrancaRotulo, t.contaBancariaRotulo, t.planoContaRotulo, t.vencimento ? `vencimento ${t.vencimento}` : t.competencia, t.numeroDocumento ? `documento ${t.numeroDocumento}` : null].filter(Boolean).join(" · ");
      valor = t.valorDevido;
      dados = { titulo: t, pessoa, contrato, imovel };
      links = { pagamentos: [], boletos: [], baixas: baixasPorId.get(JSON.stringify([t.origem, t.escopo, t.legadoId])) ?? [] };
    }
    return {
      chave: item.chave, nome, referencia, valor, status: estado?.status ?? "ATIVO",
      assinatura: hash({ chave: item.chave, dados, links, estado }),
      vinculos: { pagamentos: links.pagamentos.length, boletos: links.boletos.length, baixas: links.baixas.length },
    };
  });
  return { itens, estadosPorId };
}

export async function previaExclusaoTitulosLote(db: PrismaClient, dominio: string, chaves: unknown, ator: Ator): Promise<PreviaExclusaoTitulos> {
  const selecao = validarSelecao(dominio, chaves);
  return db.$transaction(async tx => {
    await autorizar(tx, ator);
    const { itens } = await carregarPrevia(tx, selecao);
    return { dominio: selecao[0].dominio, itens, total: itens.length };
  }, { maxWait: 5000, timeout: 15000 });
}

export async function excluirTitulosLote(db: PrismaClient, dominio: string, itens: unknown, motivo: string, ator: Ator) {
  if (!Array.isArray(itens) || itens.some(i => !i || typeof i !== "object" || typeof i.assinatura !== "string" || !/^[a-f0-9]{64}$/.test(i.assinatura))) {
    throw new ErroGovernanca("PREVIA_OBRIGATORIA", "Confira os registros selecionados antes de confirmar a exclusão.");
  }
  const confirmacoes = itens as ItemConfirmacaoExclusaoTitulo[];
  const selecao = validarSelecao(dominio, confirmacoes.map(i => i.chave));
  const m = motivo.trim();
  if (m.length < 5 || m.length > 500) throw new ErroGovernanca("MOTIVO_INVALIDO", "Explique o motivo da exclusão em 5 a 500 caracteres.");
  return db.$transaction(async tx => {
    await autorizar(tx, ator);
    const { itens: previa, estadosPorId } = await carregarPrevia(tx, selecao);
    const assinaturas = new Map(confirmacoes.map(i => [i.chave, i.assinatura]));
    const jaExcluidos = previa.filter(i => i.status === "EXCLUIDO").map(i => i.chave);
    const pendentes = previa.filter(i => i.status !== "EXCLUIDO");
    // Confere todo o lote antes da primeira escrita. Qualquer divergência aborta a operação inteira.
    if (pendentes.some(i => i.assinatura !== assinaturas.get(i.chave))) {
      throw new ErroGovernanca("PREVIA_DESATUALIZADA", "Um dos registros ou seus vínculos mudou. Nenhum registro foi excluído; atualize a prévia e confirme novamente.");
    }
    const agora = new Date();
    const plano = pendentes.map(item => {
      const anterior = estadosPorId.get(item.chave);
      return { id: anterior?.id ?? randomUUID(), chave: item.chave, anterior,
        estadoAnterior: JSON.stringify({ exclusaoAdministrativa: true, nome: item.nome, anterior: anterior ? {
          status: anterior.status, destinoId: anterior.destinoId, motivo: anterior.motivo, estadoAnterior: anterior.estadoAnterior,
        } : null }),
      };
    });
    const novos = plano.filter(p => !p.anterior);
    if (novos.length) await tx.recursoGovernado.createMany({ data: novos.map(p => ({
      id: p.id, tipo: "TITULO", origemId: p.chave, status: "EXCLUIDO", motivo: m, autorId: ator.id, estadoAnterior: p.estadoAnterior,
    })) });
    const existentes = plano.filter(p => p.anterior);
    if (existentes.length) {
      // Um UPDATE parametrizado para o lote, em vez de reler/upsert cada título.
      const atualizados = await tx.$executeRaw(Prisma.sql`UPDATE "RecursoGovernado" SET
        "status" = 'EXCLUIDO', "destinoId" = NULL, "motivo" = ${m}, "autorId" = ${ator.id},
        "estadoAnterior" = CASE "id" ${Prisma.join(existentes.map(p => Prisma.sql`WHEN ${p.id} THEN ${p.estadoAnterior}`), " ")} END,
        "versao" = "versao" + 1, "atualizadoEm" = ${agora}
        WHERE "tipo" = 'TITULO' AND "status" <> 'EXCLUIDO' AND "id" IN (${Prisma.join(existentes.map(p => p.id))})`);
      if (atualizados !== existentes.length) throw new ErroGovernanca("PREVIA_DESATUALIZADA", "A seleção mudou durante a exclusão. Nenhum registro foi excluído; atualize a prévia.");
    }
    if (plano.length) await tx.eventoGovernanca.createMany({ data: plano.map(p => ({
      recursoId: p.id, acao: "EXCLUIDO", estadoAnterior: p.anterior?.status ?? "ATIVO", estadoNovo: "EXCLUIDO", autorId: ator.id, motivo: m,
    })) });
    return { excluidos: plano.map(p => p.chave), jaExcluidos };
  }, { maxWait: 5000, timeout: 20000 });
}
