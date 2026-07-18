import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { mesMaisRecenteComLancamentos } from "@/lib/consultas/relatorios";
import { parseCompetencia } from "@/lib/dominio/normalizacao";
import { SeletorAno, anoDaQuery } from "./seletor-ano";

export const metadata = { title: "Relatórios — Brisa" };

const SECOES = (ano: number, mes: string) => [
  {
    href: `/relatorios/comissao?ano=${ano}`,
    titulo: "Matriz de comissão",
    descricao:
      "Comissão por empreendimento × mês (JAN–DEZ), com totais por linha e por mês. Equivale à aba COMISSÃO da planilha.",
  },
  {
    href: `/relatorios/resultado?ano=${ano}`,
    titulo: "Resultado consolidado",
    descricao:
      "Recebidos, IPTU, condomínio, base de cálculo e comissão acumulados no ano, por unidade. Equivale à aba RESULTADO.",
  },
  {
    href: `/relatorios/inadimplencia?mes=${mes}`,
    titulo: "Inadimplência",
    descricao:
      "Lançamentos com total devido e sem recebimento no mês, com dias desde o vencimento.",
  },
];

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string }>;
}) {
  const sp = await searchParams;
  const mesRecente = await mesMaisRecenteComLancamentos();
  const ano = anoDaQuery(sp.ano, parseCompetencia(mesRecente).ano);

  return (
    <div>
      <PageHeader
        titulo="Relatórios"
        descricao="Visões gerenciais derivadas dos recebimentos — as mesmas da planilha, sempre atualizadas."
        acoes={<SeletorAno base="/relatorios" ano={ano} />}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECOES(ano, mesRecente).map((s) => (
          <Link key={s.href} href={s.href} className="group">
            <Card className="h-full px-5 py-4 transition-colors group-hover:border-slate-400">
              <div className="text-base font-semibold group-hover:underline">
                {s.titulo}
              </div>
              <p className="mt-1.5 text-sm text-slate-500">{s.descricao}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
