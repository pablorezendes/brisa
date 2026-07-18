import Link from "next/link";
import { redirect } from "next/navigation";
import { encerrarSessao, exigirSessao } from "@/lib/auth";

const MENU = [
  { href: "/", rotulo: "Início" },
  { href: "/executivo", rotulo: "Executivo" },
  { href: "/recebimentos", rotulo: "Recebimentos" },
  { href: "/contratos", rotulo: "Contratos" },
  { href: "/temporada", rotulo: "Temporada" },
  { href: "/caixa", rotulo: "Caixa" },
  { href: "/relatorios", rotulo: "Relatórios" },
];

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
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-contorno bg-papel">
        <Link href="/" className="block border-b border-contorno px-5 py-5">
          <div className="font-serif text-2xl font-bold tracking-tight text-tinta">
            Brisa
          </div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-tinta-suave">
            Gestão de Imóveis
          </div>
        </Link>
        <nav className="flex-1 space-y-0.5 px-3 py-6">
          {MENU.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group flex items-center gap-3 px-3 py-2.5 text-xs font-bold uppercase tracking-[0.08em] text-tinta-suave transition-colors hover:bg-[#eae8e4] hover:text-tinta"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-contorno transition-colors group-hover:bg-oliva" />
              {item.rotulo}
            </Link>
          ))}
        </nav>
        <div className="border-t border-contorno px-5 py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-tinta">
                {sessao.nome}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-tinta-suave">
                conectado
              </div>
            </div>
            <form action={sair}>
              <button
                type="submit"
                className="rounded border border-contorno px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-tinta-suave hover:border-tinta hover:text-tinta"
              >
                Sair
              </button>
            </form>
          </div>
          <p className="mt-3 font-mono text-[10px] leading-relaxed text-tinta-suave">
            comissão incide só sobre o aluguel recebido — IPTU e condomínio são
            repasses
          </p>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-12 py-8">{children}</main>
    </div>
  );
}
