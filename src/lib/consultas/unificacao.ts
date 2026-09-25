import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { perfilAtual, perfilPodeVerComissoes } from "../autorizacao";
import { prisma } from "../db";
import { normalizar } from "../dominio/normalizacao";
import { operacaoNaRequisicao } from "./operacao-na-requisicao";
import { dataOperacionalUnificada, mesOperacionalUnificado } from "../unificacao/periodo";
import { DOMINIOS_UNIFICACAO, type FiltrosUnificacao, type LinhaUnificada, type ListaUnificada } from "../unificacao/tipos";

const ler = cache(async () => {
  const perfil = await perfilAtual();
  if (!["ADMINISTRADOR", "FINANCEIRO"].includes(perfil)) notFound();
  return { ...(await operacaoNaRequisicao()), perfil };
});

const parametroReservado = (linha: LinhaUnificada) =>
  linha.dominio === "PARAMETRO" &&
  /COMISS|TAXA.{0,20}ADMINISTR/.test(normalizar(`${linha.titulo} ${linha.descricao}`));

export function hojeUnificacao(): string {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return ["year","month","day"].map(tipo => partes.find(p => p.type === tipo)?.value).join("-");
}
const venceu = (linha: LinhaUnificada, hoje: string) => !linha.cancelado && (linha.aberto ?? 0) > 0 && Boolean(linha.vencimento && linha.vencimento < hoje);

export async function listarUnificados(filtros: FiltrosUnificacao = {}): Promise<ListaUnificada> {
  const { linhas, decisoes, perfil } = await ler();
  const hoje = hojeUnificacao();
  const q = normalizar(filtros.q?.slice(0,120));
  const dominio = DOMINIOS_UNIFICACAO.find(d => d === filtros.dominio);
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(filtros.mes ?? "") ? filtros.mes : null;
  const de = /^\d{4}-\d{2}-\d{2}$/.test(filtros.de ?? "") ? filtros.de : null;
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(filtros.ate ?? "") ? filtros.ate : null;
  const universo = linhas.filter(l => {
    if (!perfilPodeVerComissoes(perfil) && parametroReservado(l)) return false;
    if (dominio && l.dominio !== dominio) return false;
    if (q && !normalizar(`${l.titulo} ${l.descricao} ${Object.values(l.campos).map(c => c.valor).join(" ")}`).includes(q)) return false;
    if (mes && mesOperacionalUnificado(l) !== mes) return false;
    const data = dataOperacionalUnificada(l);
    if (de && (!data || data < de)) return false;
    if (ate && (!data || data > ate)) return false;
    if (filtros.vencidos && !venceu(l,hoje)) return false;
    if (filtros.papel && !l.papeis?.includes(filtros.papel)) return false;
    return true;
  });
  const resumo: ListaUnificada["resumo"] = { ativos: 0, pendentes: 0, vinculados: 0, quarentena: 0, devido: 0, pago: 0, aberto: 0, devidoPendente: 0, pagoPendente: 0, abertoPendente: 0, entradas: 0, saidas: 0, vencidos: 0, valorVencido: 0 };
  for (const l of universo) {
    if (l.estado === "ATIVO") resumo.ativos++;
    if (l.estado === "VINCULADO") resumo.vinculados++;
    if (l.estado === "PENDENTE" || l.estado === "REVISAR") resumo.pendentes++;
    if (l.estado === "QUARENTENA") resumo.quarentena++;
    if ((l.estado === "PENDENTE" || l.estado === "REVISAR") && (l.dominio === "RECEBER" || l.dominio === "PAGAR") && !l.cancelado) {
      resumo.devidoPendente += l.valor ?? 0; resumo.pagoPendente += l.pago ?? 0; resumo.abertoPendente += l.aberto ?? 0;
    }
    if (!l.contabiliza) continue;
    if (l.dominio === "RECEBER" || l.dominio === "PAGAR") {
      resumo.devido += l.valor ?? 0; resumo.pago += l.pago ?? 0; resumo.aberto += l.aberto ?? 0;
      if (venceu(l,hoje)) { resumo.vencidos++; resumo.valorVencido += l.aberto ?? 0; }
    }
    if (l.dominio === "MOVIMENTO") {
      if (l.natureza === "ENTRADA") resumo.entradas += l.valor ?? 0;
      if (l.natureza === "SAIDA") resumo.saidas += l.valor ?? 0;
    }
  }
  const estados = ["ATIVO","PENDENTE","VINCULADO","QUARENTENA","REVISAR","AUSENTE"];
  const filtro = estados.includes(filtros.estado ?? "") ? filtros.estado : null;
  const resultado = universo.filter(l => filtro ? l.estado === filtro : l.estado !== "VINCULADO" && l.estado !== "AUSENTE").sort((a,b) => (b.vencimento ?? b.data ?? "").localeCompare(a.vencimento ?? a.data ?? "") || a.titulo.localeCompare(b.titulo,"pt-BR") || a.chave.localeCompare(b.chave));
  const porPagina = Number.isSafeInteger(filtros.porPagina) && filtros.porPagina! > 0 ? Math.min(filtros.porPagina!,100) : 25;
  const paginas = Math.max(1,Math.ceil(resultado.length/porPagina));
  const pagina = Math.min(Number.isSafeInteger(filtros.pagina) && filtros.pagina! > 0 ? filtros.pagina! : 1,paginas);
  return { itens: resultado.slice((pagina-1)*porPagina,pagina*porPagina), total: resultado.length, pagina, paginas, porPagina, resumo, sincronizado: decisoes.length > 0 };
}

