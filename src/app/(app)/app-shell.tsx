"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

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

/** Item de navegação; destaca a rota ativa. */
function ItemNav({
  href,
  rotulo,
  ativo,
}: {
  href: string;
  rotulo: string;
  ativo: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-3 px-3 py-2.5 text-xs font-bold uppercase tracking-[0.08em] transition-colors lg:py-2 ${
        ativo
          ? "bg-[#eae8e4] text-tinta"
          : "text-tinta-suave hover:bg-[#eae8e4] hover:text-tinta"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full transition-colors ${
          ativo ? "bg-oliva" : "bg-contorno group-hover:bg-oliva"
        }`}
      />
      {rotulo}
    </Link>
  );
}

export default function AppShell({
  nome,
  sair,
  children,
}: {
  nome: string;
  sair: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const pathname = usePathname();

  // fecha o menu ao trocar de página (mobile)
  useEffect(() => {
    setAberto(false);
  }, [pathname]);

  // trava o scroll do fundo enquanto o menu está aberto
  useEffect(() => {
    document.body.style.overflow = aberto ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [aberto]);

  const rotaAtiva = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="flex min-h-screen">
      {/* ---------- barra superior (só mobile) ---------- */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-contorno bg-papel px-3 lg:hidden">
        <button
          type="button"
          onClick={() => setAberto(true)}
          aria-label="Abrir menu"
          className="flex h-10 w-10 items-center justify-center rounded text-tinta hover:bg-[#eae8e4]"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M3 6h18M3 12h18M3 18h18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <Link href="/" className="font-serif text-lg font-bold text-tinta">
          Brisa
        </Link>
        <form action={sair}>
          <button
            type="submit"
            className="rounded border border-contorno px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-tinta-suave"
          >
            Sair
          </button>
        </form>
      </header>

      {/* ---------- backdrop do drawer (mobile) ---------- */}
      {aberto ? (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setAberto(false)}
          className="fixed inset-0 z-30 bg-tinta/50 lg:hidden"
        />
      ) : null}

      {/* ---------- sidebar / drawer ---------- */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-contorno bg-papel transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-60 lg:translate-x-0 ${
          aberto ? "translate-x-0 shadow-2xl" : "-translate-x-full lg:shadow-none"
        }`}
      >
        <div className="flex items-center justify-between border-b border-contorno px-5 py-5">
          <Link href="/" className="block">
            <div className="font-serif text-2xl font-bold tracking-tight text-tinta">
              Brisa
            </div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-tinta-suave">
              Gestão de Imóveis
            </div>
          </Link>
          {/* fechar (só mobile) */}
          <button
            type="button"
            onClick={() => setAberto(false)}
            aria-label="Fechar menu"
            className="flex h-8 w-8 items-center justify-center rounded text-tinta-suave hover:bg-[#eae8e4] lg:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {MENU.map((grupo) => (
            <div key={grupo.titulo} className="mb-4">
              <div className="px-3 pb-1 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-tinta-suave/70">
                {grupo.titulo}
              </div>
              {grupo.itens.map((item) => (
                <ItemNav
                  key={item.href}
                  href={item.href}
                  rotulo={item.rotulo}
                  ativo={rotaAtiva(item.href)}
                />
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-contorno px-5 py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-tinta">
                {nome}
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
          <p className="mt-3 hidden font-mono text-[10px] leading-relaxed text-tinta-suave lg:block">
            comissão incide só sobre o aluguel recebido — IPTU e condomínio são
            repasses
          </p>
        </div>
      </aside>

      {/* ---------- conteúdo ---------- */}
      <main className="min-w-0 flex-1 px-4 pb-12 pt-20 sm:px-6 lg:px-10 lg:py-8 xl:px-12">
        {children}
      </main>
    </div>
  );
}
