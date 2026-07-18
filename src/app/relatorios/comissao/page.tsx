import { Card, Dinheiro, PageHeader, btnSecundario } from "@/components/ui";
import {
  matrizComissao,
  mesMaisRecenteComLancamentos,
} from "@/lib/consultas/relatorios";
import {
  NOME_MES_ABREV,
  parseCompetencia,
} from "@/lib/dominio/normalizacao";
import { SeletorAno, anoDaQuery } from "../seletor-ano";

export const metadata = { title: "Matriz de comissão — Brisa" };

function CelulaValor({ centavos }: { centavos: number }) {
  return (
    <td className="text-right">
      {centavos !== 0 ? (
        <Dinheiro centavos={centavos} />
      ) : (
        <span className="text-slate-300">—</span>
      )}
    </td>
  );
}

export default async function ComissaoPage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string }>;
}) {
  const sp = await searchParams;
  const mesRecente = await mesMaisRecenteComLancamentos();
  const ano = anoDaQuery(sp.ano, parseCompetencia(mesRecente).ano);
  const matriz = await matrizComissao(ano);

  return (
    <div>
      <PageHeader
        titulo="Matriz de comissão"
        descricao={`Comissão por empreendimento × mês de lançamento em ${ano}. IPTU e condomínio são repasses e não entram na base.`}
        acoes={
          <>
            <SeletorAno base="/relatorios/comissao" ano={ano} />
            <a
              href={`/relatorios/exportar?tipo=comissao&ano=${ano}`}
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
                {NOME_MES_ABREV.slice(1).map((m) => (
                  <th key={m} className="text-right">
                    {m}
                  </th>
                ))}
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {matriz.linhas.map((l) => (
                <tr key={l.empreendimentoId}>
                  <td className="font-medium">{l.empreendimento}</td>
                  {l.porMes.map((v, i) => (
                    <CelulaValor key={i} centavos={v} />
                  ))}
                  <td className="text-right">
                    <Dinheiro centavos={l.total} destaque />
                  </td>
                </tr>
              ))}
              {matriz.linhas.length === 0 ? (
                <tr>
                  <td colSpan={14} className="py-6 text-center text-slate-500">
                    Nenhuma comissão lançada em {ano}.
                  </td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                {matriz.totalPorMes.map((v, i) => (
                  <td key={i} className="text-right">
                    <Dinheiro centavos={v} destaque />
                  </td>
                ))}
                <td className="text-right">
                  <Dinheiro centavos={matriz.totalGeral} destaque />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}
