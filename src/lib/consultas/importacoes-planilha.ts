import "server-only";

import { notFound } from "next/navigation";
import { perfilAtual } from "../autorizacao";
import { prisma } from "../db";

const ESTADOS = ["IMPORTADO", "JA_EXISTENTE", "PENDENTE"] as const;
export type EstadoImportacaoPlanilha = typeof ESTADOS[number];
type Parametros = Record<string, string | string[] | undefined>;

const loteSelect = {
  id: true, arquivo: true, hashArquivo: true, versao: true, status: true,
  criadoEm: true, controles: true, _count: { select: { linhas: true } },
} as const;
const linhaSelect = {
  id: true, loteId: true, aba: true, linha: true, faixa: true, status: true, reservado: true,
  lote: { select: { arquivo: true } },
} as const;
const conteudoSelect = {
  id: true, caixaOrigem: true, mesReferencia: true, data: true, centroCusto: true, tipo: true,
  valor: true, descricao: true, categoria: true, cliente: true, local: true,
  lancamentoCaixaId: true,
} as const;

function primeiro(valor: string | string[] | undefined) {
  return Array.isArray(valor) ? valor[0] : valor;
}

export function filtrosImportacaoPlanilha(parametros: Parametros) {
  const numero = Number(primeiro(parametros.pagina));
  const estado = primeiro(parametros.status);
  return {
    lote: (primeiro(parametros.lote) ?? "").slice(0, 128),
    status: ESTADOS.includes(estado as EstadoImportacaoPlanilha) ? estado as EstadoImportacaoPlanilha : "",
    pagina: Number.isSafeInteger(numero) && numero > 0 ? numero : 1,
    porPagina: primeiro(parametros.limite) === "50" ? 50 : 30,
  };
}

async function autorizar() {
  // O papel é lido novamente no servidor, antes de qualquer consulta da carga.
  if ((await perfilAtual()) !== "ADMINISTRADOR") notFound();
}

/** Somente referências estruturais: os campos livres reservados nem são lidos. */
function identidade(linha: {
  id: string; loteId: string; aba: string; linha: number; faixa: string;
  status: string; reservado: boolean; lote: { arquivo: string };
}) {
  return {
    id: linha.id, loteId: linha.loteId, arquivo: linha.lote.arquivo,
    linha: linha.linha, status: linha.status, reservado: linha.reservado,
    // A aba também pode revelar o período de uma informação reservada.
    aba: linha.reservado ? null : linha.aba,
    faixa: linha.reservado ? null : linha.faixa,
  };
}

export async function listarImportacoesPlanilha(parametros: Parametros) {
  await autorizar();
  const filtros = filtrosImportacaoPlanilha(parametros);
  const escopo = filtros.lote ? { loteId: filtros.lote } : {};
  const where = { ...escopo, ...(filtros.status ? { status: filtros.status } : {}) };
  const [lotes, totalLotes, contagens, quantidade] = await Promise.all([
    prisma.importacaoPlanilhaLote.findMany({ select: loteSelect, orderBy: [{ criadoEm: "desc" }, { id: "asc" }], take: 50 }),
    prisma.importacaoPlanilhaLote.count(),
    prisma.importacaoPlanilhaLinha.groupBy({ by: ["status", "reservado"], where: escopo, _count: { _all: true } }),
    prisma.importacaoPlanilhaLinha.count({ where }),
  ]);
  if (filtros.lote && !lotes.some(lote => lote.id === filtros.lote)) {
    const escolhido = await prisma.importacaoPlanilhaLote.findUnique({ where: { id: filtros.lote }, select: loteSelect });
    if (!escolhido) notFound();
    lotes.push(escolhido);
  }
  const totalPaginas = Math.max(1, Math.ceil(quantidade / filtros.porPagina));
  filtros.pagina = Math.min(filtros.pagina, totalPaginas);
  const registros = await prisma.importacaoPlanilhaLinha.findMany({
    where, select: linhaSelect,
    orderBy: [{ criadoEm: "desc" }, { loteId: "asc" }, { aba: "asc" }, { linha: "asc" }, { faixa: "asc" }, { id: "asc" }],
    skip: (filtros.pagina - 1) * filtros.porPagina, take: filtros.porPagina,
  });
  const ids = registros.filter(linha => !linha.reservado).map(linha => linha.id);
  const conteudos = ids.length ? await prisma.importacaoPlanilhaLinha.findMany({
    where: { id: { in: ids }, reservado: false }, select: conteudoSelect,
  }) : [];
  const porId = new Map(conteudos.map(linha => [linha.id, linha]));
  const totais = { linhas: 0, importados: 0, existentes: 0, pendentes: 0, reservados: 0 };
  for (const grupo of contagens) {
    const numero = grupo._count._all;
    totais.linhas += numero;
    if (grupo.reservado) totais.reservados += numero;
    if (grupo.status === "IMPORTADO") totais.importados += numero;
    if (grupo.status === "JA_EXISTENTE") totais.existentes += numero;
    if (grupo.status === "PENDENTE") totais.pendentes += numero;
  }
  return {
    // Controles podem conter totais reservados; somente suas contagens saem da consulta.
    lotes: lotes.map(({ controles, ...lote }) => ({ ...lote, controles: resumirControlesImportacao(controles) })),
    totalLotes, totais, filtros, quantidade, totalPaginas,
    linhas: registros.map(linha => ({
      ...identidade(linha), conteudo: linha.reservado ? null : porId.get(linha.id) ?? null,
    })),
  };
}

