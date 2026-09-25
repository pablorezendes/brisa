import type { PrismaClient, Prisma } from "@prisma/client";
import { STATUS_BOLETO_ATIVOS } from "../dominio/boletos";
import { avaliarFonte, candidatosPara, projetarUnificados } from "./reconciliacao";
import { carregarFontesUnificacao } from "./fontes";
import type { DecisaoUnificacao, DominioUnificacao, FonteUnificacao } from "./tipos";

export class ErroUnificacao extends Error {
  constructor(public codigo: string, mensagem: string) { super(mensagem); this.name = "ErroUnificacao"; }
}

/** Idempotente e transacional; preserva decisões e todas as tabelas de origem. */
export async function analisarUnificacao(db: PrismaClient, usuarioId: string, dryRun = false) {
  return db.$transaction(async tx => {
    const fontes = await carregarFontesUnificacao(tx);
    const existentes = await tx.unificacaoRegistro.findMany();
    const porChave = new Map(fontes.map(f => [f.chave,f]));
    const anteriores = new Map(existentes.map(d => [d.chave,d]));
    const destinos = new Map<string,string>();
    for (const f of fontes) if (f.vinculoExplicito) destinos.set(f.chave,f.vinculoExplicito);
    for (const d of existentes) if (d.status === "VINCULADO" && d.destinoChave && porChave.get(d.chave)?.hash === d.hashFonte && porChave.get(d.destinoChave)?.hash === d.hashDestino) destinos.set(d.chave,d.destinoChave);
    const grupos = new Map<DominioUnificacao,FonteUnificacao[]>();
    for (const f of fontes) { const grupo = grupos.get(f.dominio) ?? []; grupo.push(f); grupos.set(f.dominio,grupo); }
    const novos: Prisma.UnificacaoRegistroCreateManyInput[] = [];
    const estados: Record<string,number> = {};
    let criados = 0, atualizados = 0, inalterados = 0;
    for (const f of fontes) {
      const anterior = anteriores.get(f.chave);
      const candidatos = candidatosPara(f, grupos.get(f.dominio) ?? [], destinos);
      const decisao = avaliarFonte(f,candidatos,porChave,anterior,anteriores);
      const alvo = decisao.destinoChave ? porChave.get(decisao.destinoChave) : null;
      const dados = {
        dominio: f.dominio, origem: f.origem, origemId: f.origemId,
        status: decisao.status, destinoChave: decisao.destinoChave,
        hashFonte: f.hash, hashDestino: alvo?.hash ?? null,
        candidatos: JSON.stringify(candidatos), motivos: JSON.stringify(decisao.motivos),
        proveniencia: JSON.stringify(f.proveniencia ?? {}),
      };
      estados[dados.status] = (estados[dados.status] ?? 0) + 1;
      if (!anterior) {
        criados++;
        if (!dryRun) novos.push({ chave: f.chave, ...dados });
      } else if (Object.entries(dados).some(([k,v]) => anterior[k as keyof typeof anterior] !== v)) {
        atualizados++;
        if (!dryRun) await tx.unificacaoRegistro.update({ where: { chave: f.chave }, data: { ...dados, versao: { increment: 1 } } });
      } else inalterados++;
    }
    if (!dryRun) for (let i=0;i<novos.length;i+=200) await tx.unificacaoRegistro.createMany({ data: novos.slice(i,i+200) });
    const ausentes = existentes.filter(d => !porChave.has(d.chave) && d.status !== "AUSENTE");
    if (!dryRun && ausentes.length) await tx.unificacaoRegistro.updateMany({ where: { chave: { in: ausentes.map(d => d.chave) } }, data: { status: "AUSENTE", versao: { increment: 1 }, motivos: JSON.stringify(["REGISTRO_REMOVIDO_NA_FONTE"]) } });
    if (!dryRun && (criados || atualizados || ausentes.length)) await tx.unificacaoDecisao.create({ data: {
      registroChave: "ANALISE", acao: "ANALISAR", estadoAnterior: "", estadoNovo: "", hashFonte: "", usuarioId,
      justificativa: JSON.stringify({ criados, atualizados, inalterados, ausentes: ausentes.length, estados }),
    } });
    return { modo: dryRun ? "DRY_RUN" : "APLICADO", total: fontes.length, criados, atualizados, inalterados, ausentes: ausentes.length, estados };
  }, { maxWait: 15000, timeout: 120000 });
}

