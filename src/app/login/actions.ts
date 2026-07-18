"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  abrirSessao,
  gerarHashSenha,
  verificarSenha,
} from "@/lib/auth";

export async function entrar(formData: FormData): Promise<void> {
  const usuario = String(formData.get("usuario") ?? "").trim().toLowerCase();
  const senha = String(formData.get("senha") ?? "");
  const lembrar = formData.get("lembrar") === "on";

  if (!usuario || !senha) redirect("/login?erro=vazio");

  const conta = await prisma.usuario.findUnique({ where: { usuario } });
  if (!conta || !verificarSenha(senha, conta.senhaHash)) {
    redirect("/login?erro=credenciais");
  }

  await abrirSessao({ id: conta.id, nome: conta.nome }, lembrar);
  redirect("/");
}

/** Só funciona enquanto NÃO existe nenhum usuário (primeiro acesso). */
export async function criarPrimeiroUsuario(formData: FormData): Promise<void> {
  const total = await prisma.usuario.count();
  if (total > 0) redirect("/login");

  const nome = String(formData.get("nome") ?? "").trim();
  const usuario = String(formData.get("usuario") ?? "").trim().toLowerCase();
  const senha = String(formData.get("senha") ?? "");
  const confirma = String(formData.get("confirma") ?? "");

  if (!nome || !usuario || !senha) redirect("/login?erro=vazio");
  if (senha.length < 8) redirect("/login?erro=senha_curta");
  if (senha !== confirma) redirect("/login?erro=senhas_diferentes");

  const conta = await prisma.usuario.create({
    data: { nome, usuario, senhaHash: gerarHashSenha(senha) },
  });

  await abrirSessao({ id: conta.id, nome: conta.nome }, true);
  redirect("/");
}
