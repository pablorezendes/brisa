import { Card, Dinheiro, PageHeader, btnSecundario } from "@/components/ui";
import {
  mesMaisRecenteComLancamentos,
  resultadoConsolidado,
} from "@/lib/consultas/relatorios";
import { parseCompetencia } from "@/lib/dominio/normalizacao";
import { SeletorAno, anoDaQuery } from "../seletor-ano";

export const metadata = { title: "Resultado consolidado — Brisa" };

export default async function ResultadoPage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string }>;
}) {
  const sp = await searchParams;
  const mesRecente = await mesMaisRecenteComLancamentos();
  const ano = anoDaQuery(sp.ano, parseCompetencia(mesRecente).ano);
  const resultado = await resultadoConsolidado(ano);

  return (
    <div>
      <PageHeader
        titulo="Resultado consolidado"
        descricao={`Totais acumulados de ${ano} por unidade: recebidos, repasses, base de cálculo e comissão.`}
        acoes={
          <>
            <SeletorAno base="/relatorios/resultado" ano={ano} />
            <a
              href={`/relatorios/exportar?tipo=resultado&ano=${ano}`}
              className={btnSecundario}
            >
              Exportar Excel
            </a>
          </>
        }
      />

      <Card>
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                <th>Empreendimento</th>
                <th>Localização</th>
                <th>Locatário</th>
                <th className="text-right">Recebidos</th>
                <th className="text-right">IPTU</th>
                <th className="text-right">Cond.</th>
                <th className="text-right">Base de cálculo</th>
                <th className="text-right">Comissão</th>
              </tr>
            </thead>
            <tbody>
              {resultado.linhas.map((l) => (
                <tr key={l.unidadeId}>
                  <td className="font-medium">{l.empreendimento}</td>
                  <td>{l.identificacao}</td>
                  <td>
                    {l.locatario ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td className="text-right">
                    <Dinheiro centavos={l.recebidos} />
                  </td>
                  <td className="text-right">
                    <Dinheiro centavos={l.iptu} />
                  </td>
                  <td className="text-right">
                    <Dinheiro centavos={l.cond} />
                  </td>
                  <td className="text-right">
                    <Dinheiro centavos={l.base} />
                  </td>
                  <td className="text-right">
                    <Dinheiro centavos={l.comissao} destaque />
                  </td>
                </tr>
              ))}
              {resultado.linhas.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-500">
                    Nenhum recebimento lançado em {ano}.
                  </td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total Geral</td>
                <td className="text-right">
                  <Dinheiro centavos={resultado.totalGeral.recebidos} destaque />
                </td>
                <td className="text-right">
                  <Dinheiro centavos={resultado.totalGeral.iptu} destaque />
                </td>
                <td className="text-right">
                  <Dinheiro centavos={resultado.totalGeral.cond} destaque />
                </td>
                <td className="text-right">
                  <Dinheiro centavos={resultado.totalGeral.base} destaque />
                </td>
                <td className="text-right">
                  <Dinheiro centavos={resultado.totalGeral.comissao} destaque />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}
