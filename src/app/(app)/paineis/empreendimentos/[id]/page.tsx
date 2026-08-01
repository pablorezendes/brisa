import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Ajuda,
  Badge,
  Card,
  Dinheiro,
  Kpi,
  PageHeader,
  Ponto,
  SeletorPeriodo,
  btnSecundario,
} from "@/components/ui";
import {
  BarraComposicao,
  BarrasDuplas,
  BarrasMensais,
  COR_1,
  COR_2,
  Legenda,
} from "@/components/graficos";
import {
  nivelInadimplencia,
  nivelTaxaRecebimento,
} from "@/lib/dominio/semaforo";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import {
  NOME_MES_ABREV,
  NOME_MES_COMPLETO,
  parseCompetencia,
} from "@/lib/dominio/normalizacao";
import {
  numerosDeMes,
  parsePeriodo,
  rotulosCompetencias,
} from "@/lib/dominio/periodo";
import { formatarDataBR } from "@/lib/consultas/locacao";
import { mesMaisRecenteComLancamentos } from "@/lib/consultas/relatorios";
import {
  detalheEmpreendimento,
  detalheEmpreendimentoDoPeriodo,
} from "@/lib/consultas/painel-empreendimentos";
import { SeletorAno, anoDaQuery } from "@/app/(app)/relatorios/seletor-ano";
import { badgeStatus } from "@/app/(app)/contratos/status";

export const metadata = { title: "Detalhe do empreendimento — Brisa" };
export const dynamic = "force-dynamic";

function pct(v: number | null): string {
  if (v === null) return "—";
  return `${(v * 100).toFixed(1).replace(".", ",")}%`;
}

