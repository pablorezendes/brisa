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

  // ---- semáforos -----------------------------------------------------------
  const nvTaxa = nivelTaxaRecebimento(d.taxaRecebimentoMes);
  const nvPendentes = nivelInadimplencia(d.pendentesMesValor, d.devidoMes);
  const graves = d.listaCobranca.filter(
    (p) => p.diasDesdeVencimento !== null && p.diasDesdeVencimento > 30
  );
  const valorGrave = graves.reduce((s, p) => s + p.totalDevido, 0);
  const nvAno: Nivel = d.pendentesAnoValor > 0 ? "atencao" : "otimo";

  const alertas: ItemAlerta[] = [];
  if (graves.length > 0) {
    alertas.push({
      nivel: "critico",
      titulo: "Cobranças acima de 30 dias",
      texto: `${graves.length} ${graves.length === 1 ? "cobrança venceu" : "cobranças venceram"} há mais de 30 dias, somando ${formatarBRL(valorGrave)}. São as primeiras ligações do dia.`,
      acao: { rotulo: "Registrar", href: `/recebimentos?mes=${mes}` },
    });
  }
  if (d.maiorDevedor && d.maiorDevedor.quantidade > 1) {
    alertas.push({
      nivel: "atencao",
      titulo: "Atraso recorrente",
      texto: `${d.maiorDevedor.locatario} acumula ${d.maiorDevedor.quantidade} cobranças em aberto no ano (${formatarBRL(d.maiorDevedor.valor)}). Vale propor um acordo e anotá-lo na Observação do lançamento.`,
    });
  }
  if (nvTaxa !== "otimo" && d.taxaRecebimentoMes !== null) {
    alertas.push({
      nivel: nvTaxa,
      titulo: "Taxa de recebimento abaixo de 95%",
      texto: `Entrou ${pct(d.taxaRecebimentoMes)} do devido de ${nomeMes} — ${formatarBRL(d.recebidoMes)} de ${formatarBRL(d.devidoMes)}.`,
    });
  }
  const semDiaVencimento = d.listaCobranca.filter(
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
        descricao={`Quem cobrar e o que registrar — ${NOME_MES_COMPLETO[mesNum]} de ${d.ano}`}
        acoes={<SeletorMes base="/paineis/cobranca" mes={mes} />}
      />

      <PainelAlertas
        itens={alertas}
        ajuda="A fila de cobrança do dia, da mais urgente para a menos. Vermelho passou de 30 dias, âmbar venceu há pouco, azul é só um aviso de cadastro."
        vazio={`Nada a cobrar em ${nomeMes} — todas as cobranças do mês foram recebidas.`}
      />

      {/* ---------- KPIs ---------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Pendentes do mês"
          valor={<Dinheiro centavos={d.pendentesMesValor} destaque />}
          detalhe={`${d.pendentesMesQtde} cobrança(s) sem pagamento em ${nomeMes}`}
          nivel={nvPendentes}
          nota={
            graves.length > 0
              ? `${graves.length} ${graves.length === 1 ? "delas passou" : "delas passaram"} de 30 dias — comece por aí.`
              : undefined
          }
          ajuda="Cobranças lançadas neste mês que ainda estão sem valor em Recebido. Quando o locatário pagar, vá em Recebimentos e preencha Recebido, Data e Via — a linha sai desta lista sozinha."
        />
        <Kpi
          rotulo="Taxa de recebimento"
          valor={pct(d.taxaRecebimentoMes)}
          detalhe={`entrou ${formatarBRL(d.recebidoMes)} de ${formatarBRL(d.devidoMes)} devidos`}
          nivel={nvTaxa}
          grafico={
            d.devidoMes > 0 ? (
              <BarraComposicao
                partes={[
                  { rotulo: "recebido", valor: d.recebidoMes, cor: COR_1 },
                  {
                    rotulo: "a receber",
                    valor: Math.max(d.devidoMes - d.recebidoMes, 0),
                    cor: COR_2,
                  },
                ]}
              />
            ) : undefined
          }
          ajuda="Quanto do total devido do mês já entrou. Pode passar de 100% quando alguém quita atrasos de meses anteriores — nesse caso lance o valor cheio em Recebido e anote o motivo na Observação; a competência continua sendo a do mês devido."
        />
        <Kpi
          rotulo="Pendentes acumulados no ano"
          valor={<Dinheiro centavos={d.pendentesAnoValor} destaque />}
          detalhe={`${d.pendentesAnoQtde} cobrança(s) em ${d.mesesOperacionaisConsiderados} mês(es) com operação`}
          nivel={nvAno}
          selo={d.pendentesAnoValor > 0 ? "a recuperar" : "nada em aberto"}
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
          nivel={
            d.maiorDevedor
              ? d.maiorDevedor.quantidade > 1
                ? "critico"
                : "atencao"
              : "otimo"
          }
          selo={
            d.maiorDevedor && d.maiorDevedor.quantidade > 1
              ? "recorrente"
              : undefined
          }
          nota={
            d.maiorDevedor && d.maiorDevedor.quantidade > 1
              ? "Mesmo nome em vários meses: proponha um acordo e registre na Observação."
              : undefined
          }
          ajuda="Locatário que mais soma pendências no ano até o mês selecionado — a primeira ligação a fazer. Se combinar um parcelamento, registre cada pagamento em Recebido e anote o acordo na Observação do lançamento."
        />
      </div>

      {/* ---------- LISTA DE COBRANÇA DE HOJE ---------- */}
      <Card
        className="mt-4 p-5"
        nivel={d.listaCobranca.length > 0 ? nvPendentes : undefined}
      >
        <TituloCard
          titulo="Lista de cobrança de hoje"
          nivel={d.listaCobranca.length > 0 ? nvPendentes : "otimo"}
          ajuda="Ordene o dia por esta lista: os maiores valores primeiro. Quando alguém pagar, vá em Recebimentos, encontre a linha e preencha Recebido, Data e Via de pagamento — a cobrança some daqui na hora."
          direita={
            <>
              <span className="font-mono text-[12px] text-tinta-suave">
                {d.pendentesMesQtde} ·{" "}
                <strong className="text-tinta">
                  {formatarBRL(d.pendentesMesValor)}
                </strong>
              </span>
              <LinkCard href={`/recebimentos?mes=${mes}`}>Registrar</LinkCard>
            </>
          }
        />
        {d.listaCobranca.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-tinta-suave">
            <Selo nivel="otimo">tudo recebido</Selo>
            Todas as cobranças de {formatarCompetencia(mes)} foram recebidas.
            Nada a cobrar hoje.
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
                  <td colSpan={4}>
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
          <TituloCard
            titulo="Aging — há quanto tempo venceu"
            ajuda="Divide o valor pendente do mês por tempo de atraso, contando a partir do dia de vencimento do contrato. Cada faixa é pintada com a cor do semáforo: azul ainda não venceu, âmbar até 30 dias, vermelho acima disso. Quanto mais desce a lista, mais urgente é cobrar."
          />
          {!agingComPendencia ? (
            <div className="flex items-center gap-2 text-sm text-tinta-suave">
              <Selo nivel="otimo">nada vencido</Selo>
              Sem valor pendente em {formatarCompetencia(mes)}.
            </div>
          ) : (
            <>
              <BarrasHorizontais
                itens={d.aging.map((f, i) => ({
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
                      {d.aging.map((f, i) => (
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
            titulo="Top devedores do ano"
            ajuda="Locatários que mais somam pendências nos meses com operação, de janeiro até o mês selecionado. Vermelho marca quem deve em mais de um mês — atraso recorrente pede acordo, e o acordo pede uma anotação na Observação do lançamento."
          />
          {d.topDevedores.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-tinta-suave">
              <Selo nivel="otimo">ninguém devendo</Selo>
              Nenhuma pendência acumulada no ano.
            </div>
          ) : (
            <>
              <BarrasHorizontais
                itens={d.topDevedores.map((t) => ({
                  rotulo: t.locatario,
                  valor: t.valor,
                  nivel: t.quantidade > 1 ? ("critico" as Nivel) : ("atencao" as Nivel),
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
        <TituloCard
          titulo="Histórico do ano — devido × recebido"
          ajuda="Compara, mês a mês, o que era para entrar com o que de fato entrou. Coluna verde menor que a ocre = mês com pendência; verde maior = atrasos de outros meses foram quitados ali. A coluna com halo é o mês em tela."
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
          serieA={d.porMes.map((l) => l.devido)}
          serieB={d.porMes.map((l) => l.recebido)}
          nomeA="Devido"
          nomeB="Recebido"
          corA={COR_2}
          corB={COR_1}
          mesSelecionado={mesNum}
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
