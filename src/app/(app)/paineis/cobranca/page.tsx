import Link from "next/link";
import {
  Ajuda,
  Badge,
  Card,
  Dinheiro,
  Kpi,
  PageHeader,
  SeletorMes,
} from "@/components/ui";
import {
  BarrasDuplas,
  BarrasHorizontais,
  COR_1,
  COR_2,
  Legenda,
} from "@/components/graficos";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import {
  formatarCompetencia,
  NOME_MES_ABREV,
  NOME_MES_COMPLETO,
  parseCompetencia,
} from "@/lib/dominio/normalizacao";
import { mesPadrao } from "@/lib/consultas/executivo";
import { dadosPainelCobranca } from "@/lib/consultas/painel-cobranca";

export const metadata = { title: "Painel de cobrança — Brisa" };
export const dynamic = "force-dynamic";

function pct(v: number | null): string {
  if (v === null) return "—";
  return `${(v * 100).toFixed(1).replace(".", ",")}%`;
}

/** Coluna "Atraso" da lista de cobrança. */
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
    <Badge cor={dias > 30 ? "vermelho" : "ambar"}>
      {dias} {dias === 1 ? "dia" : "dias"}
    </Badge>
  );
}

export default async function PainelCobranca({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const sp = await searchParams;
  const mes =
    sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : await mesPadrao();
  const d = await dadosPainelCobranca(mes);
  const { mes: mesNum } = parseCompetencia(mes);
  const nomeMes = NOME_MES_COMPLETO[mesNum].toLowerCase();
  const taxaPct =
    d.taxaRecebimentoMes !== null ? d.taxaRecebimentoMes * 100 : null;
  const agingComPendencia = d.aging.some((f) => f.valor > 0);
  const mesesComMovimento = d.porMes.filter(
    (l) => l.devido > 0 || l.recebido > 0
  );

  return (
    <div className="max-w-6xl">
      <PageHeader
        titulo="Painel de cobrança"
        descricao={`Quem cobrar e o que registrar — ${NOME_MES_COMPLETO[mesNum]} de ${d.ano}`}
        acoes={<SeletorMes base="/paineis/cobranca" mes={mes} />}
      />

      {/* ---------- KPIs ---------- */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          rotulo="Pendentes do mês"
          valor={<Dinheiro centavos={d.pendentesMesValor} destaque />}
          detalhe={`${d.pendentesMesQtde} cobrança(s) sem pagamento em ${nomeMes}`}
          ajuda="Cobranças lançadas neste mês que ainda estão sem valor em Recebido. Quando o locatário pagar, vá em Recebimentos e preencha Recebido, Data e Via — a linha sai desta lista sozinha."
        />
        <Kpi
          rotulo="Taxa de recebimento"
          valor={pct(d.taxaRecebimentoMes)}
          detalhe={`entrou ${formatarBRL(d.recebidoMes)} de ${formatarBRL(d.devidoMes)} devidos`}
          ajuda="Quanto do total devido do mês já entrou. Pode passar de 100% quando alguém quita atrasos de meses anteriores — nesse caso lance o valor cheio em Recebido e anote o motivo na Observação; a competência continua sendo a do mês devido."
        />
        <Kpi
          rotulo="Pendentes acumulados no ano"
          valor={<Dinheiro centavos={d.pendentesAnoValor} destaque />}
          detalhe={`${d.pendentesAnoQtde} cobrança(s) em ${d.mesesOperacionaisConsiderados} mês(es) com operação`}
          ajuda={`Soma tudo o que ficou sem pagamento de janeiro até ${nomeMes}. Meses lançados de antemão, ainda sem nenhum recebimento registrado, ficam de fora — senão o número inflaria com cobranças que nem venceram.`}
        />
        <Kpi
          rotulo="Maior devedor do ano"
          valor={
            d.maiorDevedor ? (
              <Dinheiro centavos={d.maiorDevedor.valor} destaque />
            ) : (
              "—"
            )
          }
          detalhe={
            d.maiorDevedor
              ? `${d.maiorDevedor.locatario} · ${d.maiorDevedor.quantidade} cobrança(s) em aberto`
              : "ninguém devendo no ano"
          }
          ajuda="Locatário que mais soma pendências no ano até o mês selecionado — a primeira ligação a fazer. Se combinar um parcelamento, registre cada pagamento em Recebido e anote o acordo na Observação do lançamento."
        />
      </div>

      {/* ---------- LISTA DE COBRANÇA DE HOJE ---------- */}
      <Card className="mt-6 p-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            Lista de cobrança de hoje
            <Ajuda dica="Ordene o dia por esta lista: os maiores valores primeiro. Quando alguém pagar, vá em Recebimentos, encontre a linha e preencha Recebido, Data e Via de pagamento — a cobrança some daqui na hora." />
          </h2>
          <span className="text-xs text-slate-500">
            {d.pendentesMesQtde} · {formatarBRL(d.pendentesMesValor)}
          </span>
        </div>
        {d.listaCobranca.length === 0 ? (
          <p className="text-sm text-slate-500">
            Todas as cobranças de {formatarCompetencia(mes)} foram recebidas.
            Nada a cobrar hoje.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Empreendimento</th>
                  <th>Locatário</th>
                  <th>Localização</th>
                  <th className="text-right">Total devido</th>
                  <th className="text-right">
                    Dia venc.{" "}
                    <Ajuda dica="Dia do mês em que o aluguel vence, cadastrado no contrato. Sem dia cadastrado não dá para calcular atraso — vale completar o contrato." />
                  </th>
                  <th>
                    Atraso{" "}
                    <Ajuda dica="Dias corridos desde o vencimento deste mês. 'A vencer' = ainda não chegou o dia; '—' = contrato sem dia de vencimento cadastrado." />
                  </th>
                  <th>
                    Observação{" "}
                    <Ajuda dica="Anotação feita no lançamento — acordos, pagamento parcial, motivo do atraso. Ao registrar qualquer combinação com o locatário, escreva aqui para a família toda saber." />
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.listaCobranca.map((p) => (
                  <tr key={p.recebimentoId}>
                    <td className="font-medium">{p.empreendimento}</td>
                    <td>
                      {p.locatario ?? (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td>{p.localizacao}</td>
                    <td className="text-right">
                      <Dinheiro centavos={p.totalDevido} destaque />
                    </td>
                    <td className="text-right font-mono">
                      {p.diaVencimento ?? (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td>
                      <Atraso
                        dias={p.diasDesdeVencimento}
                        diaVencimento={p.diaVencimento}
                      />
                    </td>
                    <td className="max-w-56 text-xs text-slate-600">
                      {p.observacao ?? (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>
                    {d.pendentesMesQtde}{" "}
                    {d.pendentesMesQtde === 1 ? "cobrança" : "cobranças"}
                  </td>
                  <td className="text-right">
                    <Dinheiro centavos={d.pendentesMesValor} destaque />
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* ---------- AGING + TOP DEVEDORES ---------- */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            Aging — há quanto tempo venceu
            <Ajuda dica="Divide o valor pendente do mês por tempo de atraso, contando os dias a partir do dia de vencimento do contrato. Quanto mais desce na lista, mais urgente é cobrar." />
          </h2>
          {!agingComPendencia ? (
            <p className="text-sm text-slate-500">
              Sem valor pendente em {formatarCompetencia(mes)}.
            </p>
          ) : (
            <>
              <BarrasHorizontais
                itens={d.aging.map((f) => ({
                  rotulo: f.faixa,
                  valor: f.valor,
                }))}
                cor={COR_2}
              />
              <p className="mt-2 text-xs text-slate-500">
                Contratos sem dia de vencimento cadastrado entram como
                &quot;no prazo&quot;, porque não há data para comparar —
                cadastre o dia no contrato para o aging ficar preciso.
              </p>
              <details className="mt-2 text-xs text-slate-600">
                <summary className="cursor-pointer select-none">
                  Ver dados
                </summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="tabela">
                    <thead>
                      <tr>
                        <th>Faixa</th>
                        <th className="text-right">Cobranças</th>
                        <th className="text-right">Valor pendente</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.aging.map((f) => (
                        <tr key={f.faixa}>
                          <td>{f.faixa}</td>
                          <td className="text-right">{f.quantidade}</td>
                          <td className="text-right">
                            <Dinheiro centavos={f.valor} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            Top devedores do ano
            <Ajuda dica="Locatários que mais somam pendências nos meses com operação, de janeiro até o mês selecionado. Um mesmo nome aparecendo com vários meses é sinal de atraso recorrente — vale propor um acordo e anotar na Observação." />
          </h2>
          {d.topDevedores.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhuma pendência acumulada no ano.
            </p>
          ) : (
            <>
              <BarrasHorizontais
                itens={d.topDevedores.map((t) => ({
                  rotulo: t.locatario,
                  valor: t.valor,
                }))}
                cor={COR_2}
              />
              <details className="mt-2 text-xs text-slate-600">
                <summary className="cursor-pointer select-none">
                  Ver dados
                </summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="tabela">
                    <thead>
                      <tr>
                        <th>Locatário</th>
                        <th className="text-right">Cobranças</th>
                        <th>Meses</th>
                        <th className="text-right">Valor pendente</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.topDevedores.map((t) => (
                        <tr key={t.locatario}>
                          <td>{t.locatario}</td>
                          <td className="text-right">{t.quantidade}</td>
                          <td className="font-mono text-[11px]">
                            {t.meses.join(", ")}
                          </td>
                          <td className="text-right">
                            <Dinheiro centavos={t.valor} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </Card>
      </div>

      {/* ---------- HISTÓRICO ---------- */}
      <Card className="mt-4 p-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            Histórico do ano — devido × recebido
            <Ajuda dica="Compara, mês a mês, o que era para entrar com o que de fato entrou. Barras verdes menores que as ocres = mês com pendência; verde maior = atrasos de outros meses foram quitados ali." />
          </h2>
          <Legenda
            itens={[
              { cor: COR_2, nome: "Devido" },
              { cor: COR_1, nome: "Recebido" },
            ]}
          />
        </div>
        <BarrasDuplas
          serieA={d.porMes.map((l) => l.devido)}
          serieB={d.porMes.map((l) => l.recebido)}
          nomeA="Devido"
          nomeB="Recebido"
          corA={COR_2}
          corB={COR_1}
        />
        <div className="mt-3 overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                <th>Mês</th>
                <th className="text-right">Devido</th>
                <th className="text-right">Recebido</th>
                <th className="text-right">
                  % recebida{" "}
                  <Ajuda dica="Recebido dividido pelo devido do mês. Acima de 100% = entrou mais que o devido (atrasos de outros meses quitados aqui)." />
                </th>
                <th className="text-right">Pendências</th>
                <th className="text-right">Valor pendente</th>
                <th>
                  Situação{" "}
                  <Ajuda dica="'Pré-lançado' = mês com devidos gerados de antemão e nenhum recebimento registrado ainda; essas pendências não entram no acumulado do ano." />
                </th>
              </tr>
            </thead>
            <tbody>
              {mesesComMovimento.map((l) => (
                <tr
                  key={l.mes}
                  className={l.mesNum === mesNum ? "font-semibold" : ""}
                >
                  <td>{NOME_MES_ABREV[l.mesNum]}</td>
                  <td className="text-right">
                    <Dinheiro centavos={l.devido} />
                  </td>
                  <td className="text-right">
                    <Dinheiro centavos={l.recebido} />
                  </td>
                  <td className="text-right font-mono">
                    {pct(l.taxaRecebimento)}
                  </td>
                  <td className="text-right">{l.pendentes}</td>
                  <td className="text-right">
                    <Dinheiro centavos={l.pendenteValor} />
                  </td>
                  <td>
                    {l.operacional ? (
                      l.pendentes === 0 ? (
                        <Badge cor="verde">tudo recebido</Badge>
                      ) : (
                        <Badge cor="ambar">em cobrança</Badge>
                      )
                    ) : (
                      <Badge cor="slate">pré-lançado</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {mesesComMovimento.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-500">
                    Nenhum lançamento em {d.ano}.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---------- rodapé ---------- */}
      <Card className="mt-6 border-l-4 border-l-oliva px-6 py-4">
        <p className="text-sm leading-relaxed text-slate-700">
          <strong>Pendente não é perda.</strong> Pendente é dinheiro que ainda
          pode entrar: a cobrança continua valendo e, quando o locatário pagar
          — mesmo meses depois —, é só preencher o Recebido daquele lançamento
          e a comissão é calculada na hora. Perda só acontece se a família
          decidir desistir de cobrar; nesse caso, anote a decisão na
          Observação do lançamento para o histórico contar a história certa.
          Se o pagamento vier junto com um mês atrasado, lance tudo em
          Recebido e explique na Observação — a competência continua sendo a
          do mês devido.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold">
          <Link
            href={`/recebimentos?mes=${mes}`}
            className="text-oliva-escura hover:underline"
          >
            Registrar recebimentos de {formatarCompetencia(mes)} →
          </Link>
          <Link
            href={`/relatorios/inadimplencia?mes=${mes}`}
            className="text-oliva-escura hover:underline"
          >
            Relatório de inadimplência →
          </Link>
        </div>
      </Card>

      {taxaPct !== null && taxaPct >= 100 && d.pendentesMesQtde > 0 ? (
        <p className="mt-3 text-xs text-slate-400">
          A taxa do mês já passou de 100% e ainda há pendentes: alguém quitou
          atrasos por aqui enquanto outros seguem devendo — a lista acima é
          quem falta.
        </p>
      ) : null}
    </div>
  );
}
