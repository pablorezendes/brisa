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
  title: "Brisa — Gestão de Imóveis · A.Camargo",
  description:
    "Administração de contratos, recebimentos, temporada e caixa do grupo Brisa/Camargo",
};

const MENU = [
  { href: "/", rotulo: "Início", icone: "◧" },
  { href: "/executivo", rotulo: "Executivo", icone: "◔" },
  { href: "/recebimentos", rotulo: "Recebimentos", icone: "▤" },
  { href: "/contratos", rotulo: "Contratos", icone: "✎" },
  { href: "/temporada", rotulo: "Temporada", icone: "☀" },
  { href: "/caixa", rotulo: "Caixa", icone: "▦" },
  { href: "/relatorios", rotulo: "Relatórios", icone: "≣" },
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
          <aside
            className="flex w-56 shrink-0 flex-col text-slate-100"
            style={{
              background:
                "linear-gradient(180deg, var(--marca-noite) 0%, var(--marca-escura) 100%)",
            }}
          >
            <Link href="/" className="block px-5 py-5">
              <div className="text-xl font-bold tracking-tight">Brisa</div>
              <div
                className="text-[11px] uppercase tracking-widest"
                style={{ color: "var(--marca-clara)" }}
              >
                Gestão de Imóveis
              </div>
            </Link>
            <nav className="flex-1 space-y-0.5 px-2">
              {MENU.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <span
                    className="w-4 text-center text-xs"
                    style={{ color: "var(--marca-laranja)" }}
                  >
                    {item.icone}
                  </span>
                  {item.rotulo}
                </Link>
              ))}
            </nav>
            <div className="px-5 py-4 text-[11px] leading-relaxed text-slate-400">
              Comissão incide só sobre o aluguel recebido — IPTU e condomínio
              são repasses.
            </div>
          </aside>
          <main className="min-w-0 flex-1 px-8 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
