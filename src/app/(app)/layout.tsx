import { redirect } from "next/navigation";
import { encerrarSessao, exigirSessao } from "@/lib/auth";
import { perfilAtual } from "@/lib/autorizacao";
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
  const perfil = await perfilAtual();

  return (
    <AppShell nome={sessao.nome} perfil={perfil} sair={sair}>
      {children}
    </AppShell>
  );
}
