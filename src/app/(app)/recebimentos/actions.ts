"use server";

/**
 * Server actions do módulo /recebimentos.
 * Regra central: mês com FechamentoMensal é TRAVADO — toda mutação verifica
 * no servidor antes de tocar no banco (a UI apenas esconde os formulários).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { exigirPermissaoFinanceira } from "@/lib/autorizacao";
import { parseBRL } from "@/lib/dominio/dinheiro";
import {
  carregarProtecaoFinanceira,
  ErroProtecaoUnificacao,
  impedimentoGeracaoUnificada,
  impedimentoRecebimentoUnificado,
} from "@/lib/unificacao/protecao-financeira";
import {
  comissaoTotal,
  comissaoPorEmpreendimento,
} from "@/lib/dominio/comissao";
import {
  RE_MES,
  RE_DATA,
  VIAS_PAGAMENTO,
  taxaComissaoParaMes,
} from "@/lib/consultas/locacao";

// ---------- utilitários internos ----------

class ErroFechamentoMes extends Error {}

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
  await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
  const mes = campo(formData, "mes");
  if (!RE_MES.test(mes)) voltar(mes, { erro: "Mês inválido." });
  await exigirMesAberto(mes);

  const taxaBps = await taxaComissaoParaMes(mes);
  let resultado: { criados: number; bloqueados: number };
  try {
    resultado = await prisma.$transaction(async (tx) => {
      if (await tx.fechamentoMensal.findUnique({ where: { mesLancamento: mes } })) {
        throw new ErroProtecaoUnificacao("O mês foi fechado. Reabra-o antes de gerar cobranças.");
      }
      const [contratos, existentes, protecao] = await Promise.all([
        tx.contrato.findMany({ where: { status: "ativo" }, include: { unidade: true } }),
        tx.recebimento.findMany({ where: { OR: [{ mesLancamento: mes }, { competencia: mes }] }, select: { contratoId: true } }),
        carregarProtecaoFinanceira(tx),
      ]);
      const jaLancados = new Set(existentes.map((registro) => registro.contratoId));
      const candidatos = contratos.filter(c => c.valorBase + c.iptu + c.condominio > 0 && !jaLancados.has(c.id));
      const liberados = candidatos.filter(c => !impedimentoGeracaoUnificada(protecao, c.id, mes));
      const novos = liberados.map(c => ({
        contratoId: c.id, empreendimentoId: c.unidade.empreendimentoId,
        mesLancamento: mes, competencia: mes, valor: c.valorBase, iptu: c.iptu,
        cond: c.condominio, recebido: null, taxaComissaoBps: taxaBps,
      }));
      if (novos.length > 0) await tx.recebimento.createMany({ data: novos });
      return { criados: novos.length, bloqueados: candidatos.length - liberados.length };
    }, { maxWait: 15000, timeout: 60000 });
  } catch (erro) {
    if (erro instanceof ErroProtecaoUnificacao) voltar(mes, { erro: erro.message });
    throw erro;
  }
  if (resultado.criados > 0) revalidarLocacao();
  const bloqueados = resultado.bloqueados > 0
    ? ` ${resultado.bloqueados} contrato(s) aguardam conferência em Unificação por vínculo ou cobrança já existente no legado.`
    : "";
  voltar(mes, {
    ok: (resultado.criados > 0
      ? `${resultado.criados} lançamento(s) devido(s) gerado(s).`
      : "Nenhuma nova cobrança gerada.") + bloqueados,
  });
}

// ---------- 2. Registrar / editar recebimento ----------

export async function registrarRecebimento(formData: FormData): Promise<void> {
  await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
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

  const alterado = await prisma.recebimento.updateMany({
    where: {
      id,
      reservaEmissaoToken: null,
      boletos: { none: {} },
      pagamentos: { none: {} },
    },
    data: {
      recebido,
      dataPagamento: dataPagamento || null,
      competencia,
      via: viaValida(campo(formData, "via")),
      observacao: campo(formData, "observacao") || null,
    },
  });
  if (alterado.count !== 1) {
    voltar(
      mes,
      {
        erro:
          "O lançamento entrou em uma operação bancária. Faça a conferência em Boletos/Conciliação para preservar a auditoria.",
      },
      retorno,
    );
  }
  revalidarLocacao();
  voltar(mes, { ok: "Recebimento registrado." }, retorno);
}

/** Limpa o recebimento (volta a pendente); mantém os insumos do devido. */
export async function limparRecebimento(formData: FormData): Promise<void> {
  await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
  const retorno = retornoSeguro(formData);
  const id = campo(formData, "id");
  const lancamento = await prisma.recebimento.findUnique({ where: { id } });
  if (!lancamento) voltar("", { erro: "Lançamento não encontrado." }, retorno);
  await exigirMesAberto(lancamento.mesLancamento, retorno);

  const alterado = await prisma.$transaction(async tx => {
    const impedimento = impedimentoRecebimentoUnificado(await carregarProtecaoFinanceira(tx), id, "LIMPAR");
    if (impedimento) throw new ErroProtecaoUnificacao(impedimento);
    return tx.recebimento.updateMany({
      where: { id, reservaEmissaoToken: null, boletos: { none: {} }, pagamentos: { none: {} } },
      data: { recebido: null, dataPagamento: null, via: null },
    });
  }, { maxWait: 15000, timeout: 60000 }).catch(erro => {
    if (erro instanceof ErroProtecaoUnificacao) voltar(lancamento.mesLancamento, { erro: erro.message }, retorno);
    throw erro;
  });
  if (alterado.count !== 1) {
    voltar(
      lancamento.mesLancamento,
      {
        erro:
          "O lançamento possui histórico ou reserva bancária e não pode ser limpo aqui.",
      },
      retorno,
    );
  }
  revalidarLocacao();
  voltar(
    lancamento.mesLancamento,
    { ok: "Recebimento limpo — lançamento voltou a pendente." },
    retorno
  );
}

