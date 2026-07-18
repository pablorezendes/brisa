import Link from "next/link";
import {
  Badge,
  Card,
  Dinheiro,
  Kpi,
  PageHeader,
  SeletorMes,
} from "@/components/ui";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import {
  formatarCompetencia,
  NOME_MES_ABREV,
  NOME_MES_COMPLETO,
  parseCompetencia,
} from "@/lib/dominio/normalizacao";
import { dadosExecutivos, mesPadrao } from "@/lib/consultas/executivo";
import {
  BarrasCaixa,
  BarrasDuplas,
  BarrasMensais,
  COR_1,
  COR_2,
  COR_3,
  Legenda,
} from "./graficos";

export const dynamic = "force-dynamic";

function pct(v: number | null): string {
  if (v === null) return "—";
  return `${(v * 100).toFixed(1).replace(".", ",")}%`;
}

export default async function PaginaExecutivo({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const sp = await searchParams;
  const mes = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : await mesPadrao();
  const d = await dadosExecutivos(mes);
  const { mes: mesNum } = parseCompetencia(mes);
  const comissaoMesTotal = d.porMes[mesNum - 1]?.comissao ?? 0;

  return (
    <div className="max-w-6xl">
      <PageHeader
        titulo="Dashboard executivo"
        descricao={`Todos os indicadores da operação — ${NOME_MES_COMPLETO[mesNum]} de ${d.ano}`}
        acoes={
          <div className="flex items-center gap-3">
            {d.mesFechado ? (
              <Badge cor="verde">Mês fechado</Badge>
            ) : (
              <Badge cor="ambar">Mês aberto</Badge>
            )}
            <SeletorMes base="/executivo" mes={mes} />
          </div>
        }
      />

      {/* ---------- KPIs ---------- */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          rotulo="Comissão do mês"
          valor={<Dinheiro centavos={d.comissaoMes} destaque />}
          detalhe={`sobre base de aluguel recebido`}
        />
        <Kpi
          rotulo="Comissão acumulada no ano"
          valor={<Dinheiro centavos={d.comissaoAcumuladaAno} destaque />}
          detalhe={`JAN a ${NOME_MES_ABREV[mesNum]} de ${d.ano}`}
        />
        <Kpi
          rotulo="Taxa de recebimento"
          valor={pct(d.taxaRecebimento)}
          detalhe={`recebido ${formatarBRL(d.recebidoMes)} / devido ${formatarBRL(d.devidoMes)}`}
        />
        <Kpi
          rotulo="Inadimplência do mês"
          valor={<Dinheiro centavos={d.inadimplentesValor} destaque />}
          detalhe={`${d.inadimplentesQtde} cobrança(s) sem recebimento`}
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          rotulo="Recebido no mês"
          valor={<Dinheiro centavos={d.recebidoMes} destaque />}
          detalhe="aluguel + repasses (IPTU/cond.)"
        />
        <Kpi
          rotulo="Saldo de caixa do mês"
          valor={<Dinheiro centavos={d.saldoCaixaMes} destaque />}
          detalhe={
            d.caixaMes
              ? `receita ${formatarBRL(d.caixaMes.receita)} − AL ${formatarBRL(d.caixaMes.despesaAL)} − CH ${formatarBRL(d.caixaMes.despesaCH)}`
              : "sem lançamentos no mês"
          }
        />
        <Kpi
          rotulo="Lucro de temporada"
          valor={
            d.lucroTemporadaMes !== null ? (
              <Dinheiro centavos={d.lucroTemporadaMes} destaque />
            ) : (
              "—"
            )
          }
          detalhe={
            d.lucroTemporadaMes !== null
              ? `receita ${formatarBRL(d.receitaTemporadaMes)} − despesa ${formatarBRL(d.despesaTemporadaMes)}`
              : `comissão AIRBNB no núcleo: ${formatarBRL(d.comissaoAirbnbMes)}`
          }
        />
        <Kpi
          rotulo="Contratos a reajustar"
          valor={String(d.reajustesDoMes.length)}
          detalhe={`aniversário em ${NOME_MES_COMPLETO[mesNum].toLowerCase()}`}
        />
      </div>

      {/* ---------- gráficos do núcleo ---------- */}
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Comissão mês a mês</h2>
            <span className="text-xs text-slate-500">
              total {d.ano}: {formatarBRL(d.porMes.reduce((a, l) => a + l.comissao, 0))}
            </span>
          </div>
          <BarrasMensais
            valores={d.porMes.map((l) => l.comissao)}
            mesSelecionado={mesNum}
          />
          <details className="mt-2 text-xs text-slate-600">
            <summary className="cursor-pointer select-none">Ver dados</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Mês</th>
                    <th className="text-right">Comissão</th>
                    <th className="text-right">Devido</th>
                    <th className="text-right">Recebido</th>
                    <th className="text-right">Pendentes</th>
                  </tr>
                </thead>
                <tbody>
                  {d.porMes.slice(0, d.ultimoMesComDados).map((l, i) => (
                    <tr key={l.mes}>
                      <td>{NOME_MES_ABREV[i + 1]}</td>
                      <td className="text-right"><Dinheiro centavos={l.comissao} /></td>
                      <td className="text-right"><Dinheiro centavos={l.devido} /></td>
                      <td className="text-right"><Dinheiro centavos={l.recebido} /></td>
                      <td className="text-right">{l.pendentes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Card>

        <Card className="p-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Devido × Recebido</h2>
            <Legenda
              itens={[
                { cor: COR_1, nome: "Devido" },
                { cor: COR_2, nome: "Recebido" },
              ]}
            />
          </div>
          <BarrasDuplas
            serieA={d.porMes.map((l) => l.devido)}
            serieB={d.porMes.map((l) => l.recebido)}
            nomeA="Devido"
            nomeB="Recebido"
          />
          <p className="mt-2 text-xs text-slate-500">
            Recebido acima do devido indica atrasos quitados no mês; abaixo,
            inadimplência ou pagamentos parciais.
          </p>
        </Card>
      </div>

      {/* ---------- comissão por empreendimento ---------- */}
      <Card className="mt-4 p-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">
            Comissão por empreendimento — {formatarCompetencia(mes)}
          </h2>
          <Link
            href="/relatorios/comissao"
            className="text-xs text-sky-700 hover:underline"
          >
            matriz completa →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                <th>Empreendimento</th>
                <th className="text-right">Comissão no mês</th>
                <th className="text-right">% do mês</th>
                <th className="text-right">Acumulada no ano</th>
                <th className="text-right">Recebido no mês</th>
                <th className="text-right">Ticket médio</th>
                <th>Evolução ({NOME_MES_ABREV[1]}–{NOME_MES_ABREV[d.ultimoMesComDados]})</th>
              </tr>
            </thead>
            <tbody>
              {d.porEmpreendimento.map((e) => (
                <tr key={e.id}>
                  <td className="font-medium">{e.nome}</td>
                  <td className="text-right"><Dinheiro centavos={e.comissaoMes} /></td>
                  <td className="text-right text-slate-500">
                    {comissaoMesTotal > 0
                      ? pct(e.comissaoMes / comissaoMesTotal)
                      : "—"}
                  </td>
                  <td className="text-right"><Dinheiro centavos={e.comissaoAno} /></td>
                  <td className="text-right"><Dinheiro centavos={e.recebidoMes} /></td>
                  <td className="text-right"><Dinheiro centavos={e.ticketMedioMes} /></td>
                  <td>
                    <BarraSparkline valores={e.serieComissao} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="text-right"><Dinheiro centavos={comissaoMesTotal} destaque /></td>
                <td className="text-right">100%</td>
                <td className="text-right"><Dinheiro centavos={d.comissaoAcumuladaAno} destaque /></td>
                <td className="text-right"><Dinheiro centavos={d.recebidoMes} destaque /></td>
                <td />
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* ---------- caixa ---------- */}
      <Card className="mt-4 p-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Caixa — receita × despesas por centro</h2>
          <Legenda
            itens={[
              { cor: COR_1, nome: "Receita (entradas)" },
              { cor: COR_2, nome: "Despesa Antonio/Laura" },
              { cor: COR_3, nome: "Despesa Chácara Brisa" },
            ]}
          />
        </div>
        <BarrasCaixa
          receita={d.caixaPorMes.map((c) => c.receita)}
          despesaAL={d.caixaPorMes.map((c) => c.despesaAL)}
          despesaCH={d.caixaPorMes.map((c) => c.despesaCH)}
        />
        <details className="mt-2 text-xs text-slate-600">
          <summary className="cursor-pointer select-none">Ver dados</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Mês</th>
                  <th className="text-right">Receita</th>
                  <th className="text-right">Despesa AL</th>
                  <th className="text-right">Despesa CH</th>
                  <th className="text-right">Saldo</th>
                  <th className="text-right">Receb. dinheiro*</th>
                </tr>
              </thead>
              <tbody>
                {d.caixaPorMes
                  .filter(
                    (c) =>
                      c.receita > 0 ||
                      c.despesaAL > 0 ||
                      c.despesaCH > 0 ||
                      c.dinheiro > 0
                  )
                  .map((c) => {
                    const { mes: m } = parseCompetencia(c.mes);
                    return (
                      <tr key={c.mes}>
                        <td>{NOME_MES_ABREV[m]}</td>
                        <td className="text-right"><Dinheiro centavos={c.receita} /></td>
                        <td className="text-right"><Dinheiro centavos={c.despesaAL} /></td>
                        <td className="text-right"><Dinheiro centavos={c.despesaCH} /></td>
                        <td className="text-right"><Dinheiro centavos={c.saldo} destaque /></td>
                        <td className="text-right"><Dinheiro centavos={c.dinheiro} /></td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-slate-500">
              * registro paralelo de espécie — não entra no saldo.
            </p>
          </div>
        </details>
      </Card>

      {/* ---------- listas operacionais ---------- */}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-2 text-sm font-semibold">
            Reajustes de {NOME_MES_COMPLETO[mesNum].toLowerCase()}
          </h2>
          {d.reajustesDoMes.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhum contrato com aniversário de reajuste neste mês.
            </p>
          ) : (
            <table className="tabela">
              <thead>
                <tr>
                  <th>Empreendimento</th>
                  <th>Localização</th>
                  <th>Locatário</th>
                  <th className="text-right">Aluguel atual</th>
                </tr>
              </thead>
              <tbody>
                {d.reajustesDoMes.map((r, i) => (
                  <tr key={i}>
                    <td>{r.empreendimento}</td>
                    <td>{r.localizacao}</td>
                    <td>{r.locatario}</td>
                    <td className="text-right"><Dinheiro centavos={r.valorBase} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">
              Pendentes do mês (sem recebimento)
            </h2>
            <span className="text-xs text-slate-500">
              {d.inadimplentesQtde} · {formatarBRL(d.inadimplentesValor)}
            </span>
          </div>
          {d.pendentesDoMes.length === 0 ? (
            <p className="text-sm text-slate-500">
              Todas as cobranças do mês foram recebidas. ✔
            </p>
          ) : (
            <table className="tabela">
              <thead>
                <tr>
                  <th>Empreendimento</th>
                  <th>Locatário</th>
                  <th>Localização</th>
                  <th className="text-right">Devido</th>
                  <th className="text-right">Atraso</th>
                </tr>
              </thead>
              <tbody>
                {d.pendentesDoMes.slice(0, 10).map((p, i) => (
                  <tr key={i}>
                    <td>{p.empreendimento}</td>
                    <td>{p.locatario}</td>
                    <td>{p.localizacao}</td>
                    <td className="text-right"><Dinheiro centavos={p.totalDevido} /></td>
                    <td className="text-right">
                      {p.diasAtraso !== null ? (
                        <Badge cor={p.diasAtraso > 30 ? "vermelho" : "ambar"}>
                          {p.diasAtraso}d
                        </Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {d.pendentesDoMes.length > 10 ? (
            <p className="mt-2 text-xs text-slate-500">
              Mostrando 10 de {d.pendentesDoMes.length} — lista completa em{" "}
              <Link href={`/relatorios/inadimplencia?mes=${mes}`} className="text-sky-700 hover:underline">
                Relatórios → Inadimplência
              </Link>
              .
            </p>
          ) : null}
        </Card>
      </div>

      <p className="mt-6 text-xs text-slate-400">
        Comissão calculada pela regra canônica (base = recebido − IPTU −
        condomínio × taxa do mês); repasses nunca entram na comissão. Fonte:
        recebimentos lançados no sistema.
      </p>
    </div>
  );
}

/** wrapper para import dinâmico do sparkline (mantém page enxuta) */
import { Sparkline } from "./graficos";
function BarraSparkline({ valores }: { valores: number[] }) {
  return <Sparkline valores={valores} />;
}
