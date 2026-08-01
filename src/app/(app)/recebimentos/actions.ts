"use server";

/**
 * Server actions do módulo /recebimentos.
 * Regra central: mês com FechamentoMensal é TRAVADO — toda mutação verifica
 * no servidor antes de tocar no banco (a UI apenas esconde os formulários).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseBRL } from "@/lib/dominio/dinheiro";
import {
  comissaoTotal,
  comissaoPorEmpreendimento,
} from "@/lib/dominio/comissao";
import {
  RE_MES,
  RE_DATA,
  VIAS_PAGAMENTO,
  recebimentosDoMes,
  taxaComissaoParaMes,
} from "@/lib/consultas/locacao";

// ---------- utilitários internos ----------

function campo(fd: FormData, nome: string): string {
  const v = fd.get(nome);
  return typeof v === "string" ? v.trim() : "";
}

function revalidarLocacao() {
  revalidatePath("/recebimentos");
  revalidatePath("/contratos", "layout");
}

/**
 * URL de retorno enviada pelo formulário — preserva o contexto de navegação
 * (período ?de/?ate, filtro ?emp) na conferência por período. Só aceita a
 * própria tela, para não virar redirect aberto.
 */
function retornoSeguro(fd: FormData): string | null {
  const r = campo(fd, "retorno");
  if (!r.startsWith("/recebimentos") || r.includes("//")) return null;
  return r;
}

/**
 * Redireciona de volta com aviso (erro ou ok). Com `retorno`, volta para a
 * MESMA visão de onde o usuário veio (período + filtro); no sucesso, fecha o
 * formulário (remove editar/excluir); no erro, mantém o formulário aberto
 * para corrigir. Nunca retorna.
 */
function voltar(
  mes: string,
  aviso: { erro?: string; ok?: string },
  retorno?: string | null
): never {
  if (retorno) {
    const url = new URL(retorno, "http://interno");
    if (aviso.erro) url.searchParams.set("erro", aviso.erro);
    if (aviso.ok) {
      url.searchParams.set("ok", aviso.ok);
      url.searchParams.delete("editar");
      url.searchParams.delete("excluir");
    }
    redirect(`${url.pathname}?${url.searchParams.toString()}`);
  }
  const p = new URLSearchParams();
  if (RE_MES.test(mes)) p.set("mes", mes);
  if (aviso.erro) p.set("erro", aviso.erro);
  if (aviso.ok) p.set("ok", aviso.ok);
  redirect(`/recebimentos?${p.toString()}`);
}

/** Recusa mutação em mês fechado (verificação NO SERVIDOR). */
async function exigirMesAberto(
  mes: string,
  retorno?: string | null
): Promise<void> {
  const fechamento = await prisma.fechamentoMensal.findUnique({
    where: { mesLancamento: mes },
  });
  if (fechamento) {
    voltar(
      mes,
      {
        erro: "Mês fechado — reabra o fechamento antes de alterar lançamentos.",
      },
      retorno
    );
  }
}

function viaValida(via: string): string | null {
  return (VIAS_PAGAMENTO as readonly string[]).includes(via) ? via : null;
}

// ---------- 1. Gerar devidos do mês ----------

/**
 * Para cada contrato ativo com valorBase+iptu+condominio > 0 que ainda não tem
 * lançamento no mês, cria o recebimento devido (recebido=null). Idempotente.
 */
