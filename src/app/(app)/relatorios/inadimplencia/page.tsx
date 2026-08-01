import {
  Badge,
  Card,
  Dinheiro,
  PageHeader,
  SeletorMes,
  SeletorPeriodo,
} from "@/components/ui";
import {
  mesMaisRecenteComLancamentos,
  pendentesDoMes,
  pendentesDoPeriodo,
} from "@/lib/consultas/relatorios";
import { formatarCompetencia } from "@/lib/dominio/normalizacao";
import { parsePeriodo } from "@/lib/dominio/periodo";

export const metadata = { title: "Inadimplência — Brisa" };

function Atraso({
  dias,
  diaVencimento,
}: {
  dias: number | null;
  diaVencimento: number | null;
}) {
  if (dias === null || diaVencimento === null) {
    return <span className="text-tinta-suave/60">—</span>;
  }
  if (dias <= 0) {
    return <Badge cor="ambar">a vencer (dia {diaVencimento})</Badge>;
  }
  return (
    <Badge cor="vermelho">
      {dias} {dias === 1 ? "dia" : "dias"}
    </Badge>
  );
}

export default async function InadimplenciaPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; de?: string; ate?: string }>;
}) {
  const sp = await searchParams;
  const periodo = parsePeriodo(sp.de, sp.ate);
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? "")
    ? (sp.mes as string)
    : await mesMaisRecenteComLancamentos();

  // as duas visões desembocam no mesmo view-model (cada pendência com o mês)
  const vm = periodo
    ? {
        pendencias: await pendentesDoPeriodo(periodo.meses),
        comMes: periodo.meses.length > 1,
        janela: `do período ${periodo.rotulo}`,
        janelaCurta: "no período",
      }
    : {
        pendencias: (await pendentesDoMes(mes)).map((p) => ({ ...p, mes })),
        comMes: false,
        janela: `de ${formatarCompetencia(mes)}`,
        janelaCurta: `em ${formatarCompetencia(mes)}`,
      };
  const totalDevido = vm.pendencias.reduce((a, p) => a + p.totalDevido, 0);

  return (
    <div>
      <PageHeader
        titulo="Inadimplência"
        descricao={`Lançamentos ${vm.janela} com total devido e sem recebimento registrado.`}
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            {!periodo ? (
              <SeletorMes base="/relatorios/inadimplencia" mes={mes} />
            ) : null}
            <SeletorPeriodo base="/relatorios/inadimplencia" periodo={periodo} />
          </div>
        }
      />

      <Card>
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                {vm.comMes ? <th>Mês</th> : null}
                <th>Empreendimento</th>
                <th>Locatário</th>
                <th>Localização</th>
                <th className="text-right">Total devido</th>
                <th>Atraso</th>
              </tr>
            </thead>
            <tbody>
              {vm.pendencias.map((p) => (
                <tr key={p.recebimentoId}>
                  {vm.comMes ? (
                    <td className="font-mono text-[12px]">
                      {formatarCompetencia(p.mes)}
                    </td>
                  ) : null}
                  <td className="font-medium">{p.empreendimento}</td>
                  <td>
                    {p.locatario ?? <span className="text-tinta-suave/60">—</span>}
                  </td>
                  <td>{p.identificacao}</td>
                  <td className="text-right">
                    <Dinheiro centavos={p.totalDevido} />
                  </td>
                  <td>
                    <Atraso
                      dias={p.diasDesdeVencimento}
                      diaVencimento={p.diaVencimento}
                    />
                  </td>
                </tr>
              ))}
              {vm.pendencias.length === 0 ? (
                <tr>
                  <td
                    colSpan={vm.comMes ? 6 : 5}
                    className="py-6 text-center text-tinta-suave"
                  >
                    Nenhuma pendência {vm.janelaCurta}.
                  </td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={vm.comMes ? 4 : 3}>
                  {vm.pendencias.length}{" "}
                  {vm.pendencias.length === 1 ? "pendência" : "pendências"}
                </td>
                <td className="text-right">
                  <Dinheiro centavos={totalDevido} destaque />
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}
