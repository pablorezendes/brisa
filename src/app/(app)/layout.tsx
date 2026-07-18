import Link from "next/link";
import { redirect } from "next/navigation";
import { encerrarSessao, exigirSessao } from "@/lib/auth";

const MENU: { titulo: string; itens: { href: string; rotulo: string }[] }[] = [
  {
    titulo: "Visão",
    itens: [
      { href: "/", rotulo: "Início" },
      { href: "/executivo", rotulo: "Executivo" },
    ],
  },
  {
    titulo: "Operação",
    itens: [
      { href: "/recebimentos", rotulo: "Recebimentos" },
      { href: "/contratos", rotulo: "Contratos" },
      { href: "/temporada", rotulo: "Temporada" },
      { href: "/caixa", rotulo: "Caixa" },
    ],
  },
  {
    titulo: "Análise",
    itens: [
      { href: "/paineis/cobranca", rotulo: "Cobrança" },
      { href: "/paineis/empreendimentos", rotulo: "Empreendimentos" },
      { href: "/paineis/caixa", rotulo: "Caixa analítico" },
      { href: "/paineis/temporada", rotulo: "Temporada anual" },
      { href: "/relatorios", rotulo: "Relatórios" },
    ],
  },
  {
    titulo: "Apoio",
    itens: [{ href: "/ajuda", rotulo: "Como funciona" }],
  },
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
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {MENU.map((grupo) => (
            <div key={grupo.titulo} className="mb-4">
              <div className="px-3 pb-1 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-tinta-suave/70">
                {grupo.titulo}
              </div>
              {grupo.itens.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group flex items-center gap-3 px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] text-tinta-suave transition-colors hover:bg-[#eae8e4] hover:text-tinta"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-contorno transition-colors group-hover:bg-oliva" />
                  {item.rotulo}
                </Link>
              ))}
            </div>
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
