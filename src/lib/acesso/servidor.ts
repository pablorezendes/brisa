import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { prisma } from "../db";
import { exigirSessao } from "../auth";
import { montarPolitica, pode, podeAbrirRota, carteiraIrrestrita } from "./politica";

/** Cache exclusivo desta renderização/requisição; nunca cache global por papel. */
export const acessoAtual = cache(async () => {
  const sessao = await exigirSessao();
  const usuario = await prisma.usuario.findUnique({ where: { id: sessao.sub }, select: {
    id: true, perfil: true, ativo: true, acessoGlobal: true, permissoesExtras: true, permissoesNegadas: true,
    papelAcesso: { select: { ativo: true, permissoes: true } }, regrasAcesso: { select: { tipo: true, recursoId: true, efeito: true } },
  } });
  if (!usuario?.ativo) redirect("/login?erro=credenciais");
  return montarPolitica(usuario);
});

export async function exigirPermissaoAcesso(codigo: string, opcoes: { global?: boolean } = {}) {
  const acesso = await acessoAtual();
  if (!pode(acesso, codigo) || (opcoes.global && !carteiraIrrestrita(acesso))) notFound();
  return { usuarioId: acesso.usuarioId, perfil: acesso.perfil };
}
export async function exigirPaginaAcesso(path: string) {
  const acesso = await acessoAtual();
  if (path === "/" && !podeAbrirRota(acesso, "/")) redirect("/carteira");
  if (!podeAbrirRota(acesso, path)) notFound();
}
