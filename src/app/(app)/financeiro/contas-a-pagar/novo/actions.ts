"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { prisma } from "@/lib/db";
import { salvarDespesa } from "@/lib/despesas/servico";
import { ErroDespesa, type PagamentoDespesaEntrada, type TipoDocumentoDespesa } from "@/lib/despesas/tipos";
import { campoLancamento, dataLancamentoValida, valorLancamento } from "@/lib/dominio/lancamento-manual";

const ROTA = "/financeiro/contas-a-pagar";

export async function salvarDespesaManual(requestId: string, _estado: { erro?: string }, form: FormData): Promise<{ erro?: string }> {
  const acesso = await exigirPermissaoAcesso("despesas.editar", { global: true });
  const total = valorLancamento(campoLancamento(form, "valor"));
  const vencimento = campoLancamento(form, "vencimento");
  if (total === null) return { erro: "Informe um valor maior que zero." };
  if (!dataLancamentoValida(vencimento)) return { erro: "Informe uma data de vencimento válida." };

  const descricao = campoLancamento(form, "descricao");
  const empreendimentoId = campoLancamento(form, "empreendimentoId");
  const dataPagamento = campoLancamento(form, "dataPagamento");
  const tipoDocumento = (campoLancamento(form, "tipoDocumento") || "SEM_DOCUMENTO") as TipoDocumentoDespesa;
  const pagamento: PagamentoDespesaEntrada = dataPagamento ? {
    modo: "REGISTRAR", data: dataPagamento, centroCusto: "BRISA", categoria: "",
    via: campoLancamento(form, "via"), contaBancariaId: campoLancamento(form, "contaBancariaId") || null,
  } : { modo: "MANTER" };
  try {
    await salvarDespesa(prisma, {
      requestId,
      fornecedorNome: campoLancamento(form, "fornecedor"),
      fornecedorDocumento: campoLancamento(form, "fornecedorDocumento") || null,
      categoriaCodigo: campoLancamento(form, "categoria"),
      descricao, total, vencimento, competencia: vencimento.slice(0, 7),
      tipoDocumento, numero: campoLancamento(form, "numero"), emissao: campoLancamento(form, "emissao"),
      destinoCusto: empreendimentoId ? "EMPREENDIMENTOS" : "ADMINISTRADORA",
      statusRateio: "CONFERIDO",
      rateios: empreendimentoId ? [{ empreendimentoId, descricao, valor: total }] : [],
      pagamento,
    }, { id: acesso.usuarioId }, true);
  } catch (erro) {
    if (erro instanceof ErroDespesa) return { erro: erro.message };
    throw erro;
  }

  revalidatePath("/", "layout");
  redirect(`${ROTA}?${new URLSearchParams({ mes: vencimento.slice(0, 7), ok: "Conta a pagar registrada." })}`);
}
