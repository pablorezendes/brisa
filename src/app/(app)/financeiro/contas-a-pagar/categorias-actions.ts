"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { prisma } from "@/lib/db";
import { listarCategoriasDespesas, salvarCategoriaDespesa } from "@/lib/despesas/catalogo-servico";
import { ErroDespesa } from "@/lib/despesas/tipos";
import type { CategoriaDespesaCatalogo, SalvarCategoriaDespesaEntrada } from "@/lib/despesas/tipos-catalogo";

type Falha = { ok: false; mensagem: string };
const falha = (erro: unknown): Falha => ({ ok: false, mensagem: erro instanceof ErroDespesa ? erro.message : "Não foi possível salvar ou carregar as categorias. Tente novamente." });

export async function carregarCategoriasDespesas(): Promise<{ ok: true; categorias: CategoriaDespesaCatalogo[]; gerenciavel: boolean } | Falha> {
  const acesso = await exigirPermissaoAcesso("despesas.ver", { global: true });
  try { return { ok: true, ...await listarCategoriasDespesas(prisma, { id: acesso.usuarioId }, { incluirInativas: true }) }; }
  catch (erro) { return falha(erro); }
}

export async function gravarCategoriaDespesa(entrada: SalvarCategoriaDespesaEntrada): Promise<{ ok: true; categoria: CategoriaDespesaCatalogo; categorias: CategoriaDespesaCatalogo[] } | Falha> {
  const acesso = await exigirPermissaoAcesso("despesas.editar", { global: true });
  try {
    const categoria = await salvarCategoriaDespesa(prisma, entrada, { id: acesso.usuarioId });
    const { categorias } = await listarCategoriasDespesas(prisma, { id: acesso.usuarioId }, { incluirInativas: true });
    // Uma categoria que passa a ser reservada pode proteger despesas e caixa
    // já exibidos em outras telas. Invalide também essas visualizações.
    revalidatePath("/", "layout");
    return { ok: true, categoria, categorias };
  } catch (erro) { return falha(erro); }
}