export function listaTextosImportacao(json: string): string[] {
  try {
    const valor: unknown = JSON.parse(json);
    return Array.isArray(valor) ? valor.filter((item): item is string => typeof item === "string").slice(0, 100) : [];
  } catch { return []; }
}

export function resumirControlesImportacao(json: string | null | undefined) {
  const resumo = { total: 0, divergencias: 0, semResultado: 0, formulasNaoConferidas: 0, ilegivel: false };
  try {
    const controles: unknown = JSON.parse(json ?? "[]");
    if (!Array.isArray(controles)) return { ...resumo, ilegivel: true };
    for (const item of controles) {
      resumo.total++;
      if (!item || typeof item !== "object" || Array.isArray(item)) { resumo.ilegivel = true; continue; }
      const controle = item as Record<string, unknown>;
      const motivos = Array.isArray(controle.motivos) ? controle.motivos : [];
      if (motivos.includes("CONTROLE_DIVERGENTE")) resumo.divergencias++;
      if (motivos.includes("CONTROLE_SEM_RESULTADO_VALIDO")) resumo.semResultado++;
      if (typeof controle.formula === "string" && typeof controle.valorCalculado !== "number") resumo.formulasNaoConferidas++;
    }
    return resumo;
  } catch { return { ...resumo, ilegivel: true }; }
}

const MOTIVOS: Record<string, string> = {
  ABA_AUXILIAR_CONFERIR: "Informação em coluna ou tabela auxiliar: a natureza operacional precisa de comprovação.",
  ABA_OU_TABELA_AUXILIAR: "Conteúdo identificado em uma tabela auxiliar.",
  VALOR_FORA_FAIXA_TRANSACIONAL: "O valor está fora das colunas principais de movimentação. Confirme a conta e o significado antes de somá-lo.",
  CONTEUDO_REPETIDO_NA_CARGA: "Conteúdo repetido dentro desta carga; conferir a origem antes de somar.",
  PROVENIENCIA_ANTERIOR_CONFIRMADA: "O mesmo lançamento já existe, com origem anterior comprovada. Nenhuma nova soma foi criada.",
  DESTINO_ANTERIOR_ALTERADO_OU_AUSENTE: "O lançamento reconhecido na carga anterior foi alterado ou não está mais disponível.",
  POSICAO_DA_ORIGEM_ALTERADA: "A posição na planilha já foi importada com outro conteúdo.",
  MES_NAO_COMPROVADO: "Não foi possível comprovar o mês de referência.",
  PERIODO_AUSENTE: "A origem não informa um período comprovável.",
  DATA_NAO_COMPROVADA: "Não foi possível comprovar a data do lançamento.",
  DATA_AUSENTE: "A data não foi preenchida na origem.",
  DATA_INVALIDA: "A origem contém uma data inválida.",
  DATA_FUTURA_CONFERIR: "A data é futura em relação à carga; conferir se o movimento já foi realizado.",
  DATA_FORA_DO_PERIODO: "A data do lançamento não corresponde ao mês da aba.",
  DATA_FORA_PERIODO: "A data do lançamento não corresponde ao período informado.",
  VALOR_NAO_IMPORTAVEL: "O valor não atende aos critérios de um lançamento operacional.",
  VALOR_INVALIDO_OU_AUSENTE: "O valor está ausente ou inválido na origem.",
  VALOR_NAO_POSITIVO: "O valor não é positivo e precisa de conferência.",
  FORMULA_NAO_ARITMETICA: "A fórmula depende de referências que precisam de conferência.",
  FORMULA_CACHE_DIVERGENTE: "O resultado salvo na planilha diverge do cálculo da fórmula.",
  MES_FECHADO: "O mês já está fechado. O histórico não foi alterado.",
  DESCRICAO_AUSENTE: "Falta uma descrição para identificar o lançamento.",
  TRANSFERENCIA_OU_PATRIMONIO_CONFERIR: "Pode ser transferência, aplicação, saldo ou operação patrimonial, e não uma receita ou despesa.",
  REALIZACAO_NAO_COMPROVADA: "A descrição indica previsão ou pendência de pagamento; a realização precisa ser comprovada.",
  POSSIVEL_DUPLICIDADE: "Há registros semelhantes. Compare data, histórico, conta e origem antes de decidir se são o mesmo fato.",
  ORIGEM_REQUER_CONFERENCIA: "A origem precisa de conferência antes de participar da operação.",
};

export function motivosPublicosImportacao(json: string): string[] {
  return [...new Set(listaTextosImportacao(json).map(codigo => MOTIVOS[codigo] ?? "Existe uma condição de conferência não detalhada nesta tela. Consulte a origem."))];
}

export async function detalheImportacaoPlanilha(id: string) {
  await autorizar();
  const registro = await prisma.importacaoPlanilhaLinha.findUnique({ where: { id }, select: linhaSelect });
  if (!registro) notFound();
  const base = identidade(registro);
  if (registro.reservado) return { ...base, detalhe: null };
  // Mesmo nesta segunda leitura o predicado impede carregar conteúdo reservado.
  const detalhe = await prisma.importacaoPlanilhaLinha.findFirst({
    where: { id, reservado: false },
    select: { ...conteudoSelect, celulas: true, hashConteudo: true, motivos: true, candidatos: true },
  });
  if (!detalhe) return { ...base, reservado: true, aba: null, faixa: null, detalhe: null };
  return { ...base, detalhe: {
    ...detalhe,
    motivos: motivosPublicosImportacao(detalhe.motivos),
    candidatos: listaTextosImportacao(detalhe.candidatos).filter(chave => /^(BRISA|WIDESYS):(MOVIMENTO|BAIXA_RECEBER):[a-zA-Z0-9_-]+$/.test(chave)),
  } };
}
