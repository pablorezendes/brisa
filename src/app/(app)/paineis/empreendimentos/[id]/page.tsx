import Link from "next/link";
import { notFound } from "next/navigation";
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
  BarrasDuplas,
  BarrasMensais,
  COR_1,
  COR_2,
  Legenda,
} from "@/components/graficos";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import {
  NOME_MES_ABREV,
  NOME_MES_COMPLETO,
  parseCompetencia,
} from "@/lib/dominio/normalizacao";
import { formatarDataBR } from "@/lib/consultas/locacao";
import { mesMaisRecenteComLancamentos } from "@/lib/consultas/relatorios";
import { detalheEmpreendimento } from "@/lib/consultas/painel-empreendimentos";
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
  searchParams: Promise<{ ano?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const mesRecente = await mesMaisRecenteComLancamentos();
  const ano = anoDaQuery(sp.ano, parseCompetencia(mesRecente).ano);
  const d = await detalheEmpreendimento(id, ano);
  if (!d) notFound();

  const hoje = new Date();
  const anoAtual = hoje.getFullYear();
  const mesAtual = hoje.getMonth() + 1;
  const ocupacaoPct =
    d.ocupacao.ativas > 0 ? d.ocupacao.ocupadas / d.ocupacao.ativas : null;
  const totalComissaoUnidades = d.unidades.reduce(
    (a, u) => a + u.comissaoAno,
    0
  );

  return (
    <div className="max-w-6xl">
      <PageHeader
        titulo={d.nome}
        descricao={`Comissão, recebimentos, unidades e locatários deste empreendimento em ${ano}.`}
        acoes={
          <>
            <SeletorAno base={`/paineis/empreendimentos/${d.id}`} ano={ano} />
            <Link
              href={`/paineis/empreendimentos?ano=${ano}`}
              className={btnSecundario}
            >
              Voltar
            </Link>
          </>
        }
      />

      {/* ---------- KPIs ---------- */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi
          rotulo="Comissão no ano"
          valor={<Dinheiro centavos={d.comissaoAno} destaque />}
          detalhe="o ganho da administradora aqui"
          ajuda="Soma da comissão de cada lançamento pago do empreendimento: (recebido − IPTU − condomínio) × taxa do lançamento (padrão 10%). IPTU e condomínio são repasses ao proprietário e nunca entram na conta."
        />
        <Kpi
          rotulo="Recebido no ano"
          valor={<Dinheiro centavos={d.recebidoAno} destaque />}
          detalhe="aluguel + repasses (IPTU/cond.)"
          ajuda="Tudo o que os locatários pagaram nos lançamentos deste ano. Só conta quando o campo Recebido é preenchido — se o locatário pagou junto um mês atrasado, lance tudo em Recebido e anote o motivo na Observação."
        />
        <Kpi
          rotulo="Taxa de recebimento"
          valor={pct(d.taxaRecebimento)}
          detalhe={`entrou ${formatarBRL(d.recebidoAno)} de ${formatarBRL(d.devidoAno)} devidos`}
          ajuda="Recebido ÷ devido no ano. Acima de 100% = atrasos de meses anteriores quitados; abaixo, há cobranças sem pagamento ou pagas em parte (o motivo do parcial vai na Observação do lançamento)."
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
          ajuda="Unidades ativas com locatário no contrato vigente. Unidade desocupada não gera aluguel nem comissão — cada mês vazio é receita perdida; priorize divulgar e negociar essas unidades."
        />
        <Kpi
          rotulo="Pendente em aberto"
          valor={<Dinheiro centavos={d.pendenteAberto} destaque />}
          detalhe={`${d.pendentesQtde} cobrança(s) sem pagamento em ${ano}`}
          ajuda="Cobranças lançadas no ano que ainda estão sem valor em Recebido. Quando o locatário pagar, preencha Recebido e a Data de pagamento no lançamento — a competência continua sendo a do mês devido."
        />
      </div>

      {/* ---------- gráficos ---------- */}
      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">
              Comissão mês a mês — {ano}
            </h2>
            <span className="text-xs text-slate-500">
              total: {formatarBRL(d.comissaoAno)}
            </span>
          </div>
          <BarrasMensais
            valores={d.comissaoPorMes}
            mesSelecionado={ano === anoAtual ? mesAtual : 0}
          />
          <p className="mt-2 text-xs text-slate-500">
            Cada barra é a comissão que este empreendimento gerou no mês de
            lançamento. Mês sem barra = nada recebido (ou só devidos ainda em
            aberto).
          </p>
          <details className="mt-2 text-xs text-slate-600">
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
                  {d.comissaoPorMes
                    .slice(0, d.ultimoMesComDados)
                    .map((v, i) => (
                      <tr key={i}>
                        <td>{NOME_MES_ABREV[i + 1]}</td>
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
            <h2 className="text-sm font-semibold">Devido × Recebido — {ano}</h2>
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
          />
          <p className="mt-2 text-xs text-slate-500">
            Recebido acima do devido = atrasos quitados no mês; abaixo =
            inadimplência ou pagamento parcial (motivo na Observação do
            lançamento).
          </p>
          <details className="mt-2 text-xs text-slate-600">
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
                  {d.devidoPorMes.slice(0, d.ultimoMesComDados).map((v, i) => (
                    <tr key={i}>
                      <td>{NOME_MES_ABREV[i + 1]}</td>
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
          <span className="text-xs text-slate-500">
            {d.ocupacao.ativas} ativa(s) · {d.ocupacao.desocupadas}{" "}
            desocupada(s)
          </span>
        </div>
        {d.unidades.length === 0 ? (
          <p className="text-sm text-slate-500">
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
                    <Ajuda dica="Mês de aniversário da correção anual do aluguel. Quando ele chega, aplique o índice e atualize o valor-base no contrato — o sistema não corrige sozinho. 'Já passou' = o aniversário deste ano ficou para trás; confira se o valor foi corrigido." />
                  </th>
                  <th>Status</th>
                  <th className="text-right">
                    Comissão no ano{" "}
                    <Ajuda dica="Comissão que os lançamentos pagos desta unidade geraram no ano, pela regra (recebido − repasses) × taxa." />
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
                          {ano === anoAtual && u.mesReajuste === mesAtual ? (
                            <Badge cor="ambar">é agora</Badge>
                          ) : ano === anoAtual && u.mesReajuste < mesAtual ? (
                            <Badge cor="ambar">já passou — confira</Badge>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
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
                      <Dinheiro centavos={u.comissaoAno} />
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
          <p className="mt-2 text-xs text-ambar">
            Unidade desocupada não gera aluguel nem comissão — cada mês vazio é
            receita que não volta. Vale priorizar a divulgação e a negociação
            dessas unidades.
          </p>
        ) : null}
      </Card>

      {/* ---------- locatários ---------- */}
      <Card className="mt-4 p-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Locatários em {ano}</h2>
          <span className="text-xs text-slate-500">
            pendente em aberto: {formatarBRL(d.pendenteAberto)}
          </span>
        </div>
        {d.locatarios.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nenhum lançamento para locatários deste empreendimento em {ano}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Locatário</th>
                  <th className="text-right">
                    Recebido no ano{" "}
                    <Ajuda dica="Soma do campo Recebido dos lançamentos do locatário no ano (aluguel + IPTU + condomínio quando cobrados juntos). Pode passar do contratado quando ele quita atrasos." />
                  </th>
                  <th className="text-right">
                    Pendente{" "}
                    <Ajuda dica="Cobranças lançadas no ano ainda sem valor em Recebido. Ao receber, preencha Recebido e a Data de pagamento; se for acordo ou pagamento parcial, anote o motivo na Observação." />
                  </th>
                  <th className="text-right">
                    Último pagamento{" "}
                    <Ajuda dica="Data de pagamento mais recente registrada nos lançamentos do ano. Se aparecer '—' com valor recebido, a data não foi preenchida no lançamento — vale sempre preencher." />
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.locatarios.map((l) => (
                  <tr key={l.nome}>
                    <td className="font-medium">{l.nome}</td>
                    <td className="text-right">
                      <Dinheiro centavos={l.recebidoAno} />
                    </td>
                    <td className="text-right">
                      {l.pendenteAno > 0 ? (
                        <span className="inline-flex items-center justify-end gap-2">
                          <Badge cor={l.lancamentosPendentes > 1 ? "vermelho" : "ambar"}>
                            {l.lancamentosPendentes}×
                          </Badge>
                          <Dinheiro centavos={l.pendenteAno} />
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="text-right font-mono text-xs">
                      {l.ultimoPagamento ? (
                        formatarDataBR(l.ultimoPagamento)
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="text-right">
                    <Dinheiro centavos={d.recebidoAno} destaque />
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

      <p className="mt-6 text-xs text-slate-400">
        Todos os números nascem dos lançamentos de recebimento do ano{" "}
        {ano} deste empreendimento (mês de lançamento {NOME_MES_ABREV[1]}–
        {NOME_MES_ABREV[12]}), pela regra canônica: comissão = (recebido − IPTU
        − condomínio) × taxa do lançamento. {NOME_MES_COMPLETO[mesAtual]} é o
        mês corrente usado para destacar reajustes.
      </p>
    </div>
  );
}
