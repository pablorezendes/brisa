import type { PrismaClient } from "@prisma/client";
import { falsoErroTipoPagamento } from "./campos-data";
import { carregarFontesUnificacao } from "../unificacao/fontes";
import { avaliarFonte, candidatosPara } from "../unificacao/reconciliacao";
import { filtrarFontesGovernadas } from "../governanca/filtros";

const CODIGO = "TITULO_PAGAMENTO_INVALIDO";
/** Corrige exclusivamente a falsa leitura de forma de pagamento em títulos não pagos. */
export async function revalidarPagamentoWidesys(db: PrismaClient, aplicar = false) {
  return db.$transaction(async tx => {
    const titulos = await tx.tituloFinanceiroLegado.findMany({ where: {
      origem: "WIDESYS", statusImportacao: "QUARENTENA", quarentenaMotivo: { contains: CODIGO },
    } });
    const decisoes = await tx.unificacaoRegistro.findMany();
    const porChave = new Map(decisoes.map(d => [d.chave, d]));
    const elegiveis = titulos.filter(t => {
      const d = porChave.get(`WIDESYS:${t.natureza}:${t.id}`);
      if (t.pagamento || t.valorPago !== 0 || (d && (d.decisao !== "AUTOMATICA" || d.destinoChave))) return false;
      try {
        const campos = JSON.parse(t.snapshot).campos;
        if (!campos || typeof campos !== "object" || Array.isArray(campos)
          || Object.values(campos).some(v => typeof v !== "string" && !(Array.isArray(v) && v.every(s => typeof s === "string")))) return false;
        return t.quarentenaMotivo?.split(";").includes(CODIGO) && falsoErroTipoPagamento(campos);
      } catch { return false; }
    });
    const resumo = { modo: aplicar ? "APLICADO" : "PREVIA", encontrados: titulos.length,
      corrigiveis: elegiveis.length, preservados: titulos.length - elegiveis.length,
      liberados: 0, pendentes: 0, outrasInconsistencias: 0 };
    if (!aplicar || !elegiveis.length) return resumo;
    for (const t of elegiveis) {
      const motivos = t.quarentenaMotivo!.split(";").filter(m => m !== CODIGO).join(";") || null;
      await tx.tituloFinanceiroLegado.update({ where: { id: t.id }, data: {
        quarentenaMotivo: motivos, statusImportacao: motivos ? "QUARENTENA" : "STAGING",
      } });
    }
    const fontes = filtrarFontesGovernadas(await carregarFontesUnificacao(tx), await tx.recursoGovernado.findMany());
    const fontesMap = new Map(fontes.map(f => [f.chave, f]));
    // Toda correspondência é preservada como pendência: a correção técnica não
    // autoriza somar uma segunda fonte nem confirma manualmente uma despesa.
    for (const t of elegiveis) {
      const chave = `WIDESYS:${t.natureza}:${t.id}`, anterior = porChave.get(chave), f = fontesMap.get(chave);
      if (!f) { resumo.pendentes++; continue; } // excluído: não ressuscitar
      const candidatos = candidatosPara(f, fontes, new Map());
      const avaliada = avaliarFonte(f, candidatos, fontesMap, undefined, porChave);
      const estado = f.qualidade !== "OK" ? "QUARENTENA" : candidatos.length || f.vinculoExplicito ? "PENDENTE" : avaliada.status;
      const motivos = estado === "PENDENTE" ? ["CONFERIR_APOS_REVALIDACAO", ...avaliada.motivos] : avaliada.motivos;
      const dados = { dominio: f.dominio, origem: f.origem, origemId: f.origemId, status: estado,
        hashFonte: f.hash, candidatos: JSON.stringify(candidatos), motivos: JSON.stringify(motivos),
        decisao: "AUTOMATICA", versao: (anterior?.versao ?? 0) + 1 };
      await tx.unificacaoRegistro.upsert({ where: { chave }, create: { chave, ...dados }, update: dados });
      await tx.unificacaoDecisao.create({ data: { registroChave: chave, acao: "REVALIDAR_DATA_PAGAMENTO",
        estadoAnterior: anterior?.status ?? "QUARENTENA", estadoNovo: estado, hashFonte: f.hash,
        usuarioId: "SISTEMA:CORRECAO_DATA_PAGAMENTO", justificativa: JSON.stringify({
          motivoRemovido: CODIGO, motivoAnterior: t.quarentenaMotivo,
          criterio: "Tipo de pagamento confundido com data; valor pago zero e data ausente. Datas, valores e snapshot preservados.",
        }) } });
      if (estado === "ATIVO") resumo.liberados++; else if (estado === "QUARENTENA") resumo.outrasInconsistencias++; else resumo.pendentes++;
    }
    return resumo;
  }, { timeout: 60000, maxWait: 15000 });
}
