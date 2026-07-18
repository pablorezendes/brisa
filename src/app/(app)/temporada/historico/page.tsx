import Link from "next/link";
import { PageHeader, Card, Dinheiro, btnSecundario } from "@/components/ui";
import { NOME_MES_COMPLETO } from "@/lib/dominio/normalizacao";
import { historicoTemporada } from "@/lib/consultas/temporada";

// consulta o banco — nunca pré-renderizar no build (o container não tem dados)
export const dynamic = "force-dynamic";

export default async function PaginaHistoricoTemporada() {
  const anos = await historicoTemporada();

  return (
    <div>
      <PageHeader
        titulo="Temporada — Histórico"
        descricao="Apuração importada da planilha AIRBNB (somente leitura). O ano corrente é apurado no módulo operacional."
        acoes={
          <Link href="/temporada" className={btnSecundario}>
            ‹ Voltar à temporada
          </Link>
        }
      />

      {anos.length === 0 ? (
        <Card className="px-6 py-8">
          <p className="text-sm text-slate-500">Nenhuma apuração histórica importada.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {anos.map((a) => (
            <Card key={a.ano} className="overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-3">
                <h2 className="text-sm font-semibold">Apuração {a.ano}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Mês</th>
                      <th className="text-right">Receita</th>
                      <th className="text-right">Despesa</th>
                      <th className="text-right">Lucro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.meses.map((m) => (
                      <tr key={m.mes}>
                        <td>{NOME_MES_COMPLETO[m.mes]}</td>
                        <td className="text-right">
                          <Dinheiro centavos={m.receita} />
                        </td>
                        <td className="text-right">
                          <Dinheiro centavos={m.despesa} />
                        </td>
                        <td className="text-right">
                          <Dinheiro centavos={m.lucro} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total {a.ano}</td>
                      <td className="text-right">
                        <Dinheiro centavos={a.totalReceita} destaque />
                      </td>
                      <td className="text-right">
                        <Dinheiro centavos={a.totalDespesa} destaque />
                      </td>
                      <td className="text-right">
                        <Dinheiro centavos={a.totalLucro} destaque />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
