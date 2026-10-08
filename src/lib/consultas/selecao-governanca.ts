import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { prisma } from "../db";
import { exigirPermissaoAcesso } from "../acesso/servidor";
import { normalizar } from "../dominio/normalizacao";
import { carregarDadosFontesUnificacao, derivarFontesUnificacao } from "../unificacao/fontes";
import { projetarUnificados } from "../unificacao/reconciliacao";
import type { FonteUnificacao } from "../unificacao/tipos";

type TipoFinanceiro = "CAIXA" | "TITULO";
export type OpcaoFinanceiraGovernanca = {
  id: string; nome: string; data: string | null; competencia: string | null;
  origem: string; situacao: string; href: string | null;
};
export function filtrosSelecaoGovernanca(q?: string, mes?: string) {
  return { q: typeof q === "string" ? q.trim().slice(0, 120) : "", mes: typeof mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) ? mes : "" };
}

async function autorizar(tipo: TipoFinanceiro) {
  await exigirPermissaoAcesso("governanca.editar", { global: true });
  await exigirPermissaoAcesso("financeiro.ver", { global: true });
  await exigirPermissaoAcesso("cadastros.sensiveis", { global: true });
  if (tipo === "CAIXA") await exigirPermissaoAcesso("caixa.ver", { global: true });
}

// Cache só desta requisição. Inclui fontes excluídas para permitir a restauração
// pelo link já existente, sem entregar snapshots ou a operação inteira à UI.
const fotografia = cache(async () => {
  const [dados, decisoes, governados] = await prisma.$transaction(tx => Promise.all([
    carregarDadosFontesUnificacao(tx), tx.unificacaoRegistro.findMany(),
    tx.recursoGovernado.findMany({ select: { tipo: true, origemId: true, status: true } }),
  ]), { maxWait: 2000, timeout: 60000 });
  // Hashes, reconstrução da prova de planilhas e reconciliação não mantêm
  // a conexão SQLite reservada durante o trabalho em memória/arquivo.
  const fontes = await derivarFontesUnificacao(dados);
  const estados = new Map(governados.map(g => [`${g.tipo}:${g.origemId}`, g.status]));
  return { fontes, estados, linhas: projetarUnificados(fontes, decisoes) };
});

function compativel(f: FonteUnificacao, tipo: TipoFinanceiro) {
  return tipo === "CAIXA" ? f.dominio === "MOVIMENTO" && f.origem === "BRISA" : ["RECEBER", "PAGAR"].includes(f.dominio);
}

// Comissões continuam no módulo próprio, mesmo para quem pode consultá-las.
function reservado(f: FonteUnificacao) {
  const rotulos = [f.titulo, f.descricao, ...["categoria", "plano", "tipoCobranca", "descricao"].map(c => f.campos[c]?.valor ?? "")];
  return /COMISS|CORRETAG|HONORARI|TAXA.{0,24}ADMINISTR/.test(normalizar(rotulos.join(" ")));
}
function origem(f: FonteUnificacao) {
  if (f.origem === "WIDESYS") return "Widesys";
  if (typeof f.proveniencia?.arquivo === "string") {
    const aba = typeof f.proveniencia.aba === "string" ? ` · ${f.proveniencia.aba}` : "";
    return `Excel · ${f.proveniencia.arquivo}${aba}`;
  }
  return "Brisa · origem a confirmar";
}
function opcao(f: FonteUnificacao, tipo: TipoFinanceiro, situacao: string): OpcaoFinanceiraGovernanca {
  return { id: tipo === "CAIXA" ? f.origemId : f.chave, nome: f.titulo,
    data: f.vencimento ?? f.data ?? null, competencia: f.competencia ?? null,
    origem: origem(f), situacao, href: f.href };
}

export async function buscarFinanceirosGovernanca(tipo: TipoFinanceiro, parametros: {
  q?: string; mes?: string; mantido?: boolean; excluirId?: string; dominio?: string; excluidos?: boolean;
} = {}) {
  await autorizar(tipo);
  const filtros = filtrosSelecaoGovernanca(parametros.q, parametros.mes);
  const busca = normalizar(filtros.q);
  const { linhas, estados } = await fotografia();
  const filtradas = linhas.filter(f => {
    const id = tipo === "CAIXA" ? f.origemId : f.chave;
    if (!compativel(f, tipo) || reservado(f) || id === parametros.excluirId) return false;
    if (parametros.dominio && f.dominio !== parametros.dominio) return false;
    const inativo = (estados.get(`${tipo}:${id}`) ?? "ATIVO") !== "ATIVO";
    if (parametros.excluidos ? !inativo : inativo || f.estado === "VINCULADO" || f.estado === "AUSENTE") return false;
    if (parametros.mantido && (f.estado !== "ATIVO" || f.qualidade !== "OK")) return false;
    if (filtros.mes && (f.competencia ?? (f.vencimento ?? f.data)?.slice(0, 7)) !== filtros.mes) return false;
    return !busca || normalizar(`${f.titulo} ${f.descricao} ${origem(f)} ${f.caixaChave ?? ""} ${f.data ?? ""} ${f.competencia ?? ""}`).includes(busca);
  }).sort((a, b) => (b.vencimento ?? b.data ?? b.competencia ?? "").localeCompare(a.vencimento ?? a.data ?? a.competencia ?? "") || a.titulo.localeCompare(b.titulo, "pt-BR") || a.chave.localeCompare(b.chave));
  return { filtros, total: filtradas.length, itens: filtradas.slice(0, 30).map(f => opcao(f, tipo, estados.get(`${tipo}:${tipo === "CAIXA" ? f.origemId : f.chave}`) ?? f.estado)) };
}

export async function financeiroSelecionadoGovernanca(tipo: TipoFinanceiro, id: string) {
  await autorizar(tipo);
  if (!id || id.length > 250) notFound();
  const { fontes, estados } = await fotografia();
  const f = fontes.find(f => compativel(f, tipo) && (tipo === "CAIXA" ? f.origemId : f.chave) === id);
  if (!f || reservado(f)) notFound();
  return { ...opcao(f, tipo, estados.get(`${tipo}:${id}`) ?? "ATIVO"), dominio: f.dominio };
}
