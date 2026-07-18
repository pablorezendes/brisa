/**
 * /caixa/ano — resumo anual do livro-caixa (?ano=YYYY).
 * Mês a mês: despesa AL, despesa CH, receita, saldo e saldo acumulado.
 */
import Link from "next/link";
import {
  Card,
  Dinheiro,
  Kpi,
  PageHeader,
  btnSecundario,
} from "@/components/ui";
import { NOME_MES_COMPLETO, parseCompetencia } from "@/lib/dominio/normalizacao";
import { consolidacaoAnual, mesMaisRecente } from "@/lib/consultas/caixa";

const RE_ANO = /^\d{4}$/;

export default async function PaginaCaixaAnual({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string }>;
}) {
  const sp = await searchParams;
  const anoPadrao = parseCompetencia(await mesMaisRecente()).ano;
  const ano = sp.ano && RE_ANO.test(sp.ano) ? Number(sp.ano) : anoPadrao;

  const resumo = await consolidacaoAnual(ano);

  return (
    <>
      <PageHeader
        titulo={`Caixa — resumo anual ${ano}`}
        descricao="Consolidação mês a mês do livro-caixa CONTA_AC"
        acoes={
          <>
            <Link href="/caixa" className={btnSecundario}>
              Visão mensal
            </Link>
            <div className="flex items-center gap-1 text-sm">
              <Link
                href={`/caixa/ano?ano=${ano - 1}`}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 hover:bg-slate-50"
              >
                ‹
              </Link>
              <span className="min-w-16 px-2 text-center font-semibold">{ano}</span>
              <Link
                href={`/caixa/ano?ano=${ano + 1}`}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 hover:bg-slate-50"
              >
                ›
              </Link>
            </div>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi
          rotulo="Despesa Antonio/Laura"
          valor={<Dinheiro centavos={resumo.totais.despesaAL} destaque />}
          detalhe={`ano ${ano}`}
        />
        <Kpi
          rotulo="Despesa Chácara Brisa"
          valor={<Dinheiro centavos={resumo.totais.despesaCH} destaque />}
          detalhe={`ano ${ano}`}
        />
        <Kpi
          rotulo="Receita (entradas)"
          valor={<Dinheiro centavos={resumo.totais.receita} destaque />}
          detalhe={`ano ${ano}`}
        />
        <Kpi
          rotulo="Saldo do ano"
          valor={<Dinheiro centavos={resumo.totais.saldo} destaque />}
          detalhe="receita − despesa AL − despesa CH"
        />
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                <th>Mês</th>
                <th className="text-right!">Despesa AL</th>
                <th className="text-right!">Despesa CH</th>
                <th className="text-right!">Receita</th>
                <th className="text-right!">Saldo</th>
                <th className="text-right!">Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {resumo.linhas.map((linha) => {
                const { mes } = parseCompetencia(linha.mes);
                const tem = linha.temLancamentos;
                return (
                  <tr key={linha.mes} className={tem ? "" : "text-slate-400"}>
                    <td>
                      {tem ? (
                        <Link
                          href={`/caixa?mes=${linha.mes}`}
                          className="font-medium hover:underline"
                        >
                          {NOME_MES_COMPLETO[mes]}
                        </Link>
                      ) : (
                        NOME_MES_COMPLETO[mes]
                      )}
                    </td>
                    <td className="text-right!">
                      <Dinheiro centavos={tem ? linha.despesaAL : null} />
                    </td>
                    <td className="text-right!">
                      <Dinheiro centavos={tem ? linha.despesaCH : null} />
                    </td>
                    <td className="text-right!">
                      <Dinheiro centavos={tem ? linha.receita : null} />
                    </td>
                    <td className="text-right!">
                      <Dinheiro centavos={tem ? linha.saldo : null} destaque={tem} />
                    </td>
                    <td className="text-right!">
                      <Dinheiro centavos={tem ? linha.acumulado : null} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Total {ano}</td>
                <td className="text-right!">
                  <Dinheiro centavos={resumo.totais.despesaAL} destaque />
                </td>
                <td className="text-right!">
                  <Dinheiro centavos={resumo.totais.despesaCH} destaque />
                </td>
                <td className="text-right!">
                  <Dinheiro centavos={resumo.totais.receita} destaque />
                </td>
                <td className="text-right!">
                  <Dinheiro centavos={resumo.totais.saldo} destaque />
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <p className="mt-4 text-xs text-slate-400">
        Recebimentos em dinheiro são registro paralelo de espécie e não entram no saldo.
        Meses sem lançamentos aparecem com “—”.
      </p>
    </>
  );
}
