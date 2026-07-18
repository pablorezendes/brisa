import {
  Badge,
  Card,
  Dinheiro,
  PageHeader,
  SeletorMes,
} from "@/components/ui";
import {
  mesMaisRecenteComLancamentos,
  pendentesDoMes,
} from "@/lib/consultas/relatorios";
import { formatarCompetencia } from "@/lib/dominio/normalizacao";

export const metadata = { title: "Inadimplência — Brisa" };

function Atraso({
  dias,
  diaVencimento,
}: {
  dias: number | null;
  diaVencimento: number | null;
}) {
  if (dias === null || diaVencimento === null) {
    return <span className="text-slate-400">—</span>;
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
  searchParams: Promise<{ mes?: string }>;
}) {
  const sp = await searchParams;
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? "")
    ? (sp.mes as string)
    : await mesMaisRecenteComLancamentos();
  const pendencias = await pendentesDoMes(mes);
  const totalDevido = pendencias.reduce((a, p) => a + p.totalDevido, 0);

  return (
    <div>
      <PageHeader
        titulo="Inadimplência"
        descricao={`Lançamentos de ${formatarCompetencia(mes)} com total devido e sem recebimento registrado.`}
        acoes={<SeletorMes base="/relatorios/inadimplencia" mes={mes} />}
      />

      <Card>
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                <th>Empreendimento</th>
                <th>Locatário</th>
                <th>Localização</th>
                <th className="text-right">Total devido</th>
                <th>Atraso</th>
              </tr>
            </thead>
            <tbody>
              {pendencias.map((p) => (
                <tr key={p.recebimentoId}>
                  <td className="font-medium">{p.empreendimento}</td>
                  <td>
                    {p.locatario ?? <span className="text-slate-400">—</span>}
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
              {pendencias.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-500">
                    Nenhuma pendência em {formatarCompetencia(mes)}.
                  </td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>
                  {pendencias.length}{" "}
                  {pendencias.length === 1 ? "pendência" : "pendências"}
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
