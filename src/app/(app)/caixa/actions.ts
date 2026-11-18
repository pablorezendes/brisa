"use server";

/**
 * Server actions do módulo Caixa.
 *
 * salvarLancamento cobre criação e edição (id presente ⇒ update) e é usado
 * com useActionState no FormLancamento — validação defensiva devolve
 * { erro } para exibição no formulário; sucesso revalida e redireciona
 * para o mês do lançamento.
 */
import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseBRL } from "@/lib/dominio/dinheiro";
import { dataLancamentoValida, idLancamentoValido, valorLancamento } from "@/lib/dominio/lancamento-manual";
import { recursoEstaAtivo } from "@/lib/governanca/filtros";
import { filtroCaixaDespesasRestritas } from "@/lib/despesas/sigilo-caixa";
import { contemComissaoRestrita } from "@/lib/despesas/sigilo";

export type EstadoFormLancamento = { erro: string | null };

const TIPOS = new Set(["SAIDA", "ENTRADA", "RECEB_DINHEIRO"]);
const CENTROS_SAIDA = new Set(["AL", "CH", "BRISA"]);
const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const RE_DATA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Lê campo de texto do FormData: trim; vazio/ausente → null. */
function texto(fd: FormData, campo: string): string | null {
  const v = fd.get(campo);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export async function salvarLancamento(
  _prev: EstadoFormLancamento,
  formData: FormData,
): Promise<EstadoFormLancamento> {
  const acesso = await exigirPermissaoAcesso("caixa.editar", { global: true });
  return salvarLancamentoInterno(formData, acesso);
}

export async function salvarLancamentoManual(
  idRequisicao: string,
  _prev: EstadoFormLancamento,
  formData: FormData,
): Promise<EstadoFormLancamento> {
  const acesso = await exigirPermissaoAcesso("caixa.editar", { global: true });
  return salvarLancamentoInterno(formData, acesso, idRequisicao);
}

async function salvarLancamentoInterno(formData: FormData, acesso: Awaited<ReturnType<typeof exigirPermissaoAcesso>>, idRequisicao?: string): Promise<EstadoFormLancamento> {
  const manual = idRequisicao !== undefined;
  if (manual && !idLancamentoValido(idRequisicao)) return { erro: "Abra o formulário novamente para registrar o movimento." };
  const id = texto(formData, "id");
  const sigilo = filtroCaixaDespesasRestritas(acesso.perfil);

  const tipo = texto(formData, "tipo") ?? "";
  if (!TIPOS.has(tipo) || (manual && tipo === "RECEB_DINHEIRO")) return { erro: "Tipo de lançamento inválido." };

  const data = texto(formData, "data");
  const mesReferencia = (manual ? data?.slice(0, 7) : texto(formData, "mesReferencia")) ?? "";
  if (!RE_MES.test(mesReferencia)) {
    return { erro: "Mês de referência inválido (use o formato AAAA-MM)." };
  }

  const valorTexto = texto(formData, "valor");
  const valor = manual ? valorLancamento(valorTexto ?? "") : parseBRL(valorTexto);
  if (valor === null || valor <= 0) {
    return { erro: "Valor inválido — informe um valor maior que zero (ex.: 1.234,56)." };
  }

  if (data !== null && !RE_DATA.test(data)) {
    return { erro: "Data inválida (use o formato AAAA-MM-DD)." };
  }
  if (manual && (!data || !dataLancamentoValida(data))) return { erro: "Informe uma data válida para o movimento." };

  let centroCusto = "GERAL";
  let categoria: string | null = null;
  if (tipo === "SAIDA") {
    centroCusto = texto(formData, "centro") ?? "";
    const centroPreservado = id && !CENTROS_SAIDA.has(centroCusto)
      ? await prisma.lancamentoCaixa.findFirst({ where: { AND: [{ id }, sigilo] }, select: { centroCusto: true, tipo: true } }) : null;
    if (!CENTROS_SAIDA.has(centroCusto) && !(centroPreservado?.tipo === "SAIDA" && centroPreservado.centroCusto === centroCusto)) {
      return { erro: "Saída exige centro de custo (Antonio/Laura, Chácara Brisa ou Brisa)." };
    }
    categoria = texto(formData, "categoria");
    if (categoria === null) return { erro: "Saída exige uma categoria." };
    if (manual && categoria.length > 120) return { erro: "Informe a categoria com até 120 caracteres." };
  }

  const descricao = texto(formData, "descricao");
  if (manual && (!descricao || descricao.length > 500)) return { erro: "Informe a descrição com até 500 caracteres." };
  if (manual && acesso.perfil !== "ADMINISTRADOR" && contemComissaoRestrita([descricao, categoria])) return { erro: "Este lançamento está restrito ao administrador." };
  const cliente = tipo === "RECEB_DINHEIRO" ? texto(formData, "cliente") : null;
  const local = tipo === "RECEB_DINHEIRO" ? texto(formData, "local") : null;

  const dados = {
    mesReferencia,
    centroCusto,
    tipo,
    categoria,
    data,
    valor,
    descricao,
    cliente,
    local,
  };

  if (id) {
    if (!await recursoEstaAtivo(prisma, "CAIXA", id)) return { erro: "Este lançamento foi excluído logicamente. Restaure-o na governança antes de editar." };
    const identidade = manual ? { id, criadoManualBrisa: true, despesaDocumento: { is: null }, recebimentoManualId: null } : { id };
    const where = { AND: [identidade, sigilo] };
    const existente = await prisma.lancamentoCaixa.findFirst({
      where, select: { id: true, descricao: true, categoria: true, criadoManualBrisa: true, recebimentoManualId: true, despesaDocumento: { select: { criadoManualBrisa: true } }, recebimentoWidesysLocal: { select: { id: true } }, baixaContaReceberContratoLegado: { select: { id: true } } },
    });
    if (!existente) return { erro: "Lançamento não encontrado — pode ter sido excluído." };
    if (existente.recebimentoManualId || existente.despesaDocumento?.criadoManualBrisa || existente.recebimentoWidesysLocal || existente.baixaContaReceberContratoLegado) return { erro: "Consulte a conta vinculada para tratar este movimento." };
    if (!manual && existente.criadoManualBrisa) return { erro: "Abra o movimento na lista para fazer a alteração." };
    if (manual && acesso.perfil !== "ADMINISTRADOR" && contemComissaoRestrita([existente.descricao, existente.categoria])) return { erro: "Este lançamento está restrito ao administrador." };
    // A mesma condição no UPDATE impede corrida com uma nota que acaba de
    // tornar seu pagamento reservado, sem carregar seus dados para o cliente.
    const resultado = await prisma.lancamentoCaixa.updateMany({ where: { ...where, recebimentoWidesysLocal: { is: null }, baixaContaReceberContratoLegado: { is: null } }, data: dados });
    if (resultado.count !== 1) return { erro: "Lançamento indisponível para alteração. Reabra a página." };
  } else {
    try {
      await prisma.lancamentoCaixa.create({
        data: { ...dados, ...(manual ? { id: idRequisicao, criadoManualBrisa: true } : {}) },
      });
    } catch (erro) {
      if (manual && erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") return { erro: "Este lançamento já foi enviado. Consulte a lista antes de tentar novamente." };
      throw erro;
    }
  }

  revalidatePath("/caixa");
  revalidatePath("/caixa/ano");
  if (manual) revalidatePath("/", "layout");
  redirect(`/caixa?mes=${mesReferencia}`);
}

/** Abre a conferência auditada; nunca exclui diretamente a partir da lista. */
export async function excluirLancamento(formData: FormData): Promise<void> {
  const acesso = await exigirPermissaoAcesso("governanca.editar", { global: true });
  const id = texto(formData, "id");
  if (!id) return;
  if (!await prisma.lancamentoCaixa.findFirst({ where: { AND: [{ id }, filtroCaixaDespesasRestritas(acesso.perfil)], recebimentoWidesysLocal: { is: null } }, select: { id: true } })) return;
  redirect(`/cadastros/governanca?${new URLSearchParams({ tipo: "CAIXA", origemId: id })}`);
}
