import Link from "next/link";
import {
  Badge,
  Card,
  Dinheiro,
  Kpi,
  PageHeader,
  SeletorMes,
} from "@/components/ui";
import {
  comissaoDoMesPorEmpreendimento,
  contratosAReajustarDoMes,
  kpisDoMes,
  mesMaisRecenteComLancamentos,
  pendentesDoMes,
} from "@/lib/consultas/relatorios";
import {
  formatarCompetencia,
  parseCompetencia,
} from "@/lib/dominio/normalizacao";

const fmtPercentual = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 1,
});

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const sp = await searchParams;
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? "")
    ? (sp.mes as string)
    : await mesMaisRecenteComLancamentos();
  const { ano } = parseCompetencia(mes);

  const [kpis, comissaoPorEmp, reajustes, pendentes] = await Promise.all([
    kpisDoMes(mes),
    comissaoDoMesPorEmpreendimento(mes),
    contratosAReajustarDoMes(mes),
    pendentesDoMes(mes),
  ]);
  const topPendentes = pendentes.slice(0, 8);

  return (
    <div>
      <PageHeader
        titulo="Visão geral"
        descricao={`Resumo gerencial de ${formatarCompetencia(mes)} — comissão, inadimplência, reajustes, caixa e temporada.`}
        acoes={<SeletorMes base="/" mes={mes} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Comissão do mês"
          valor={<Dinheiro centavos={kpis.comissaoMes} />}
          detalhe={`mês de lançamento ${formatarCompetencia(mes)}`}
        />
        <Kpi
          rotulo="Acumulada no ano"
          valor={<Dinheiro centavos={kpis.comissaoAcumuladaAno} />}
          detalhe={`JAN–${formatarCompetencia(mes)}`}
        />
        <Kpi
          rotulo="Inadimplência"
          valor={<Dinheiro centavos={kpis.inadimplencia.valorDevido} />}
          detalhe={`${kpis.inadimplencia.quantidade} ${
            kpis.inadimplencia.quantidade === 1
              ? "lançamento pendente"
              : "lançamentos pendentes"
          }`}
        />
        <Kpi
          rotulo="Taxa de recebimento"
          valor={
            kpis.taxaRecebimento !== null
              ? fmtPercentual.format(kpis.taxaRecebimento)
              : "—"
          }
          detalhe="Σ recebido / Σ total devido"
        />
        <Kpi
          rotulo="Contratos a reajustar"
          valor={kpis.contratosAReajustar}
          detalhe="mês de reajuste igual ao mês atual"
        />
        <Kpi
          rotulo="Saldo de caixa do mês"
          valor={<Dinheiro centavos={kpis.saldoCaixaMes} />}
          detalhe="entradas − saídas AL − saídas CH"
        />
        <Kpi
          rotulo="Lucro temporada"
          valor={<Dinheiro centavos={kpis.lucroTemporadaMes} />}
          detalhe="receitas − despesas − limpezas"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Comissão por empreendimento no mês
            </h2>
            <Link
              href={`/relatorios/comissao?ano=${ano}`}
              className="text-sm font-medium text-sky-700 hover:underline"
            >
              Matriz completa →
            </Link>
          </div>
          <table className="tabela">
            <thead>
              <tr>
                <th>Empreendimento</th>
                <th className="text-right">Comissão</th>
              </tr>
            </thead>
            <tbody>
              {comissaoPorEmp.map((c) => (
                <tr key={c.empreendimentoId}>
                  <td className="font-medium">{c.empreendimento}</td>
                  <td className="text-right">
                    <Dinheiro centavos={c.comissao} />
                  </td>
                </tr>
              ))}
              {comissaoPorEmp.length === 0 ? (
                <tr>
                  <td colSpan={2} className="py-6 text-center text-slate-500">
                    Nenhuma comissão em {formatarCompetencia(mes)}.
                  </td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="text-right">
                  <Dinheiro centavos={kpis.comissaoMes} destaque />
                </td>
              </tr>
            </tfoot>
          </table>
        </Card>

        <Card className="px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Pendentes do mês
            </h2>
            <Link
              href={`/relatorios/inadimplencia?mes=${mes}`}
              className="text-sm font-medium text-sky-700 hover:underline"
            >
              Inadimplência completa →
            </Link>
          </div>
          <table className="tabela">
            <thead>
              <tr>
                <th>Empreendimento</th>
                <th>Locatário</th>
                <th className="text-right">Total devido</th>
              </tr>
            </thead>
            <tbody>
              {topPendentes.map((p) => (
                <tr key={p.recebimentoId}>
                  <td className="font-medium">{p.empreendimento}</td>
                  <td>
                    {p.locatario ?? (
                      <span className="text-slate-400">{p.identificacao}</span>
                    )}
                  </td>
                  <td className="text-right">
                    <Dinheiro centavos={p.totalDevido} />
                  </td>
                </tr>
              ))}
              {topPendentes.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-slate-500">
                    Nenhuma pendência em {formatarCompetencia(mes)}.
                  </td>
                </tr>
              ) : null}
            </tbody>
            {pendentes.length > 0 ? (
              <tfoot>
                <tr>
                  <td colSpan={2}>
                    {pendentes.length > topPendentes.length
                      ? `Top ${topPendentes.length} de ${pendentes.length} pendências`
                      : `${pendentes.length} ${
                          pendentes.length === 1 ? "pendência" : "pendências"
                        }`}
                  </td>
                  <td className="text-right">
                    <Dinheiro
                      centavos={kpis.inadimplencia.valorDevido}
                      destaque
                    />
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </Card>
      </div>

      <Card className="mt-4 px-5 py-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Reajustes deste mês
          </h2>
          <Badge cor={reajustes.length > 0 ? "ambar" : "slate"}>
            {reajustes.length}{" "}
            {reajustes.length === 1 ? "contrato" : "contratos"}
          </Badge>
        </div>
        {reajustes.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">
            Nenhum contrato com reajuste em {formatarCompetencia(mes)}.
          </p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Empreendimento</th>
                <th>Localização</th>
                <th>Locatário</th>
                <th>Índice</th>
                <th className="text-right">Valor atual</th>
              </tr>
            </thead>
            <tbody>
              {reajustes.map((r) => (
                <tr key={r.contratoId}>
                  <td className="font-medium">{r.empreendimento}</td>
                  <td>{r.identificacao}</td>
                  <td>
                    {r.locatario ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td>
                    {r.indiceReajuste ? (
                      <Badge cor="azul">{r.indiceReajuste}</Badge>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="text-right">
                    <Dinheiro centavos={r.valorBase} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
