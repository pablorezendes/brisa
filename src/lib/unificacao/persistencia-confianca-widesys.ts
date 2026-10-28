import type { PrismaClient } from "@prisma/client";
import { carregarFontesUnificacao } from "./fontes";
import { filtrarFontesGovernadas } from "../governanca/filtros";
import { criarIndiceCandidatos } from "./candidatos-indice";
import { hashFonteCorresponde } from "./hashes";
import { candidatosPara } from "./reconciliacao";
import { planejarConfiancaWidesys } from "./confianca-widesys";

/** Conferência da origem autorizada pelo administrador; nunca altera fontes,
 * pagamentos, planilhas, exclusões ou vínculos previamente decididos. */
export async function conferirOrigemWidesys(db: PrismaClient, aplicar = false) {
  return db.$transaction(async tx => {
    const fontes = filtrarFontesGovernadas(await carregarFontesUnificacao(tx), await tx.recursoGovernado.findMany({ select: { tipo: true, origemId: true, status: true } }));
    const existentes = await tx.unificacaoRegistro.findMany();
    const anteriores = new Map(existentes.map(d => [d.chave, d]));
    const porChave = new Map(fontes.map(f => [f.chave, f]));
    const destinos = new Map<string, string>();
    for (const f of fontes) if (f.vinculoExplicito) destinos.set(f.chave, f.vinculoExplicito);
    for (const d of existentes) if (d.status === "VINCULADO" && d.destinoChave && hashFonteCorresponde(porChave.get(d.chave), d.hashFonte) && hashFonteCorresponde(porChave.get(d.destinoChave), d.hashDestino)) destinos.set(d.chave, d.destinoChave);
    const indice = criarIndiceCandidatos(fontes, destinos);
    const resumo = { modo: aplicar ? "APLICADO" : "PREVIA", conferidos: 0, cruzamentos: 0, preservados: 0, atualizados: 0 };
    for (const f of fontes.filter(f => f.origem === "WIDESYS")) {
      const anterior = anteriores.get(f.chave);
      const dados = planejarConfiancaWidesys(f, candidatosPara(f, indice.para(f), destinos), anterior,
        indice.competenciasReceberBrisa.has(f.competencia), anteriores);
      if (!dados) { resumo.preservados++; continue; }
      if (dados.status === "PENDENTE") resumo.cruzamentos++; else resumo.conferidos++;
      if (anterior && Object.entries(dados).every(([k, v]) => anterior[k as keyof typeof anterior] === v)) continue;
      resumo.atualizados++;
      if (!aplicar) continue;
      await tx.unificacaoRegistro.upsert({ where: { chave: f.chave },
        create: { chave: f.chave, dominio: f.dominio, origem: f.origem, origemId: f.origemId, ...dados },
        update: { ...dados, versao: { increment: 1 } } });
      await tx.unificacaoDecisao.create({ data: { registroChave: f.chave, acao: "CONFERIR_ORIGEM_WIDESYS",
        estadoAnterior: anterior?.status ?? "NAO_ANALISADO", estadoNovo: dados.status, hashFonte: f.hash,
        usuarioId: "SISTEMA:WIDESYS_CONFERIDO", justificativa: "Origem Widesys confirmada pelo administrador. Identificadores distintos são registros distintos. Cruzamentos com Brisa e planilhas permanecem sem soma adicional até conciliação." } });
    }
    return resumo;
  }, { timeout: 120000, maxWait: 15000 });
}