export default async function PaginaDetalheEmpreendimento({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ano?: string; de?: string; ate?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const periodo = parsePeriodo(sp.de, sp.ate);
  const mesRecente = await mesMaisRecenteComLancamentos();
  const ano = anoDaQuery(sp.ano, parseCompetencia(mesRecente).ano);

  const hoje = new Date();
  const anoAtual = hoje.getFullYear();
  const mesAtual = hoje.getMonth() + 1;

  // ---- as duas visões desembocam no MESMO view-model -----------------------
  // (modo ano: séries JAN..DEZ cortadas no último mês com dados; modo
  //  período: exatamente as competências escolhidas no calendário)
  const vm = periodo
    ? await (async () => {
        const d = await detalheEmpreendimentoDoPeriodo(id, periodo.meses);
        if (!d) return null;
        const rotulos = rotulosCompetencias(periodo.meses);
        return {
          d,
          janela: periodo.rotulo,
          naJanela: "no período",
          rotulosSerie: rotulos as string[] | undefined,
          rotulosLinhas: rotulos,
          corte: periodo.meses.length,
          destaqueSerie: undefined as number | undefined,
          mesesReajuste: new Set(numerosDeMes(periodo.meses)) as Set<number> | null,
          hrefVoltar: `/paineis/empreendimentos?de=${periodo.de}&ate=${periodo.ate}`,
        };
      })()
    : await (async () => {
        const d = await detalheEmpreendimento(id, ano);
        if (!d) return null;
        return {
          d,
          janela: String(ano),
          naJanela: `em ${ano}`,
          rotulosSerie: undefined as string[] | undefined,
          rotulosLinhas: NOME_MES_ABREV.slice(1, d.ultimoMesComDados + 1),
          corte: d.ultimoMesComDados,
          destaqueSerie: (ano === anoAtual ? mesAtual : 0) as
            | number
            | undefined,
          mesesReajuste: null as Set<number> | null,
          hrefVoltar: `/paineis/empreendimentos?ano=${ano}`,
        };
      })();
  if (!vm) notFound();
  const d = vm.d;

  const ocupacaoPct =
    d.ocupacao.ativas > 0 ? d.ocupacao.ocupadas / d.ocupacao.ativas : null;
  const totalComissaoUnidades = d.unidades.reduce(
    (a, u) => a + u.comissaoJanela,
    0
  );

  return (
    <div className="max-w-6xl">
      <PageHeader
        titulo={d.nome}
        descricao={
          periodo
            ? `Comissão, recebimentos, unidades e locatários deste empreendimento no período ${periodo.rotulo}.`
            : `Comissão, recebimentos, unidades e locatários deste empreendimento em ${ano}.`
        }
        acoes={
          <>
            {!periodo ? (
              <SeletorAno
                base={`/paineis/empreendimentos/${d.id}`}
                ano={ano}
              />
            ) : null}
            <SeletorPeriodo
              base={`/paineis/empreendimentos/${d.id}`}
              periodo={periodo}
            />
            <Link href={vm.hrefVoltar} className={btnSecundario}>
              Voltar
            </Link>
          </>
        }
      />

      {/* ---------- KPIs ---------- */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi
          rotulo={periodo ? "Comissão no período" : "Comissão no ano"}
          valor={<Dinheiro centavos={d.comissaoTotal} destaque />}
          detalhe="o ganho da administradora aqui"
          ajuda="Soma da comissão de cada lançamento pago do empreendimento: (recebido − IPTU − condomínio) × taxa do lançamento (padrão 10%). IPTU e condomínio são repasses ao proprietário e nunca entram na conta."
        />
        <Kpi
          rotulo={periodo ? "Recebido no período" : "Recebido no ano"}
          valor={<Dinheiro centavos={d.recebidoTotal} destaque />}
          detalhe="aluguel + repasses (IPTU/cond.)"
          ajuda={`Tudo o que os locatários pagaram nos lançamentos ${periodo ? "do período" : "deste ano"}. Só conta quando o campo Recebido é preenchido — se o locatário pagou junto um mês atrasado, lance tudo em Recebido e anote o motivo na Observação.`}
        />
        <Kpi
          rotulo="Taxa de recebimento"
          valor={pct(d.taxaRecebimento)}
          detalhe={`entrou ${formatarBRL(d.recebidoTotal)} de ${formatarBRL(d.devidoTotal)} devidos`}
          nivel={nivelTaxaRecebimento(d.taxaRecebimento)}
          grafico={
            d.devidoTotal > 0 ? (
              <BarraComposicao
                partes={[
                  { rotulo: "recebido", valor: d.recebidoTotal, cor: COR_1 },
                  {
                    rotulo: "a receber",
                    valor: Math.max(d.devidoTotal - d.recebidoTotal, 0),
                    cor: COR_2,
                  },
                ]}
              />
            ) : undefined
          }
          ajuda={`Recebido ÷ devido ${periodo ? "no período" : "no ano"}. Acima de 100% = atrasos de meses anteriores quitados; abaixo, há cobranças sem pagamento ou pagas em parte (o motivo do parcial vai na Observação do lançamento).`}
        />
        <Kpi
          rotulo="Ocupação"
          valor={
            d.ocupacao.ativas > 0
              ? `${d.ocupacao.ocupadas}/${d.ocupacao.ativas} (${pct(ocupacaoPct)})`
              : "—"
          }
          detalhe={
            d.ocupacao.desocupadas > 0
              ? `${d.ocupacao.desocupadas} unidade(s) desocupada(s)`
              : "todas as unidades ocupadas"
          }
          nivel={
            d.ocupacao.ativas === 0
              ? "neutro"
              : d.ocupacao.desocupadas === 0
                ? "otimo"
                : "atencao"
          }
          selo={
            d.ocupacao.ativas === 0
              ? undefined
              : d.ocupacao.desocupadas === 0
                ? "tudo alugado"
                : "unidade vazia"
          }
          nota={
            d.ocupacao.desocupadas > 0
              ? "Cada mês vazio é receita perdida — priorize divulgar e negociar essas unidades."
              : undefined
          }
          ajuda="Unidades ativas com locatário no contrato vigente. Unidade desocupada não gera aluguel nem comissão — cada mês vazio é receita perdida; priorize divulgar e negociar essas unidades."
        />
        <Kpi
          rotulo="Pendente em aberto"
          valor={<Dinheiro centavos={d.pendenteAberto} destaque />}
          detalhe={`${d.pendentesQtde} cobrança(s) sem pagamento ${vm.naJanela}`}
          nivel={nivelInadimplencia(d.pendenteAberto, d.devidoTotal)}
          nota={
            d.pendenteAberto > 0
              ? "Registre o pagamento em Recebimentos assim que o dinheiro entrar."
              : undefined
          }
          ajuda={`Cobranças lançadas ${periodo ? "no período" : "no ano"} que ainda estão sem valor em Recebido. Quando o locatário pagar, preencha Recebido e a Data de pagamento no lançamento — a competência continua sendo a do mês devido.`}
        />
      </div>

      {/* ---------- gráficos ---------- */}
      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">
              Comissão mês a mês — {vm.janela}
            </h2>
            <span className="text-xs text-tinta-suave">
              total: {formatarBRL(d.comissaoTotal)}
            </span>
          </div>
          <BarrasMensais
            valores={d.comissaoPorMes}
            mesSelecionado={vm.destaqueSerie}
            rotulos={vm.rotulosSerie}
          />
          <p className="mt-2 text-xs text-tinta-suave">
            Cada barra é a comissão que este empreendimento gerou no mês de
            lançamento. Mês sem barra = nada recebido (ou só devidos ainda em
            aberto).
          </p>
          <details className="mt-2 text-xs text-tinta-suave">
            <summary className="cursor-pointer select-none">Ver dados</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Mês</th>
                    <th className="text-right">Comissão</th>
                  </tr>
                </thead>
                <tbody>
                  {d.comissaoPorMes.slice(0, vm.corte).map((v, i) => (
                    <tr key={i}>
                      <td>{vm.rotulosLinhas[i]}</td>
                      <td className="text-right">
                        <Dinheiro centavos={v} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Card>

        <Card className="p-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">
              Devido × Recebido — {vm.janela}
            </h2>
            <Legenda
              itens={[
                { cor: COR_2, nome: "Devido" },
                { cor: COR_1, nome: "Recebido" },
              ]}
            />
          </div>
          <BarrasDuplas
            serieA={d.devidoPorMes}
            serieB={d.recebidoPorMes}
            nomeA="Devido"
            nomeB="Recebido"
            corA={COR_2}
            corB={COR_1}
            rotulos={vm.rotulosSerie}
          />
          <p className="mt-2 text-xs text-tinta-suave">
            Recebido acima do devido = atrasos quitados no mês; abaixo =
            inadimplência ou pagamento parcial (motivo na Observação do
            lançamento).
          </p>
          <details className="mt-2 text-xs text-tinta-suave">
            <summary className="cursor-pointer select-none">Ver dados</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Mês</th>
                    <th className="text-right">Devido</th>
                    <th className="text-right">Recebido</th>
                    <th className="text-right">Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  {d.devidoPorMes.slice(0, vm.corte).map((v, i) => (
                    <tr key={i}>
                      <td>{vm.rotulosLinhas[i]}</td>
                      <td className="text-right">
                        <Dinheiro centavos={v} />
                      </td>
                      <td className="text-right">
                        <Dinheiro centavos={d.recebidoPorMes[i]} />
                      </td>
                      <td className="text-right">
                        <Dinheiro centavos={d.recebidoPorMes[i] - v} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Card>
      </div>

      {/* ---------- unidades ---------- */}
      <Card className="mt-4 p-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Unidades</h2>
          <span className="text-xs text-tinta-suave">
            {d.ocupacao.ativas} ativa(s) · {d.ocupacao.desocupadas}{" "}
            desocupada(s)
          </span>
        </div>
        {d.unidades.length === 0 ? (
          <p className="text-sm text-tinta-suave">
            Nenhuma unidade cadastrada neste empreendimento.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Localização</th>
                  <th>
                    Locatário atual{" "}
                    <Ajuda dica="Quem está no contrato vigente da unidade. 'Desocupada' = sem locatário: não gera aluguel nem comissão e merece atenção comercial." />
                  </th>
                  <th className="text-right">
                    Aluguel contratado{" "}
                    <Ajuda dica="Valor-base do contrato vigente, sem IPTU e condomínio (repasses ao proprietário). É o valor que deve ser corrigido no aniversário de reajuste." />
                  </th>
                  <th>
                    Reajuste{" "}
                    <Ajuda
                      dica={
                        periodo
                          ? "Mês de aniversário da correção anual do aluguel. 'Cai no período' = o aniversário cai em um dos meses da janela escolhida — confira se o índice foi aplicado e o valor-base atualizado no contrato; o sistema não corrige sozinho."
                          : "Mês de aniversário da correção anual do aluguel. Quando ele chega, aplique o índice e atualize o valor-base no contrato — o sistema não corrige sozinho. 'Já passou' = o aniversário deste ano ficou para trás; confira se o valor foi corrigido."
                      }
                    />
                  </th>
                  <th>Status</th>
                  <th className="text-right">
                    {periodo ? "Comissão no período" : "Comissão no ano"}{" "}
                    <Ajuda
                      dica={`Comissão que os lançamentos pagos desta unidade geraram ${periodo ? "no período" : "no ano"}, pela regra (recebido − repasses) × taxa.`}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.unidades.map((u) => (
                  <tr key={u.unidadeId}>
                    <td className="font-medium">
                      {u.identificacao}
                      {!u.ativa ? (
                        <span className="ml-2 align-middle">
                          <Badge cor="slate">inativa</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {u.locatario ?? <Badge cor="ambar">Desocupada</Badge>}
                    </td>
                    <td className="text-right">
                      <Dinheiro centavos={u.aluguelContratado} />
                    </td>
                    <td>
                      {u.mesReajuste ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="font-mono text-xs">
                            {NOME_MES_ABREV[u.mesReajuste]}
                          </span>
                          {periodo ? (
                            vm.mesesReajuste?.has(u.mesReajuste) ? (
                              <Badge cor="ambar">cai no período</Badge>
                            ) : null
                          ) : ano === anoAtual && u.mesReajuste === mesAtual ? (
                            <Badge cor="ambar">é agora</Badge>
                          ) : ano === anoAtual && u.mesReajuste < mesAtual ? (
                            <Badge cor="ambar">já passou — confira</Badge>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-tinta-suave/60">—</span>
                      )}
                    </td>
                    <td>
                      {u.statusContrato ? (
                        badgeStatus(u.statusContrato)
                      ) : (
                        <Badge cor="slate">sem contrato</Badge>
                      )}
                    </td>
                    <td className="text-right">
                      <Dinheiro centavos={u.comissaoJanela} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>Total</td>
                  <td className="text-right">
                    <Dinheiro centavos={totalComissaoUnidades} destaque />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {d.ocupacao.desocupadas > 0 ? (
          <p className="mt-2 flex items-baseline gap-1.5 text-xs text-tinta-suave">
            <Ponto nivel="atencao" titulo="atenção" />
            <span>
              Unidade desocupada não gera aluguel nem comissão — cada mês vazio
              é receita que não volta. Vale priorizar a divulgação e a
              negociação dessas unidades.
            </span>
          </p>
        ) : null}
      </Card>

      {/* ---------- locatários ---------- */}
      <Card className="mt-4 p-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">
            {periodo ? "Locatários no período" : `Locatários em ${ano}`}
          </h2>
          <span className="text-xs text-tinta-suave">
            pendente em aberto: {formatarBRL(d.pendenteAberto)}
          </span>
        </div>
        {d.locatarios.length === 0 ? (
          <p className="text-sm text-tinta-suave">
            Nenhum lançamento para locatários deste empreendimento{" "}
            {vm.naJanela}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Locatário</th>
                  <th className="text-right">
                    {periodo ? "Recebido no período" : "Recebido no ano"}{" "}
                    <Ajuda
                      dica={`Soma do campo Recebido dos lançamentos do locatário ${periodo ? "no período" : "no ano"} (aluguel + IPTU + condomínio quando cobrados juntos). Pode passar do contratado quando ele quita atrasos.`}
                    />
                  </th>
                  <th className="text-right">
                    Pendente{" "}
                    <Ajuda
                      dica={`Cobranças lançadas ${periodo ? "no período" : "no ano"} ainda sem valor em Recebido. Ao receber, preencha Recebido e a Data de pagamento; se for acordo ou pagamento parcial, anote o motivo na Observação.`}
                    />
                  </th>
                  <th className="text-right">
                    Último pagamento{" "}
                    <Ajuda
                      dica={`Data de pagamento mais recente registrada nos lançamentos ${periodo ? "do período" : "do ano"}. Se aparecer '—' com valor recebido, a data não foi preenchida no lançamento — vale sempre preencher.`}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.locatarios.map((l) => (
                  <tr key={l.nome}>
                    <td className="font-medium">{l.nome}</td>
                    <td className="text-right">
                      <Dinheiro centavos={l.recebidoJanela} />
                    </td>
                    <td className="text-right">
                      {l.pendenteJanela > 0 ? (
                        <span className="inline-flex items-center justify-end gap-2">
                          <Badge cor={l.lancamentosPendentes > 1 ? "vermelho" : "ambar"}>
                            {l.lancamentosPendentes}×
                          </Badge>
                          <Dinheiro centavos={l.pendenteJanela} />
                        </span>
                      ) : (
                        <span className="text-tinta-suave/40">—</span>
                      )}
                    </td>
                    <td className="text-right font-mono text-xs">
                      {l.ultimoPagamento ? (
                        formatarDataBR(l.ultimoPagamento)
                      ) : (
                        <span className="text-tinta-suave/60">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="text-right">
                    <Dinheiro centavos={d.recebidoTotal} destaque />
                  </td>
                  <td className="text-right">
                    <Dinheiro centavos={d.pendenteAberto} destaque />
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-6 text-xs text-tinta-suave/60">
        {periodo ? (
          <>
            Todos os números nascem dos lançamentos de recebimento deste
            empreendimento no período {periodo.rotulo} (
            {vm.rotulosLinhas.length === 1
              ? `competência ${vm.rotulosLinhas[0]}`
              : `competências ${vm.rotulosLinhas[0]}–${vm.rotulosLinhas[vm.rotulosLinhas.length - 1]}`}
            ), pela regra canônica: comissão = (recebido − IPTU − condomínio) ×
            taxa do lançamento. Reajustes ganham a marca &quot;cai no
            período&quot; quando o mês de aniversário está dentro da janela.
          </>
        ) : (
          <>
            Todos os números nascem dos lançamentos de recebimento do ano {ano}{" "}
            deste empreendimento (mês de lançamento {NOME_MES_ABREV[1]}–
            {NOME_MES_ABREV[12]}), pela regra canônica: comissão = (recebido −
            IPTU − condomínio) × taxa do lançamento.{" "}
            {NOME_MES_COMPLETO[mesAtual]} é o mês corrente usado para destacar
            reajustes.
          </>
        )}
      </p>
    </div>
  );
}
