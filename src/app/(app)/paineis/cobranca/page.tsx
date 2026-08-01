import Link from "next/link";
import {
  Ajuda,
  Card,
  Dinheiro,
  Kpi,
  LinkCard,
  PageHeader,
  PainelAlertas,
  Ponto,
  Selo,
  SeletorMes,
  SeletorPeriodo,
  TituloCard,
  type ItemAlerta,
} from "@/components/ui";
import {
  BarraComposicao,
  BarrasDuplas,
  BarrasHorizontais,
  COR_1,
  COR_2,
  Legenda,
} from "@/components/graficos";
import {
  nivelAtraso,
  nivelInadimplencia,
  nivelTaxaRecebimento,
  type Nivel,
} from "@/lib/dominio/semaforo";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import {
  formatarCompetencia,
  NOME_MES_ABREV,
  NOME_MES_COMPLETO,
  parseCompetencia,
} from "@/lib/dominio/normalizacao";
import { parsePeriodo, rotulosCompetencias } from "@/lib/dominio/periodo";
import { mesPadrao } from "@/lib/consultas/executivo";
import {
  dadosPainelCobranca,
  dadosPainelCobrancaPeriodo,
} from "@/lib/consultas/painel-cobranca";

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
    return (
      <span className="text-xs text-tinta-suave/60">sem dia cadastrado</span>
    );
  }
  if (dias <= 0) {
    return <Selo nivel="info">a vencer (dia {diaVencimento})</Selo>;
  }
  return (
    <Selo nivel={nivelAtraso(dias)}>
      {dias} {dias === 1 ? "dia" : "dias"}
    </Selo>
  );
}

/**
 * Nível de cada faixa de aging, na mesma ordem de FAIXAS_AGING:
 * No prazo · 1–15 · 16–30 · 31–60 · +60 dias.
 */
const NIVEL_AGING: Nivel[] = [
  "info",
  "atencao",
  "atencao",
  "critico",
  "critico",
];

