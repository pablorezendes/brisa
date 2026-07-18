/**
 * /paineis/caixa — caixa analítico do ano (?ano=YYYY).
 * Camada de análise sobre o livro-caixa: KPIs anuais, evolução mensal,
 * despesas por categoria, comparativo entre centros e maiores saídas.
 */
import Link from "next/link";
import {
  Ajuda,
  Badge,
  Card,
  Dinheiro,
  Kpi,
  PageHeader,
  btnSecundario,
} from "@/components/ui";
import {
  BarrasCaixa,
  BarrasHorizontais,
  COR_1,
  COR_2,
  COR_3,
  Legenda,
} from "@/components/graficos";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { NOME_MES_ABREV, parseCompetencia } from "@/lib/dominio/normalizacao";
import {
  anoPadraoCaixa,
  painelCaixa,
} from "@/lib/consultas/painel-caixa-temporada";
import { SeletorAno, anoDaQuery } from "../../relatorios/seletor-ano";

export const dynamic = "force-dynamic";

function formatarData(d: string | null): string {
  if (!d) return "—";
  const [ano, mes, dia] = d.split("-");
  return `${dia}/${mes}/${ano}`;
}

function pctDoTotal(valor: number, total: number): string {
  if (total <= 0) return "—";
  return `${((valor / total) * 100).toFixed(1).replace(".", ",")}%`;
}

/** Badge do centro de custo com as mesmas cores das séries (AL ocre, CH índigo). */
function BadgeCentro({ centro }: { centro: string }) {
  if (centro === "AL") return <Badge cor="ambar">Antonio/Laura</Badge>;
  if (centro === "CH") return <Badge cor="azul">Chácara Brisa</Badge>;
  return <Badge cor="slate">{centro}</Badge>;
}

/**
 * Duas barras horizontais na MESMA escala para comparar os centros.
 * (BarrasHorizontais compartilhado é série única de uma cor só — aqui o
 * comparativo pede uma cor por centro: AL ocre, CH índigo, como no gráfico
 * mensal.) Mesma geometria/estilo do componente compartilhado.
 */
