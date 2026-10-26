import type { Prisma, PrismaClient, UnificacaoRegistro } from "@prisma/client";
import { STATUS_BOLETO_ATIVOS } from "../dominio/boletos";
import { filtrarFontesGovernadas } from "../governanca/filtros";
import { criarIndiceCandidatos } from "./candidatos-indice";
import { carregarFontesUnificacao } from "./fontes";
import { hashFonteCorresponde } from "./hashes";
import { candidatosPara } from "./reconciliacao";
import type { FonteUnificacao } from "./tipos";
import { avaliarRegraValoresDiferentes, DECISAO_VALOR_DIFERENTE, MOTIVO_VALORES_DIFERENTES, type EvidenciaValoresDiferentes } from "./valores-diferentes";

export const AUTOR_REGRA_VALOR_DIFERENTE = "SISTEMA:REGRA_VALOR_DIFERENTE";

type ConferenciaPorValor = {
  fonte: FonteUnificacao;
  anterior?: UnificacaoRegistro;
  evidencia: EvidenciaValoresDiferentes;
};
type Contexto = {
  fontes: FonteUnificacao[];
  existentes: UnificacaoRegistro[];
  destinos?: Map<string, string>;
  indice?: ReturnType<typeof criarIndiceCandidatos>;
};

/** Usa a mesma fotografia da análise. Não modifica título, baixa ou caixa. */
export async function planejarConferenciaPorValores(tx: Prisma.TransactionClient, contexto: Contexto) {
  const { fontes, existentes } = contexto;
  const porChave = new Map(fontes.map(f => [f.chave, f]));
  const anteriores = new Map(existentes.map(d => [d.chave, d]));
  const destinos = contexto.destinos ?? new Map<string, string>();
  if (!contexto.destinos) {
    for (const f of fontes) if (f.vinculoExplicito) destinos.set(f.chave, f.vinculoExplicito);
    for (const d of existentes) if (d.status === "VINCULADO" && d.destinoChave
      && hashFonteCorresponde(porChave.get(d.chave), d.hashFonte)
      && hashFonteCorresponde(porChave.get(d.destinoChave), d.hashDestino)) destinos.set(d.chave, d.destinoChave);
  }
  const indice = contexto.indice ?? criarIndiceCandidatos(fontes, destinos);
  const elegiveis = new Map<string, ConferenciaPorValor>();
  for (const fonte of fontes) {
    if (fonte.dominio !== "PAGAR" && fonte.dominio !== "RECEBER") continue;
    const fontesComparaveis = indice.para(fonte);
    const evidencia = avaliarRegraValoresDiferentes({ fonte, fontesComparaveis,
      candidatosAtuais: candidatosPara(fonte, fontesComparaveis, destinos), destinos, anterior: anteriores.get(fonte.chave) });
    if (evidencia) elegiveis.set(fonte.chave, { fonte, anterior: anteriores.get(fonte.chave), evidencia });
  }

  // Fechamento e cobrança bancária continuam protegidos, mesmo que a regra
  // alterasse apenas a decisão local de um recebimento nativo.
  const nativos = [...elegiveis.values()].filter(p => p.fonte.origem === "BRISA" && p.fonte.dominio === "RECEBER");
  const protegidos = new Set<string>();
  if (nativos.length) {
    const mesesFechados = new Set((await tx.fechamentoMensal.findMany({ select: { mesLancamento: true } })).map(m => m.mesLancamento));
    for (let i = 0; i < nativos.length; i += 400) {
      const recebimentos = await tx.recebimento.findMany({
        where: { id: { in: nativos.slice(i, i + 400).map(p => p.fonte.origemId) } },
        select: { id: true, mesLancamento: true, reservaEmissaoToken: true,
          boletos: { where: { status: { in: [...STATUS_BOLETO_ATIVOS] } }, select: { id: true }, take: 1 } },
      });
      for (const r of recebimentos) if (mesesFechados.has(r.mesLancamento) || r.reservaEmissaoToken || r.boletos.length) protegidos.add(`BRISA:RECEBER:${r.id}`);
    }
    for (const chave of protegidos) elegiveis.delete(chave);
  }
  return { elegiveis, protegidos: protegidos.size, chavesProtegidas: protegidos };
}

