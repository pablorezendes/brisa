"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { prisma } from "@/lib/db";
import { alterarSituacaoFornecedor, buscaFornecedores, salvarFornecedor, vincularPessoaFornecedor } from "@/lib/fornecedores/servico";
import { ErroFornecedor, type FornecedorCadastro, type FornecedorResumo, type SalvarFornecedorEntrada } from "@/lib/fornecedores/tipos";

type Falha = { ok: false; mensagem: string; existentes?: FornecedorResumo[] };
const falha = (e: unknown): Falha => ({ ok: false, mensagem: e instanceof ErroFornecedor ? e.message : "Não foi possível concluir. Tente novamente.", ...(e instanceof ErroFornecedor && e.existentes.length ? { existentes: e.existentes } : {}) });

export async function pesquisarFornecedores(entrada: { termo?: string; todasPessoas?: boolean }): Promise<{ ok: true; fornecedores: FornecedorResumo[] } | Falha> {
  const acesso = await exigirPermissaoAcesso("cadastros.sensiveis", { global: true });
  try { return { ok: true, fornecedores: await buscaFornecedores(prisma, entrada, { id: acesso.usuarioId }) }; } catch (e) { return falha(e); }
}
export async function salvarCadastroFornecedor(entrada: SalvarFornecedorEntrada): Promise<{ ok: true; fornecedor: FornecedorCadastro } | Falha> {
  const acesso = await exigirPermissaoAcesso("cadastros.editar", { global: true });
  try {
    const fornecedor = await salvarFornecedor(prisma, entrada, { id: acesso.usuarioId });
    revalidatePath("/cadastros/fornecedores");
    return { ok: true, fornecedor };
  } catch (e) { return falha(e); }
}
export async function usarPessoaComoFornecedor(id: string): Promise<{ ok: true; fornecedor: FornecedorResumo } | Falha> {
  const acesso = await exigirPermissaoAcesso("cadastros.editar", { global: true });
  try {
    const fornecedor = await vincularPessoaFornecedor(prisma, id, { id: acesso.usuarioId });
    revalidatePath("/cadastros/fornecedores");
    return { ok: true, fornecedor };
  } catch (e) { return falha(e); }
}
export async function mudarSituacaoFornecedor(entrada: { id: string; ativo: boolean; atualizadoEm: string }): Promise<{ ok: true; fornecedor: FornecedorCadastro } | Falha> {
  const acesso = await exigirPermissaoAcesso("cadastros.editar", { global: true });
  try {
    const fornecedor = await alterarSituacaoFornecedor(prisma, entrada, { id: acesso.usuarioId });
    revalidatePath("/cadastros/fornecedores");
    return { ok: true, fornecedor };
  } catch (e) { return falha(e); }
}
