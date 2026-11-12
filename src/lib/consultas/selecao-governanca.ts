import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { prisma } from "../db";
import { exigirPermissaoAcesso } from "../acesso/servidor";
import { normalizar } from "../dominio/normalizacao";
import { carregarDadosFontesUnificacao, derivarFontesUnificacao } from "../unificacao/fontes";
import { projetarFinanceiroWidesys } from "../unificacao/projecao-widesys";
import type { FonteUnificacao } from "../unificacao/tipos";
import { contemComissaoRestrita } from "../despesas/sigilo";

export type OpcaoFinanceiraGovernanca = {
  id: string; nome: string; data: string | null; competencia: string | null;
  origem: string; situacao: string; href: string | null;
};
export function filtrosSelecaoGovernanca(q?: string, mes?: string) {
  return { q: typeof q === "string" ? q.trim().slice(0, 120) : "", mes: typeof mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) ? mes : "" };
}

async function autorizar() {
  const acesso = await exigirPermissaoAcesso("governanca.editar", { global: true });
  await exigirPermissaoAcesso("financeiro.ver", { global: true });
  await exigirPermissaoAcesso("cadastros.sensiveis", { global: true });
  return acesso;
}

// Inclui títulos Widesys excluídos para o administrador poder restaurá-los.
const fotografia = cache(async () => {
  const [dados, decisoes, governados] = await prisma.$transaction(tx => Promise.all([
    carregarDadosFontesUnificacao(tx, undefined, false), tx.unificacaoRegistro.findMany(),
    tx.recursoGovernado.findMany({ where: { tipo: "TITULO" }, select: { tipo: true, origemId: true, status: true } }),
  ]), { maxWait: 2000, timeout: 60000 });
  const { linhas } = projetarFinanceiroWidesys(await derivarFontesUnificacao(dados, false), decisoes);
  const titulos = linhas.filter(l => l.origem === "WIDESYS" && (l.dominio === "RECEBER" || l.dominio === "PAGAR"));
  const estados = new Map(governados.map(g => [g.origemId, g.status]));
  return { titulos, estados };
});

function reservado(f: FonteUnificacao, perfil: string) {
  const rotulos = [f.titulo, f.descricao, ...["categoria", "plano", "tipoCobranca", "descricao"].map(c => f.campos[c]?.valor ?? "")];
  return (f.restrito && perfil !== "ADMINISTRADOR") || contemComissaoRestrita(rotulos.map(String));
}

function opcao(f: FonteUnificacao, situacao: string): OpcaoFinanceiraGovernanca {
  return { id: f.chave, nome: f.titulo, data: f.vencimento ?? f.data ?? null, competencia: f.competencia ?? null,
    origem: "Widesys", situacao, href: f.href };
}

export async function buscarFinanceirosGovernanca(parametros: { q?: string; mes?: string; excluidos?: boolean } = {}) {
  const acesso = await autorizar();
  const filtros = filtrosSelecaoGovernanca(parametros.q, parametros.mes);
  const busca = normalizar(filtros.q);
  const { titulos, estados } = await fotografia();
  const filtradas = titulos.filter(f => {
    if (reservado(f, acesso.perfil)) return false;
    const inativo = (estados.get(f.chave) ?? "ATIVO") !== "ATIVO";
    if (parametros.excluidos ? !inativo : inativo || f.estado === "AUSENTE") return false;
    if (filtros.mes && (f.competencia ?? (f.vencimento ?? f.data)?.slice(0, 7)) !== filtros.mes) return false;
    return !busca || normalizar(`${f.titulo} ${f.descricao} ${f.data ?? ""} ${f.competencia ?? ""}`).includes(busca);
  }).sort((a, b) => (b.vencimento ?? b.data ?? b.competencia ?? "").localeCompare(a.vencimento ?? a.data ?? a.competencia ?? "") || a.titulo.localeCompare(b.titulo, "pt-BR") || a.chave.localeCompare(b.chave));
  return { filtros, total: filtradas.length, itens: filtradas.slice(0, 30).map(f => opcao(f, estados.get(f.chave) ?? f.estado)) };
}

export async function financeiroSelecionadoGovernanca(id: string) {
  const acesso = await autorizar();
  if (!id || id.length > 250) notFound();
  const { titulos, estados } = await fotografia();
  const f = titulos.find(t => t.chave === id);
  if (!f || reservado(f, acesso.perfil)) notFound();
  return opcao(f, estados.get(id) ?? f.estado);
}
