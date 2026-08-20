import {
  Ajuda,
  Card,
  Dinheiro,
  PageHeader,
  SeletorPeriodo,
  btnSecundario,
} from "@/components/ui";
import { MapaCalor } from "@/components/graficos";
import {
  matrizComissao,
  matrizComissaoPeriodo,
  mesMaisRecenteComLancamentos,
} from "@/lib/consultas/relatorios";
import {
  NOME_MES_ABREV,
  parseCompetencia,
} from "@/lib/dominio/normalizacao";
import { parsePeriodo, rotulosCompetencias } from "@/lib/dominio/periodo";
import { SeletorAno, anoDaQuery } from "../seletor-ano";

export const metadata = { title: "Matriz de comissão — Brisa" };

function CelulaValor({ centavos }: { centavos: number }) {
  return (
    <td className="text-right">
      {centavos !== 0 ? (
        <Dinheiro centavos={centavos} />
      ) : (
        <span className="text-tinta-suave/40">—</span>
      )}
    </td>
  );
}

export default async function ComissaoPage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string; de?: string; ate?: string }>;
}) {
  const sp = await searchParams;
  const periodo = parsePeriodo(sp.de, sp.ate);
  const mesRecente = await mesMaisRecenteComLancamentos();
  const ano = anoDaQuery(sp.ano, parseCompetencia(mesRecente).ano);

  // as duas visões desembocam no mesmo view-model: colunas + linhas + totais
  const vm = periodo
    ? await (async () => {
        const m = await matrizComissaoPeriodo(periodo.meses);
        return {
          colunas: rotulosCompetencias(periodo.meses),
          linhas: m.linhas,
          totalPorMes: m.totalPorMes,
          totalGeral: m.totalGeral,
          janela: `no período ${periodo.rotulo}`,
          janelaCurta: "no período",
        };
      })()
    : await (async () => {
        const m = await matrizComissao(ano);
        return {
          colunas: NOME_MES_ABREV.slice(1),
          linhas: m.linhas,
          totalPorMes: m.totalPorMes,
          totalGeral: m.totalGeral,
          janela: `em ${ano}`,
          janelaCurta: `em ${ano}`,
        };
      })();

  const exportarHref = periodo
    ? `/relatorios/exportar?tipo=comissao&de=${periodo.de}&ate=${periodo.ate}`
    : `/relatorios/exportar?tipo=comissao&ano=${ano}`;

  return (
    <div>
      <PageHeader
        titulo="Matriz de comissão"
        descricao={`Comissão por empreendimento × mês de lançamento ${vm.janela}. IPTU e condomínio são repasses e não entram na base.`}
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            {!periodo ? (
              <SeletorAno base="/relatorios/comissao" ano={ano} />
            ) : null}
            <SeletorPeriodo base="/relatorios/comissao" periodo={periodo} />
            <a href={exportarHref} className={btnSecundario}>
              Exportar Excel
            </a>
          </div>
        }
      />

      {vm.linhas.length > 0 ? (
        <Card className="mb-4 p-5">
          <div className="mb-3 flex items-center gap-1.5">
            <h2 className="text-sm font-semibold">Mapa de calor</h2>
            <Ajuda dica="Cada célula é a comissão de um empreendimento num mês. Quanto mais escuro o verde, maior o valor — os melhores meses de cada linha saltam aos olhos. Célula com traço = sem movimento. Os números exatos estão na tabela abaixo." />
          </div>
          <div className="overflow-x-auto">
            {/* min-width acompanha o nº de colunas: períodos multi-ano rolam
                dentro do card em vez de espremer as células */}
            <div
              style={{
                minWidth: `${Math.max(560, 128 + vm.colunas.length * 40)}px`,
              }}
            >
              <MapaCalor
                colunas={vm.colunas}
                linhas={vm.linhas.map((l) => ({
                  rotulo: l.empreendimento,
                  valores: l.porMes.map((v) => (v !== 0 ? v : null)),
                }))}
                rotuloAcessivel={`Mapa de calor da comissão ${vm.janela}`}
              />
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                <th>Empreendimento</th>
                {vm.colunas.map((m) => (
                  <th key={m} className="text-right">
                    {m}
                  </th>
                ))}
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {vm.linhas.map((l) => (
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
              {vm.linhas.length === 0 ? (
                <tr>
                  <td
                    colSpan={vm.colunas.length + 2}
                    className="py-6 text-center text-tinta-suave"
                  >
                    Nenhuma comissão lançada {vm.janelaCurta}.
                  </td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                {vm.totalPorMes.map((v, i) => (
                  <td key={i} className="text-right">
                    <Dinheiro centavos={v} destaque />
                  </td>
                ))}
                <td className="text-right">
                  <Dinheiro centavos={vm.totalGeral} destaque />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}