export type ResolverUnificacaoEntrada = { chave: string; versao: number; acao: "VINCULAR" | "DISTINTO" | "REABRIR"; destinoChave?: string; hashFonte: string; hashDestino?: string; justificativa: string };

export async function decidirUnificacao(db: PrismaClient, entrada: ResolverUnificacaoEntrada, usuarioId: string) {
  if (!entrada.chave || entrada.chave.length > 250 || !Number.isSafeInteger(entrada.versao) || entrada.versao < 1 || !["VINCULAR","DISTINTO","REABRIR"].includes(entrada.acao)) throw new ErroUnificacao("DADOS_INVALIDOS", "Atualize a análise antes de resolver este registro.");
  if (entrada.justificativa.trim().length < 8 || entrada.justificativa.length > 500) throw new ErroUnificacao("JUSTIFICATIVA_OBRIGATORIA", "Descreva o motivo da decisão com 8 a 500 caracteres.");
  return db.$transaction(async tx => {
    const registro = await tx.unificacaoRegistro.findUnique({ where: { chave: entrada.chave } });
    if (!registro || registro.versao !== entrada.versao) throw new ErroUnificacao("DECISAO_DESATUALIZADA", "Este registro foi alterado. Reabra a comparação.");
    const fontes = await carregarFontesUnificacao(tx);
    const fonte = fontes.find(f => f.chave === entrada.chave);
    if (!fonte || fonte.hash !== entrada.hashFonte || registro.hashFonte !== fonte.hash) throw new ErroUnificacao("FONTE_DESATUALIZADA", "A origem mudou. Atualize a análise e compare novamente.");
    if (fonte.qualidade !== "OK") throw new ErroUnificacao("FONTE_EM_QUARENTENA", "Resolva a inconsistência na origem e importe uma nova captura antes de incorporar este registro.");
    const envolvidas = new Set([fonte.chave, registro.destinoChave, ...(entrada.acao === "VINCULAR" ? [entrada.destinoChave] : [])]);
    const idsRecebimentos = fontes.filter(f => envolvidas.has(f.chave) && f.origem === "BRISA" && f.dominio === "RECEBER").map(f => f.origemId);
    if (idsRecebimentos.length) {
      const meses = await tx.recebimento.findMany({ where: { id: { in: idsRecebimentos } }, select: { mesLancamento: true } });
      if (await tx.fechamentoMensal.count({ where: { mesLancamento: { in: meses.map(r => r.mesLancamento) } } })) throw new ErroUnificacao("MES_FECHADO", "Um dos recebimentos pertence a um mês fechado. Reabra o mês pelo fluxo de locações antes de alterar sua unificação.");
    }
    let destino: FonteUnificacao | undefined;
    if (entrada.acao === "VINCULAR") {
      destino = fontes.find(f => f.chave === entrada.destinoChave);
      const decisaoAlvo = destino ? await tx.unificacaoRegistro.findUnique({ where: { chave: destino.chave } }) : null;
      if (!destino || destino.chave === fonte.chave || destino.dominio !== fonte.dominio || destino.qualidade !== "OK" || decisaoAlvo?.status !== "ATIVO" || decisaoAlvo.destinoChave) throw new ErroUnificacao("DESTINO_INVALIDO", "Escolha um registro principal ativo do mesmo tipo.");
      if (destino.hash !== entrada.hashDestino || decisaoAlvo.hashFonte !== destino.hash) throw new ErroUnificacao("DESTINO_DESATUALIZADO", "O registro principal mudou. Reabra a comparação.");
      // Reparentear um grupo esconderia vários vínculos e pode formar ciclos.
      if (await tx.unificacaoRegistro.count({ where: { destinoChave: fonte.chave, status: "VINCULADO" } })) throw new ErroUnificacao("REGISTRO_PRINCIPAL_COM_VINCULOS", "Este registro já é principal de outro grupo. Reabra os vínculos antes de unir grupos.");
      if ((fonte.dominio === "RECEBER" || fonte.dominio === "PAGAR") && Boolean(fonte.cancelado) !== Boolean(destino.cancelado)) throw new ErroUnificacao("SITUACAO_DIVERGENTE", "Um título está cancelado e o outro não. Corrija a situação antes de vinculá-los.");
      if (fonte.dominio === "MOVIMENTO" && (fonte.natureza !== destino.natureza || Boolean(fonte.informativo) !== Boolean(destino.informativo))) throw new ErroUnificacao("NATUREZA_DIVERGENTE", "Movimentos com direções ou efeitos diferentes no caixa não podem representar o mesmo lançamento.");
      if (["RECEBER", "MOVIMENTO"].includes(fonte.dominio) && fonte.origem === "BRISA" && destino.origem === "WIDESYS") throw new ErroUnificacao("PRESERVAR_COMPOSICAO_NATIVA", "Mantenha o lançamento Brisa como principal para preservar a composição e a apuração. Abra a ocorrência Widesys e vincule-a ao registro Brisa.");
      const recebimentos = [fonte, destino].filter(f => f.origem === "BRISA" && f.dominio === "RECEBER").map(f => f.origemId);
      const contratos = [fonte, destino].filter(f => f.origem === "BRISA" && f.dominio === "CONTRATO").map(f => f.origemId);
      if ((recebimentos.length || contratos.length) && await tx.recebimento.count({ where: { AND: [{ OR: [{ id: { in: recebimentos } }, { contratoId: { in: contratos } }] }, { OR: [{ reservaEmissaoToken: { not: null } }, { boletos: { some: { status: { in: [...STATUS_BOLETO_ATIVOS] } } } }] }] } })) throw new ErroUnificacao("EMISSAO_EM_ANDAMENTO", "Este título ou contrato possui cobrança bancária ativa ou emissão em andamento. Confira a situação no banco antes de unificar.");
    }
    const status = entrada.acao === "VINCULAR" ? "VINCULADO" : entrada.acao === "DISTINTO" ? "ATIVO" : "PENDENTE";
    const mudanca = await tx.unificacaoRegistro.updateMany({ where: { chave: entrada.chave, versao: entrada.versao }, data: {
      status, destinoChave: destino?.chave ?? null, hashFonte: fonte.hash, hashDestino: destino?.hash ?? null,
      decisao: "MANUAL", decididoPor: usuarioId, decididoEm: new Date(), versao: { increment: 1 },
      motivos: JSON.stringify([entrada.acao === "VINCULAR" ? "UNIAO_CONFIRMADA" : entrada.acao === "DISTINTO" ? "REGISTRO_DISTINTO_CONFIRMADO" : "REVISAO_REABERTA"]),
    } });
    if (mudanca.count !== 1) throw new ErroUnificacao("DECISAO_DESATUALIZADA", "Outra pessoa já resolveu este registro. Atualize a página.");
    await tx.unificacaoDecisao.create({ data: { registroChave: registro.chave, acao: entrada.acao, estadoAnterior: registro.status, estadoNovo: status, destinoChave: destino?.chave, hashFonte: fonte.hash, hashDestino: destino?.hash, justificativa: entrada.justificativa.trim(), usuarioId } });
    return { chave: registro.chave, status };
  }, { maxWait: 15000, timeout: 60000 });
}

export async function lerOperacaoUnificada(db: PrismaClient) {
  return db.$transaction(async tx => {
    const [fontes, decisoes] = await Promise.all([carregarFontesUnificacao(tx), tx.unificacaoRegistro.findMany()]);
    return { fontes, decisoes, linhas: projetarUnificados(fontes,decisoes as DecisaoUnificacao[]) };
  }, { timeout: 60000 });
}
