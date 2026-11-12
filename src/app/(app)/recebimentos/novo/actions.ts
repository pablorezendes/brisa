"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { exigirPermissaoFinanceira } from "@/lib/autorizacao";
import { prisma } from "@/lib/db";
import { taxaComissaoParaMes } from "@/lib/consultas/locacao";
import { recursoEstaAtivo } from "@/lib/governanca/filtros";
import { campoLancamento, dataLancamentoValida, idLancamentoValido, valorLancamento } from "@/lib/dominio/lancamento-manual";
import { validarRetornoFinanceiro } from "@/lib/interface/contexto-financeiro";
import { contemComissaoRestrita } from "@/lib/despesas/sigilo";

const VIAS = new Set(["PIX", "BOLETO", "DINHEIRO", "TRANSFERENCIA"]);

function registrarEntrada(tx: Prisma.TransactionClient, entrada: { id: string; recebimentoId: string; data: string; valor: number; descricao: string }) {
  return tx.lancamentoCaixa.create({
    data: {
      id: entrada.id, recebimentoManualId: entrada.recebimentoId, mesReferencia: entrada.data.slice(0, 7),
      centroCusto: "GERAL", tipo: "ENTRADA", data: entrada.data, valor: entrada.valor,
      descricao: `Recebimento · ${entrada.descricao}`, criadoManualBrisa: true,
    },
    select: { id: true },
  });
}

async function mesFechado(tx: Prisma.TransactionClient, mes: string, dataPagamento: string) {
  const meses = [mes, ...(dataPagamento ? [dataPagamento.slice(0, 7)] : [])];
  return Boolean(await tx.fechamentoMensal.findFirst({ where: { mesLancamento: { in: meses } }, select: { id: true } }));
}

export async function salvarRecebimentoManual(id: string, _estado: { erro?: string }, form: FormData): Promise<{ erro?: string }> {
  const acesso = await exigirPermissaoAcesso("recebimentos.editar", { global: true });
  await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
  if (!idLancamentoValido(id)) return { erro: "Abra o formulário novamente para registrar a conta." };

  const contratoId = campoLancamento(form, "contratoId");
  const descricao = campoLancamento(form, "descricao");
  const vencimento = campoLancamento(form, "vencimento");
  const valor = valorLancamento(campoLancamento(form, "valor"));
  if (!contratoId) return { erro: "Selecione um contrato." };
  if (!descricao || descricao.length > 500) return { erro: "Informe a descrição com até 500 caracteres." };
  if (acesso.perfil !== "ADMINISTRADOR" && contemComissaoRestrita(descricao)) return { erro: "Este lançamento está restrito ao administrador." };
  if (valor === null) return { erro: "Informe um valor maior que zero." };
  if (!dataLancamentoValida(vencimento)) return { erro: "Informe uma data de vencimento válida." };

  const dataPagamento = campoLancamento(form, "dataPagamento");
  const valorRecebido = campoLancamento(form, "recebido");
  if (valorRecebido && !dataPagamento) return { erro: "Informe a data do recebimento." };
  if (dataPagamento && !dataLancamentoValida(dataPagamento)) return { erro: "Informe uma data de recebimento válida." };
  const recebido = dataPagamento ? (valorRecebido ? valorLancamento(valorRecebido) : valor) : null;
  if (dataPagamento && (recebido === null || recebido > valor)) return { erro: "O valor recebido deve ser positivo e até o valor da conta." };
  const via = dataPagamento ? campoLancamento(form, "via") : null;
  if (via !== null && !VIAS.has(via)) return { erro: "Informe a forma de recebimento." };
  if (dataPagamento) await exigirPermissaoAcesso("caixa.editar", { global: true });

  const mes = vencimento.slice(0, 7);
  const taxaComissaoBps = await taxaComissaoParaMes(mes);
  try {
    const erro = await prisma.$transaction(async tx => {
      if (await mesFechado(tx, mes, dataPagamento)) {
        return "O mês da conta ou do recebimento está fechado.";
      }
      const contrato = await tx.contrato.findFirst({
        where: { id: contratoId, status: { in: ["ativo", "acordo"] }, unidade: { ativo: true, empreendimento: { ativo: true } } },
        select: { id: true, unidadeId: true, unidade: { select: { empreendimentoId: true } } },
      });
      if (!contrato) return "Selecione um contrato ativo.";
      const empreendimentoId = contrato.unidade.empreendimentoId;
      if (!await recursoEstaAtivo(tx, "CONTRATO", contrato.id) || !await recursoEstaAtivo(tx, "UNIDADE", contrato.unidadeId) || !await recursoEstaAtivo(tx, "EMPREENDIMENTO", empreendimentoId)) {
        return "O contrato ou imóvel selecionado está indisponível.";
      }
      await tx.recebimento.create({
        data: {
          id, contratoId: contrato.id, empreendimentoId, valor, recebido, via, taxaComissaoBps,
          criadoManualBrisa: true, vencimentoManual: vencimento, mesLancamento: mes, competencia: mes,
          dataPagamento: dataPagamento || null, observacao: descricao,
        },
      });
      if (recebido !== null) await registrarEntrada(tx, { id, recebimentoId: id, data: dataPagamento, valor: recebido, descricao });
      return null;
    });
    if (erro) return { erro };
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") return { erro: "Este lançamento já foi enviado. Consulte a lista antes de tentar novamente." };
    throw erro;
  }
  revalidatePath("/", "layout");
  redirect(`/recebimentos?${new URLSearchParams({ mes, ok: "Conta a receber registrada." })}`);
}

