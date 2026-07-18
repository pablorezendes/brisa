import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Brisa — Gestão de Imóveis",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <div className="flex min-h-screen">
          <aside className="w-52 shrink-0 bg-slate-900 text-slate-100 flex flex-col">
            <Link href="/" className="px-5 py-5 block">
              <div className="text-lg font-bold tracking-tight">Brisa</div>
              <div className="text-[11px] text-slate-400 uppercase tracking-widest">
                Gestão de Imóveis
              </div>
            </Link>
            <nav className="flex-1 px-2 space-y-0.5">
              {MENU.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
                >
                  {item.rotulo}
                </Link>
              ))}
            </nav>
            <div className="px-5 py-4 text-[11px] text-slate-500">
              comissão sobre aluguel recebido
              <br />— IPTU e condomínio são repasses
            </div>
          </aside>
          <main className="flex-1 min-w-0 px-8 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
