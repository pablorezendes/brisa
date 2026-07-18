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
  comissaoDoMesPorEmpreendimento,
  contratosAReajustarDoMes,
  kpisDoMes,
  mesMaisRecenteComLancamentos,
  pendentesDoMes,
} from "@/lib/consultas/relatorios";
import {
  formatarCompetencia,
  parseCompetencia,
} from "@/lib/dominio/normalizacao";

const fmtPercentual = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 1,
});

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const sp = await searchParams;
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? "")
    ? (sp.mes as string)
    : await mesMaisRecenteComLancamentos();
  const { ano } = parseCompetencia(mes);

  const [kpis, comissaoPorEmp, reajustes, pendentes] = await Promise.all([
    kpisDoMes(mes),
    comissaoDoMesPorEmpreendimento(mes),
    contratosAReajustarDoMes(mes),
    pendentesDoMes(mes),
  ]);
  const topPendentes = pendentes.slice(0, 8);

  return (
    <div>
      <PageHeader
        titulo="Visão geral"
        descricao={`Resumo gerencial de ${formatarCompetencia(mes)} — comissão, inadimplência, reajustes, caixa e temporada.`}
        acoes={<SeletorMes base="/" mes={mes} />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Comissão do mês"
          valor={<Dinheiro centavos={kpis.comissaoMes} />}
          detalhe={`mês de lançamento ${formatarCompetencia(mes)}`}
          ajuda="O que a administradora ganhou no mês: a taxa vigente (padrão 10%) sobre o aluguel efetivamente recebido. IPTU e condomínio são repasses ao proprietário e nunca entram na conta. Só muda quando você registra pagamentos em Recebimentos."
        />
        <Kpi
          rotulo="Acumulada no ano"
          valor={<Dinheiro centavos={kpis.comissaoAcumuladaAno} />}
          detalhe={`JAN–${formatarCompetencia(mes)}`}
          ajuda="Soma das comissões de janeiro até o mês selecionado. É o total que a administradora ganhou no ano até aqui — a matriz completa por empreendimento está em Relatórios."
        />
        <Kpi
          rotulo="Inadimplência"
          valor={<Dinheiro centavos={kpis.inadimplencia.valorDevido} />}
          detalhe={`${kpis.inadimplencia.quantidade} ${
            kpis.inadimplencia.quantidade === 1
              ? "lançamento pendente"
              : "lançamentos pendentes"
          }`}
          ajuda="Soma das cobranças do mês que ainda não têm pagamento registrado. Quando o locatário pagar, vá em Recebimentos e clique em Registrar na linha dele — o valor sai daqui na hora."
        />
        <Kpi
          rotulo="Taxa de recebimento"
          valor={
            kpis.taxaRecebimento !== null
              ? fmtPercentual.format(kpis.taxaRecebimento)
              : "—"
          }
          detalhe="Σ recebido / Σ total devido"
          ajuda="Quanto do que era devido no mês já entrou. Pode passar de 100% quando alguém quita um atraso de meses anteriores junto — nesse caso lance tudo em Recebido e anote o motivo na Observação."
        />
        <Kpi
          rotulo="Contratos a reajustar"
          valor={kpis.contratosAReajustar}
          detalhe="mês de reajuste igual ao mês atual"
          ajuda="Contratos que fazem aniversário de correção neste mês. É hora de aplicar o índice (IGP-M, IPCA...) e atualizar o valor do aluguel na tela de Contratos — o sistema não reajusta sozinho."
        />
        <Kpi
          rotulo="Saldo de caixa do mês"
          valor={<Dinheiro centavos={kpis.saldoCaixaMes} />}
          detalhe="entradas − saídas AL − saídas CH"
          ajuda="Entradas do caixa menos as saídas dos dois centros (Antonio/Laura e Chácara Brisa). Recebimentos em dinheiro são um registro paralelo de espécie e não entram neste saldo."
        />
        <Kpi
          rotulo="Lucro temporada"
          valor={<Dinheiro centavos={kpis.lucroTemporadaMes} />}
          detalhe="receitas − despesas − limpezas"
          ajuda="Resultado do Airbnb no mês: o que as plataformas repassaram menos despesas (energia, condomínio, IPTU) e o pagamento das limpezas. Lançado na tela Temporada."
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Comissão por empreendimento no mês
            </h2>
            <Link
              href={`/relatorios/comissao?ano=${ano}`}
              className="text-sm font-medium font-semibold text-oliva-escura hover:underline"
            >
              Matriz completa →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Empreendimento</th>
                  <th className="text-right">Comissão</th>
                </tr>
              </thead>
              <tbody>
                {comissaoPorEmp.map((c) => (
                  <tr key={c.empreendimentoId}>
                    <td className="font-medium">{c.empreendimento}</td>
                    <td className="text-right">
                      <Dinheiro centavos={c.comissao} />
                    </td>
                  </tr>
                ))}
                {comissaoPorEmp.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="py-6 text-center text-slate-500">
                      Nenhuma comissão em {formatarCompetencia(mes)}.
                    </td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="text-right">
                    <Dinheiro centavos={kpis.comissaoMes} destaque />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <Card className="px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Pendentes do mês
            </h2>
            <Link
              href={`/relatorios/inadimplencia?mes=${mes}`}
              className="text-sm font-medium font-semibold text-oliva-escura hover:underline"
            >
              Inadimplência completa →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Empreendimento</th>
                  <th>Locatário</th>
                  <th className="text-right">
                    Total devido{" "}
                    <Ajuda dica="Aluguel + IPTU + condomínio da cobrança ainda sem pagamento. Quando entrar o dinheiro, registre em Recebimentos — se vier parcial ou em acordo, anote o motivo na Observação." />
                  </th>
                </tr>
              </thead>
              <tbody>
                {topPendentes.map((p) => (
                  <tr key={p.recebimentoId}>
                    <td className="font-medium">{p.empreendimento}</td>
                    <td>
                      {p.locatario ?? (
                        <span className="text-slate-400">{p.identificacao}</span>
                      )}
                    </td>
                    <td className="text-right">
                      <Dinheiro centavos={p.totalDevido} />
                    </td>
                  </tr>
                ))}
                {topPendentes.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-slate-500">
                      Nenhuma pendência em {formatarCompetencia(mes)}.
                    </td>
                  </tr>
                ) : null}
              </tbody>
              {pendentes.length > 0 ? (
                <tfoot>
                  <tr>
                    <td colSpan={2}>
                      {pendentes.length > topPendentes.length
                        ? `Top ${topPendentes.length} de ${pendentes.length} pendências`
                        : `${pendentes.length} ${
                            pendentes.length === 1 ? "pendência" : "pendências"
                          }`}
                    </td>
                    <td className="text-right">
                      <Dinheiro
                        centavos={kpis.inadimplencia.valorDevido}
                        destaque
                      />
                    </td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </Card>
      </div>

      <Card className="mt-4 px-5 py-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Reajustes deste mês
          </h2>
          <Badge cor={reajustes.length > 0 ? "ambar" : "slate"}>
            {reajustes.length}{" "}
            {reajustes.length === 1 ? "contrato" : "contratos"}
          </Badge>
        </div>
        {reajustes.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">
            Nenhum contrato com reajuste em {formatarCompetencia(mes)}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Empreendimento</th>
                  <th>Localização</th>
                  <th>Locatário</th>
                  <th>
                    Índice{" "}
                    <Ajuda dica="Índice de correção combinado no contrato (IGP-M, IPCA...). Aplique o percentual acumulado de 12 meses sobre o valor atual e atualize o contrato." />
                  </th>
                  <th className="text-right">
                    Valor atual{" "}
                    <Ajuda dica="Aluguel-base vigente antes do reajuste, sem IPTU nem condomínio. É sobre este valor que o índice é aplicado." />
                  </th>
                </tr>
              </thead>
              <tbody>
                {reajustes.map((r) => (
                  <tr key={r.contratoId}>
                    <td className="font-medium">{r.empreendimento}</td>
                    <td>{r.identificacao}</td>
                    <td>
                      {r.locatario ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td>
                      {r.indiceReajuste ? (
                        <Badge cor="azul">{r.indiceReajuste}</Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="text-right">
                      <Dinheiro centavos={r.valorBase} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
