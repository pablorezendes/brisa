import { redirect } from "next/navigation";
import { encerrarSessao, exigirSessao } from "@/lib/auth";
import { acessoAtual } from "@/lib/acesso/servidor";
import { navegacaoAcesso } from "@/lib/acesso/politica";
import AppShell from "./app-shell";

async function sair() {
  "use server";
  await encerrarSessao();
  redirect("/login");
}

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const sessao = await exigirSessao();
  const acesso = await acessoAtual();

  return (
    <AppShell nome={sessao.nome} perfil={acesso.perfil} acesso={navegacaoAcesso(acesso)} sair={sair}>
      {children}
    </AppShell>
  );
}
