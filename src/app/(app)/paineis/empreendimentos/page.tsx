import Link from "next/link";
import { Ajuda, Badge, Card, Dinheiro, PageHeader } from "@/components/ui";
import { Sparkline } from "@/components/graficos";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import {
  NOME_MES_ABREV,
  parseCompetencia,
} from "@/lib/dominio/normalizacao";
import { mesMaisRecenteComLancamentos } from "@/lib/consultas/relatorios";
import { painelEmpreendimentos } from "@/lib/consultas/painel-empreendimentos";
import { SeletorAno, anoDaQuery } from "@/app/(app)/relatorios/seletor-ano";

export const metadata = { title: "Painel por empreendimento — Brisa" };
export const dynamic = "force-dynamic";

export default async function PaginaPainelEmpreendimentos({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string }>;
}) {
  const sp = await searchParams;
  const mesRecente = await mesMaisRecenteComLancamentos();
  const ano = anoDaQuery(sp.ano, parseCompetencia(mesRecente).ano);
  const painel = await painelEmpreendimentos(ano);
  const abrevUltimo = NOME_MES_ABREV[painel.ultimoMesComDados];

  return (
    <div className="max-w-6xl">
      <PageHeader
        titulo="Painel por empreendimento"
        descricao={`Como cada prédio rendeu em ${ano} — comissão, recebimentos e ocupação. Clique em um cartão para ver unidades e locatários.`}
        acoes={<SeletorAno base="/paineis/empreendimentos" ano={ano} />}
      />

      {painel.cartoes.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">
          Nenhum recebimento lançado em {ano}. Use as setas acima para trocar o
          ano ou lance os recebimentos do mês em Recebimentos.
        </Card>
      ) : (
        <>
          <p className="mb-4 text-sm text-tinta-suave">
            {painel.cartoes.length} empreendimento(s) com movimento em {ano} —
            juntos geraram{" "}
            <strong className="text-tinta">
              {formatarBRL(painel.totalComissaoAno)}
            </strong>{" "}
            de comissão sobre{" "}
            <strong className="text-tinta">
              {formatarBRL(painel.totalRecebidoAno)}
            </strong>{" "}
            recebidos.
          </p>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {painel.cartoes.map((c) => (
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
                      Comissão no ano
                      <Ajuda dica="O que a administradora ganhou aqui: soma de (recebido − IPTU − condomínio) × taxa, lançamento a lançamento. IPTU e condomínio são repasses ao proprietário e nunca entram na conta." />
                    </dt>
                    <dd className="mt-0.5 font-serif text-xl font-semibold tabular-nums">
                      <Dinheiro centavos={c.comissaoAno} destaque />
                    </dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-tinta-suave">
                      Recebido no ano
                      <Ajuda dica="Tudo o que os locatários pagaram nos lançamentos deste ano (aluguel + repasses). Só conta quando o campo Recebido do lançamento é preenchido." />
                    </dt>
                    <dd className="mt-0.5 font-mono text-sm tabular-nums">
                      <Dinheiro centavos={c.recebidoAno} />
                    </dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-tinta-suave">
                      Ticket médio
                      <Ajuda dica={`Recebido no ano ÷ ${c.lancamentosPagos || "nº de"} lançamento(s) pago(s): o "aluguel médio" que entra por cobrança. Ajuda a comparar prédios de tamanhos diferentes.`} />
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
                      Comissão JAN–{abrevUltimo}
                    </div>
                    <Sparkline valores={c.serieComissao} />
                  </div>
                  <Link
                    href={`/paineis/empreendimentos/${c.id}?ano=${ano}`}
                    className="text-xs font-semibold text-oliva-escura hover:underline"
                  >
                    ver detalhe →
                  </Link>
                </div>
              </Card>
            ))}
          </div>

          <details className="mt-6 text-xs text-slate-600">
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
                      {NOME_MES_ABREV.slice(1, painel.ultimoMesComDados + 1).map(
                        (m) => (
                          <th key={m} className="text-right">
                            {m}
                          </th>
                        )
                      )}
                      <th className="text-right">
                        Comissão no ano
                        <Ajuda dica="Soma das colunas de meses: comissão derivada de cada lançamento pago pela regra recebido − repasses × taxa." />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {painel.cartoes.map((c) => (
                      <tr key={c.id}>
                        <td className="font-medium">{c.nome}</td>
                        {c.serieComissao.map((v, i) => (
                          <td key={i} className="text-right">
                            {v !== 0 ? (
                              <Dinheiro centavos={v} />
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        ))}
                        <td className="text-right">
                          <Dinheiro centavos={c.comissaoAno} destaque />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      {Array.from(
                        { length: painel.ultimoMesComDados },
                        (_, i) => (
                          <td key={i} className="text-right">
                            <Dinheiro
                              centavos={painel.cartoes.reduce(
                                (a, c) => a + (c.serieComissao[i] ?? 0),
                                0
                              )}
                            />
                          </td>
                        )
                      )}
                      <td className="text-right">
                        <Dinheiro centavos={painel.totalComissaoAno} destaque />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          </details>
        </>
      )}

      <p className="mt-6 text-xs text-slate-400">
        Comissão calculada pela regra canônica (base = recebido − IPTU −
        condomínio × taxa do lançamento); repasses nunca entram. Ocupação conta
        as unidades ativas e o locatário do contrato vigente. Fonte:
        recebimentos lançados no sistema.
      </p>
    </div>
  );
}
