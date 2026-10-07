import "server-only";

import { prisma } from "@/lib/db";
import { exigirSessao, type SessaoPayload } from "@/lib/auth";
import { perfilPodeVerComissoes } from "@/lib/permissoes-comissoes";
import { notFound } from "next/navigation";
import { acessoAtual, exigirPermissaoAcesso } from "./acesso/servidor";
import { pode } from "./acesso/politica";

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
  const mapa: Record<PermissaoFinanceira, string> = { GERENCIAR_CONTAS: "contas.editar", EMITIR_BOLETOS: "boletos.emitir", SINCRONIZAR_BOLETOS: "boletos.sincronizar", CONCILIAR_PAGAMENTOS: "pagamentos.conciliar" };
  await exigirPermissaoAcesso(mapa[permissao], { global: true });
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
 * Usa a permissão efetiva da requisição: uma concessão por função pode ser
 * revogada explicitamente, mesmo para quem mantém o perfil FINANCEIRO.
 * A consulta chamadora continua responsável pelo escopo do registro.
 */
export async function podeVerPiiCadastrosAtual(): Promise<boolean> {
  return pode(await acessoAtual(), "cadastros.sensiveis");
}
