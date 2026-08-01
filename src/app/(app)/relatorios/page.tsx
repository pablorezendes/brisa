import Link from "next/link";
import { Card, PageHeader, SeletorPeriodo } from "@/components/ui";
import { mesMaisRecenteComLancamentos } from "@/lib/consultas/relatorios";
import { parseCompetencia } from "@/lib/dominio/normalizacao";
import { parsePeriodo } from "@/lib/dominio/periodo";
import { SeletorAno, anoDaQuery } from "./seletor-ano";

export const metadata = { title: "Relatórios — Brisa" };

const SECOES = (ano: number, mes: string, qsPeriodo: string | null) => [
  {
    href: qsPeriodo
      ? `/relatorios/comissao?${qsPeriodo}`
      : `/relatorios/comissao?ano=${ano}`,
    titulo: "Matriz de comissão",
    descricao:
      "Comissão por empreendimento × mês, com totais por linha e por mês. Equivale à aba COMISSÃO da planilha.",
  },
  {
    href: qsPeriodo
      ? `/relatorios/resultado?${qsPeriodo}`
      : `/relatorios/resultado?ano=${ano}`,
    titulo: "Resultado consolidado",
    descricao:
      "Recebidos, IPTU, condomínio, base de cálculo e comissão acumulados na janela, por unidade. Equivale à aba RESULTADO.",
  },
  {
    href: qsPeriodo
      ? `/relatorios/inadimplencia?${qsPeriodo}`
      : `/relatorios/inadimplencia?mes=${mes}`,
    titulo: "Inadimplência",
    descricao:
      "Lançamentos com total devido e sem recebimento, com dias desde o vencimento.",
  },
];

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string; de?: string; ate?: string }>;
}) {
  const sp = await searchParams;
  const periodo = parsePeriodo(sp.de, sp.ate);
  const mesRecente = await mesMaisRecenteComLancamentos();
  const ano = anoDaQuery(sp.ano, parseCompetencia(mesRecente).ano);
  const qsPeriodo = periodo ? `de=${periodo.de}&ate=${periodo.ate}` : null;

  return (
    <div>
      <PageHeader
        titulo="Relatórios"
        descricao={
          periodo
            ? `Visões gerenciais derivadas dos recebimentos — cada relatório abaixo já abre no período ${periodo.rotulo}.`
            : "Visões gerenciais derivadas dos recebimentos — as mesmas da planilha, sempre atualizadas."
        }
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            {!periodo ? <SeletorAno base="/relatorios" ano={ano} /> : null}
            <SeletorPeriodo base="/relatorios" periodo={periodo} />
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECOES(ano, mesRecente, qsPeriodo).map((s) => (
          <Link key={s.href} href={s.href} className="group">
            <Card className="h-full px-5 py-4 transition-colors group-hover:border-contorno-forte">
              <div className="text-base font-semibold group-hover:underline">
                {s.titulo}
              </div>
              <p className="mt-1.5 text-sm text-tinta-suave">{s.descricao}</p>
            </Card>
          </Link>
        ))}
      </div>
      <p className="mt-4 text-xs text-tinta-suave">
        Todo relatório também aceita análise por período: use o botão
        &ldquo;Período&rdquo; para escolher as datas no calendário — a tela
        passa a somar exatamente os meses da janela, e o Excel exportado
        acompanha.
      </p>
    </div>
  );
}
