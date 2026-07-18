import { redirect } from "next/navigation";
import { encerrarSessao, exigirSessao } from "@/lib/auth";
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

  return (
    <AppShell nome={sessao.nome} sair={sair}>
      {children}
    </AppShell>
  );
}
