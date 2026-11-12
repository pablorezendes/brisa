import { acessoAtual, exigirPaginaAcesso } from "@/lib/acesso/servidor";
import { podeAbrirRota } from "@/lib/acesso/politica";
import { hrefFinanceiroPeriodo } from "@/lib/consultas/rota-financeira";
import { parsePeriodo } from "@/lib/dominio/periodo";
import { Card, PageHeader, SeletorPeriodo } from "@/components/ui";
import Link from "next/link";

export const metadata = { title: "Relatórios — Brisa" };

export default async function RelatoriosPage({ searchParams }: { searchParams: Promise<{ ano?: string; de?: string; ate?: string }> }) {
  await exigirPaginaAcesso("/relatorios");
  const sp = await searchParams;
  const acesso = await acessoAtual();
  const periodo = parsePeriodo(sp.de, sp.ate);
  const secoes = [
    { href: "/executivo", titulo: "Resultado financeiro", descricao: "Acompanhe os recebimentos, despesas e o saldo de caixa do Widesys." },
    { href: "/recebimentos", titulo: "Inadimplência", descricao: "Consulte os títulos vencidos com saldo em aberto.", filtros: { vencidos: "1" } },
  ].filter(s => podeAbrirRota(acesso, s.href));

  return (
    <div>
      <PageHeader
        titulo="Relatórios"
        descricao="Visões gerenciais dos dados importados do Widesys."
        acoes={<SeletorPeriodo base="/relatorios" periodo={periodo} />}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {secoes.map(s => (
          <Link key={s.href} href={hrefFinanceiroPeriodo(s.href, sp, s.filtros)} className="group">
            <Card className="h-full px-5 py-4 transition-colors group-hover:border-contorno-forte">
              <h2 className="text-base font-semibold group-hover:underline">{s.titulo}</h2>
              <p className="mt-1.5 text-sm text-tinta-suave">{s.descricao}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
