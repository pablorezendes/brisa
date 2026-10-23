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
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseBRL } from "@/lib/dominio/dinheiro";
import { recursoEstaAtivo } from "@/lib/governanca/filtros";
import { filtroCaixaDespesasRestritas } from "@/lib/despesas/sigilo-caixa";

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
  const id = texto(formData, "id");
  const sigilo = filtroCaixaDespesasRestritas(acesso.perfil);

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
    const centroPreservado = id && !CENTROS_SAIDA.has(centroCusto)
      ? await prisma.lancamentoCaixa.findFirst({ where: { AND: [{ id }, sigilo] }, select: { centroCusto: true, tipo: true } }) : null;
    if (!CENTROS_SAIDA.has(centroCusto) && !(centroPreservado?.tipo === "SAIDA" && centroPreservado.centroCusto === centroCusto)) {
      return { erro: "Saída exige centro de custo (Antonio/Laura, Chácara Brisa ou Brisa)." };
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
    if (!await recursoEstaAtivo(prisma, "CAIXA", id)) return { erro: "Este lançamento foi excluído logicamente. Restaure-o na governança antes de editar." };
    const existente = await prisma.lancamentoCaixa.findFirst({ where: { AND: [{ id }, sigilo] }, select: { id: true } });
    if (!existente) return { erro: "Lançamento não encontrado — pode ter sido excluído." };
    // A mesma condição no UPDATE impede corrida com uma nota que acaba de
    // tornar seu pagamento reservado, sem carregar seus dados para o cliente.
    const resultado = await prisma.lancamentoCaixa.updateMany({ where: { AND: [{ id }, sigilo] }, data: dados });
    if (resultado.count !== 1) return { erro: "Lançamento indisponível para alteração. Reabra a página." };
  } else {
    await prisma.lancamentoCaixa.create({ data: dados });
  }

  revalidatePath("/caixa");
  revalidatePath("/caixa/ano");
  redirect(`/caixa?mes=${mesReferencia}`);
}

/** Abre a conferência auditada; nunca exclui diretamente a partir da lista. */
export async function excluirLancamento(formData: FormData): Promise<void> {
  const acesso = await exigirPermissaoAcesso("governanca.editar", { global: true });
  const id = texto(formData, "id");
  if (!id) return;
  if (!await prisma.lancamentoCaixa.findFirst({ where: { AND: [{ id }, filtroCaixaDespesasRestritas(acesso.perfil)] }, select: { id: true } })) return;
  redirect(`/cadastros/governanca?${new URLSearchParams({ tipo: "CAIXA", origemId: id })}`);
}
