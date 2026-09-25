"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IconeMenu, type IconeMenuNome } from "@/components/icones-menu";
import { PERFIS_COMISSOES } from "@/lib/permissoes-comissoes";

type ItemMenu = {
  tipo: "link";
  href: string;
  rotulo: string;
  icone?: IconeMenuNome;
  correspondencia?: "exata" | "prefixo";
  perfis?: readonly string[];
};

type ModuloMenu = {
  tipo: "modulo";
  id: string;
  rotulo: string;
  icone: IconeMenuNome;
  itens: ItemMenu[];
};

type EntradaMenu = ItemMenu | ModuloMenu;

const MENU: { titulo: string; itens: EntradaMenu[] }[] = [
  {
    titulo: "Visão",
    itens: [
      { tipo: "link", href: "/", rotulo: "Visão geral", icone: "inicio", correspondencia: "exata" },
      { tipo: "link", href: "/executivo", rotulo: "Executivo", icone: "executivo" },
    ],
  },
  {
    titulo: "Módulos",
    itens: [
      {
        tipo: "modulo",
        id: "cadastros",
        rotulo: "Cadastros",
        icone: "cadastros",
        itens: [
          { tipo: "link", href: "/cadastros", rotulo: "Visão cadastral", correspondencia: "exata" },
          { tipo: "link", href: "/cadastros/base-unificada", rotulo: "Base unificada", icone: "integracao", perfis: ["ADMINISTRADOR", "FINANCEIRO"] },
          { tipo: "link", href: "/cadastros/pessoas", rotulo: "Pessoas e empresas", icone: "pessoas" },
          { tipo: "link", href: "/cadastros/imoveis-legado", rotulo: "Imóveis do legado", icone: "imoveis-legado" },
          { tipo: "link", href: "/cadastros/empreendimentos", rotulo: "Empreendimentos", icone: "empreendimentos" },
          { tipo: "link", href: "/cadastros/unidades", rotulo: "Imóveis e unidades", icone: "unidades" },
          { tipo: "link", href: "/cadastros/locatarios", rotulo: "Inquilinos", icone: "locatarios" },
          { tipo: "link", href: "/contratos", rotulo: "Contratos", icone: "contratos" },
        ],
      },
      {
        tipo: "modulo",
        id: "financeiro",
        rotulo: "Financeiro",
        icone: "financeiro",
        itens: [
          { tipo: "link", href: "/financeiro", rotulo: "Visão financeira", correspondencia: "exata" },
          { tipo: "link", href: "/recebimentos", rotulo: "Contas a receber", icone: "recebimentos" },
          { tipo: "link", href: "/financeiro/contas-a-pagar", rotulo: "Contas a pagar", icone: "financeiro", perfis: ["ADMINISTRADOR", "FINANCEIRO"] },
          { tipo: "link", href: "/financeiro/boletos", rotulo: "Boletos", icone: "boletos" },
          { tipo: "link", href: "/paineis/cobranca", rotulo: "Cobrança e atrasos", icone: "cobranca" },
          { tipo: "link", href: "/financeiro/automacoes", rotulo: "Central de comunicação", icone: "mensagens", perfis: ["ADMINISTRADOR"] },
          { tipo: "link", href: "/financeiro/notas-fiscais", rotulo: "Notas fiscais de serviço", icone: "notas-fiscais", perfis: ["ADMINISTRADOR"] },
          { tipo: "link", href: "/financeiro/contas-bancarias", rotulo: "Contas bancárias", icone: "contas-bancarias" },
          { tipo: "link", href: "/financeiro/conciliacao", rotulo: "Conciliação bancária", icone: "conciliacao" },
          {
            tipo: "link",
            href: "/financeiro/migracao-widesys",
            rotulo: "Migração Widesys",
            icone: "integracao",
            perfis: ["ADMINISTRADOR", "FINANCEIRO"],
          },
          { tipo: "link", href: "/caixa", rotulo: "Movimentações de caixa", icone: "caixa" },
          { tipo: "link", href: "/unificacao", rotulo: "Resolver duplicidades", icone: "conciliacao", perfis: ["ADMINISTRADOR", "FINANCEIRO"] },
          { tipo: "link", href: "/financeiro/comissoes", rotulo: "Comissões", icone: "comissoes", perfis: PERFIS_COMISSOES },
        ],
      },
      {
        tipo: "modulo",
        id: "temporada",
        rotulo: "Temporada",
        icone: "temporada",
        itens: [
          { tipo: "link", href: "/temporada", rotulo: "Operação mensal", icone: "calendario", correspondencia: "exata" },
          { tipo: "link", href: "/temporada/historico", rotulo: "Histórico", icone: "historico" },
        ],
      },
      {
        tipo: "modulo",
        id: "analises",
        rotulo: "Análises",
        icone: "analises",
        itens: [
          { tipo: "link", href: "/relatorios", rotulo: "Central de relatórios", icone: "relatorios", correspondencia: "exata" },
          { tipo: "link", href: "/relatorios/inadimplencia", rotulo: "Inadimplência", icone: "cobranca" },
          { tipo: "link", href: "/relatorios/resultado", rotulo: "Resultado por unidade", icone: "performance" },
          { tipo: "link", href: "/paineis/empreendimentos", rotulo: "Performance por imóvel", icone: "empreendimentos" },
          { tipo: "link", href: "/paineis/caixa", rotulo: "Análise de caixa", icone: "analitico" },
          { tipo: "link", href: "/paineis/temporada", rotulo: "Temporada anual", icone: "calendario" },
        ],
      },
    ],
  },
  {
    titulo: "Suporte",
    itens: [
      { tipo: "link", href: "/ajuda", rotulo: "Como funciona", icone: "ajuda" },
    ],
  },
];