function ComparativoCentros({ al, ch }: { al: number; ch: number }) {
  const LARG = 560;
  const ALT_BARRA = 18;
  const GAP = 10;
  const ROTULO_W = 170;
  const VALOR_W = 90;
  const itens = [
    { rotulo: "Antonio/Laura", valor: al, cor: COR_2 },
    { rotulo: "Chácara Brisa", valor: ch, cor: COR_3 },
  ];
  const max = Math.max(al, ch, 1);
  const plotW = LARG - ROTULO_W - VALOR_W;
  const altura = itens.length * (ALT_BARRA + GAP);
  return (
    <svg
      viewBox={`0 0 ${LARG} ${altura}`}
      className="w-full"
      role="img"
      aria-label="Despesa do ano por centro de custo"
    >
      {itens.map((item, i) => {
        const y = i * (ALT_BARRA + GAP);
        const w = Math.max((item.valor / max) * plotW, 2);
        return (
          <g key={item.rotulo}>
            <text
              x={ROTULO_W - 8}
              y={y + ALT_BARRA / 2 + 3.5}
              fontSize={10}
              fill="#1c2430"
              textAnchor="end"
            >
              {item.rotulo}
            </text>
            <path
              d={`M${ROTULO_W},${y} h${w - 4} q4,0 4,4 v${ALT_BARRA - 8} q0,4 -4,4 h${-(w - 4)} z`}
              fill={item.cor}
            >
              <title>{`${item.rotulo}: ${formatarBRL(item.valor)}`}</title>
            </path>
            <text
              x={ROTULO_W + w + 6}
              y={y + ALT_BARRA / 2 + 3.5}
              fontSize={10}
              fontWeight={600}
              fill="#444840"
            >
              {formatarBRL(item.valor)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default async function PaginaPainelCaixa({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string }>;
}) {
  const sp = await searchParams;
  const ano = anoDaQuery(sp.ano, await anoPadraoCaixa());
  const d = await painelCaixa(ano);
  const t = d.resumo.totais;
  const despesaTotal = t.despesaAL + t.despesaCH;
  const top10 = d.categorias.slice(0, 10);
  const resto = d.categorias.slice(10);
  const restoTotal = resto.reduce((a, c) => a + c.total, 0);

  return (
    <div className="max-w-6xl">
      <PageHeader
        titulo="Caixa analítico"
        descricao={`O ano de ${ano} do livro-caixa em uma página: para onde o dinheiro foi e de onde veio`}
        acoes={
          <div className="flex items-center gap-2">
            <Link href="/caixa" className={btnSecundario}>
              Livro-caixa mensal
            </Link>
            <SeletorAno base="/paineis/caixa" ano={ano} />
          </div>
        }
      />

      {/* ---------- KPIs do ano ---------- */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <Kpi
          rotulo="Receita no ano"
          valor={<Dinheiro centavos={t.receita} destaque />}
          detalhe={`entradas em ${ano}`}
          ajuda="Tudo o que entrou na conta no ano (lançamentos ENTRADA). É dinheiro que caiu no caixa — não confunda com aluguel devido, que fica em Recebimentos."
        />
        <Kpi
          rotulo="Despesa Antonio/Laura"
          valor={<Dinheiro centavos={t.despesaAL} destaque />}
          detalhe={pctDoTotal(t.despesaAL, despesaTotal) + " das saídas"}
          ajuda="Soma das saídas lançadas no centro AL. Ao lançar uma saída, escolha o centro certo — é isso que separa as contas de Antonio/Laura das da Chácara."
        />
        <Kpi
          rotulo="Despesa Chácara Brisa"
          valor={<Dinheiro centavos={t.despesaCH} destaque />}
          detalhe={pctDoTotal(t.despesaCH, despesaTotal) + " das saídas"}
          ajuda="Soma das saídas lançadas no centro CH (Chácara Brisa). Se um gasto serve aos dois centros, divida em dois lançamentos e explique na descrição."
        />
        <Kpi
          rotulo="Saldo acumulado"
          valor={<Dinheiro centavos={t.saldo} destaque />}
          detalhe="receita − saídas AL − saídas CH"
          ajuda="Quanto sobrou no ano: receita menos as saídas dos dois centros, somando mês a mês. Se aparecer em vermelho, saiu mais do que entrou até aqui."
        />
        <Kpi
          rotulo="Recebido em dinheiro"
          valor={<Dinheiro centavos={t.recebDinheiro} destaque />}
          detalhe="registro paralelo — fora do saldo"
          ajuda="Registro paralelo do que foi recebido em espécie no ano, só para conferência — NÃO entra no saldo. Ao receber em dinheiro vivo, lance como RECEB_DINHEIRO anotando cliente e local."
        />
      </div>

      {/* ---------- evolução mensal ---------- */}
      <Card className="mt-6 p-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Mês a mês — {ano}</h2>
          <Legenda
            itens={[
              { cor: COR_1, nome: "Receita (entradas)" },
              { cor: COR_2, nome: "Despesa Antonio/Laura" },
              { cor: COR_3, nome: "Despesa Chácara Brisa" },
            ]}
          />
        </div>
        <BarrasCaixa
          receita={d.resumo.linhas.map((l) => l.receita)}
          despesaAL={d.resumo.linhas.map((l) => l.despesaAL)}
          despesaCH={d.resumo.linhas.map((l) => l.despesaCH)}
        />
        <p className="mt-2 text-xs text-tinta-suave">
          Verde é o que entrou; a pilha ocre + índigo é o que saiu em cada
          centro. Mês bom é o verde maior que a pilha.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                <th>Mês</th>
                <th className="text-right!">Receita</th>
                <th className="text-right!">Despesa AL</th>
                <th className="text-right!">Despesa CH</th>
                <th className="text-right!">Saldo</th>
                <th className="text-right!">
                  <span className="inline-flex items-center gap-1.5">
                    Acumulado
                    <Ajuda dica="Soma dos saldos de janeiro até o mês da linha — mostra como o ano foi se acumulando. O último valor é o saldo do ano inteiro." />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {d.resumo.linhas.map((l) => {
                const { mes } = parseCompetencia(l.mes);
                const tem = l.temLancamentos;
                return (
                  <tr key={l.mes} className={tem ? "" : "text-slate-400"}>
                    <td>
                      {tem ? (
                        <Link
                          href={`/caixa?mes=${l.mes}`}
                          className="font-medium hover:underline"
                        >
                          {NOME_MES_ABREV[mes]}
                        </Link>
                      ) : (
                        NOME_MES_ABREV[mes]
                      )}
                    </td>
                    <td className="text-right!">
                      <Dinheiro centavos={tem ? l.receita : null} />
                    </td>
                    <td className="text-right!">
                      <Dinheiro centavos={tem ? l.despesaAL : null} />
                    </td>
                    <td className="text-right!">
                      <Dinheiro centavos={tem ? l.despesaCH : null} />
                    </td>
                    <td className="text-right!">
                      <Dinheiro centavos={tem ? l.saldo : null} destaque={tem} />
                    </td>
                    <td className="text-right!">
                      <Dinheiro centavos={tem ? l.acumulado : null} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Total {ano}</td>
                <td className="text-right!">
                  <Dinheiro centavos={t.receita} destaque />
                </td>
                <td className="text-right!">
                  <Dinheiro centavos={t.despesaAL} destaque />
                </td>
                <td className="text-right!">
                  <Dinheiro centavos={t.despesaCH} destaque />
                </td>
                <td className="text-right!">
                  <Dinheiro centavos={t.saldo} destaque />
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* ---------- despesas por categoria ---------- */}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">
              Despesas por categoria — top 10 de {ano}
            </h2>
            <Ajuda dica="Soma das saídas do ano por categoria, juntando os dois centros. Abra 'Ver dados por centro' para ver quanto cada centro gastou em cada categoria. Saídas sem categoria aparecem como SEM CATEGORIA — vale voltar no lançamento e classificar." />
          </div>
          {top10.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhuma saída lançada em {ano}.
            </p>
          ) : (
            <>
              <BarrasHorizontais
                itens={top10.map((c) => ({
                  rotulo: c.categoria,
                  valor: c.total,
                }))}
              />
              {resto.length > 0 ? (
                <p className="mt-2 text-xs text-slate-500">
                  Outras {resto.length} categoria(s) somam{" "}
                  {formatarBRL(restoTotal)}.
                </p>
              ) : null}
              <details className="mt-2 text-xs text-slate-600">
                <summary className="cursor-pointer select-none">
                  Ver dados por centro
                </summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="tabela">
                    <thead>
                      <tr>
                        <th>Categoria</th>
                        <th>Centro</th>
                        <th className="text-right!">Valor</th>
                        <th className="text-right!">% das saídas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {top10.flatMap((c) =>
                        (
                          [
                            { centro: "AL", valor: c.al },
                            { centro: "CH", valor: c.ch },
                          ] as const
                        )
                          .filter((x) => x.valor > 0)
                          .map((x) => (
                            <tr key={`${c.categoria}-${x.centro}`}>
                              <td>{c.categoria}</td>
                              <td>
                                <BadgeCentro centro={x.centro} />
                              </td>
                              <td className="text-right!">
                                <Dinheiro centavos={x.valor} />
                              </td>
                              <td className="text-right!">
                                {pctDoTotal(x.valor, despesaTotal)}
                              </td>
                            </tr>
                          )),
                      )}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">
              Quem gastou mais no ano — AL × CH
            </h2>
            <Legenda
              itens={[
                { cor: COR_2, nome: "Antonio/Laura" },
                { cor: COR_3, nome: "Chácara Brisa" },
              ]}
            />
          </div>
          <ComparativoCentros al={t.despesaAL} ch={t.despesaCH} />
          <p className="mt-2 text-xs text-tinta-suave">
            Total de saídas em {ano}: {formatarBRL(despesaTotal)} —{" "}
            {pctDoTotal(t.despesaAL, despesaTotal)} de Antonio/Laura e{" "}
            {pctDoTotal(t.despesaCH, despesaTotal)} da Chácara Brisa.
          </p>
          <Card className="mt-4 border-l-4 border-l-ambar bg-papel px-4 py-3">
            <p className="text-xs leading-relaxed text-slate-700">
              <strong>Transferências internas:</strong> quando um centro manda
              dinheiro para o outro, aparece uma SAÍDA no centro que enviou e
              uma ENTRADA (geral) do outro lado — <strong>não é gasto novo</strong>,
              os dois lados se compensam no saldo do ano. Ao lançar, escreva
              &quot;transferência&quot; na descrição dos dois lançamentos para
              ninguém confundir com despesa de verdade.
            </p>
          </Card>
        </Card>
      </div>

      {/* ---------- maiores saídas ---------- */}
      <Card className="mt-4 p-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">
            Maiores saídas de {ano} — top {d.maioresSaidas.length}
          </h2>
          <span className="text-xs text-slate-500">
            {formatarBRL(d.maioresSaidas.reduce((a, l) => a + l.valor, 0))} somadas
          </span>
        </div>
        {d.maioresSaidas.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma saída lançada em {ano}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Centro</th>
                  <th>Categoria</th>
                  <th>
                    <span className="inline-flex items-center gap-1.5">
                      Descrição
                      <Ajuda dica="Confira se as maiores saídas têm descrição clara — é isso que dá rastreabilidade. Um lançamento grande sem descrição vira mistério daqui a seis meses: edite no livro-caixa e escreva o que foi." />
                    </span>
                  </th>
                  <th className="text-right!">Valor</th>
                </tr>
              </thead>
              <tbody>
                {d.maioresSaidas.map((l) => (
                  <tr key={l.id}>
                    <td className="text-slate-500">{formatarData(l.data)}</td>
                    <td>
                      <BadgeCentro centro={l.centroCusto} />
                    </td>
                    <td>{l.categoria ?? "—"}</td>
                    <td>
                      {l.descricao ? (
                        l.descricao
                      ) : (
                        <Badge cor="ambar">sem descrição</Badge>
                      )}
                    </td>
                    <td className="text-right!">
                      <Dinheiro centavos={l.valor} destaque />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-6 text-xs text-slate-400">
        Fonte: lançamentos do livro-caixa CONTA_AC. Saldo = entradas − saídas
        AL − saídas CH; recebimentos em dinheiro são registro paralelo de
        espécie e não entram no saldo.
      </p>
    </div>
  );
}
