import Link from "next/link";
import {
  Ajuda,
  Badge,
  Card,
  Dinheiro,
  PageHeader,
  SeletorPeriodo,
} from "@/components/ui";
import { Sparkline } from "@/components/graficos";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import {
  NOME_MES_ABREV,
  parseCompetencia,
} from "@/lib/dominio/normalizacao";
import { parsePeriodo, rotulosCompetencias } from "@/lib/dominio/periodo";
import { mesMaisRecenteComLancamentos } from "@/lib/consultas/relatorios";
import {
  painelEmpreendimentos,
  painelEmpreendimentosDoPeriodo,
} from "@/lib/consultas/painel-empreendimentos";
import { SeletorAno, anoDaQuery } from "@/app/(app)/relatorios/seletor-ano";

export const metadata = { title: "Painel por empreendimento — Brisa" };
export const dynamic = "force-dynamic";

export default async function PaginaPainelEmpreendimentos({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string; de?: string; ate?: string }>;
}) {
  const sp = await searchParams;
  const periodo = parsePeriodo(sp.de, sp.ate);
  const mesRecente = await mesMaisRecenteComLancamentos();
  const ano = anoDaQuery(sp.ano, parseCompetencia(mesRecente).ano);

  // ---- as duas visões desembocam no MESMO view-model -----------------------
  // (modo ano: 12 competências, sparkline até o último mês com dados; modo
  //  período: exatamente as competências escolhidas no calendário)
  const vm = periodo
    ? await (async () => {
        const painel = await painelEmpreendimentosDoPeriodo(periodo.meses);
        const rotulos = rotulosCompetencias(periodo.meses);
        return {
          janela: periodo.rotulo,
          naJanela: "no período",
          cartoes: painel.cartoes,
          totalComissao: painel.totalComissao,
          totalRecebido: painel.totalRecebido,
          rotulosMeses: rotulos,
          faixaSparkline:
            rotulos.length === 1
              ? `Comissão ${rotulos[0]}`
              : `Comissão ${rotulos[0]}–${rotulos[rotulos.length - 1]}`,
          queryDetalhe: `de=${periodo.de}&ate=${periodo.ate}`,
        };
      })()
    : await (async () => {
        const painel = await painelEmpreendimentos(ano);
        return {
          janela: String(ano),
          naJanela: `em ${ano}`,
          cartoes: painel.cartoes,
          totalComissao: painel.totalComissao,
          totalRecebido: painel.totalRecebido,
          rotulosMeses: NOME_MES_ABREV.slice(1, painel.ultimoMesComDados + 1),
          faixaSparkline: `Comissão JAN–${NOME_MES_ABREV[painel.ultimoMesComDados]}`,
          queryDetalhe: `ano=${ano}`,
        };
      })();

  return (
    <div className="max-w-6xl">
      <PageHeader
        titulo="Painel por empreendimento"
        descricao={
          periodo
            ? `Como cada prédio rendeu no período ${periodo.rotulo} — comissão, recebimentos e ocupação. Clique em um cartão para ver unidades e locatários.`
            : `Como cada prédio rendeu em ${ano} — comissão, recebimentos e ocupação. Clique em um cartão para ver unidades e locatários.`
        }
        acoes={
          <>
            {!periodo ? (
              <SeletorAno base="/paineis/empreendimentos" ano={ano} />
            ) : null}
            <SeletorPeriodo base="/paineis/empreendimentos" periodo={periodo} />
          </>
        }
      />

      {vm.cartoes.length === 0 ? (
        <Card className="p-8 text-center text-sm text-tinta-suave">
          {periodo
            ? "Nenhum recebimento lançado no período escolhido. Ajuste as datas no botão Período acima — ou limpe com o × para voltar à visão do ano."
            : `Nenhum recebimento lançado em ${ano}. Use as setas acima para trocar o ano ou lance os recebimentos do mês em Recebimentos.`}
        </Card>
      ) : (
        <>
          <p className="mb-4 text-sm text-tinta-suave">
            {vm.cartoes.length} empreendimento(s) com movimento {vm.naJanela} —
            juntos geraram{" "}
            <strong className="text-tinta">
              {formatarBRL(vm.totalComissao)}
            </strong>{" "}
            de comissão sobre{" "}
            <strong className="text-tinta">
              {formatarBRL(vm.totalRecebido)}
            </strong>{" "}
            recebidos.
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {vm.cartoes.map((c) => (
              <Card key={c.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-serif text-lg font-semibold leading-snug">
                    {c.nome}
                  </h2>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge cor="verde">{c.ocupacao.ativas} unid.</Badge>
                    {c.ocupacao.desocupadas > 0 ? (
                      <Badge cor="ambar">
                        {c.ocupacao.desocupadas} desocupada(s)
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                  <div>
                    <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-tinta-suave">
                      {periodo ? "Comissão no período" : "Comissão no ano"}
                      <Ajuda dica="O que a administradora ganhou aqui: soma de (recebido − IPTU − condomínio) × taxa, lançamento a lançamento. IPTU e condomínio são repasses ao proprietário e nunca entram na conta." />
                    </dt>
                    <dd className="mt-0.5 font-serif text-xl font-semibold tabular-nums">
                      <Dinheiro centavos={c.comissaoJanela} destaque />
                    </dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-tinta-suave">
                      {periodo ? "Recebido no período" : "Recebido no ano"}
                      <Ajuda
                        dica={`Tudo o que os locatários pagaram nos lançamentos ${periodo ? "do período" : "deste ano"} (aluguel + repasses). Só conta quando o campo Recebido do lançamento é preenchido.`}
                      />
                    </dt>
                    <dd className="mt-0.5 font-mono text-sm tabular-nums">
                      <Dinheiro centavos={c.recebidoJanela} />
                    </dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-tinta-suave">
                      Ticket médio
                      <Ajuda dica={`Recebido ${periodo ? "no período" : "no ano"} ÷ ${c.lancamentosPagos || "nº de"} lançamento(s) pago(s): o "aluguel médio" que entra por cobrança. Ajuda a comparar prédios de tamanhos diferentes.`} />
                    </dt>
                    <dd className="mt-0.5 font-mono text-sm tabular-nums">
                      <Dinheiro centavos={c.ticketMedio} />
                    </dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-tinta-suave">
                      Ocupação
                      <Ajuda dica="Unidades ativas com locatário no contrato vigente. Unidade desocupada não gera aluguel nem comissão — merece atenção comercial." />
                    </dt>
                    <dd className="mt-0.5 font-mono text-sm tabular-nums">
                      {c.ocupacao.ocupadas}/{c.ocupacao.ativas}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 flex items-end justify-between gap-3 border-t border-contorno pt-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-tinta-suave">
                      {vm.faixaSparkline}
                    </div>
                    <Sparkline
                      valores={c.serieComissao}
                      rotulos={vm.rotulosMeses}
                    />
                  </div>
                  <Link
                    href={`/paineis/empreendimentos/${c.id}?${vm.queryDetalhe}`}
                    className="text-xs font-semibold text-oliva-escura hover:underline"
                  >
                    ver detalhe →
                  </Link>
                </div>
              </Card>
            ))}
          </div>

          <details className="mt-6 text-xs text-tinta-suave">
            <summary className="cursor-pointer select-none">
              Ver dados de todos os empreendimentos (números das linhas de
              evolução)
            </summary>
            <Card className="mt-2 p-4">
              <div className="overflow-x-auto">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Empreendimento</th>
                      {vm.rotulosMeses.map((m, i) => (
                        <th key={i} className="text-right">
                          {m}
                        </th>
                      ))}
                      <th className="text-right">
                        {periodo ? "Comissão no período" : "Comissão no ano"}
                        <Ajuda dica="Soma das colunas de meses: comissão derivada de cada lançamento pago pela regra recebido − repasses × taxa." />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {vm.cartoes.map((c) => (
                      <tr key={c.id}>
                        <td className="font-medium">{c.nome}</td>
                        {c.serieComissao.map((v, i) => (
                          <td key={i} className="text-right">
                            {v !== 0 ? (
                              <Dinheiro centavos={v} />
                            ) : (
                              <span className="text-tinta-suave/40">—</span>
                            )}
                          </td>
                        ))}
                        <td className="text-right">
                          <Dinheiro centavos={c.comissaoJanela} destaque />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      {vm.rotulosMeses.map((_, i) => (
                        <td key={i} className="text-right">
                          <Dinheiro
                            centavos={vm.cartoes.reduce(
                              (a, c) => a + (c.serieComissao[i] ?? 0),
                              0
                            )}
                          />
                        </td>
                      ))}
                      <td className="text-right">
                        <Dinheiro centavos={vm.totalComissao} destaque />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          </details>
        </>
      )}

      <p className="mt-6 text-xs text-tinta-suave/60">
        Comissão calculada pela regra canônica (base = recebido − IPTU −
        condomínio × taxa do lançamento); repasses nunca entram. Ocupação conta
        as unidades ativas e o locatário do contrato vigente. Fonte:
        recebimentos lançados no sistema.
      </p>
    </div>
  );
}
