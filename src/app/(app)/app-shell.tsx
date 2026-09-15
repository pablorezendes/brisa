"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type IconeNome =
  | "inicio"
  | "executivo"
  | "recebimentos"
  | "contratos"
  | "temporada"
  | "caixa"
  | "cobranca"
  | "empreendimentos"
  | "analitico"
  | "calendario"
  | "relatorios"
  | "ajuda";

const MENU: {
  titulo: string;
  itens: { href: string; rotulo: string; icone: IconeNome }[];
}[] = [
  {
    titulo: "Visão",
    itens: [
      { href: "/", rotulo: "Visão geral", icone: "inicio" },
      { href: "/executivo", rotulo: "Executivo", icone: "executivo" },
    ],
  },
  {
    titulo: "Operação",
    itens: [
      { href: "/recebimentos", rotulo: "Recebimentos", icone: "recebimentos" },
      { href: "/contratos", rotulo: "Contratos", icone: "contratos" },
      { href: "/temporada", rotulo: "Temporada", icone: "temporada" },
      { href: "/caixa", rotulo: "Caixa", icone: "caixa" },
    ],
  },
  {
    titulo: "Análise",
    itens: [
      { href: "/paineis/cobranca", rotulo: "Cobrança", icone: "cobranca" },
      {
        href: "/paineis/empreendimentos",
        rotulo: "Empreendimentos",
        icone: "empreendimentos",
      },
      { href: "/paineis/caixa", rotulo: "Caixa analítico", icone: "analitico" },
      {
        href: "/paineis/temporada",
        rotulo: "Temporada anual",
        icone: "calendario",
      },
      { href: "/relatorios", rotulo: "Relatórios", icone: "relatorios" },
    ],
  },
  {
    titulo: "Suporte",
    itens: [{ href: "/ajuda", rotulo: "Como funciona", icone: "ajuda" }],
  },
];

function Icone({ nome, className = "" }: { nome: IconeNome; className?: string }) {
  const comum = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className,
  };

  switch (nome) {
    case "inicio":
      return <svg {...comum}><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></svg>;
    case "executivo":
      return <svg {...comum}><path d="M4 19V9M10 19V5M16 19v-7M22 19H2" /></svg>;
    case "recebimentos":
      return <svg {...comum}><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h3" /></svg>;
    case "contratos":
      return <svg {...comum}><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h5" /></svg>;
    case "temporada":
      return <svg {...comum}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" /></svg>;
    case "caixa":
      return <svg {...comum}><path d="M3 7h16a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2z" /><path d="M3 7V6a2 2 0 0 1 2-2h12v3M16 12h5" /></svg>;
    case "cobranca":
      return <svg {...comum}><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 17h.01" /></svg>;
    case "empreendimentos":
      return <svg {...comum}><path d="M4 21V5l8-3v19M12 8h8v13M2 21h20M7 7h2M7 11h2M7 15h2M15 12h2M15 16h2" /></svg>;
    case "analitico":
      return <svg {...comum}><path d="M3 3v18h18" /><path d="m7 16 4-5 3 2 5-7" /></svg>;
    case "calendario":
      return <svg {...comum}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" /></svg>;
    case "relatorios":
      return <svg {...comum}><path d="M5 3h14v18H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>;
    case "ajuda":
      return <svg {...comum}><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.4 2.4 0 1 1 3.7 2c-.9.6-1.5 1-1.5 2M12 17h.01" /></svg>;
  }
}