export async function registrarBaixaRecebimentoManual(recebimentoId: string, id: string, retorno: string, _estado: { erro?: string }, form: FormData): Promise<{ erro?: string }> {
  const acesso = await exigirPermissaoAcesso("recebimentos.editar", { global: true });
  await exigirPermissaoAcesso("caixa.editar", { global: true });
  await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
  if (!idLancamentoValido(id) || !idLancamentoValido(recebimentoId)) return { erro: "Abra a conta novamente para registrar o recebimento." };

  const valor = valorLancamento(campoLancamento(form, "valor"));
  const data = campoLancamento(form, "dataPagamento");
  const via = campoLancamento(form, "via");
  if (valor === null) return { erro: "Informe um valor maior que zero." };
  if (!dataLancamentoValida(data)) return { erro: "Informe uma data de recebimento válida." };
  if (!VIAS.has(via)) return { erro: "Informe a forma de recebimento." };
  try {
    const erro = await prisma.$transaction(async tx => {
      const titulo = await tx.recebimento.findFirst({
        where: { id: recebimentoId, criadoManualBrisa: true },
        select: { mesLancamento: true, valor: true, iptu: true, cond: true, recebido: true, observacao: true },
      });
      if (!titulo || !await recursoEstaAtivo(tx, "TITULO", `BRISA:RECEBER:${recebimentoId}`)) return "Conta indisponível.";
      if (acesso.perfil !== "ADMINISTRADOR" && contemComissaoRestrita(titulo.observacao)) return "Conta indisponível.";
      if (await mesFechado(tx, titulo.mesLancamento, data)) return "O mês da conta ou do recebimento está fechado.";
      const recebido = (titulo.recebido ?? 0) + valor;
      if (recebido > titulo.valor + titulo.iptu + titulo.cond) return "O valor informado ultrapassa o saldo em aberto.";
      const atualizado = await tx.recebimento.updateMany({
        where: { id: recebimentoId, recebido: titulo.recebido, reservaEmissaoToken: null, boletos: { none: {} }, pagamentos: { none: {} } },
        data: { recebido, dataPagamento: data, via },
      });
      if (atualizado.count !== 1) return "A conta mudou ou tem uma operação bancária vinculada. Atualize e confira o saldo.";
      await registrarEntrada(tx, { id, recebimentoId, data, valor, descricao: titulo.observacao ?? "Conta a receber" });
      return null;
    });
    if (erro) return { erro };
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") return { erro: "Este recebimento já foi enviado. Consulte a conta antes de repetir." };
    throw erro;
  }
  revalidatePath("/", "layout");
  const voltar = validarRetornoFinanceiro(retorno) ?? "/recebimentos";
  const destino = new URL(voltar, "http://brisa.local");
  destino.searchParams.set("ok", "Recebimento registrado no caixa.");
  redirect(`${destino.pathname}?${destino.searchParams.toString()}`);
}