export function dadosConferenciaPorValores(plano: ConferenciaPorValor, decididoEm: Date) {
  return {
    status: "ATIVO", destinoChave: null, hashDestino: null,
    decisao: DECISAO_VALOR_DIFERENTE, decididoPor: AUTOR_REGRA_VALOR_DIFERENTE, decididoEm,
    candidatos: "[]", motivos: JSON.stringify([MOTIVO_VALORES_DIFERENTES]),
    hashFonte: plano.fonte.hash,
  };
}

export function auditoriaConferenciaPorValores(plano: ConferenciaPorValor): Prisma.UnificacaoDecisaoCreateManyInput {
  return {
    registroChave: plano.fonte.chave, acao: DECISAO_VALOR_DIFERENTE,
    estadoAnterior: plano.anterior?.status ?? "NAO_ANALISADO", estadoNovo: "ATIVO",
    hashFonte: plano.fonte.hash, usuarioId: AUTOR_REGRA_VALOR_DIFERENTE,
    justificativa: JSON.stringify({ regra: DECISAO_VALOR_DIFERENTE, versao: 1,
      criterio: "Mesmo vínculo e competência, com valores devidos diferentes e sem outra correspondência pendente.",
      valorDevido: plano.fonte.valor, comparados: plano.evidencia.comparados }),
  };
}

/** A aplicação é explícita; a chamada sem opções é uma prévia sem gravações. */
export async function conferirValoresDiferentes(db: PrismaClient, opcoes: { aplicar?: boolean } = {}) {
  return db.$transaction(async tx => {
    const fontes = filtrarFontesGovernadas(await carregarFontesUnificacao(tx),
      await tx.recursoGovernado.findMany({ select: { tipo: true, origemId: true, status: true } }));
    const existentes = await tx.unificacaoRegistro.findMany();
    const plano = await planejarConferenciaPorValores(tx, { fontes, existentes });
    const porDominio = { PAGAR: 0, RECEBER: 0 };
    const decididoEm = new Date();
    const auditoria: Prisma.UnificacaoDecisaoCreateManyInput[] = [];
    let criados = 0, atualizados = 0;
    for (const item of plano.elegiveis.values()) {
      porDominio[item.fonte.dominio as keyof typeof porDominio]++;
      if (item.anterior) atualizados++; else criados++;
      if (!opcoes.aplicar) continue;
      const dados = dadosConferenciaPorValores(item, decididoEm);
      if (item.anterior) {
        const gravados = await tx.unificacaoRegistro.updateMany({ where: {
          chave: item.fonte.chave, versao: item.anterior.versao, hashFonte: item.anterior.hashFonte, decisao: "AUTOMATICA",
        }, data: { ...dados, versao: { increment: 1 } } });
        if (gravados.count !== 1) throw new Error("DECISAO_ALTERADA_DURANTE_CONFERENCIA");
      } else {
        await tx.unificacaoRegistro.create({ data: { chave: item.fonte.chave, dominio: item.fonte.dominio,
          origem: item.fonte.origem, origemId: item.fonte.origemId, proveniencia: JSON.stringify(item.fonte.proveniencia ?? {}), ...dados } });
      }
      auditoria.push(auditoriaConferenciaPorValores(item));
    }
    for (let i = 0; i < auditoria.length; i += 200) await tx.unificacaoDecisao.createMany({ data: auditoria.slice(i, i + 200) });
    return {
      modo: opcoes.aplicar ? "APLICADO" : "DRY_RUN", regra: DECISAO_VALOR_DIFERENTE,
      avaliados: fontes.filter(f => f.dominio === "PAGAR" || f.dominio === "RECEBER").length,
      conferidos: plano.elegiveis.size, porDominio, decisoesNovas: criados, decisoesAtualizadas: atualizados,
      protegidos: plano.protegidos,
      titulosCriados: 0, pagamentosCriados: 0, movimentosCriados: 0,
    };
  }, { maxWait: 15000, timeout: 120000 });
}
