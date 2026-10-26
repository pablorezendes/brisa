import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { carteiraIrrestrita, perfilSomenteLeitura, pode, type PoliticaAcesso } from "../acesso/politica";
import { carregarDadosFontesUnificacao, derivarFontesUnificacao } from "../unificacao/fontes";
import { projetarUnificados } from "../unificacao/reconciliacao";
import { filtrarFontesGovernadas } from "../governanca/filtros";
import type { DecisaoUnificacao } from "../unificacao/tipos";
import { contemComissaoRestrita } from "../despesas/sigilo";

export type CustoEmpreendimento = { empreendimentoId: string; empreendimento: string; competencia: string; valor: number; parcelas: number };
export type ResumoRateios = { custos: CustoEmpreendimento[]; total: number; notasConferidas: number; notasPendentes: number };
const vazio = (): ResumoRateios => ({ custos: [], total: 0, notasConferidas: 0, notasPendentes: 0 });
const ids = (p: PoliticaAcesso, tipo: string, efeito: string) => p.regras.filter(r => r.tipo === tipo && r.efeito === efeito).map(r => r.recursoId);

/** Custos sem imóvel exigem o empreendimento liberado, não apenas uma unidade dele. */
export function filtroRateiosCarteira(p: PoliticaAcesso): Prisma.DespesaRateioWhereInput {
  return { AND: [
    { empreendimento: { ativo: true }, empreendimentoId: { notIn: ids(p, "EMPREENDIMENTO", "BLOQUEAR") } },
    { OR: [{ unidadeId: null }, { unidade: { ativo: true }, unidadeId: { notIn: ids(p, "UNIDADE", "BLOQUEAR") } }] },
    p.global ? {} : { OR: [{ empreendimentoId: { in: ids(p, "EMPREENDIMENTO", "PERMITIR") } }, { unidadeId: { in: ids(p, "UNIDADE", "PERMITIR") } }] },
  ] };
}

/** Uma fotografia consistente: rateios nunca se somam à nota ou ao fluxo de caixa.
 * O DTO compartilhável contém somente agregados da parcela autorizada.
 */
