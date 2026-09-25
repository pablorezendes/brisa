import Link from "next/link";
import {
  Ajuda,
  Badge,
  Card,
  Dinheiro,
  PageHeader,
  SeletorPeriodo,
} from "@/components/ui";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { parseCompetencia } from "@/lib/dominio/normalizacao";
import { parsePeriodo } from "@/lib/dominio/periodo";
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

  // Totais de recebimento e ocupação na janela selecionada.
  const vm = periodo
    ? await (async () => {
        const painel = await painelEmpreendimentosDoPeriodo(periodo.meses);
        return {
          janela: periodo.rotulo,
          naJanela: "no período",
          cartoes: painel.cartoes,
          totalRecebido: painel.totalRecebido,
          queryDetalhe: `de=${periodo.de}&ate=${periodo.ate}`,
        };
      })()
    : await (async () => {
        const painel = await painelEmpreendimentos(ano);
        return {
          janela: String(ano),
          naJanela: `em ${ano}`,
          cartoes: painel.cartoes,
          totalRecebido: painel.totalRecebido,
          queryDetalhe: `ano=${ano}`,
        };
      })();

  return (
    <div className="max-w-6xl">
      <PageHeader
        titulo="Painel por empreendimento"
        descricao={
          periodo
            ? `Recebimentos, pagamentos e ocupação de cada empreendimento no período ${periodo.rotulo}. Clique em um cartão para ver unidades e locatários.`
            : `Recebimentos, pagamentos e ocupação de cada empreendimento em ${ano}. Clique em um cartão para ver unidades e locatários.`
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
            juntos registraram{" "}
            <strong className="text-tinta">
              {formatarBRL(vm.totalRecebido)}
            </strong>{" "}
            em pagamentos.
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

                <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-tinta-suave">
                      {periodo ? "Recebido no período" : "Recebido no ano"}
                      <Ajuda
                        dica={`Tudo o que os locatários pagaram nos lançamentos ${periodo ? "do período" : "deste ano"} (aluguel + repasses). Só conta quando o campo Recebido do lançamento é preenchido.`}
                      />
                    </dt>
                    <dd className="numero-card mt-0.5 font-mono text-sm tabular-nums">
                      <Dinheiro centavos={c.recebidoJanela} />
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-tinta-suave">
                      Ticket médio
                      <Ajuda dica={`Recebido ${periodo ? "no período" : "no ano"} ÷ ${c.lancamentosPagos || "nº de"} lançamento(s) pago(s): o "aluguel médio" que entra por cobrança. Ajuda a comparar prédios de tamanhos diferentes.`} />
                    </dt>
                    <dd className="numero-card mt-0.5 font-mono text-sm tabular-nums">
                      <Dinheiro centavos={c.ticketMedio} />
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-tinta-suave">
                      Ocupação
                      <Ajuda dica="Unidades ativas com locatário no contrato vigente. Unidade desocupada merece atenção comercial." />
                    </dt>
                    <dd className="numero-card mt-0.5 font-mono text-sm tabular-nums">
                      {c.ocupacao.ocupadas}/{c.ocupacao.ativas}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 flex items-end justify-between gap-3 border-t border-contorno pt-3">
                  <p className="text-xs text-tinta-suave">{c.lancamentosPagos} pagamento(s) registrado(s)</p>
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
              Ver resumo de todos os empreendimentos
            </summary>
            <Card className="mt-2 p-4">
              <div className="overflow-x-auto">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Empreendimento</th>
                      <th className="text-right">Recebido</th>
                      <th className="text-right">Pagamentos</th>
                      <th className="text-right">Ocupação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vm.cartoes.map((c) => (
                      <tr key={c.id}>
                        <td className="font-medium">{c.nome}</td>
                        <td className="text-right">
                          <Dinheiro centavos={c.recebidoJanela} destaque />
                        </td>
                        <td className="text-right">{c.lancamentosPagos}</td>
                        <td className="text-right">{c.ocupacao.ocupadas}/{c.ocupacao.ativas}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="text-right">
                        <Dinheiro centavos={vm.totalRecebido} destaque />
                      </td>
                      <td className="text-right">{vm.cartoes.reduce((a, c) => a + c.lancamentosPagos, 0)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          </details>
        </>
      )}

      <p className="mt-6 text-xs text-tinta-suave/60">
        Ocupação conta as unidades ativas e o locatário do contrato vigente. Fonte:
        recebimentos lançados no sistema.
      </p>
    </div>
  );
}
