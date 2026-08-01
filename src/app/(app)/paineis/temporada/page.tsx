/**
 * /paineis/temporada — visão anual do Airbnb, ou recorte por período
 * (?de=YYYY-MM-DD&ate=YYYY-MM-DD, que vence a visão anual quando presente).
 * Compara a receita mês a mês de todos os anos: 2023–2025 vêm da apuração
 * histórica importada da planilha; o ano corrente vem das linhas agregadas
 * do núcleo (recebimento.origemAgregada) até o módulo Temporada assumir.
 * No modo período, cada competência da janela usa a melhor fonte disponível
 * (planilha ou núcleo) e a origem fica visível na tabela e no "i".
 */
import Link from "next/link";
import {
  Ajuda,
  Badge,
  Card,
  Dinheiro,
  Kpi,
  PageHeader,
  SeletorPeriodo,
  btnPrimario,
  btnSecundario,
} from "@/components/ui";
import { BarrasMensais } from "@/components/graficos";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import {
  NOME_MES_ABREV,
  NOME_MES_COMPLETO,
  formatarCompetencia,
} from "@/lib/dominio/normalizacao";
import {
  parsePeriodo,
  rotulosCompetencias,
  type Periodo,
} from "@/lib/dominio/periodo";
import {
  painelTemporada,
  painelTemporadaPeriodo,
  type AnoTemporada,
  type OrigemAnoTemporada,
  type PainelTemporadaPeriodo,
} from "@/lib/consultas/painel-caixa-temporada";

export const dynamic = "force-dynamic";

/** Explicação da origem dos números de cada ano, em linguagem de família. */
function dicaOrigem(a: AnoTemporada): string {
  if (a.origem === "nucleo") {
    return `A receita de ${a.ano} vem das linhas agregadas do AIRBNB lançadas em Recebimentos (o núcleo) — soma do que já foi marcado como recebido. A despesa ainda não é conhecida aqui: ela será apurada no módulo Temporada (limpezas + energia/condomínio/IPTU), por isso o lucro aparece como "—".`;
  }
  if (a.totalDespesa === null) {
    return `Números importados da planilha AIRBNB de ${a.ano}. Essa planilha só trouxe a receita — a despesa não foi rotulada, então o lucro fica como "—" (desconhecido, não zero).`;
  }
  return `Números importados da planilha AIRBNB de ${a.ano}: receita e despesa mês a mês, ano já fechado.`;
}

/** Origem dos números no modo período — vira o "i" da receita e do gráfico. */
function dicaOrigemJanela(d: PainelTemporadaPeriodo): string {
  const plural = (n: number) => (n === 1 ? "mês" : "meses");
  const partes: string[] = [];
  if (d.mesesHistorico > 0) {
    partes.push(
      `${d.mesesHistorico} ${plural(d.mesesHistorico)} da planilha AIRBNB importada (anos fechados)`,
    );
  }
  if (d.mesesNucleo > 0) {
    partes.push(
      `${d.mesesNucleo} ${plural(d.mesesNucleo)} das linhas agregadas lançadas em Recebimentos, o núcleo — só o que já foi marcado como recebido`,
    );
  }
  const base =
    partes.length > 0
      ? `Cada mês da janela usa a melhor fonte disponível: ${partes.join(" e ")}.`
      : "Nenhuma fonte tem lançamentos para os meses da janela — tudo aparece zerado.";
  const semDado =
    d.mesesSemDado > 0
      ? ` ${d.mesesSemDado} ${plural(d.mesesSemDado)} sem lançamento em nenhuma fonte ${d.mesesSemDado === 1 ? "entra" : "entram"} como zero.`
      : "";
  return `${base}${semDado} Quando as duas fontes têm o mesmo mês, vale a planilha (ano fechado). A coluna Origem da tabela mostra a fonte de cada mês.`;
}

/** Badge da fonte de cada mês no modo período. */
function BadgeOrigem({ origem }: { origem: OrigemAnoTemporada | null }) {
  if (origem === "historico") return <Badge cor="azul">planilha</Badge>;
  if (origem === "nucleo") return <Badge cor="ambar">núcleo</Badge>;
  return <Badge cor="slate">sem dado</Badge>;
}

