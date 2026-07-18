import type { Metadata } from "next";
import { JetBrains_Mono, Public_Sans, Source_Serif_4 } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "Brisa — Gestão de Imóveis · A.Camargo",
  description:
    "Administração de contratos, recebimentos, temporada e caixa do grupo Brisa/Camargo",
};

const MENU = [
  { href: "/", rotulo: "Início" },
  { href: "/executivo", rotulo: "Executivo" },
  { href: "/recebimentos", rotulo: "Recebimentos" },
  { href: "/contratos", rotulo: "Contratos" },
  { href: "/temporada", rotulo: "Temporada" },
  { href: "/caixa", rotulo: "Caixa" },
  { href: "/relatorios", rotulo: "Relatórios" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${sourceSerif.variable} ${publicSans.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <div className="flex min-h-screen">
          <aside className="flex w-60 shrink-0 flex-col border-r border-contorno bg-papel">
            <Link
              href="/"
              className="block border-b border-contorno px-5 py-5"
            >
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
            <div className="border-t border-contorno px-5 py-4 font-mono text-[10px] leading-relaxed text-tinta-suave">
              comissão incide só sobre o aluguel recebido — IPTU e condomínio
              são repasses
            </div>
          </aside>
          <main className="min-w-0 flex-1 px-12 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