export default async function PainelCobranca({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; de?: string; ate?: string }>;
}) {
  const sp = await searchParams;
  const periodo = parsePeriodo(sp.de, sp.ate);
  const mes =
    sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : await mesPadrao();
  const { ano, mes: mesNum } = parseCompetencia(mes);
  const nomeMes = NOME_MES_COMPLETO[mesNum].toLowerCase();

  // links de ação carregam a MESMA janela em tela (período ou mês)
  const qs = periodo ? `de=${periodo.de}&ate=${periodo.ate}` : `mes=${mes}`;

  // ---- as duas visões desembocam no MESMO view-model -----------------------
  // (modo mês: pendências do mês em tela + série dos 12 meses do ano; modo
  //  período: pendências de todos os meses da janela + série da própria janela)
  const vm = periodo
    ? await (async () => {
        const d = await dadosPainelCobrancaPeriodo(periodo.meses);
        return {
          pendentesQtde: d.pendentesQtde,
          pendentesValor: d.pendentesValor,
          devido: d.devido,
          recebido: d.recebido,
          taxa: d.taxaRecebimento,
          maiorDevedor: d.maiorDevedor,
          listaCobranca: d.listaCobranca,
          aging: d.aging,
          porMes: d.porMes,
          topDevedores: d.topDevedores,
          rotulosSerie: rotulosCompetencias(periodo.meses) as
            | string[]
            | undefined,
          destaqueSerie: undefined as number | undefined,
          comMesNaTabela: periodo.meses.length > 1,
          // "Pendentes no período" = a própria janela
          acumQtde: d.pendentesQtde,
          acumValor: d.pendentesValor,
          mesesOperacionais: d.porMes.filter((l) => l.operacional).length,
        };
      })()
    : await (async () => {
        const d = await dadosPainelCobranca(mes);
        return {
          pendentesQtde: d.pendentesMesQtde,
          pendentesValor: d.pendentesMesValor,
          devido: d.devidoMes,
          recebido: d.recebidoMes,
          taxa: d.taxaRecebimentoMes,
          maiorDevedor: d.maiorDevedor,
          listaCobranca: d.listaCobranca.map((p) => ({ ...p, mes })),
          aging: d.aging,
          porMes: d.porMes,
          topDevedores: d.topDevedores,
          rotulosSerie: undefined as string[] | undefined,
          destaqueSerie: mesNum as number | undefined,
          comMesNaTabela: false,
          acumQtde: d.pendentesAnoQtde,
          acumValor: d.pendentesAnoValor,
          mesesOperacionais: d.mesesOperacionaisConsiderados,
        };
      })();

  const nomeJanela = periodo ? "no período" : `em ${nomeMes}`;
  const taxaPct = vm.taxa !== null ? vm.taxa * 100 : null;
  const agingComPendencia = vm.aging.some((f) => f.valor > 0);
  const linhasHistorico = (
    periodo
      ? vm.porMes.map((l, i) => ({
          ...l,
          rotulo: (vm.rotulosSerie as string[])[i],
          atual: false,
        }))
      : vm.porMes.map((l) => ({
          ...l,
          rotulo: NOME_MES_ABREV[l.mesNum],
          atual: l.mesNum === mesNum,
        }))
  ).filter((l) => l.devido > 0 || l.recebido > 0);

  // ---- semáforos -----------------------------------------------------------
  const nvTaxa = nivelTaxaRecebimento(vm.taxa);
  const nvPendentes = nivelInadimplencia(vm.pendentesValor, vm.devido);
  const graves = vm.listaCobranca.filter(
    (p) => p.diasDesdeVencimento !== null && p.diasDesdeVencimento > 30
  );
  const valorGrave = graves.reduce((s, p) => s + p.totalDevido, 0);
  const nvAcum: Nivel = vm.acumValor > 0 ? "atencao" : "otimo";

  const alertas: ItemAlerta[] = [];
  if (graves.length > 0) {
    alertas.push({
      nivel: "critico",
      titulo: "Cobranças acima de 30 dias",
      texto: `${graves.length} ${graves.length === 1 ? "cobrança venceu" : "cobranças venceram"} há mais de 30 dias, somando ${formatarBRL(valorGrave)}. São as primeiras ligações do dia.`,
      acao: { rotulo: "Registrar", href: `/recebimentos?${qs}` },
    });
  }
  if (vm.maiorDevedor && vm.maiorDevedor.quantidade > 1) {
    alertas.push({
      nivel: "atencao",
      titulo: "Atraso recorrente",
      texto: `${vm.maiorDevedor.locatario} acumula ${vm.maiorDevedor.quantidade} cobranças em aberto ${periodo ? "no período" : "no ano"} (${formatarBRL(vm.maiorDevedor.valor)}). Vale propor um acordo e anotá-lo na Observação do lançamento.`,
    });
  }
  if (nvTaxa !== "otimo" && vm.taxa !== null) {
    alertas.push({
      nivel: nvTaxa,
      titulo: "Taxa de recebimento abaixo de 95%",
      texto: `Entrou ${pct(vm.taxa)} do devido ${periodo ? "no período" : `de ${nomeMes}`} — ${formatarBRL(vm.recebido)} de ${formatarBRL(vm.devido)}.`,
    });
  }
  const semDiaVencimento = vm.listaCobranca.filter(
    (p) => p.diaVencimento === null
  ).length;
  if (semDiaVencimento > 0) {
    alertas.push({
      nivel: "info",
      titulo: "Contratos sem dia de vencimento",
      texto: `${semDiaVencimento} cobrança(s) pendente(s) vêm de contrato sem dia de vencimento cadastrado — sem isso não dá para calcular atraso e elas caem em "no prazo" no aging.`,
      acao: { rotulo: "Abrir contratos", href: "/contratos" },
    });
  }

  return (
    <div className="max-w-7xl">
      <PageHeader
        titulo="Painel de cobrança"
        descricao={
          periodo
            ? `Quem cobrar e o que registrar — ${periodo.rotulo}`
            : `Quem cobrar e o que registrar — ${NOME_MES_COMPLETO[mesNum]} de ${ano}`
        }
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            {!periodo ? (
              <SeletorMes base="/paineis/cobranca" mes={mes} />
            ) : null}
            <SeletorPeriodo base="/paineis/cobranca" periodo={periodo} />
          </div>
        }
      />

      <PainelAlertas
        itens={alertas}
        ajuda="A fila de cobrança do dia, da mais urgente para a menos. Vermelho passou de 30 dias, âmbar venceu há pouco, azul é só um aviso de cadastro."
        vazio={`Nada a cobrar ${nomeJanela} — todas as cobranças ${periodo ? "da janela" : "do mês"} foram recebidas.`}
      />

      {/* ---------- KPIs ---------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {periodo ? (
          <Kpi
            rotulo="Vencido há mais de 30 dias"
            valor={<Dinheiro centavos={valorGrave} destaque />}
            detalhe={`${graves.length} ${graves.length === 1 ? "cobrança passou" : "cobranças passaram"} de 30 dias na janela`}
            nivel={graves.length > 0 ? "critico" : "otimo"}
            selo={graves.length > 0 ? "ligar hoje" : "nada grave"}
            ajuda="Soma das cobranças do período que venceram há mais de 30 dias — o atraso é contado do vencimento da competência de cada uma. São as primeiras ligações do dia; quando o dinheiro entrar, registre em Recebimentos e anote acordos na Observação."
          />
        ) : (
          <Kpi
            rotulo="Pendentes do mês"
            valor={<Dinheiro centavos={vm.pendentesValor} destaque />}
            detalhe={`${vm.pendentesQtde} cobrança(s) sem pagamento em ${nomeMes}`}
            nivel={nvPendentes}
            nota={
              graves.length > 0
                ? `${graves.length} ${graves.length === 1 ? "delas passou" : "delas passaram"} de 30 dias — comece por aí.`
                : undefined
            }
            ajuda="Cobranças lançadas neste mês que ainda estão sem valor em Recebido. Quando o locatário pagar, vá em Recebimentos e preencha Recebido, Data e Via — a linha sai desta lista sozinha."
          />
        )}
        <Kpi
          rotulo="Taxa de recebimento"
          valor={pct(vm.taxa)}
          detalhe={`entrou ${formatarBRL(vm.recebido)} de ${formatarBRL(vm.devido)} devidos`}
          nivel={nvTaxa}
          grafico={
            vm.devido > 0 ? (
              <BarraComposicao
                partes={[
                  { rotulo: "recebido", valor: vm.recebido, cor: COR_1 },
                  {
                    rotulo: "a receber",
                    valor: Math.max(vm.devido - vm.recebido, 0),
                    cor: COR_2,
                  },
                ]}
              />
            ) : undefined
          }
          ajuda={`Quanto do total devido ${periodo ? "da janela" : "do mês"} já entrou. Pode passar de 100% quando alguém quita atrasos de outros meses — nesse caso lance o valor cheio em Recebido e anote o motivo na Observação; a competência continua sendo a do mês devido.`}
        />
        <Kpi
          rotulo={
            periodo ? "Pendentes no período" : "Pendentes acumulados no ano"
          }
          valor={<Dinheiro centavos={vm.acumValor} destaque />}
          detalhe={
            periodo
              ? `${vm.acumQtde} cobrança(s) nas ${periodo.meses.length} competência(s) da janela`
              : `${vm.acumQtde} cobrança(s) em ${vm.mesesOperacionais} mês(es) com operação`
          }
          nivel={nvAcum}
          selo={vm.acumValor > 0 ? "a recuperar" : "nada em aberto"}
          ajuda={
            periodo
              ? "Tudo o que segue sem pagamento dentro da janela escolhida no calendário — é a lista de cobrança abaixo, somada. Meses lançados de antemão contam quando você os inclui no período; encurte a janela se não quiser vê-los."
              : `Soma tudo o que ficou sem pagamento de janeiro até ${nomeMes}. Meses lançados de antemão, ainda sem nenhum recebimento registrado, ficam de fora — senão o número inflaria com cobranças que nem venceram.`
          }
        />
        <Kpi
          rotulo={periodo ? "Maior devedor do período" : "Maior devedor do ano"}
          valor={
            vm.maiorDevedor ? (
              <Dinheiro centavos={vm.maiorDevedor.valor} destaque />
            ) : (
              "—"
            )
          }
          detalhe={
            vm.maiorDevedor
              ? `${vm.maiorDevedor.locatario} · ${vm.maiorDevedor.quantidade} cobrança(s) em aberto`
              : periodo
                ? "ninguém devendo no período"
                : "ninguém devendo no ano"
          }
          nivel={
            vm.maiorDevedor
              ? vm.maiorDevedor.quantidade > 1
                ? "critico"
                : "atencao"
              : "otimo"
          }
          selo={
            vm.maiorDevedor && vm.maiorDevedor.quantidade > 1
              ? "recorrente"
              : undefined
          }
          nota={
            vm.maiorDevedor && vm.maiorDevedor.quantidade > 1
              ? "Mesmo nome em vários meses: proponha um acordo e registre na Observação."
              : undefined
          }
          ajuda={
            periodo
              ? "Locatário que mais soma pendências dentro da janela escolhida — a primeira ligação a fazer. Se combinar um parcelamento, registre cada pagamento em Recebido e anote o acordo na Observação do lançamento."
              : "Locatário que mais soma pendências no ano até o mês selecionado — a primeira ligação a fazer. Se combinar um parcelamento, registre cada pagamento em Recebido e anote o acordo na Observação do lançamento."
          }
        />
      </div>

      {/* ---------- LISTA DE COBRANÇA ---------- */}
      <Card
        className="mt-4 p-5"
        nivel={vm.listaCobranca.length > 0 ? nvPendentes : undefined}
      >
        <TituloCard
          titulo={
            periodo ? "Lista de cobrança do período" : "Lista de cobrança de hoje"
          }
          nivel={vm.listaCobranca.length > 0 ? nvPendentes : "otimo"}
          ajuda={
            periodo
              ? "Todas as cobranças pendentes dos meses da janela, dos maiores valores para os menores — a coluna Mês diz a competência de cada uma. Quando alguém pagar, vá em Recebimentos, escolha o mês da cobrança e preencha Recebido, Data e Via de pagamento."
              : "Ordene o dia por esta lista: os maiores valores primeiro. Quando alguém pagar, vá em Recebimentos, encontre a linha e preencha Recebido, Data e Via de pagamento — a cobrança some daqui na hora."
          }
          direita={
            <>
              <span className="font-mono text-[12px] text-tinta-suave">
                {vm.pendentesQtde} ·{" "}
                <strong className="text-tinta">
                  {formatarBRL(vm.pendentesValor)}
                </strong>
              </span>
              <LinkCard href={`/recebimentos?${qs}`}>Registrar</LinkCard>
            </>
          }
        />
        {vm.listaCobranca.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-tinta-suave">
            <Selo nivel="otimo">tudo recebido</Selo>
            Todas as cobranças de{" "}
            {periodo ? periodo.rotulo : formatarCompetencia(mes)} foram
            recebidas. Nada a cobrar hoje.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead>
                <tr>
                  <th>
                    <span className="sr-only">Situação</span>
                    <Ajuda dica="Semáforo do atraso: azul = ainda não venceu, âmbar = venceu há até 30 dias, vermelho = passou de 30 dias, cinza = contrato sem dia de vencimento cadastrado." />
                  </th>
                  {vm.comMesNaTabela ? <th>Mês</th> : null}
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
                    <Ajuda
                      dica={
                        periodo
                          ? "Dias corridos desde o vencimento da competência de cada cobrança. 'A vencer' = ainda não chegou o dia; '—' = contrato sem dia de vencimento cadastrado."
                          : "Dias corridos desde o vencimento deste mês. 'A vencer' = ainda não chegou o dia; '—' = contrato sem dia de vencimento cadastrado."
                      }
                    />
                  </th>
                  <th>
                    Observação{" "}
                    <Ajuda dica="Anotação feita no lançamento — acordos, pagamento parcial, motivo do atraso. Ao registrar qualquer combinação com o locatário, escreva aqui para a família toda saber." />
                  </th>
                </tr>
              </thead>
              <tbody>
                {vm.listaCobranca.map((p) => (
                  <tr key={p.recebimentoId}>
                    <td>
                      <Ponto
                        nivel={nivelAtraso(p.diasDesdeVencimento)}
                        titulo={
                          p.diasDesdeVencimento === null
                            ? "sem dia de vencimento cadastrado"
                            : p.diasDesdeVencimento <= 0
                              ? `a vencer (dia ${p.diaVencimento})`
                              : `${p.diasDesdeVencimento} dia(s) de atraso`
                        }
                      />
                    </td>
                    {vm.comMesNaTabela ? (
                      <td className="font-mono text-[12px]">
                        {formatarCompetencia(p.mes)}
                      </td>
                    ) : null}
                    <td className="font-medium">{p.empreendimento}</td>
                    <td>
                      {p.locatario ?? (
                        <span className="text-tinta-suave/60">—</span>
                      )}
                    </td>
                    <td>{p.localizacao}</td>
                    <td className="text-right">
                      <Dinheiro centavos={p.totalDevido} destaque />
                    </td>
                    <td className="text-right font-mono">
                      {p.diaVencimento ?? (
                        <span className="text-tinta-suave/60">—</span>
                      )}
                    </td>
                    <td>
                      <Atraso
                        dias={p.diasDesdeVencimento}
                        diaVencimento={p.diaVencimento}
                      />
                    </td>
                    <td className="max-w-56 text-xs text-tinta-suave">
                      {p.observacao ?? (
                        <span className="text-tinta-suave/60">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={vm.comMesNaTabela ? 5 : 4}>
                    {vm.pendentesQtde}{" "}
                    {vm.pendentesQtde === 1 ? "cobrança" : "cobranças"}
                  </td>
                  <td className="text-right">
                    <Dinheiro centavos={vm.pendentesValor} destaque />
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
          <TituloCard
            titulo="Aging — há quanto tempo venceu"
            ajuda={
              periodo
                ? "Divide o valor pendente do período por tempo de atraso, contando a partir do vencimento da competência de cada cobrança — uma pendência de março continua envelhecendo mesmo com a janela indo até junho. Cada faixa é pintada com a cor do semáforo: azul ainda não venceu, âmbar até 30 dias, vermelho acima disso. Quanto mais desce a lista, mais urgente é cobrar."
                : "Divide o valor pendente do mês por tempo de atraso, contando a partir do dia de vencimento do contrato. Cada faixa é pintada com a cor do semáforo: azul ainda não venceu, âmbar até 30 dias, vermelho acima disso. Quanto mais desce a lista, mais urgente é cobrar."
            }
          />
          {!agingComPendencia ? (
            <div className="flex items-center gap-2 text-sm text-tinta-suave">
              <Selo nivel="otimo">nada vencido</Selo>
              Sem valor pendente{" "}
              {periodo ? "no período" : `em ${formatarCompetencia(mes)}`}.
            </div>
          ) : (
            <>
              <BarrasHorizontais
                itens={vm.aging.map((f, i) => ({
                  rotulo: f.faixa,
                  valor: f.valor,
                  nivel: NIVEL_AGING[i],
                }))}
                cor={COR_2}
              />
              <p className="mt-2 text-xs text-tinta-suave">
                Contratos sem dia de vencimento cadastrado entram como
                &quot;no prazo&quot;, porque não há data para comparar —
                cadastre o dia no contrato para o aging ficar preciso.
              </p>
              <details className="mt-2 text-xs text-tinta-suave">
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
                      {vm.aging.map((f, i) => (
                        <tr key={f.faixa}>
                          <td>
                            <span className="inline-flex items-center gap-2">
                              <Ponto nivel={NIVEL_AGING[i]} />
                              {f.faixa}
                            </span>
                          </td>
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
          <TituloCard
            titulo={
              periodo ? "Top devedores do período" : "Top devedores do ano"
            }
            ajuda={
              periodo
                ? "Locatários que mais somam pendências dentro da janela escolhida no calendário. Vermelho marca quem deve em mais de um mês — atraso recorrente pede acordo, e o acordo pede uma anotação na Observação do lançamento."
                : "Locatários que mais somam pendências nos meses com operação, de janeiro até o mês selecionado. Vermelho marca quem deve em mais de um mês — atraso recorrente pede acordo, e o acordo pede uma anotação na Observação do lançamento."
            }
          />
          {vm.topDevedores.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-tinta-suave">
              <Selo nivel="otimo">ninguém devendo</Selo>
              Nenhuma pendência acumulada{" "}
              {periodo ? "no período" : "no ano"}.
            </div>
          ) : (
            <>
              <BarrasHorizontais
                itens={vm.topDevedores.map((t) => ({
                  rotulo: t.locatario,
                  valor: t.valor,
                  nivel: t.quantidade > 1 ? ("critico" as Nivel) : ("atencao" as Nivel),
                }))}
                cor={COR_2}
              />
              <details className="mt-2 text-xs text-tinta-suave">
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
                      {vm.topDevedores.map((t) => (
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
        <TituloCard
          titulo={
            periodo
              ? "Devido × recebido no período"
              : "Histórico do ano — devido × recebido"
          }
          ajuda={
            periodo
              ? "Compara, em cada mês da janela escolhida, o que era para entrar com o que de fato entrou. Coluna verde menor que a ocre = mês com pendência; verde maior = atrasos de outros meses foram quitados ali."
              : "Compara, mês a mês, o que era para entrar com o que de fato entrou. Coluna verde menor que a ocre = mês com pendência; verde maior = atrasos de outros meses foram quitados ali. A coluna com halo é o mês em tela."
          }
          direita={
            <Legenda
              itens={[
                { cor: COR_2, nome: "Devido" },
                { cor: COR_1, nome: "Recebido" },
              ]}
            />
          }
        />
        <BarrasDuplas
          serieA={vm.porMes.map((l) => l.devido)}
          serieB={vm.porMes.map((l) => l.recebido)}
          nomeA="Devido"
          nomeB="Recebido"
          corA={COR_2}
          corB={COR_1}
          mesSelecionado={vm.destaqueSerie}
          rotulos={vm.rotulosSerie}
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
                  <Ajuda
                    dica={
                      periodo
                        ? "'Pré-lançado' = mês com devidos gerados de antemão e nenhum recebimento registrado ainda. No modo período essas pendências contam nos totais, porque a janela foi escolhida por você."
                        : "'Pré-lançado' = mês com devidos gerados de antemão e nenhum recebimento registrado ainda; essas pendências não entram no acumulado do ano."
                    }
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {linhasHistorico.map((l) => (
                <tr key={l.mes} className={l.atual ? "font-semibold" : ""}>
                  <td>{l.rotulo}</td>
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
                        <Selo nivel="otimo">tudo recebido</Selo>
                      ) : (
                        <Selo nivel={nivelInadimplencia(l.pendenteValor, l.devido)}>
                          em cobrança
                        </Selo>
                      )
                    ) : (
                      <Selo nivel="neutro">pré-lançado</Selo>
                    )}
                  </td>
                </tr>
              ))}
              {linhasHistorico.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-tinta-suave">
                    Nenhum lançamento {periodo ? "no período" : `em ${ano}`}.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---------- rodapé ---------- */}
      <Card className="mt-6 px-6 py-4" nivel="info">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-tinta-suave">
          Como ler este painel
          <Ajuda dica="A diferença entre 'pendente' e 'perda' muda a forma de trabalhar a lista: pendente continua sendo dinheiro que pode entrar, e o registro do pagamento reconstrói a comissão sozinho." />
        </div>
        <p className="text-sm leading-relaxed text-tinta">
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
            href={`/recebimentos?${qs}`}
            className="text-oliva-escura hover:underline"
          >
            Registrar recebimentos de {periodo ? periodo.rotulo : formatarCompetencia(mes)} →
          </Link>
          <Link
            href={`/relatorios/inadimplencia?${qs}`}
            className="text-oliva-escura hover:underline"
          >
            Relatório de inadimplência →
          </Link>
        </div>
      </Card>

      {taxaPct !== null && taxaPct >= 100 && vm.pendentesQtde > 0 ? (
        <p className="mt-3 text-xs text-tinta-suave/60">
          A taxa {periodo ? "do período" : "do mês"} já passou de 100% e ainda
          há pendentes: alguém quitou atrasos por aqui enquanto outros seguem
          devendo — a lista acima é quem falta.
        </p>
      ) : null}
    </div>
  );
}