/** Variação percentual da receita vs ano anterior (▲ verde / ▼ vermelho). */
function VariacaoAnual({
  atual,
  anterior,
}: {
  atual: number;
  anterior: number | null;
}) {
  if (anterior === null || anterior === 0) {
    return <span className="text-xs text-tinta-suave/60">sem base</span>;
  }
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100;
  if (Math.abs(pct) < 0.05) {
    return <span className="text-xs text-tinta-suave/60">estável</span>;
  }
  const subiu = pct > 0;
  return (
    <span
      className={`font-mono text-[11px] font-bold ${
        subiu ? "text-oliva-escura" : "text-erro"
      }`}
    >
      {subiu ? "▲" : "▼"} {Math.abs(pct).toFixed(1).replace(".", ",")}% vs ano
      anterior
    </span>
  );
}

/** Modo PERÍODO: a janela escolhida no calendário, mês a mês. */
async function TemporadaDoPeriodo({ periodo }: { periodo: Periodo }) {
  const d = await painelTemporadaPeriodo(periodo.meses);
  const rotulos = rotulosCompetencias(periodo.meses);
  const dicaJanela = dicaOrigemJanela(d);
  const fontes =
    [
      d.mesesHistorico > 0 ? `${d.mesesHistorico} da planilha` : null,
      d.mesesNucleo > 0 ? `${d.mesesNucleo} do núcleo` : null,
      d.mesesSemDado > 0 ? `${d.mesesSemDado} sem dado` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "sem lançamentos na janela";

  return (
    <div className="max-w-6xl">
      <PageHeader
        titulo="Temporada — análise do período"
        descricao={`O Airbnb no período ${periodo.rotulo}: receita mês a mês combinando a planilha histórica e o núcleo`}
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/temporada/historico" className={btnSecundario}>
              Histórico da planilha
            </Link>
            <Link href="/temporada" className={btnSecundario}>
              Módulo Temporada
            </Link>
            <SeletorPeriodo base="/paineis/temporada" periodo={periodo} />
          </div>
        }
      />

      {/* ---------- KPIs do período ---------- */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi
          rotulo="Receita no período"
          valor={<Dinheiro centavos={d.totalReceita} destaque />}
          detalhe={fontes}
          ajuda={dicaJanela}
        />
        <Kpi
          rotulo="Comissão AIRBNB no período"
          valor={<Dinheiro centavos={d.comissaoAirbnb} destaque />}
          detalhe="só meses lançados no núcleo"
          ajuda="O que a administradora ganhou com o Airbnb na janela: a taxa do lançamento (padrão 10%) sobre o recebido, descontando IPTU e condomínio — a mesma regra canônica dos aluguéis. Vale só para os meses lançados em Recebimentos (o núcleo): a planilha histórica não tem recebimentos individuais para aplicar a regra, então meses antigos entram como zero aqui."
        />
        <Kpi
          rotulo="Melhor mês do período"
          valor={
            d.melhorMes ? (
              <Dinheiro centavos={d.melhorMes.receita} destaque />
            ) : (
              "—"
            )
          }
          detalhe={
            d.melhorMes ? formatarCompetencia(d.melhorMes.mes) : "sem receita"
          }
          ajuda="O mês de maior receita dentro da janela escolhida. Bom para enxergar o pico da temporada no recorte e planejar reservas e limpezas nos meses fortes."
        />
        <Kpi
          rotulo="Lucro no período"
          valor={
            d.totalLucro !== null ? (
              <Dinheiro centavos={d.totalLucro} destaque />
            ) : (
              "—"
            )
          }
          detalhe={
            d.mesesComDespesa > 0
              ? `${d.mesesComDespesa} de ${periodo.meses.length} ${periodo.meses.length === 1 ? "mês" : "meses"} com despesa conhecida`
              : "sem despesa conhecida na janela"
          }
          nivel={
            d.totalLucro === null
              ? "neutro"
              : d.totalLucro > 0
                ? "otimo"
                : d.totalLucro < 0
                  ? "critico"
                  : "neutro"
          }
          selo={
            d.totalLucro !== null && d.totalLucro !== 0
              ? d.totalLucro > 0
                ? "no azul"
                : "no vermelho"
              : undefined
          }
          ajuda='Lucro = receita − despesa, somando SÓ os meses da janela em que a despesa é conhecida (planilha com despesa rotulada). Meses do núcleo e da planilha de 2025 não têm despesa aqui, por isso ficam de fora da conta — melhor admitir que não se sabe do que inventar número. Para o lucro real do ano corrente, lance limpezas e contas no módulo Temporada.'
        />
      </div>

      {/* ---------- chamada para ação (formulários continuam mensais) ---------- */}
      {d.mesesNucleo > 0 ? (
        <Card className="mt-6 border-l-4 border-l-ambar px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm leading-relaxed text-tinta">
              <strong>Para ver o lucro real dos meses do núcleo</strong>, lance
              as limpezas e as despesas (energia, condomínio, IPTU) no módulo
              Temporada, mês a mês. A receita já entra pelo núcleo; sem as
              despesas, o lucro fica como &quot;—&quot;.
            </p>
            <Link href="/temporada" className={btnPrimario}>
              Lançar no módulo Temporada
            </Link>
          </div>
        </Card>
      ) : null}

      {/* ---------- receita mês a mês da janela ---------- */}
      <Card className="mt-6 p-5">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            Receita mês a mês — {periodo.rotulo}
            <Ajuda dica={dicaJanela} />
          </h2>
          <span className="text-xs text-tinta-suave">
            receita do período:{" "}
            <strong className="font-serif text-sm text-tinta">
              {formatarBRL(d.totalReceita)}
            </strong>
          </span>
        </div>
        <BarrasMensais
          valores={d.linhas.map((l) => l.receita)}
          rotulos={rotulos}
          rotuloAcessivel={`Receita da temporada mês a mês — ${periodo.rotulo}`}
        />
        <p className="mt-2 text-xs text-tinta-suave">
          O eixo mostra exatamente os meses cobertos pelas datas escolhidas no
          calendário — escolher 15/03 a 10/05 analisa MAR, ABR e MAI inteiros.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                <th>Mês</th>
                <th>
                  <span className="inline-flex items-center gap-1.5">
                    Origem
                    <Ajuda dica='De onde veio o número do mês: "planilha" é a apuração histórica importada (ano fechado); "núcleo" são as linhas agregadas do AIRBNB em Recebimentos; "sem dado" é mês sem lançamento em nenhuma fonte — entra como zero, não como prejuízo.' />
                  </span>
                </th>
                <th className="text-right!">Receita</th>
                <th className="text-right!">
                  <span className="inline-flex items-center gap-1.5">
                    Despesa
                    <Ajuda dica='"—" significa despesa desconhecida, não zero: meses do núcleo (apuração no módulo Temporada) e a planilha de 2025 não trazem despesa rotulada.' />
                  </span>
                </th>
                <th className="text-right!">
                  <span className="inline-flex items-center gap-1.5">
                    Lucro
                    <Ajuda dica='Lucro = receita − despesa. Quando a despesa é desconhecida, o lucro também fica "—" — melhor admitir que não se sabe do que inventar número.' />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {d.linhas.map((l, i) => (
                <tr
                  key={l.mes}
                  className={l.origem === null ? "text-tinta-suave/60" : ""}
                >
                  <td className="font-medium">{rotulos[i]}</td>
                  <td>
                    <BadgeOrigem origem={l.origem} />
                  </td>
                  <td className="text-right!">
                    <Dinheiro centavos={l.origem !== null ? l.receita : null} />
                  </td>
                  <td className="text-right!">
                    <Dinheiro centavos={l.despesa} />
                  </td>
                  <td className="text-right!">
                    <Dinheiro centavos={l.lucro} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total do período</td>
                <td className="text-right!">
                  <Dinheiro centavos={d.totalReceita} destaque />
                </td>
                <td className="text-right!">
                  <Dinheiro centavos={d.totalDespesa} destaque={d.totalDespesa !== null} />
                </td>
                <td className="text-right!">
                  <Dinheiro centavos={d.totalLucro} destaque={d.totalLucro !== null} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {d.mesesComDespesa > 0 && d.mesesComDespesa < periodo.meses.length ? (
          <p className="mt-2 text-xs text-tinta-suave">
            Atenção: a despesa e o lucro do total somam só{" "}
            {d.mesesComDespesa === 1
              ? "o único mês com despesa conhecida"
              : `os ${d.mesesComDespesa} meses com despesa conhecida`}{" "}
            — a receita soma a janela inteira, então não compare lucro com
            receita diretamente.
          </p>
        ) : null}
      </Card>

      <p className="mt-6 text-xs text-tinta-suave/60">
        Fontes: apuração histórica importada da planilha AIRBNB (anos fechados)
        e linhas agregadas do núcleo para o ano corrente — no período, cada mês
        usa a melhor fonte disponível. Os lançamentos continuam mensais: use o
        módulo Temporada para lançar e o calendário só para analisar.
      </p>
    </div>
  );
}

export default async function PaginaPainelTemporada({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const sp = await searchParams;
  const periodo = parsePeriodo(sp.de, sp.ate);
  if (periodo) return <TemporadaDoPeriodo periodo={periodo} />;

  const d = await painelTemporada();
  const anosDesc = [...d.anos].sort((a, b) => b.ano - a.ano);
  const rotuloAnos =
    d.lucroMedio && d.lucroMedio.anos.length > 0
      ? d.lucroMedio.anos.join("–")
      : "—";

  return (
    <div className="max-w-6xl">
      <PageHeader
        titulo="Temporada — visão anual"
        descricao="O Airbnb ano a ano: quanto rendeu, quando rendeu e o que ainda falta lançar"
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/temporada/historico" className={btnSecundario}>
              Histórico da planilha
            </Link>
            <Link href="/temporada" className={btnSecundario}>
              Módulo Temporada
            </Link>
            <SeletorPeriodo base="/paineis/temporada" periodo={null} />
          </div>
        }
      />

      {/* ---------- KPIs ---------- */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi
          rotulo={
            d.anoNucleo !== null
              ? `Receita ${d.anoNucleo} até agora`
              : "Receita do ano"
          }
          valor={<Dinheiro centavos={d.receitaAnoNucleo} destaque />}
          detalhe="linhas agregadas do núcleo"
          ajuda="Soma do que o Airbnb já repassou no ano, pelas linhas agregadas lançadas em Recebimentos. Só conta o que está marcado como recebido — mês ainda pendente não entra. Ao receber o repasse do mês, lance na linha agregada AIRBNB do núcleo."
        />
        <Kpi
          rotulo="Comissão AIRBNB no ano"
          valor={<Dinheiro centavos={d.comissaoAirbnbAnoNucleo} destaque />}
          detalhe={d.anoNucleo !== null ? `ano ${d.anoNucleo}` : undefined}
          ajuda="O que a administradora ganhou com o Airbnb no ano: a taxa do lançamento (padrão 10%) sobre o recebido, descontando IPTU e condomínio — a mesma regra canônica dos aluguéis. Repasses nunca entram na comissão."
        />
        <Kpi
          rotulo="Melhor mês histórico"
          valor={
            d.melhorMes ? <Dinheiro centavos={d.melhorMes.receita} destaque /> : "—"
          }
          detalhe={
            d.melhorMes
              ? `${NOME_MES_COMPLETO[d.melhorMes.mes]} de ${d.melhorMes.ano}`
              : "sem dados"
          }
          ajuda="O mês de maior receita já registrado, olhando todos os anos do comparativo (planilha 2023–2025 + ano atual no núcleo). Bom para saber o teto da temporada e planejar reservas e limpezas nos meses fortes."
        />
        <Kpi
          rotulo={`Lucro médio mensal ${rotuloAnos}`}
          valor={
            d.lucroMedio ? (
              <Dinheiro centavos={d.lucroMedio.valorMensal} destaque />
            ) : (
              "—"
            )
          }
          detalhe={
            d.lucroMedio ? `média de ${d.lucroMedio.meses} meses` : "sem despesa conhecida"
          }
          nivel={
            !d.lucroMedio
              ? "neutro"
              : d.lucroMedio.valorMensal > 0
                ? "otimo"
                : "critico"
          }
          selo={
            d.lucroMedio
              ? d.lucroMedio.valorMensal > 0
                ? "no azul"
                : "no vermelho"
              : undefined
          }
          ajuda="Média do lucro (receita − despesa) por mês nos anos em que a despesa é conhecida (2023 e 2024). 2025 fica de fora porque a planilha daquele ano não rotulou as despesas — receita sem despesa não dá lucro confiável."
        />
      </div>

      {/* ---------- chamada para ação ---------- */}
      <Card className="mt-6 border-l-4 border-l-ambar px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm leading-relaxed text-tinta">
            <strong>Para ver o lucro real de {d.anoNucleo ?? "do ano"}</strong>,
            lance as limpezas e as despesas (energia, condomínio, IPTU) no
            módulo Temporada, mês a mês. A receita já entra pelo núcleo; sem as
            despesas, o lucro fica como &quot;—&quot;.
          </p>
          <Link href="/temporada" className={btnPrimario}>
            Lançar no módulo Temporada
          </Link>
        </div>
      </Card>

      {/* ---------- comparativo anual (pequenos múltiplos) ---------- */}
      <div className="mt-6 space-y-4">
        {d.anos.length === 0 ? (
          <Card className="px-6 py-8">
            <p className="text-sm text-tinta-suave">
              Sem apuração histórica importada nem linhas agregadas do Airbnb no
              núcleo.
            </p>
          </Card>
        ) : (
          d.anos.map((a) => (
            <Card key={a.ano} className="p-5">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  Receita mês a mês — {a.ano}
                  <Ajuda dica={dicaOrigem(a)} />
                </h2>
                <div className="flex items-baseline gap-4 text-xs text-tinta-suave">
                  <span>
                    receita do ano:{" "}
                    <strong className="font-serif text-sm text-tinta">
                      {formatarBRL(a.totalReceita)}
                    </strong>
                  </span>
                  <span>
                    lucro:{" "}
                    <strong className="font-serif text-sm text-tinta">
                      {a.totalLucro !== null ? formatarBRL(a.totalLucro) : "—"}
                    </strong>
                  </span>
                </div>
              </div>
              <BarrasMensais valores={a.receitaPorMes} mesSelecionado={0} />
              <details className="mt-2 text-xs text-tinta-suave">
                <summary className="cursor-pointer select-none">Ver dados</summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="tabela">
                    <thead>
                      <tr>
                        <th>Mês</th>
                        <th className="text-right!">Receita</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.receitaPorMes.map((v, i) =>
                        v > 0 ? (
                          <tr key={i}>
                            <td>{NOME_MES_ABREV[i + 1]}</td>
                            <td className="text-right!">
                              <Dinheiro centavos={v} />
                            </td>
                          </tr>
                        ) : null,
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>Total {a.ano}</td>
                        <td className="text-right!">
                          <Dinheiro centavos={a.totalReceita} destaque />
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </details>
            </Card>
          ))
        )}
      </div>

      {/* ---------- tabela anual ---------- */}
      <Card className="mt-4 p-5">
        <h2 className="mb-2 text-sm font-semibold">Resumo ano a ano</h2>
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                <th>Ano</th>
                <th className="text-right!">Receita</th>
                <th className="text-right!">
                  <span className="inline-flex items-center gap-1.5">
                    Despesa
                    <Ajuda dica='"—" significa despesa desconhecida, não zero: a planilha de 2025 não rotulou despesas, e a do ano corrente é apurada no módulo Temporada.' />
                  </span>
                </th>
                <th className="text-right!">
                  <span className="inline-flex items-center gap-1.5">
                    Lucro
                    <Ajuda dica='Lucro = receita − despesa. Quando a despesa é desconhecida, o lucro também fica "—" — melhor admitir que não se sabe do que inventar número.' />
                  </span>
                </th>
                <th>Receita vs ano anterior</th>
              </tr>
            </thead>
            <tbody>
              {anosDesc.map((a) => {
                const anterior =
                  d.anos.find((x) => x.ano === a.ano - 1)?.totalReceita ?? null;
                return (
                  <tr key={a.ano}>
                    <td className="font-medium">{a.ano}</td>
                    <td className="text-right!">
                      <Dinheiro centavos={a.totalReceita} destaque />
                    </td>
                    <td className="text-right!">
                      <Dinheiro centavos={a.totalDespesa} />
                    </td>
                    <td className="text-right!">
                      <Dinheiro centavos={a.totalLucro} />
                    </td>
                    <td>
                      <VariacaoAnual atual={a.totalReceita} anterior={anterior} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {d.anoNucleo !== null ? (
          <p className="mt-2 text-xs text-tinta-suave">
            Atenção ao comparar {d.anoNucleo} com anos fechados: o ano corrente
            ainda está em andamento — a receita só cobre os meses já recebidos.
          </p>
        ) : null}
      </Card>

      <p className="mt-6 text-xs text-tinta-suave/60">
        Fontes: apuração histórica importada da planilha AIRBNB (2023–2025) e
        linhas agregadas do núcleo para o ano corrente. A receita do módulo
        Temporada deve conciliar mês a mês com a linha agregada do núcleo.
      </p>
    </div>
  );
}