export async function gerarDevidosDoMes(formData: FormData): Promise<void> {
  const mes = campo(formData, "mes");
  if (!RE_MES.test(mes)) voltar(mes, { erro: "Mês inválido." });
  await exigirMesAberto(mes);

  const [contratos, existentes, taxaBps] = await Promise.all([
    prisma.contrato.findMany({
      where: { status: "ativo" },
      include: { unidade: true },
    }),
    prisma.recebimento.findMany({
      where: { mesLancamento: mes },
      select: { contratoId: true },
    }),
    taxaComissaoParaMes(mes),
  ]);
  const jaLancados = new Set(existentes.map((r) => r.contratoId));

  const novos = contratos
    .filter(
      (c) => c.valorBase + c.iptu + c.condominio > 0 && !jaLancados.has(c.id)
    )
    .map((c) => ({
      contratoId: c.id,
      empreendimentoId: c.unidade.empreendimentoId,
      mesLancamento: mes,
      competencia: mes,
      valor: c.valorBase,
      iptu: c.iptu,
      cond: c.condominio,
      recebido: null,
      taxaComissaoBps: taxaBps,
    }));

  if (novos.length > 0) {
    await prisma.recebimento.createMany({ data: novos });
    revalidarLocacao();
  }
  voltar(mes, {
    ok:
      novos.length > 0
        ? `${novos.length} lançamento(s) devido(s) gerado(s).`
        : "Nada a gerar — todos os contratos ativos já têm lançamento no mês.",
  });
}

// ---------- 2. Registrar / editar recebimento ----------

export async function registrarRecebimento(formData: FormData): Promise<void> {
  const retorno = retornoSeguro(formData);
  const id = campo(formData, "id");
  const lancamento = await prisma.recebimento.findUnique({ where: { id } });
  if (!lancamento) voltar("", { erro: "Lançamento não encontrado." }, retorno);
  const mes = lancamento.mesLancamento;
  await exigirMesAberto(mes, retorno);

  const recebido = parseBRL(campo(formData, "recebido"));
  if (recebido === null) {
    voltar(mes, { erro: "Informe o valor recebido (ex.: 1.234,56)." }, retorno);
  }

  const dataPagamento = campo(formData, "dataPagamento");
  if (dataPagamento && !RE_DATA.test(dataPagamento)) {
    voltar(mes, { erro: "Data de pagamento inválida." }, retorno);
  }
  const competencia = campo(formData, "competencia") || lancamento.competencia;
  if (!RE_MES.test(competencia)) {
    voltar(mes, { erro: "Competência inválida (use AAAA-MM)." }, retorno);
  }

  await prisma.recebimento.update({
    where: { id },
    data: {
      recebido,
      dataPagamento: dataPagamento || null,
      competencia,
      via: viaValida(campo(formData, "via")),
      observacao: campo(formData, "observacao") || null,
    },
  });
  revalidarLocacao();
  voltar(mes, { ok: "Recebimento registrado." }, retorno);
}

/** Limpa o recebimento (volta a pendente); mantém os insumos do devido. */
export async function limparRecebimento(formData: FormData): Promise<void> {
  const retorno = retornoSeguro(formData);
  const id = campo(formData, "id");
  const lancamento = await prisma.recebimento.findUnique({ where: { id } });
  if (!lancamento) voltar("", { erro: "Lançamento não encontrado." }, retorno);
  await exigirMesAberto(lancamento.mesLancamento, retorno);

  await prisma.recebimento.update({
    where: { id },
    data: { recebido: null, dataPagamento: null, via: null },
  });
  revalidarLocacao();
  voltar(
    lancamento.mesLancamento,
    { ok: "Recebimento limpo — lançamento voltou a pendente." },
    retorno
  );
}

// ---------- 3. Excluir lançamento ----------

export async function excluirRecebimento(formData: FormData): Promise<void> {
  const retorno = retornoSeguro(formData);
  const id = campo(formData, "id");
  const lancamento = await prisma.recebimento.findUnique({ where: { id } });
  if (!lancamento) voltar("", { erro: "Lançamento não encontrado." }, retorno);
  await exigirMesAberto(lancamento.mesLancamento, retorno);

  await prisma.recebimento.delete({ where: { id } });
  revalidarLocacao();
  voltar(lancamento.mesLancamento, { ok: "Lançamento excluído." }, retorno);
}

// ---------- Lançamento avulso ----------

