import "server-only";
import { notFound } from "next/navigation";
import { exigirSessao } from "@/lib/auth";
import { prisma } from "@/lib/db";

/** Notas de serviços podem revelar receitas restritas. Não basta ocultar o menu. */
export async function exigirAcessoFiscal() {
  const sessao = await exigirSessao();
  const usuario = await prisma.usuario.findUnique({ where: { id: sessao.sub }, select: { perfil: true } });
  if (usuario?.perfil !== "ADMINISTRADOR") notFound();
  return sessao;
}