const ITENS_COM_CONTEXTO = MENU.flatMap((grupo) =>
  grupo.itens.flatMap((entrada) =>
    entrada.tipo === "modulo"
      ? entrada.itens.map((item) => ({ item, contexto: entrada.rotulo }))
      : [{ item: entrada, contexto: grupo.titulo }]
  )
).sort((a, b) => b.item.href.length - a.item.href.length);

function rotaAtiva(pathname: string, item: ItemMenu) {
  if (item.correspondencia === "exata" || item.href === "/") {
    return pathname === item.href;
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function MarcaBrisa({
  compacta = false,
  apenasIcone = false,
}: {
  compacta?: boolean;
  apenasIcone?: boolean;
}) {
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
          <span className="block text-[21px] font-bold leading-none tracking-[-0.03em] text-white">Brisa</span>
          <span className="mt-1 block text-[9px] font-semibold uppercase tracking-[0.22em] text-[#8fa5a7]">Gestão de imóveis</span>
        </span>
      ) : null}
    </Link>
  );
}

function ItemNav({
  item,
  ativo,
  aoNavegar,
  compacto,
  submenu = false,
}: {
  item: ItemMenu;
  ativo: boolean;
  aoNavegar: () => void;
  compacto: boolean;
  submenu?: boolean;
}) {
  return (
    <Link
      href={item.href}
      onClick={aoNavegar}
      title={compacto ? item.rotulo : undefined}
      aria-current={ativo ? "page" : undefined}
      className={`group relative flex min-h-10 items-center gap-3 rounded-lg py-2 text-[13px] font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#72d3b4] ${submenu ? "px-2.5" : "px-3"} ${compacto ? "lg:justify-center lg:px-2" : ""} ${
        ativo
          ? "bg-white/[0.09] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
          : "text-[#aebcbd] hover:bg-white/[0.055] hover:text-white"
      }`}
    >
      {ativo ? <span className="absolute -left-2 h-5 w-[3px] rounded-r-full bg-[#59c7a3]" /> : null}
      {item.icone ? (
        <span className={`shrink-0 transition-colors ${ativo ? "text-[#72d3b4]" : "text-[#74898b] group-hover:text-[#a8bbb9]"}`}>
          <IconeMenu nome={item.icone} />
        </span>
      ) : (
        <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${ativo ? "bg-[#72d3b4]" : "bg-[#50676a] group-hover:bg-[#82999b]"}`} />
      )}
      <span className={`truncate ${compacto ? "lg:sr-only" : ""}`}>{item.rotulo}</span>
    </Link>
  );
}

function ModuloNav({
  modulo,
  pathname,
  expandido,
  compacto,
  aoAlternar,
  aoNavegar,
}: {
  modulo: ModuloMenu;
  pathname: string;
  expandido: boolean;
  compacto: boolean;
  aoAlternar: () => void;
  aoNavegar: () => void;
}) {
  const ativo = modulo.itens.some((item) => rotaAtiva(pathname, item));
  const idConteudo = `submenu-${modulo.id}`;
  const submenuVisivel = expandido && !compacto;

  return (
    <div>
      <button
        type="button"
        onClick={aoAlternar}
        title={compacto ? `${modulo.rotulo} — abrir submenu` : undefined}
        aria-expanded={submenuVisivel}
        aria-controls={idConteudo}
        className={`group relative flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#72d3b4] ${compacto ? "lg:justify-center lg:px-2" : ""} ${
          ativo
            ? "bg-white/[0.09] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
            : "text-[#c0cbcc] hover:bg-white/[0.055] hover:text-white"
        }`}
      >
        {ativo ? <span className="absolute -left-2 h-5 w-[3px] rounded-r-full bg-[#59c7a3]" /> : null}
        <span className={`shrink-0 ${ativo ? "text-[#72d3b4]" : "text-[#829698] group-hover:text-[#b3c2c1]"}`}>
          <IconeMenu nome={modulo.icone} />
        </span>
        <span className={`min-w-0 flex-1 truncate ${compacto ? "lg:sr-only" : ""}`}>{modulo.rotulo}</span>
        <span className={`text-[#6f8587] transition-transform duration-200 ${expandido ? "rotate-90" : ""} ${compacto ? "lg:hidden" : ""}`}>
          <IconeMenu nome="chevron-direita" className="h-4 w-4" />
        </span>
      </button>

      <div
        id={idConteudo}
        aria-hidden={!submenuVisivel}
        inert={!submenuVisivel ? true : undefined}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          submenuVisivel
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0"
        } ${compacto ? "lg:hidden" : ""}`}
      >
        <div className="overflow-hidden">
          <div className="ml-5 mt-1 space-y-0.5 border-l border-white/[0.09] pl-2">
            {modulo.itens.map((item) => (
              <ItemNav
                key={item.href}
                item={item}
                ativo={rotaAtiva(pathname, item)}
                aoNavegar={aoNavegar}
                compacto={false}
                submenu
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AppShell({
  nome,
  perfil,
  sair,
  children,
}: {
  nome: string;
  perfil: string;
  sair: () => Promise<void>;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);
  const [recolhida, setRecolhida] = useState(false);
  const [estadoModulos, setEstadoModulos] = useState<{
    pathname: string;
    valores: Record<string, boolean>;
  }>({ pathname: "", valores: {} });
  const botaoAbrirRef = useRef<HTMLButtonElement>(null);
  const botaoFecharRef = useRef<HTMLButtonElement>(null);
  const painelMenuRef = useRef<HTMLElement>(null);
  const modulosAbertos = estadoModulos.pathname === pathname
    ? estadoModulos.valores
    : {};
  const menuVisivel = MENU.map((grupo) => ({
    ...grupo,
    itens: grupo.itens.map((entrada) =>
      entrada.tipo === "modulo"
        ? {
            ...entrada,
            itens: entrada.itens.filter(
              (item) => !item.perfis || item.perfis.includes(perfil),
            ),
          }
        : entrada,
    ),
  }));

  useEffect(() => {
    if (!aberto) return;

    const focoAnterior = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : botaoAbrirRef.current;
    document.body.style.overflow = "hidden";
    const quadroFoco = window.requestAnimationFrame(() => botaoFecharRef.current?.focus());

    function controlarTeclado(evento: KeyboardEvent) {
      if (evento.key === "Escape") {
        evento.preventDefault();
        setAberto(false);
        return;
      }
      if (evento.key !== "Tab" || !painelMenuRef.current) return;

      const focaveis = Array.from(
        painelMenuRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((elemento) => elemento.offsetParent !== null);
      if (focaveis.length === 0) return;

      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (evento.shiftKey && document.activeElement === primeiro) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primeiro.focus();
      } else if (!painelMenuRef.current.contains(document.activeElement)) {
        evento.preventDefault();
        primeiro.focus();
      }
    }

    document.addEventListener("keydown", controlarTeclado);
    return () => {
      window.cancelAnimationFrame(quadroFoco);
      document.body.style.overflow = "";
      document.removeEventListener("keydown", controlarTeclado);
      if (focoAnterior?.isConnected) focoAnterior.focus();
    };
  }, [aberto]);

  const itemAtual = ITENS_COM_CONTEXTO.find(({ item }) => rotaAtiva(pathname, item));
  const iniciais = nome.split(/\s+/).filter(Boolean).slice(0, 2).map((parte) => parte[0]?.toUpperCase()).join("") || "B";

  function alternarModulo(modulo: ModuloMenu) {
    if (recolhida) {
      setRecolhida(false);
      setEstadoModulos({ pathname, valores: { [modulo.id]: true } });
      return;
    }

    const contemRotaAtiva = modulo.itens.some((item) => rotaAtiva(pathname, item));
    setEstadoModulos((estadoAtual) => {
      const atuais = estadoAtual.pathname === pathname ? estadoAtual.valores : {};
      const foiAlterado = Object.prototype.hasOwnProperty.call(atuais, modulo.id);
      const expandidoAgora = foiAlterado ? atuais[modulo.id] : contemRotaAtiva;
      return {
        pathname,
        valores: { [modulo.id]: !expandidoAgora },
      };
    });
  }

  return (
    <div className="min-h-screen bg-[#f3f6f7]">
      <header
        inert={aberto ? true : undefined}
        className="fixed inset-x-0 top-0 z-30 flex h-[58px] items-center justify-between border-b border-white/10 bg-[#102326] px-4 lg:hidden"
      >
        <button
          ref={botaoAbrirRef}
          type="button"
          onClick={() => {
            setRecolhida(false);
            setAberto(true);
          }}
          aria-label="Abrir menu"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10"
        >
          <IconeMenu nome="menu" className="h-[21px] w-[21px]" />
        </button>
        <MarcaBrisa apenasIcone />
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-[11px] font-bold text-white">{iniciais}</span>
      </header>

      {aberto ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setAberto(false)}
          className="fixed inset-0 z-30 bg-[#071214]/70 backdrop-blur-[2px] lg:hidden"
        />
      ) : null}

      <aside
        ref={painelMenuRef}
        role={aberto ? "dialog" : undefined}
        aria-modal={aberto ? "true" : undefined}
        aria-label={aberto ? "Menu principal" : undefined}
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
          <IconeMenu nome="recolher" className={`h-3.5 w-3.5 transition-transform ${recolhida ? "rotate-180" : ""}`} />
        </button>

        <div className={`flex h-[76px] items-center justify-between border-b border-white/[0.08] px-5 ${recolhida ? "lg:justify-center lg:px-0" : ""}`}>
          <MarcaBrisa compacta={recolhida} />
          <button ref={botaoFecharRef} type="button" onClick={() => setAberto(false)} aria-label="Fechar menu" className="flex h-8 w-8 items-center justify-center rounded-lg text-[#9aabad] hover:bg-white/10 hover:text-white lg:hidden">
            <IconeMenu nome="fechar" className="h-[19px] w-[19px]" />
          </button>
        </div>

        <nav aria-label="Navegação principal" className={`flex-1 overflow-y-auto px-4 py-4 ${recolhida ? "lg:px-2.5" : ""}`}>
          {menuVisivel.map((grupo) => (
            <div key={grupo.titulo} className="mb-4 last:mb-0">
              <div className={`mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.17em] text-[#829698] ${recolhida ? "lg:sr-only" : ""}`}>
                {grupo.titulo}
              </div>
              <div className="space-y-0.5">
                {grupo.itens.map((entrada) => {
                  if (entrada.tipo === "link") {
                    return (
                      <ItemNav
                        key={entrada.href}
                        item={entrada}
                        ativo={rotaAtiva(pathname, entrada)}
                        aoNavegar={() => {
                          setEstadoModulos({ pathname, valores: {} });
                          setAberto(false);
                        }}
                        compacto={recolhida}
                      />
                    );
                  }

                  const moduloAtivo = entrada.itens.some((item) => rotaAtiva(pathname, item));
                  const foiAlterado = Object.prototype.hasOwnProperty.call(
                    modulosAbertos,
                    entrada.id,
                  );
                  const expandido = foiAlterado
                    ? modulosAbertos[entrada.id]
                    : moduloAtivo;

                  return (
                    <ModuloNav
                      key={entrada.id}
                      modulo={entrada}
                      pathname={pathname}
                      expandido={expandido}
                      compacto={recolhida}
                      aoAlternar={() => alternarModulo(entrada)}
                      aoNavegar={() => {
                        setEstadoModulos({ pathname, valores: { [entrada.id]: true } });
                        setAberto(false);
                      }}
                    />
                  );
                })}
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
              <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#7f9698]">
                {perfil.toLocaleLowerCase("pt-BR").replaceAll("_", " ")}
              </div>
            </div>
            <form action={sair}>
              <button type="submit" title="Sair do sistema" aria-label="Sair do sistema" className="flex h-8 w-8 items-center justify-center rounded-lg text-[#829799] transition-colors hover:bg-white/10 hover:text-white">
                <IconeMenu nome="sair" className="h-4 w-4" />
              </button>
            </form>
          </div>
          <p className={`mt-3 px-1 text-[10px] leading-relaxed text-[#6f8587] ${recolhida ? "lg:hidden" : ""}`}>
            Gestão financeira centralizada<br />Grupo Brisa · A.Camargo
          </p>
        </div>
      </aside>

      <div
        inert={aberto ? true : undefined}
        className={`min-w-0 transition-[margin] duration-200 ease-out ${recolhida ? "lg:ml-[78px]" : "lg:ml-[268px]"}`}
      >
        <div className="sticky top-0 z-20 hidden h-[64px] items-center justify-between border-b border-[#dde5e7] bg-white/95 px-8 backdrop-blur-sm lg:flex">
          <div className="flex items-center gap-2 text-[12px] text-[#596b6f]">
            <span className="font-medium">{itemAtual?.contexto ?? "Gestão imobiliária"}</span>
            <span className="text-[#c0c9cb]">/</span>
            <span className="font-semibold text-[#25383b]">{itemAtual?.item.rotulo ?? "Brisa"}</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-2 text-[11px] font-medium text-[#596b6f]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#35a56f] shadow-[0_0_0_3px_rgba(53,165,111,0.12)]" />
              Sistema atualizado
            </span>
            <span className="h-5 w-px bg-[#dde5e7]" />
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e7efed] text-[10px] font-bold text-[#315e55]">{iniciais}</span>
          </div>
        </div>

        <main className="app-content min-w-0 px-4 pb-12 pt-[78px] sm:px-6 lg:px-7 lg:py-6 xl:px-8 2xl:px-10">{children}</main>
      </div>
    </div>
  );
}
