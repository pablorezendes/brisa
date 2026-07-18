/**
 * /paineis/temporada — visão anual do Airbnb.
 * Compara a receita mês a mês de todos os anos: 2023–2025 vêm da apuração
 * histórica importada da planilha; o ano corrente vem das linhas agregadas
 * do núcleo (recebimento.origemAgregada) até o módulo Temporada assumir.
 */
import Link from "next/link";
import {
  Ajuda,
  Card,
  Dinheiro,
  Kpi,
  PageHeader,
  btnPrimario,
  btnSecundario,
} from "@/components/ui";
import { BarrasMensais } from "@/components/graficos";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { NOME_MES_ABREV, NOME_MES_COMPLETO } from "@/lib/dominio/normalizacao";
import {
  painelTemporada,
  type AnoTemporada,
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

/** Variação percentual da receita vs ano anterior (▲ verde / ▼ vermelho). */
function VariacaoAnual({
  atual,
  anterior,
}: {
  atual: number;
  anterior: number | null;
}) {
  if (anterior === null || anterior === 0) {
    return <span className="text-xs text-slate-400">sem base</span>;
  }
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100;
  if (Math.abs(pct) < 0.05) {
    return <span className="text-xs text-slate-400">estável</span>;
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

export default async function PaginaPainelTemporada() {
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
          <div className="flex items-center gap-2">
            <Link href="/temporada/historico" className={btnSecundario}>
              Histórico da planilha
            </Link>
            <Link href="/temporada" className={btnSecundario}>
              Módulo Temporada
            </Link>
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
          ajuda="Média do lucro (receita − despesa) por mês nos anos em que a despesa é conhecida (2023 e 2024). 2025 fica de fora porque a planilha daquele ano não rotulou as despesas — receita sem despesa não dá lucro confiável."
        />
      </div>

      {/* ---------- chamada para ação ---------- */}
      <Card className="mt-6 border-l-4 border-l-ambar px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm leading-relaxed text-slate-700">
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
            <p className="text-sm text-slate-500">
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
                <div className="flex items-baseline gap-4 text-xs text-slate-600">
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
              <details className="mt-2 text-xs text-slate-600">
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
          <p className="mt-2 text-xs text-slate-500">
            Atenção ao comparar {d.anoNucleo} com anos fechados: o ano corrente
            ainda está em andamento — a receita só cobre os meses já recebidos.
          </p>
        ) : null}
      </Card>

      <p className="mt-6 text-xs text-slate-400">
        Fontes: apuração histórica importada da planilha AIRBNB (2023–2025) e
        linhas agregadas do núcleo para o ano corrente. A receita do módulo
        Temporada deve conciliar mês a mês com a linha agregada do núcleo.
      </p>
    </div>
  );
}