export async function consultarResumoRateios(db: PrismaClient, p: PoliticaAcesso, mes?: string): Promise<ResumoRateios> {
  const operacional = carteiraIrrestrita(p) && !perfilSomenteLeitura(p) && pode(p, "despesas.ver");
  if (!operacional && !(pode(p, "carteira.ver") && pode(p, "financeiro.ver"))) return vazio();
  if ((mes && !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) || (!operacional && !mes)) throw new Error("Informe uma competência válida.");
  const [documentos, parcelas, dadosFontes, decisoes, governados, fontesLegadas] = await db.$transaction(tx => Promise.all([
    tx.despesaDocumento.findMany({ where: { destinoCusto: "EMPREENDIMENTOS", ...(mes ? { competencia: mes } : {}), ...(operacional ? {} : { rateios: { some: filtroRateiosCarteira(p) } }) }, select: {
      id: true, origemChave: true, origemHash: true, total: true, statusRateio: true, competencia: true, restrita: true,
      rateios: { select: { valor: true, empreendimentoId: true, unidadeId: true,
        empreendimento: { select: { ativo: true } }, unidade: { select: { ativo: true, empreendimentoId: true } } } },
    } }),
    tx.despesaRateio.findMany({ where: { AND: [filtroRateiosCarteira(p), ...(mes ? [{ despesa: { competencia: mes } }] : [])] }, select: {
      id: true, despesaId: true, empreendimentoId: true, valor: true, categoria: true, descricao: true,
      empreendimento: { select: { nome: true } }, unidadeId: true, unidade: { select: { empreendimentoId: true } },
    } }),
    carregarDadosFontesUnificacao(tx, "PAGAR"),
    tx.unificacaoRegistro.findMany({ where: { dominio: "PAGAR" } }),
    tx.recursoGovernado.findMany({ where: { tipo: { in: ["TITULO", "EMPREENDIMENTO", "UNIDADE", "CAIXA"] } }, select: { tipo: true, origemId: true, status: true } }),
    tx.tituloFinanceiroLegado.findMany({ where: { natureza: "PAGAR", origem: "WIDESYS" }, select: { id: true, snapshotHash: true, planoContaRotulo: true, tipoCobrancaRotulo: true } }),
  ]), { maxWait: 2000, timeout: 20000 });
  const fontes = filtrarFontesGovernadas((await derivarFontesUnificacao(dadosFontes)).filter(f => f.dominio === "PAGAR"), governados);
  const linhas = new Map(projetarUnificados(fontes, decisoes as DecisaoUnificacao[]).map(l => [l.chave, l]));
  const hashes = new Map(fontesLegadas.map(f => [`WIDESYS:PAGAR:${f.id}`, f.snapshotHash]));
  const fontesRestritas = new Set(fontesLegadas.filter(f => contemComissaoRestrita([f.planoContaRotulo, f.tipoCobrancaRotulo])).map(f => `WIDESYS:PAGAR:${f.id}`));
  // O sigilo é persistente: remover a descrição de comissão não torna seus
  // valores históricos compartilháveis nem expõe o restante da nota por soma.
  const documentosVisiveis = documentos.filter(d => p.perfil === "ADMINISTRADOR" || (!d.restrita && (!d.origemChave || !fontesRestritas.has(d.origemChave))));
  const excluidos = new Set(governados.filter(g => g.status !== "ATIVO").map(g => `${g.tipo}:${g.origemId}`));
  const elegiveis = documentosVisiveis.filter(d => {
    const chave = d.origemChave ?? `BRISA:PAGAR:${d.id}`;
    const linha = linhas.get(chave);
    // Se um imóvel mudou de empreendimento, a divisão inteira precisa ser
    // reconferida. Publicar só o restante daria aparência de nota conferida
    // enquanto o custo distribuído não fecha com o documento.
    const destinosValidos = d.rateios.every(r => r.empreendimento.ativo && !excluidos.has(`EMPREENDIMENTO:${r.empreendimentoId}`)
      && (!r.unidadeId || (r.unidade?.ativo && r.unidade.empreendimentoId === r.empreendimentoId && !excluidos.has(`UNIDADE:${r.unidadeId}`))));
    return d.statusRateio === "CONFERIDO" && destinosValidos && d.rateios.length > 0 && d.rateios.reduce((s, r) => s + r.valor, 0) === d.total
      && !!linha?.contabiliza && !linha.cancelado && linha.valor === d.total
      && (!d.origemChave || hashes.get(d.origemChave) === d.origemHash);
  });
  const porDocumento = new Map(elegiveis.map(d => [d.id, d]));
  const grupos = new Map<string, CustoEmpreendimento>();
  const notasVisiveis = new Set<string>();
  for (const r of parcelas) {
    const d = porDocumento.get(r.despesaId);
    if (!d || excluidos.has(`EMPREENDIMENTO:${r.empreendimentoId}`) || (r.unidadeId && (excluidos.has(`UNIDADE:${r.unidadeId}`) || r.unidade?.empreendimentoId !== r.empreendimentoId))) continue;
    // Comissões seguem restritas mesmo se classificadas como despesas.
    if (p.perfil !== "ADMINISTRADOR" && contemComissaoRestrita([r.categoria, r.descricao])) continue;
    const chave = `${r.empreendimentoId}:${d.competencia}`;
    const grupo = grupos.get(chave) ?? { empreendimentoId: r.empreendimentoId, empreendimento: r.empreendimento.nome, competencia: d.competencia, valor: 0, parcelas: 0 };
    grupo.valor += r.valor; grupo.parcelas += 1;
    grupos.set(chave, grupo); notasVisiveis.add(d.id);
  }
  const custos = [...grupos.values()].sort((a, b) => b.competencia.localeCompare(a.competencia) || a.empreendimento.localeCompare(b.empreendimento, "pt-BR"));
  return { custos, total: custos.reduce((s, c) => s + c.valor, 0), notasConferidas: notasVisiveis.size,
    // Nenhuma contagem de documentos de outras carteiras é compartilhada.
    notasPendentes: operacional ? documentosVisiveis.filter(d => !porDocumento.has(d.id) && !excluidos.has(`TITULO:${d.origemChave ?? `BRISA:PAGAR:${d.id}`}`)).length : 0 };
}