export async function criarLancamentoAvulso(formData: FormData): Promise<void> {
  const mes = campo(formData, "mes");
  if (!RE_MES.test(mes)) voltar(mes, { erro: "Mês inválido." });
  await exigirMesAberto(mes);

  const contratoId = campo(formData, "contratoId");
  const contrato = contratoId
    ? await prisma.contrato.findUnique({
        where: { id: contratoId },
        include: { unidade: true },
      })
    : null;
  if (!contrato) voltar(mes, { erro: "Selecione o contrato do lançamento." });

  const competencia = campo(formData, "competencia") || mes;
  if (!RE_MES.test(competencia)) {
    voltar(mes, { erro: "Competência inválida (use AAAA-MM)." });
  }
  const dataPagamento = campo(formData, "dataPagamento");
  if (dataPagamento && !RE_DATA.test(dataPagamento)) {
    voltar(mes, { erro: "Data de pagamento inválida." });
  }

  // Campos em branco herdam os valores do contrato (digite 0 para zerar).
  const valor = parseBRL(campo(formData, "valor")) ?? contrato.valorBase;
  const iptu = parseBRL(campo(formData, "iptu")) ?? contrato.iptu;
  const cond = parseBRL(campo(formData, "cond")) ?? contrato.condominio;
  const recebido = parseBRL(campo(formData, "recebido")); // null = ainda não recebido

  await prisma.recebimento.create({
    data: {
      contratoId: contrato.id,
      empreendimentoId: contrato.unidade.empreendimentoId,
      mesLancamento: mes,
      competencia,
      valor,
      iptu,
      cond,
      recebido,
      dataPagamento: recebido !== null && dataPagamento ? dataPagamento : null,
      via: recebido !== null ? viaValida(campo(formData, "via")) : null,
      taxaComissaoBps: await taxaComissaoParaMes(mes),
      observacao: campo(formData, "observacao") || null,
    },
  });
  revalidarLocacao();
  voltar(mes, { ok: "Lançamento avulso criado." });
}

// ---------- 4. Fechar / reabrir mês ----------

export async function fecharMes(formData: FormData): Promise<void> {
  const mes = campo(formData, "mes");
  if (!RE_MES.test(mes)) voltar(mes, { erro: "Mês inválido." });

  const jaFechado = await prisma.fechamentoMensal.findUnique({
    where: { mesLancamento: mes },
  });
  if (jaFechado) voltar(mes, { erro: "Este mês já está fechado." });

  const recebimentos = await recebimentosDoMes(mes);
  if (recebimentos.length === 0) {
    voltar(mes, { erro: "Não há lançamentos neste mês para fechar." });
  }

  // Snapshot pela regra canônica — nunca recalculado à mão.
  const total = comissaoTotal(recebimentos);
  const matriz = comissaoPorEmpreendimento(recebimentos);
  const nomePorId = new Map(
    recebimentos.map((r) => [r.empreendimentoId, r.empreendimento.nome])
  );
  const detalhe = Array.from(matriz.entries())
    .map(([empreendimentoId, porMes]) => ({
      empreendimento: nomePorId.get(empreendimentoId) ?? empreendimentoId,
      comissao: porMes.get(mes) ?? 0,
    }))
    .filter((d) => d.comissao !== 0)
    .sort((a, b) => a.empreendimento.localeCompare(b.empreendimento, "pt-BR"));

  await prisma.fechamentoMensal.create({
    data: {
      mesLancamento: mes,
      comissaoTotal: total,
      detalhe: JSON.stringify(detalhe),
    },
  });
  revalidarLocacao();
  voltar(mes, { ok: "Mês fechado — lançamentos travados." });
}

export async function reabrirMes(formData: FormData): Promise<void> {
  const mes = campo(formData, "mes");
  if (!RE_MES.test(mes)) voltar(mes, { erro: "Mês inválido." });

  const removidos = await prisma.fechamentoMensal.deleteMany({
    where: { mesLancamento: mes },
  });
  if (removidos.count === 0) voltar(mes, { erro: "Este mês não está fechado." });
  revalidarLocacao();
  voltar(mes, { ok: "Mês reaberto — lançamentos liberados para edição." });
}