// ---------- 3. Excluir lançamento ----------

export async function excluirRecebimento(formData: FormData): Promise<void> {
  await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
  const retorno = retornoSeguro(formData);
  const id = campo(formData, "id");
  const lancamento = await prisma.recebimento.findUnique({ where: { id } });
  if (!lancamento) voltar("", { erro: "Lançamento não encontrado." }, retorno);
  await exigirMesAberto(lancamento.mesLancamento, retorno);

  const removido = await prisma.$transaction(async tx => {
    const impedimento = impedimentoRecebimentoUnificado(await carregarProtecaoFinanceira(tx), id, "EXCLUIR");
    if (impedimento) throw new ErroProtecaoUnificacao(impedimento);
    return tx.recebimento.deleteMany({
      where: { id, reservaEmissaoToken: null, boletos: { none: {} }, pagamentos: { none: {} } },
    });
  }, { maxWait: 15000, timeout: 60000 }).catch(erro => {
    if (erro instanceof ErroProtecaoUnificacao) voltar(lancamento.mesLancamento, { erro: erro.message }, retorno);
    throw erro;
  });
  if (removido.count !== 1) {
    voltar(
      lancamento.mesLancamento,
      {
        erro:
          "O lançamento possui histórico ou reserva bancária e não pode ser excluído.",
      },
      retorno,
    );
  }
  revalidarLocacao();
  voltar(lancamento.mesLancamento, { ok: "Lançamento excluído." }, retorno);
}

// ---------- Lançamento avulso ----------