export async function detalheUnificado(chave: string, buscaDestino?: string) {
  const { linhas, fontes, perfil } = await ler();
  const registro = linhas.find(l => l.chave === chave);
  if (!registro || (!perfilPodeVerComissoes(perfil) && parametroReservado(registro))) return null;
  const chaves = new Set(registro.candidatos.map(c => c.chave));
  const busca = normalizar(buscaDestino?.slice(0,120));
  const candidatos = linhas.filter(l => l.chave !== chave && l.dominio === registro.dominio && l.estado === "ATIVO" && (perfilPodeVerComissoes(perfil) || !parametroReservado(l)) && (!busca ? chaves.has(l.chave) : normalizar(`${l.titulo} ${l.descricao}`).includes(busca))).slice(0,100);
  const historico = await prisma.unificacaoDecisao.findMany({ where: { registroChave: chave }, orderBy: { criadoEm: "desc" }, take: 30, select: { acao: true, justificativa: true, criadoEm: true } });
  const chavesFonte = new Set(registro.fontes);
  const associadas = fontes.filter(f => chavesFonte.has(f.chave));
  // Detalhes financeiros ficam ligados ao título. As baixas não entram de novo
  // nos totais; a ligação reversa usa os IDs capturados pelo importador.
  const baixas = linhas.filter(l => l.dominio.startsWith("BAIXA_") && l.estado !== "VINCULADO" && l.estado !== "AUSENTE" && l.tituloChave && chavesFonte.has(l.tituloChave));
  return { registro, candidatos, fontes: associadas, historico, baixas };
}

export async function resumoUnificacao() {
  const [receber,pagar,movimentos,pessoas,contratos] = await Promise.all([
    listarUnificados({ dominio: "RECEBER", porPagina: 1 }), listarUnificados({ dominio: "PAGAR", porPagina: 1 }), listarUnificados({ dominio: "MOVIMENTO", porPagina: 1 }), listarUnificados({ dominio: "PESSOA", porPagina: 1 }), listarUnificados({ dominio: "CONTRATO", porPagina: 1 }),
  ]);
  return { receber: receber.resumo, pagar: pagar.resumo, movimentos: movimentos.resumo, pessoas: pessoas.resumo, contratos: contratos.resumo };
}
