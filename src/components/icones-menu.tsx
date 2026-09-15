import type { ReactNode } from "react";

/**
 * Vocabulário visual único da navegação.
 *
 * Os nomes descrevem destinos e conceitos, não a aparência do desenho. Isso
 * permite trocar um pictograma sem espalhar decisões de iconografia pelo shell.
 */
export type IconeMenuNome =
  | "inicio"
  | "executivo"
  | "cadastros"
  | "financeiro"
  | "temporada"
  | "analises"
  | "relatorios"
  | "empreendimentos"
  | "unidades"
  | "locatarios"
  | "contratos"
  | "recebimentos"
  | "boletos"
  | "contas-bancarias"
  | "conciliacao"
  | "integracao"
  | "cobranca"
  | "caixa"
  | "comissoes"
  | "reajustes"
  | "historico"
  | "performance"
  | "analitico"
  | "calendario"
  | "ajuda"
  | "chevron-cima"
  | "chevron-direita"
  | "chevron-baixo"
  | "chevron-esquerda"
  | "menu"
  | "recolher"
  | "expandir"
  | "fechar"
  | "sair";

const DESENHOS: Record<IconeMenuNome, ReactNode> = {
  inicio: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="4" rx="1.5" />
      <rect x="14" y="11" width="7" height="10" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  executivo: (
    <>
      <path d="M4.3 17a8.5 8.5 0 1 1 15.4 0" />
      <path d="m12 13 4-4" />
      <path d="M7.2 17h9.6" />
      <circle cx="12" cy="13" r="1" />
    </>
  ),
  cadastros: (
    <>
      <ellipse cx="12" cy="5" rx="7.5" ry="3" />
      <path d="M4.5 5v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V5" />
      <path d="M4.5 10v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-5" />
      <path d="M4.5 15v4c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-4" />
    </>
  ),
  financeiro: (
    <>
      <path d="m3 9 9-5 9 5" />
      <path d="M5 10h14M6 10v7M10 10v7M14 10v7M18 10v7M4 20h16" />
    </>
  ),
  temporada: (
    <>
      <path d="M3 18V8M3 14h18v6M7 14V9h9a4 4 0 0 1 4 4v1" />
      <path d="M7 18v2M20 18v2" />
      <circle cx="6.5" cy="10.5" r="1.5" />
    </>
  ),
  analises: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      <path d="m4 8 6-5 6 7 5-4" />
    </>
  ),
  relatorios: (
    <>
      <path d="M6 2.8h8l4 4V21H6z" />
      <path d="M14 3v4h4M9 17v-3M12 17v-6M15 17v-4" />
    </>
  ),
  empreendimentos: (
    <>
      <path d="M4 21V5l8-3v19M12 8h8v13M2 21h20" />
      <path d="M7 7h2M7 11h2M7 15h2M15 12h2M15 16h2" />
    </>
  ),
  unidades: (
    <>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v11h14V10M9 21v-7h6v7" />
      <path d="M12 17h.01" />
    </>
  ),
  locatarios: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20v-1.5A4.5 4.5 0 0 1 8 14h2a4.5 4.5 0 0 1 4.5 4.5V20" />
      <path d="M15.5 5.3a3 3 0 0 1 0 5.4M17 14a4.5 4.5 0 0 1 3.5 4.4V20" />
    </>
  ),
  contratos: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5M9 12h6M9 16h3" />
      <path d="m13 18 1.5 1.5L18 16" />
    </>
  ),
  recebimentos: (
    <>
      <circle cx="16.5" cy="7.5" r="4.5" />
      <path d="M16.5 5v5M18.2 6h-2.5a1.1 1.1 0 0 0 0 2.2h1.6a1.1 1.1 0 0 1 0 2.2h-2.6" />
      <path d="M3 14.5h4l2 2h5.5a2 2 0 0 1 2 2H9" />
      <path d="M3 19.5h10.5a4 4 0 0 0 2.6-1l4.2-3.5a1.7 1.7 0 0 0-2.2-2.5L15 14.8" />
    </>
  ),
  boletos: (
    <>
      <path d="M6 3h12v18l-2-1.4L14 21l-2-1.4L10 21l-2-1.4L6 21V3Z" />
      <path d="M9 8h6M9 12h1M12 12h1M15 12h1M9 16h6" />
    </>
  ),
  "contas-bancarias": (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 15h3M15.5 15h1.5" />
      <path d="M7 6V4h10v2" />
    </>
  ),
  conciliacao: (
    <>
      <path d="M4 7h12M13 4l3 3-3 3M20 17H8M11 14l-3 3 3 3" />
      <path d="m15.5 13.5 1.7 1.7 3.3-3.7" />
    </>
  ),
  integracao: (
    <>
      <path d="M8 12H3M21 12h-5M8 8V5a4 4 0 0 1 8 0v3M8 16v3a4 4 0 0 0 8 0v-3" />
      <rect x="8" y="8" width="8" height="8" rx="2" />
    </>
  ),
  cobranca: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4M12 7v4M12 14h.01" />
    </>
  ),
  caixa: (
    <>
      <path d="M4 8h15M17 5l3 3-3 3" />
      <path d="M20 16H5M7 13l-3 3 3 3" />
    </>
  ),
  comissoes: (
    <>
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="17" cy="17" r="2.5" />
      <path d="m19 5-14 14" />
    </>
  ),
  reajustes: (
    <>
      <path d="M4 20V10M10 20V6M16 20v-7M22 20H2" />
      <path d="m16 8 3-3 3 3M19 5v7" />
    </>
  ),
  historico: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </>
  ),
  performance: (
    <>
      <path d="M3 20h18" />
      <path d="m4 16 5-5 4 3 7-8" />
      <path d="M15 6h5v5" />
    </>
  ),
  analitico: (
    <>
      <path d="M3 3v18h18" />
      <path d="M6 16c2-1 2.5-5 5-5s2.5 3 5 2 2.5-4 5-5" />
    </>
  ),
  calendario: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18M7 14h4M14 14h3M7 17h2" />
    </>
  ),
  ajuda: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.8 9a2.4 2.4 0 1 1 3.7 2c-.9.6-1.5 1-1.5 2M12 17h.01" />
    </>
  ),
  "chevron-cima": <path d="m6 15 6-6 6 6" />,
  "chevron-direita": <path d="m9 6 6 6-6 6" />,
  "chevron-baixo": <path d="m6 9 6 6 6-6" />,
  "chevron-esquerda": <path d="m15 6-6 6 6 6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  recolher: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18M16 8l-4 4 4 4" />
    </>
  ),
  expandir: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18M12 8l4 4-4 4" />
    </>
  ),
  fechar: <path d="M6 6l12 12M18 6 6 18" />,
  sair: (
    <>
      <path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9" />
    </>
  ),
};

export function IconeMenu({
  nome,
  className = "",
  tamanho = 18,
}: {
  nome: IconeMenuNome;
  className?: string;
  tamanho?: number;
}) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {DESENHOS[nome]}
    </svg>
  );
}