export async function criarLancamentoAvulso(formData: FormData): Promise<void> {
  await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
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
  await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
  const mes = campo(formData, "mes");
  if (!RE_MES.test(mes)) voltar(mes, { erro: "Mês inválido." });

  try {
    await prisma.$transaction(async (tx) => {
      // A criação provisória é a primeira escrita e serializa o fechamento
      // contra uma baixa LIQUI concorrente. Qualquer erro abaixo reverte tudo.
      const fechamento = await tx.fechamentoMensal.create({
        data: { mesLancamento: mes, comissaoTotal: 0, detalhe: "[]" },
      });
      const pendenciasBancarias = await tx.boleto.count({
        where: {
          recebimento: { mesLancamento: mes },
          OR: [
            {
              status: {
                in: ["EMITINDO", "RESULTADO_DESCONHECIDO", "PAGAMENTO_REPORTADO"],
              },
            },
            { pagamentos: { some: { conciliadoEm: null } } },
          ],
        },
      });
      if (pendenciasBancarias > 0) {
        throw new ErroFechamentoMes(
          `${pendenciasBancarias} cobrança(s) bancária(s) ainda aguardam confirmação ou conciliação. Resolva-as antes de fechar o mês.`,
        );
      }
      const unificacao = await carregarProtecaoFinanceira(tx);
      const duplicatasConfirmadas = [...unificacao.porChave.values()]
        .filter(l => l.origem === "BRISA" && l.dominio === "RECEBER" && l.campos.mesLancamento?.valor === mes && l.estado === "VINCULADO" && unificacao.decisoesPorChave.get(l.chave)?.destinoChave?.startsWith("BRISA:"))
        .map(l => l.origemId);
      const recebimentos = await tx.recebimento.findMany({
        where: { mesLancamento: mes, id: { notIn: duplicatasConfirmadas } },
        include: { empreendimento: true },
        orderBy: [
          { empreendimento: { nome: "asc" } },
          { contrato: { unidade: { identificacao: "asc" } } },
        ],
      });
      if (recebimentos.length === 0) {
        throw new ErroFechamentoMes("Não há lançamentos neste mês para fechar.");
      }

      // Snapshot pela regra canônica — nunca recalculado à mão.
      const total = comissaoTotal(recebimentos);
      const matriz = comissaoPorEmpreendimento(recebimentos);
      const nomePorId = new Map(
        recebimentos.map((r) => [r.empreendimentoId, r.empreendimento.nome]),
      );
      const detalhe = Array.from(matriz.entries())
        .map(([empreendimentoId, porMes]) => ({
          empreendimento: nomePorId.get(empreendimentoId) ?? empreendimentoId,
          comissao: porMes.get(mes) ?? 0,
        }))
        .filter((item) => item.comissao !== 0)
        .sort((a, b) => a.empreendimento.localeCompare(b.empreendimento, "pt-BR"));

      await tx.fechamentoMensal.update({
        where: { id: fechamento.id },
        data: { comissaoTotal: total, detalhe: JSON.stringify(detalhe), unificacaoExcluidos: JSON.stringify(duplicatasConfirmadas) },
      });
    });
  } catch (erro) {
    if (erro instanceof ErroFechamentoMes) {
      voltar(mes, { erro: erro.message });
    }
    const jaFechado = await prisma.fechamentoMensal.findUnique({
      where: { mesLancamento: mes },
      select: { id: true },
    });
    if (jaFechado) voltar(mes, { erro: "Este mês já está fechado." });
    throw erro;
  }
  revalidarLocacao();
  voltar(mes, { ok: "Mês fechado — lançamentos travados." });
}

export async function reabrirMes(formData: FormData): Promise<void> {
  await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
  const mes = campo(formData, "mes");
  if (!RE_MES.test(mes)) voltar(mes, { erro: "Mês inválido." });

  const removidos = await prisma.fechamentoMensal.deleteMany({
    where: { mesLancamento: mes },
  });
  if (removidos.count === 0) voltar(mes, { erro: "Este mês não está fechado." });
  revalidarLocacao();
  voltar(mes, { ok: "Mês reaberto — lançamentos liberados para edição." });
}
