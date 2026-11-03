import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const sourceSerif = localFont({
  src: "./fonts/source-serif-4-latin.woff2",
  variable: "--font-source-serif",
  weight: "200 900",
  adjustFontFallback: "Times New Roman",
  display: "swap",
});

const publicSans = localFont({
  src: "./fonts/public-sans-latin.woff2",
  variable: "--font-public-sans",
  weight: "100 900",
  display: "swap",
});

const jetbrains = localFont({
  src: "./fonts/jetbrains-mono-latin.woff2",
  variable: "--font-jetbrains",
  weight: "100 800",
  fallback: ["monospace"],
  adjustFontFallback: false,
  display: "swap",
});

export const metadata: Metadata = {
  title: "Brisa — Gestão de Imóveis · A.Camargo",
  description:
    "Administração de contratos, recebimentos, temporada e caixa do grupo Brisa/Camargo",
};

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
      <body className="min-h-full">{children}</body>
    </html>
  );
}
