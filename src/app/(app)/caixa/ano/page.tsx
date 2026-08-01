/**
 * /caixa/ano — resumo mês a mês do livro-caixa: por ano (?ano=YYYY) ou por
 * período (?de=YYYY-MM-DD&ate=YYYY-MM-DD — quando presente, vence o ?ano).
 *
 * Mês a mês: despesa AL, despesa CH, receita, saldo e saldo acumulado.
 * No modo período as linhas são exatamente os meses da janela (mesmo cruzando
 * anos) e o acumulado zera no primeiro mês da janela.
 */
import Link from "next/link";
import {
  Ajuda,
  Card,
  Dinheiro,
  Kpi,
  PageHeader,
  SeletorPeriodo,
  btnSecundario,
} from "@/components/ui";
import {
  BarraComposicao,
  COR_1,
  COR_2,
  COR_3,
} from "@/components/graficos";
import { NOME_MES_COMPLETO, parseCompetencia } from "@/lib/dominio/normalizacao";
import { parsePeriodo } from "@/lib/dominio/periodo";
import { nivelSaldo } from "@/lib/dominio/semaforo";
import {
  consolidacaoAnual,
  consolidacaoMensalDoPeriodo,
  mesMaisRecente,
} from "@/lib/consultas/caixa";

const RE_ANO = /^\d{4}$/;

export default async function PaginaCaixaAnual({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string; de?: string; ate?: string }>;
}) {
  const sp = await searchParams;
  const periodo = parsePeriodo(sp.de, sp.ate);
  const anoPadrao = parseCompetencia(await mesMaisRecente()).ano;
  const ano = sp.ano && RE_ANO.test(sp.ano) ? Number(sp.ano) : anoPadrao;

  const resumo = periodo
    ? await consolidacaoMensalDoPeriodo(periodo.meses)
    : await consolidacaoAnual(ano);

  const detalheJanela = periodo ? "no período" : `ano ${ano}`;

  return (
    <>
      <PageHeader
        titulo={periodo ? "Caixa — mês a mês no período" : `Caixa — resumo anual ${ano}`}
        descricao={
          periodo
            ? `Consolidação mês a mês do livro-caixa CONTA_AC — ${periodo.rotulo}`
            : "Consolidação mês a mês do livro-caixa CONTA_AC"
        }
        acoes={
          <>
            <Link
              href={
                periodo ? `/caixa?de=${periodo.de}&ate=${periodo.ate}` : "/caixa"
              }
              className={btnSecundario}
            >
              {periodo ? "Lançamentos do período" : "Visão mensal"}
            </Link>
            {!periodo ? (
              <div className="flex items-center gap-1 text-sm">
                <Link
                  href={`/caixa/ano?ano=${ano - 1}`}
                  className="rounded-md border border-contorno bg-carta px-2.5 py-1 hover:bg-[#f5f3ef]"
                >
                  ‹
                </Link>
                <span className="min-w-16 px-2 text-center font-semibold">{ano}</span>
                <Link
                  href={`/caixa/ano?ano=${ano + 1}`}
                  className="rounded-md border border-contorno bg-carta px-2.5 py-1 hover:bg-[#f5f3ef]"
                >
                  ›
                </Link>
              </div>
            ) : null}
            <SeletorPeriodo base="/caixa/ano" periodo={periodo} />
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi
          rotulo="Despesa Antonio/Laura"
          valor={<Dinheiro centavos={resumo.totais.despesaAL} destaque />}
          detalhe={detalheJanela}
          ajuda="Tudo o que saiu pelo centro de custo AL (Antonio/Laura) na janela em análise. Ao lançar uma saída, o centro escolhido é o que separa as contas de cada núcleo da família — errar aqui embaralha os dois."
        />
        <Kpi
          rotulo="Despesa Chácara Brisa"
          valor={<Dinheiro centavos={resumo.totais.despesaCH} destaque />}
          detalhe={detalheJanela}
          ajuda="Tudo o que saiu pelo centro de custo CH (Chácara Brisa) na janela em análise. Gastos da chácara entram aqui; gastos pessoais de Antonio/Laura vão no centro AL."
        />
        <Kpi
          rotulo="Receita (entradas)"
          valor={<Dinheiro centavos={resumo.totais.receita} destaque />}
          detalhe={detalheJanela}
          ajuda="Tudo o que entrou na conta na janela em análise (tipo ENTRADA, centro GERAL). Recebimentos em dinheiro NÃO estão aqui — são registro paralelo de espécie."
        />
        <Kpi
          rotulo={periodo ? "Saldo do período" : "Saldo do ano"}
          valor={<Dinheiro centavos={resumo.totais.saldo} destaque />}
          detalhe="receita − despesa AL − despesa CH"
          nivel={nivelSaldo(resumo.totais.saldo)}
          selo={
            resumo.totais.saldo > 0
              ? "sobrou"
              : resumo.totais.saldo < 0
                ? "faltou"
                : undefined
          }
          nota={
            resumo.totais.saldo < 0
              ? periodo
                ? "No acumulado do período saiu mais do que entrou pelo livro-caixa."
                : "No acumulado do ano saiu mais do que entrou pelo livro-caixa."
              : undefined
          }
          grafico={
            resumo.totais.receita > 0 ||
            resumo.totais.despesaAL > 0 ||
            resumo.totais.despesaCH > 0 ? (
              <BarraComposicao
                partes={[
                  { rotulo: "entradas", valor: resumo.totais.receita, cor: COR_1 },
                  { rotulo: "saídas AL", valor: resumo.totais.despesaAL, cor: COR_2 },
                  { rotulo: "saídas CH", valor: resumo.totais.despesaCH, cor: COR_3 },
                ]}
              />
            ) : undefined
          }
          ajuda="Entradas da janela menos as saídas dos dois centros. Positivo: sobrou dinheiro no período; negativo: as saídas superaram as entradas. O registro de espécie fica fora desta conta."
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
                <th className="text-right!">
                  Acumulado{" "}
                  <Ajuda dica="Soma dos saldos mês a mês, do primeiro ao último mês em tela. No modo período o acumulado começa do zero no primeiro mês da janela — ele mostra quanto sobrou (ou faltou) dentro do recorte escolhido." />
                </th>
              </tr>
            </thead>
            <tbody>
              {resumo.linhas.map((linha) => {
                const { ano: anoLinha, mes } = parseCompetencia(linha.mes);
                const rotuloMes = periodo
                  ? `${NOME_MES_COMPLETO[mes]} ${anoLinha}`
                  : NOME_MES_COMPLETO[mes];
                const tem = linha.temLancamentos;
                return (
                  <tr key={linha.mes} className={tem ? "" : "text-tinta-suave/60"}>
                    <td>
                      {tem ? (
                        <Link
                          href={`/caixa?mes=${linha.mes}`}
                          className="font-medium hover:underline"
                        >
                          {rotuloMes}
                        </Link>
                      ) : (
                        rotuloMes
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
                <td>{periodo ? "Total do período" : `Total ${ano}`}</td>
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

      <p className="mt-4 text-xs text-tinta-suave/60">
        Recebimentos em dinheiro são registro paralelo de espécie e não entram no saldo.
        Meses sem lançamentos aparecem com “—”.
        {periodo
          ? " No modo período o acumulado considera apenas os meses da janela escolhida."
          : ""}
      </p>
    </>
  );
}
