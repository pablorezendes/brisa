import Link from "next/link";
import { IconeMenu, type IconeMenuNome } from "@/components/icones-menu";
import { Badge, Card } from "@/components/ui";

export type SecaoCadastro =
  | "inicio"
  | "empreendimentos"
  | "unidades"
  | "locatarios";

const SECOES: {
  id: SecaoCadastro;
  href: string;
  rotulo: string;
  descricao: string;
  icone: Extract<IconeMenuNome, "inicio" | "empreendimentos" | "unidades" | "locatarios">;
}[] = [
  {
    id: "inicio",
    href: "/cadastros",
    rotulo: "Resumo",
    descricao: "Visão geral dos cadastros",
    icone: "inicio",
  },
  {
    id: "empreendimentos",
    href: "/cadastros/empreendimentos",
    rotulo: "Empreendimentos",
    descricao: "Prédios e grupos patrimoniais",
    icone: "empreendimentos",
  },
  {
    id: "unidades",
    href: "/cadastros/unidades",
    rotulo: "Imóveis",
    descricao: "Salas, casas e unidades",
    icone: "unidades",
  },
  {
    id: "locatarios",
    href: "/cadastros/locatarios",
    rotulo: "Inquilinos",
    descricao: "Pessoas e empresas locatárias",
    icone: "locatarios",
  },
];

export function NavegacaoCadastros({ atual }: { atual: SecaoCadastro }) {
  return (
    <nav
      aria-label="Seções de cadastros"
      className="mb-5 overflow-x-auto rounded-xl border border-contorno bg-carta p-1.5 shadow-[0_1px_2px_rgba(16,35,38,0.035)]"
    >
      <div className="flex min-w-max gap-1">
        {SECOES.map((secao) => {
          const ativa = secao.id === atual;
          return (
            <Link
              key={secao.id}
              href={secao.href}
              aria-current={ativa ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oliva/25 ${
                ativa
                  ? "bg-[#e8f1ee] text-oliva-escura"
                  : "text-tinta-suave hover:bg-[#f5f7f7] hover:text-tinta"
              }`}
            >
              <IconeMenu nome={secao.icone} tamanho={19} />
              <span>
                <span className="block text-[12px] font-bold">{secao.rotulo}</span>
                <span className="hidden text-[10px] leading-tight opacity-75 lg:block">
                  {secao.descricao}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function AvisosCadastro({ ok, erro }: { ok?: string; erro?: string }) {
  return (
    <>
      {erro ? (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-erro/25 bg-erro/5 px-4 py-3 text-[13px] font-medium text-erro"
        >
          {erro}
        </div>
      ) : null}
      {ok ? (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 rounded-lg border border-oliva/25 bg-oliva/5 px-4 py-3 text-[13px] font-medium text-oliva-escura"
        >
          {ok}
        </div>
      ) : null}
    </>
  );
}

export function StatusCadastro({ ativo }: { ativo: boolean }) {
  return ativo ? <Badge cor="verde">Ativo</Badge> : <Badge cor="slate">Inativo</Badge>;
}

export function EstadoVazio({
  titulo,
  texto,
}: {
  titulo: string;
  texto: string;
}) {
  return (
    <div className="px-5 py-12 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-[#eef2f2] text-tinta-suave">
        <IconeMenu nome="inicio" tamanho={19} />
      </div>
      <h2 className="mt-3 text-sm font-bold text-tinta">{titulo}</h2>
      <p className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-tinta-suave">
        {texto}
      </p>
    </div>
  );
}

export function PaginacaoCadastros({
  base,
  pagina,
  total,
  porPagina,
  parametros = {},
}: {
  base: string;
  pagina: number;
  total: number;
  porPagina: number;
  parametros?: Record<string, string | undefined>;
}) {
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  if (totalPaginas <= 1) return null;

  function href(destino: number) {
    const query = new URLSearchParams();
    for (const [chave, valor] of Object.entries(parametros)) {
      if (valor && valor !== "todos") query.set(chave, valor);
    }
    if (destino > 1) query.set("pagina", String(destino));
    const texto = query.toString();
    return texto ? `${base}?${texto}` : base;
  }

  const inicio = (pagina - 1) * porPagina + 1;
  const fim = Math.min(total, pagina * porPagina);
  return (
    <nav
      aria-label="Paginação da lista"
      className="flex flex-col gap-2 border-t border-contorno px-4 py-3 text-[11px] sm:flex-row sm:items-center sm:justify-between"
    >
      <span className="text-tinta-suave">
        Mostrando {inicio}–{fim} de {total}
      </span>
      <div className="flex items-center gap-2">
        {pagina > 1 ? (
          <Link href={href(pagina - 1)} className="font-bold text-oliva-escura hover:underline">
            ← Anterior
          </Link>
        ) : (
          <span className="text-tinta-suave/50">← Anterior</span>
        )}
        <span className="font-mono tabular-nums text-tinta-suave">
          {pagina}/{totalPaginas}
        </span>
        {pagina < totalPaginas ? (
          <Link href={href(pagina + 1)} className="font-bold text-oliva-escura hover:underline">
            Próxima →
          </Link>
        ) : (
          <span className="text-tinta-suave/50">Próxima →</span>
        )}
      </div>
    </nav>
  );
}

export function CartaoModulo({
  href,
  icone,
  titulo,
  descricao,
  total,
  detalhe,
}: {
  href: string;
  icone: Extract<IconeMenuNome, "empreendimentos" | "unidades" | "locatarios">;
  titulo: string;
  descricao: string;
  total: number;
  detalhe: string;
}) {
  return (
    <Link href={href} className="group block focus-visible:outline-none">
      <Card className="h-full p-5 transition-all group-hover:-translate-y-0.5 group-hover:border-[#aebabc] group-hover:shadow-[0_8px_24px_rgba(16,35,38,0.07)] group-focus-visible:ring-2 group-focus-visible:ring-oliva/25">
        <div className="flex items-start justify-between gap-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e8f1ee] text-oliva-escura">
            <IconeMenu nome={icone} tamanho={19} />
          </span>
          <span className="font-mono text-2xl font-bold tabular-nums text-tinta">{total}</span>
        </div>
        <h2 className="mt-4 text-base font-bold tracking-tight text-tinta group-hover:text-oliva-escura">
          {titulo}
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-tinta-suave">{descricao}</p>
        <div className="mt-4 flex items-center justify-between border-t border-contorno/70 pt-3 text-[11px]">
          <span className="text-tinta-suave">{detalhe}</span>
          <span className="font-bold text-oliva-escura">Abrir →</span>
        </div>
      </Card>
    </Link>
  );
}
