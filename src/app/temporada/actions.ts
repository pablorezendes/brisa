"use server";

/**
 * Server actions do módulo Temporada (Airbnb).
 *
 * Validação defensiva: entradas inválidas fazem a action retornar sem gravar
 * (os formulários são simples, sem estado de erro). Valores monetários lidos
 * com parseBRL (aceita "1.234,56"); tudo persiste em centavos (Int).
 *
 * O tipo de despesa LIMPEZA não é aceito aqui: ele é derivado do bloco de
 * limpezas (ver src/lib/consultas/temporada.ts).
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { parseBRL } from "@/lib/dominio/dinheiro";
import { normalizar } from "@/lib/dominio/normalizacao";

const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const TIPOS_DESPESA_MANUAIS = new Set(["ENERGIA", "CONDO", "IPTU", "EXTRA"]);

/** Lê campo de texto do FormData: trim; ausente → "". */
function texto(fd: FormData, campo: string): string {
  const v = fd.get(campo);
  return typeof v === "string" ? v.trim() : "";
}

/** Cadastra (ou reativa) uma unidade de temporada pelo código ("208", "304"...). */
export async function criarUnidadeTemporada(formData: FormData): Promise<void> {
  const codigo = normalizar(texto(formData, "codigo"));
  if (!codigo || codigo.length > 30) return;
  await prisma.unidadeTemporada.upsert({
    where: { codigo },
    update: { ativo: true },
    create: { codigo },
  });
  revalidatePath("/temporada");
}

/**
 * Lança/edita a limpeza de uma unidade na competência (upsert manual por
 * unidade+competência — o schema não tem chave composta).
 */
export async function salvarLimpeza(formData: FormData): Promise<void> {
  const unidadeTemporadaId = texto(formData, "unidadeTemporadaId");
  const competencia = texto(formData, "competencia");
  if (!unidadeTemporadaId || !RE_MES.test(competencia)) return;

  const unidade = await prisma.unidadeTemporada.findUnique({
    where: { id: unidadeTemporadaId },
  });
  if (!unidade) return;

  const qtd = Number.parseInt(texto(formData, "quantidade"), 10);
  const quantidade = Number.isInteger(qtd) && qtd > 0 ? qtd : 0;
  const vu = parseBRL(texto(formData, "valorUnitario"));
  const valorUnitario = vu !== null && vu >= 0 ? vu : 5000; // default R$50,00
  const extra = parseBRL(texto(formData, "extraPdl"));
  const extraPdl = extra !== null && extra >= 0 ? extra : 0;

  const existente = await prisma.limpeza.findFirst({
    where: { unidadeTemporadaId, competencia },
  });
  if (existente) {
    await prisma.limpeza.update({
      where: { id: existente.id },
      data: { quantidade, valorUnitario, extraPdl },
    });
  } else {
    await prisma.limpeza.create({
      data: { unidadeTemporadaId, competencia, quantidade, valorUnitario, extraPdl },
    });
  }
  revalidatePath("/temporada");
}

/** Lança despesa do mês (com ou sem unidade). LIMPEZA é derivada — não aceita. */
export async function lancarDespesa(formData: FormData): Promise<void> {
  const competencia = texto(formData, "competencia");
  if (!RE_MES.test(competencia)) return;

  const tipo = texto(formData, "tipo");
  if (!TIPOS_DESPESA_MANUAIS.has(tipo)) return;

  const valor = parseBRL(texto(formData, "valor"));
  if (valor === null || valor <= 0) return;

  const idUnidade = texto(formData, "unidadeTemporadaId");
  let unidadeTemporadaId: string | null = null;
  if (idUnidade) {
    const unidade = await prisma.unidadeTemporada.findUnique({
      where: { id: idUnidade },
    });
    if (!unidade) return;
    unidadeTemporadaId = unidade.id;
  }

  await prisma.despesaTemporada.create({
    data: { unidadeTemporadaId, competencia, tipo, valor },
  });
  revalidatePath("/temporada");
}

/** Exclui uma despesa (deleteMany é idempotente — não lança se já excluída). */
export async function excluirDespesa(formData: FormData): Promise<void> {
  const id = texto(formData, "id");
  if (!id) return;
  await prisma.despesaTemporada.deleteMany({ where: { id } });
  revalidatePath("/temporada");
}

/** Lança recebimento de temporada (valor obrigatório; plataforma/hóspede opcionais). */
export async function lancarRecebimentoTemporada(formData: FormData): Promise<void> {
  const competencia = texto(formData, "competencia");
  if (!RE_MES.test(competencia)) return;

  const valor = parseBRL(texto(formData, "valor"));
  if (valor === null || valor <= 0) return;

  const idUnidade = texto(formData, "unidadeTemporadaId");
  let unidadeTemporadaId: string | null = null;
  if (idUnidade) {
    const unidade = await prisma.unidadeTemporada.findUnique({
      where: { id: idUnidade },
    });
    if (!unidade) return;
    unidadeTemporadaId = unidade.id;
  }

  const plataforma = texto(formData, "plataforma") || null;
  const hospede = texto(formData, "hospede") || null;

  await prisma.recebimentoTemporada.create({
    data: { unidadeTemporadaId, competencia, valor, plataforma, hospede },
  });
  revalidatePath("/temporada");
}

/** Exclui um recebimento de temporada. */
export async function excluirRecebimentoTemporada(formData: FormData): Promise<void> {
  const id = texto(formData, "id");
  if (!id) return;
  await prisma.recebimentoTemporada.deleteMany({ where: { id } });
  revalidatePath("/temporada");
}