function MarcaBrisa({ compacta = false, apenasIcone = false }: { compacta?: boolean; apenasIcone?: boolean }) {
  return (
    <Link href="/" className="group flex items-center gap-3" aria-label="Brisa — início">
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/15 bg-white/[0.07] text-[#72d3b4]">
        <svg width="27" height="27" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <path d="M8 6h9.5a5.5 5.5 0 0 1 0 11H8V6Z" stroke="currentColor" strokeWidth="2.4" />
          <path d="M8 17h11a5 5 0 0 1 0 10H8V17Z" stroke="currentColor" strokeWidth="2.4" />
          <path d="M3 10c2.2 0 3.1 1.2 5 1.2S10.8 10 13 10" stroke="#fff" strokeOpacity=".78" strokeWidth="1.6" />
        </svg>
      </span>
      {!apenasIcone ? (
        <span className={`min-w-0 ${compacta ? "lg:hidden" : ""}`}>
          <span className="block text-[21px] font-bold leading-none tracking-[-0.03em] text-white">
            Brisa
          </span>
          <span className="mt-1 block text-[9px] font-semibold uppercase tracking-[0.22em] text-[#8fa5a7]">
            Gestão de imóveis
          </span>
        </span>
      ) : null}
    </Link>
  );
}

function ItemNav({ href, rotulo, icone, ativo, aoNavegar, compacto }: {
  href: string;
  rotulo: string;
  icone: IconeNome;
  ativo: boolean;
  aoNavegar: () => void;
  compacto: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={aoNavegar}
      title={compacto ? rotulo : undefined}
      aria-current={ativo ? "page" : undefined}
      className={`group relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#72d3b4] ${compacto ? "lg:justify-center lg:px-2" : ""} ${
        ativo
          ? "bg-white/[0.09] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
          : "text-[#aebcbd] hover:bg-white/[0.055] hover:text-white"
      }`}
    >
      {ativo ? <span className="absolute -left-2 h-5 w-[3px] rounded-r-full bg-[#59c7a3]" /> : null}
      <span className={`transition-colors ${ativo ? "text-[#72d3b4]" : "text-[#74898b] group-hover:text-[#a8bbb9]"}`}>
        <Icone nome={icone} />
      </span>
      <span className={`truncate ${compacto ? "lg:sr-only" : ""}`}>{rotulo}</span>
    </Link>
  );
}

export default function AppShell({ nome, sair, children }: {
  nome: string;
  sair: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const [recolhida, setRecolhida] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    document.body.style.overflow = aberto ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [aberto]);

  const rotaAtiva = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);
  const itemAtual = MENU.flatMap((grupo) => grupo.itens).find((item) => rotaAtiva(item.href));
  const iniciais = nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase())
    .join("") || "B";

  return (
    <div className="min-h-screen bg-[#f3f6f7]">
      <header className="fixed inset-x-0 top-0 z-30 flex h-[58px] items-center justify-between border-b border-white/10 bg-[#102326] px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setAberto(true)}
          aria-label="Abrir menu"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10"
        >
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <MarcaBrisa apenasIcone />
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-[11px] font-bold text-white">
          {iniciais}
        </span>
      </header>

      {aberto ? (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setAberto(false)}
          className="fixed inset-0 z-30 bg-[#071214]/70 backdrop-blur-[2px] lg:hidden"
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[268px] flex-col border-r border-[#213b3e] bg-[#102326] transition-[width,transform] duration-200 ease-out lg:flex lg:h-screen lg:translate-x-0 ${recolhida ? "lg:w-[78px]" : "lg:w-[268px]"} ${
          aberto ? "flex translate-x-0 shadow-2xl" : "hidden -translate-x-full lg:shadow-none"
        }`}
      >
        <button
          type="button"
          onClick={() => setRecolhida((valor) => !valor)}
          title={recolhida ? "Expandir menu" : "Recolher menu"}
          aria-label={recolhida ? "Expandir menu" : "Recolher menu"}
          className="absolute -right-3.5 top-6 z-10 hidden h-7 w-7 items-center justify-center rounded-full border border-[#d6e0e2] bg-white text-[#50666a] shadow-[0_3px_10px_rgba(11,30,33,0.14)] transition-colors hover:border-[#aebdc0] hover:text-oliva lg:flex"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`transition-transform ${recolhida ? "rotate-180" : ""}`}>
            <path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className={`flex h-[76px] items-center justify-between border-b border-white/[0.08] px-5 ${recolhida ? "lg:justify-center lg:px-0" : ""}`}>
          <MarcaBrisa compacta={recolhida} />
          <button
            type="button"
            onClick={() => setAberto(false)}
            aria-label="Fechar menu"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#9aabad] hover:bg-white/10 hover:text-white lg:hidden"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <nav className={`flex-1 overflow-y-auto px-4 py-4 ${recolhida ? "lg:px-2.5" : ""}`}>
          {MENU.map((grupo) => (
            <div key={grupo.titulo} className="mb-4 last:mb-0">
              <div className={`mb-1.5 px-3 text-[9px] font-bold uppercase tracking-[0.19em] text-[#647a7c] ${recolhida ? "lg:sr-only" : ""}`}>
                {grupo.titulo}
              </div>
              <div className="space-y-0.5">
                {grupo.itens.map((item) => (
                  <ItemNav
                    key={item.href}
                    href={item.href}
                    rotulo={item.rotulo}
                    icone={item.icone}
                    ativo={rotaAtiva(item.href)}
                    aoNavegar={() => setAberto(false)}
                    compacto={recolhida}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className={`border-t border-white/[0.08] p-4 ${recolhida ? "lg:px-2.5" : ""}`}>
          <div className={`flex items-center gap-3 rounded-xl bg-white/[0.055] p-2.5 ${recolhida ? "lg:flex-col lg:gap-2 lg:px-1.5" : ""}`}>
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#244448] text-[11px] font-bold text-[#dff8ef]">
              {iniciais}
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#183034] bg-[#59c774]" />
            </span>
            <div className={`min-w-0 flex-1 ${recolhida ? "lg:hidden" : ""}`}>
              <div className="truncate text-[12px] font-semibold text-white">{nome}</div>
              <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#7f9698]">Administrador</div>
            </div>
            <form action={sair}>
              <button
                type="submit"
                title="Sair do sistema"
                aria-label="Sair do sistema"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#829799] transition-colors hover:bg-white/10 hover:text-white"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </form>
          </div>
          <p className={`mt-3 px-1 text-[10px] leading-relaxed text-[#6f8587] ${recolhida ? "lg:hidden" : ""}`}>
            Gestão financeira centralizada<br />Grupo Brisa · A.Camargo
          </p>
        </div>
      </aside>

      <div className={`min-w-0 transition-[margin] duration-200 ease-out ${recolhida ? "lg:ml-[78px]" : "lg:ml-[268px]"}`}>
        <div className="sticky top-0 z-20 hidden h-[64px] items-center justify-between border-b border-[#dde5e7] bg-white/95 px-8 backdrop-blur-sm lg:flex">
          <div className="flex items-center gap-2 text-[12px] text-[#7b898d]">
            <span className="font-medium">Gestão imobiliária</span>
            <span className="text-[#c0c9cb]">/</span>
            <span className="font-semibold text-[#25383b]">{itemAtual?.rotulo ?? "Brisa"}</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-2 text-[11px] font-medium text-[#718085]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#35a56f] shadow-[0_0_0_3px_rgba(53,165,111,0.12)]" />
              Sistema atualizado
            </span>
            <span className="h-5 w-px bg-[#dde5e7]" />
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e7efed] text-[10px] font-bold text-[#315e55]">{iniciais}</span>
          </div>
        </div>

        <main className="app-content min-w-0 px-4 pb-12 pt-[78px] sm:px-6 lg:px-7 lg:py-6 xl:px-8 2xl:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
