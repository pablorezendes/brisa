"use server";

/**
 * Server actions do módulo Caixa.
 *
 * salvarLancamento cobre criação e edição (id presente ⇒ update) e é usado
 * com useActionState no FormLancamento — validação defensiva devolve
 * { erro } para exibição no formulário; sucesso revalida e redireciona
 * para o mês do lançamento.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseBRL } from "@/lib/dominio/dinheiro";

export type EstadoFormLancamento = { erro: string | null };

const TIPOS = new Set(["SAIDA", "ENTRADA", "RECEB_DINHEIRO"]);
const CENTROS_SAIDA = new Set(["AL", "CH"]);
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
  const id = texto(formData, "id");

  const tipo = texto(formData, "tipo") ?? "";
  if (!TIPOS.has(tipo)) return { erro: "Tipo de lançamento inválido." };

  const mesReferencia = texto(formData, "mesReferencia") ?? "";
  if (!RE_MES.test(mesReferencia)) {
    return { erro: "Mês de referência inválido (use o formato AAAA-MM)." };
  }

  const valor = parseBRL(texto(formData, "valor"));
  if (valor === null || valor <= 0) {
    return { erro: "Valor inválido — informe um valor maior que zero (ex.: 1.234,56)." };
  }

  const data = texto(formData, "data");
  if (data !== null && !RE_DATA.test(data)) {
    return { erro: "Data inválida (use o formato AAAA-MM-DD)." };
  }

  let centroCusto = "GERAL";
  let categoria: string | null = null;
  if (tipo === "SAIDA") {
    centroCusto = texto(formData, "centro") ?? "";
    if (!CENTROS_SAIDA.has(centroCusto)) {
      return { erro: "Saída exige centro de custo (Antonio/Laura ou Chácara Brisa)." };
    }
    categoria = texto(formData, "categoria");
    if (categoria === null) return { erro: "Saída exige uma categoria." };
  }

  const descricao = texto(formData, "descricao");
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
    const existente = await prisma.lancamentoCaixa.findUnique({ where: { id } });
    if (!existente) return { erro: "Lançamento não encontrado — pode ter sido excluído." };
    await prisma.lancamentoCaixa.update({ where: { id }, data: dados });
  } else {
    await prisma.lancamentoCaixa.create({ data: dados });
  }

  revalidatePath("/caixa");
  revalidatePath("/caixa/ano");
  redirect(`/caixa?mes=${mesReferencia}`);
}

/** Exclui um lançamento (a confirmação acontece no cliente — BotaoExcluir). */
export async function excluirLancamento(formData: FormData): Promise<void> {
  const id = texto(formData, "id");
  if (!id) return;
  // deleteMany é idempotente: não lança erro se o registro já foi excluído.
  await prisma.lancamentoCaixa.deleteMany({ where: { id } });
  revalidatePath("/caixa");
  revalidatePath("/caixa/ano");
}
