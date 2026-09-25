import "server-only";

import { prisma } from "@/lib/db";
import { exigirSessao, type SessaoPayload } from "@/lib/auth";
import { perfilPodeVerPiiCadastros } from "@/lib/privacidade-cadastros";
import { perfilPodeVerComissoes } from "@/lib/permissoes-comissoes";
import { notFound } from "next/navigation";

export { perfilPodeVerComissoes } from "@/lib/permissoes-comissoes";

export type PermissaoFinanceira =
  | "GERENCIAR_CONTAS"
  | "EMITIR_BOLETOS"
  | "SINCRONIZAR_BOLETOS"
  | "CONCILIAR_PAGAMENTOS";

const PERMISSOES: Record<string, readonly PermissaoFinanceira[]> = {
  ADMINISTRADOR: [
    "GERENCIAR_CONTAS",
    "EMITIR_BOLETOS",
    "SINCRONIZAR_BOLETOS",
    "CONCILIAR_PAGAMENTOS",
  ],
  FINANCEIRO: [
    "EMITIR_BOLETOS",
    "SINCRONIZAR_BOLETOS",
    "CONCILIAR_PAGAMENTOS",
  ],
  OPERADOR: ["EMITIR_BOLETOS", "SINCRONIZAR_BOLETOS"],
  CONSULTA: [],
};

export class ErroPermissao extends Error {
  constructor() {
    super("Seu perfil não tem permissão para esta operação financeira.");
    this.name = "ErroPermissao";
  }
}

/**
 * Autoriza novamente no servidor antes de cada operação bancária. A sessão
 * carrega somente o ID do usuário; o perfil é sempre lido do banco para que
 * uma revogação tenha efeito imediato.
 */
export async function exigirPermissaoFinanceira(
  permissao: PermissaoFinanceira,
): Promise<SessaoPayload & { perfil: string }> {
  const sessao = await exigirSessao();
  const usuario = await prisma.usuario.findUnique({
    where: { id: sessao.sub },
    select: { perfil: true },
  });
  const perfil = usuario?.perfil ?? "CONSULTA";
  if (!PERMISSOES[perfil]?.includes(permissao)) throw new ErroPermissao();
  return { ...sessao, perfil };
}

export async function perfilAtual(): Promise<string> {
  const sessao = await exigirSessao();
  const usuario = await prisma.usuario.findUnique({
    where: { id: sessao.sub },
    select: { perfil: true },
  });
  return usuario?.perfil ?? "CONSULTA";
}

/** Checagem no servidor, antes de consultar ou renderizar qualquer valor. */
export async function exigirAcessoComissoes(): Promise<void> {
  if (!perfilPodeVerComissoes(await perfilAtual())) notFound();
}

/**
 * Resolve a autorização com o perfil fresco do banco. Nunca confia em perfil
 * enviado pelo cliente nem deixa a decisão para ocultação visual no React.
 */
export async function podeVerPiiCadastrosAtual(): Promise<boolean> {
  return perfilPodeVerPiiCadastros(await perfilAtual());
}
