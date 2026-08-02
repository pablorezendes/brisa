import Link from "next/link";
import {
  Ajuda,
  PageHeader,
  Card,
  Dinheiro,
  Badge,
  Kpi,
  LinkCard,
  SeletorMes,
  SeletorPeriodo,
  btnPrimario,
  btnSecundario,
  inputBase,
} from "@/components/ui";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { competencia, formatarCompetencia } from "@/lib/dominio/normalizacao";
import { parsePeriodo } from "@/lib/dominio/periodo";
import { nivelSaldo } from "@/lib/dominio/semaforo";
import {
  calcularApuracao,
  conciliacaoComNucleo,
  conciliacaoComNucleoDoPeriodo,
  dadosTemporadaDoMes,
  dadosTemporadaDoPeriodo,
  totalLimpeza,
  type ConciliacaoNucleo,
  type DadosTemporadaDoMes,
  type DadosTemporadaDoPeriodo,
} from "@/lib/consultas/temporada";
import {
  criarUnidadeTemporada,
  excluirDespesa,
  excluirRecebimentoTemporada,
  lancarDespesa,
  lancarRecebimentoTemporada,
  salvarLimpeza,
} from "./actions";

const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

const COR_TIPO: Record<string, "slate" | "verde" | "vermelho" | "ambar" | "azul"> = {
  ENERGIA: "ambar",
  CONDO: "azul",
  IPTU: "vermelho",
  LIMPEZA: "verde",
  EXTRA: "slate",
};

function mesCorrente(): string {
  const hoje = new Date();
  return competencia(hoje.getFullYear(), hoje.getMonth() + 1);
}

// Fallbacks tipados: cada modo só busca os próprios dados; o outro fica vazio.
const VAZIO_MES: DadosTemporadaDoMes = {
  unidades: [],
  limpezas: [],
  despesas: [],
  recebimentos: [],
};
const VAZIO_PERIODO: DadosTemporadaDoPeriodo = {
  limpezas: [],
  despesas: [],
  recebimentos: [],
};

/** Centavos → texto para defaultValue de input ("50,00"). */
function centavosParaInput(centavos: number): string {
  return (centavos / 100).toFixed(2).replace(".", ",");
}

function BadgeConciliacao({
  c,
  janela = "neste mês",
}: {
  c: ConciliacaoNucleo;
  janela?: string;
}) {
  if (!c.existeLinhaNucleo) {
    return <Badge cor="slate">Sem linha AIRBNB no núcleo {janela}</Badge>;
  }
  if (c.recebidoNucleo === null) {
    return <Badge cor="ambar">Núcleo ainda sem valor recebido</Badge>;
  }
  if (c.conciliado) {
    return <Badge cor="verde">Conciliado</Badge>;
  }
  return <Badge cor="ambar">Diferença de {formatarBRL(c.diferenca)}</Badge>;
}

export default async function PaginaTemporada({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; de?: string; ate?: string }>;
}) {
  const sp = await searchParams;
  const periodo = parsePeriodo(sp.de, sp.ate);
  const mes = sp.mes && RE_MES.test(sp.mes) ? sp.mes : mesCorrente();

  // As duas visões desembocam na MESMA apuração (calcularApuracao): o modo mês
  // soma 1 competência; o modo período soma a janela inteira (gte/lte).
  const dadosMes = periodo ? null : await dadosTemporadaDoMes(mes);
  const dadosPeriodo = periodo ? await dadosTemporadaDoPeriodo(periodo.meses) : null;
  const apuracao = calcularApuracao(dadosMes ?? dadosPeriodo ?? VAZIO_PERIODO);
  const conciliacao = periodo
    ? await conciliacaoComNucleoDoPeriodo(periodo.meses, apuracao.receita)
    : await conciliacaoComNucleo(mes, apuracao.receita);

  // ---- modo mês -----------------------------------------------------------
  const { unidades, limpezas, despesas, recebimentos } = dadosMes ?? VAZIO_MES;
  const limpezaPorUnidade = new Map(limpezas.map((l) => [l.unidadeTemporadaId, l]));
  // Linhas LIMPEZA derivadas para o bloco de despesas (uma por unidade com limpeza).
  const limpezasDerivadas = limpezas
    .map((l) => ({ codigo: l.unidadeTemporada.codigo, total: totalLimpeza(l) }))
    .filter((l) => l.total > 0)
    .sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR"));

  // ---- modo período -------------------------------------------------------
  const comMes = periodo ? periodo.meses.length > 1 : false;
  const dadosJanela = dadosPeriodo ?? VAZIO_PERIODO;
  const limpezasJanela = dadosJanela.limpezas
    .filter((l) => totalLimpeza(l) > 0)
    .sort((a, b) =>
      a.competencia === b.competencia
        ? a.unidadeTemporada.codigo.localeCompare(b.unidadeTemporada.codigo, "pt-BR")
        : a.competencia.localeCompare(b.competencia),
    );
  // Linhas LIMPEZA derivadas da janela (uma por unidade×mês com limpeza).
  const limpezasDerivadasJanela = limpezasJanela.map((l) => ({
    mes: l.competencia,
    codigo: l.unidadeTemporada.codigo,
    total: totalLimpeza(l),
  }));

  return (
    <div>
      <PageHeader
        titulo="Temporada"
        descricao={
          periodo
            ? `Apuração agregada do período ${periodo.rotulo} — receita, despesas e limpezas somadas na janela`
            : "Limpezas, despesas e recebimentos das unidades Airbnb — apuração derivada do mês"
        }
        acoes={
          <>
            <Link href="/temporada/historico" className={btnSecundario}>
              Histórico
            </Link>
            {!periodo ? <SeletorMes base="/temporada" mes={mes} /> : null}
            <SeletorPeriodo base="/temporada" periodo={periodo} />
          </>
        }
      />

      {/* Apuração da janela (derivada — nunca persistida) */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          rotulo="Receita"
          valor={<Dinheiro centavos={apuracao.receita} destaque />}
          detalhe={periodo ? "Σ recebimentos no período" : "Σ recebimentos do mês"}
          ajuda={
            periodo
              ? "Soma dos repasses das plataformas (Airbnb, Booking...) e hospedagens de todos os meses da janela. Deve bater com a soma das linhas AIRBNB do núcleo no mesmo período — confira o selo de conciliação."
              : "Soma dos repasses das plataformas (Airbnb, Booking...) e hospedagens lançados no bloco Recebimentos abaixo. Deve bater com a linha AIRBNB do núcleo — confira o selo de conciliação."
          }
        />
        <Kpi
          rotulo="Despesa"
          valor={<Dinheiro centavos={apuracao.despesa} destaque />}
          detalhe="despesas + limpezas"
          ajuda={
            periodo
              ? "Despesas lançadas (energia, condomínio, IPTU, extras) nos meses da janela mais o total das limpezas do período, que entra automaticamente — não lance a limpeza de novo como despesa."
              : "Despesas lançadas (energia, condomínio, IPTU, extras) mais o total das limpezas, que entra automaticamente — não lance a limpeza de novo como despesa."
          }
        />
        <Kpi
          rotulo="Lucro"
          valor={<Dinheiro centavos={apuracao.lucro} destaque />}
          detalhe="receita − despesa"
          nivel={nivelSaldo(apuracao.lucro)}
          selo={
            apuracao.lucro > 0
              ? "no azul"
              : apuracao.lucro < 0
                ? "no vermelho"
                : undefined
          }
          nota={
            apuracao.lucro < 0
              ? periodo
                ? "Despesas e limpezas passaram do que as plataformas repassaram no período."
                : "Despesas e limpezas passaram do que as plataformas repassaram no mês."
              : undefined
          }
          ajuda={
            periodo
              ? "O que a temporada rendeu na janela: receita menos despesas e limpezas de todos os meses do período. Sempre calculado na hora a partir dos lançamentos — nunca digitado."
              : "O que a temporada rendeu no mês: receita menos despesas e limpezas. Sempre calculado na hora a partir dos lançamentos — nunca digitado."
          }
        />
        <Kpi
          rotulo="Pagamento diarista"
          valor={<Dinheiro centavos={apuracao.totalLimpezas} destaque />}
          detalhe={periodo ? "total das limpezas no período" : "total das limpezas do mês"}
          ajuda={
            periodo
              ? "Quanto foi pago à diarista somando os meses da janela: em cada mês, quantidade de limpezas × valor unitário + extra/PDL. Para ajustar um lançamento, abra o mês dele na visão mensal."
              : "Quanto pagar à diarista no mês: para cada unidade, quantidade de limpezas × valor unitário + extra/PDL. Preencha no bloco Limpezas e o total sai aqui."
          }
        />
      </div>

      {/* Conciliação com o núcleo */}
      <Card className="mt-4 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">Conciliação com o núcleo</span>
          <BadgeConciliacao c={conciliacao} janela={periodo ? "no período" : "neste mês"} />
          <span className="text-sm text-tinta-suave">
            Núcleo (AIRBNB/TODOS): <Dinheiro centavos={conciliacao.recebidoNucleo} /> · Receita da
            temporada: <Dinheiro centavos={apuracao.receita} />
          </span>
        </div>
        <p className="mt-1 text-xs text-tinta-suave">
          {periodo
            ? `A soma das linhas agregadas AIRBNB/TODOS do núcleo deve refletir a receita da temporada no período ${periodo.rotulo} — as duas pontas somadas sobre os mesmos meses.`
            : `A linha agregada AIRBNB/TODOS do núcleo de recebimentos deve refletir a receita da temporada de ${formatarCompetencia(mes)}.`}
        </p>
      </Card>

      {periodo ? (
        <>
          {/* Aviso: lançamentos continuam mensais */}
          <Card className="mt-6 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-tinta-suave">
                Lançamentos são feitos na visão mensal — no período a tela é só de leitura.
              </p>
              <LinkCard href={`/temporada?mes=${mesCorrente()}`}>
                Lançar em {formatarCompetencia(mesCorrente())}
              </LinkCard>
            </div>
          </Card>

          {/* 1. LIMPEZAS DA JANELA */}
          <Card className="mt-6">
            <div className="border-b border-contorno px-5 py-3">
              <h2 className="text-sm font-semibold">Limpezas — {periodo.rotulo}</h2>
              <p className="text-xs text-tinta-suave">
                Lançamentos de limpeza da janela, mês a mês. O rodapé é o total pago à diarista
                no período.
              </p>
            </div>
            {limpezasJanela.length === 0 ? (
              <p className="px-5 py-4 text-sm text-tinta-suave">Nenhuma limpeza no período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="tabela">
                  <thead>
                    <tr>
                      {comMes ? <th>Mês</th> : null}
                      <th>Unidade</th>
                      <th className="text-right">Quantidade</th>
                      <th className="text-right">Valor unitário</th>
                      <th className="text-right">Extra/PDL</th>
                      <th className="text-right">
                        Total{" "}
                        <Ajuda dica="Quantidade × valor unitário + extra/PDL do mês da linha. Para corrigir, abra o mês na visão mensal." />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {limpezasJanela.map((l) => (
                      <tr key={l.id}>
                        {comMes ? (
                          <td className="font-mono text-[12px]">
                            {formatarCompetencia(l.competencia)}
                          </td>
                        ) : null}
                        <td className="font-medium">{l.unidadeTemporada.codigo}</td>
                        <td className="text-right">{l.quantidade}</td>
                        <td className="text-right">
                          <Dinheiro centavos={l.valorUnitario} />
                        </td>
                        <td className="text-right">
                          <Dinheiro centavos={l.extraPdl} />
                        </td>
                        <td className="text-right">
                          <Dinheiro centavos={totalLimpeza(l)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={comMes ? 5 : 4}>Pagamento no período (diarista)</td>
                      <td className="text-right">
                        <Dinheiro centavos={apuracao.totalLimpezas} destaque />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>

          {/* 2. DESPESAS DA JANELA */}
          <Card className="mt-6">
            <div className="border-b border-contorno px-5 py-3">
              <h2 className="text-sm font-semibold">Despesas — {periodo.rotulo}</h2>
              <p className="text-xs text-tinta-suave">
                Despesas lançadas nos meses da janela. As linhas LIMPEZA são derivadas
                automaticamente do bloco de limpezas de cada mês.
              </p>
            </div>
            {dadosJanela.despesas.length === 0 && limpezasDerivadasJanela.length === 0 ? (
              <p className="px-5 py-4 text-sm text-tinta-suave">Nenhuma despesa no período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="tabela">
                  <thead>
                    <tr>
                      {comMes ? <th>Mês</th> : null}
                      <th>
                        Unidade{" "}
                        <Ajuda dica="Despesa de uma unidade específica ou '— mês' quando é geral (produto de limpeza, por exemplo)." />
                      </th>
                      <th>
                        Tipo{" "}
                        <Ajuda dica="ENERGIA, CONDO, IPTU ou EXTRA — lançados na visão mensal. LIMPEZA é derivada automaticamente do bloco de limpezas; não a lance de novo." />
                      </th>
                      <th className="text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dadosJanela.despesas.map((d) => (
                      <tr key={d.id}>
                        {comMes ? (
                          <td className="font-mono text-[12px]">
                            {formatarCompetencia(d.competencia)}
                          </td>
                        ) : null}
                        <td>
                          {d.unidadeTemporada?.codigo ?? (
                            <span className="text-tinta-suave/60">— mês</span>
                          )}
                        </td>
                        <td>
                          <Badge cor={COR_TIPO[d.tipo] ?? "slate"}>{d.tipo}</Badge>
                        </td>
                        <td className="text-right">
                          <Dinheiro centavos={d.valor} />
                        </td>
                      </tr>
                    ))}
                    {limpezasDerivadasJanela.map((l) => (
                      <tr key={`limp-${l.mes}-${l.codigo}`}>
                        {comMes ? (
                          <td className="font-mono text-[12px]">
                            {formatarCompetencia(l.mes)}
                          </td>
                        ) : null}
                        <td>{l.codigo}</td>
                        <td>
                          <Badge cor="verde">LIMPEZA</Badge>{" "}
                          <span className="text-xs text-tinta-suave/60">derivada das limpezas</span>
                        </td>
                        <td className="text-right">
                          <Dinheiro centavos={l.total} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={comMes ? 3 : 2}>Total de despesas no período</td>
                      <td className="text-right">
                        <Dinheiro centavos={apuracao.despesa} destaque />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>

          {/* 3. RECEBIMENTOS DA JANELA */}
          <Card className="mt-6">
            <div className="border-b border-contorno px-5 py-3">
              <h2 className="text-sm font-semibold">Recebimentos — {periodo.rotulo}</h2>
              <p className="text-xs text-tinta-suave">
                Repasses das plataformas e hospedagens dos meses da janela. A soma é a receita
                do período.
              </p>
            </div>
            {dadosJanela.recebimentos.length === 0 ? (
              <p className="px-5 py-4 text-sm text-tinta-suave">
                Nenhum recebimento no período.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="tabela">
                  <thead>
                    <tr>
                      {comMes ? <th>Mês</th> : null}
                      <th>Unidade</th>
                      <th>Plataforma</th>
                      <th>Hóspede</th>
                      <th className="text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dadosJanela.recebimentos.map((r) => (
                      <tr key={r.id}>
                        {comMes ? (
                          <td className="font-mono text-[12px]">
                            {formatarCompetencia(r.competencia)}
                          </td>
                        ) : null}
                        <td>
                          {r.unidadeTemporada?.codigo ?? (
                            <span className="text-tinta-suave/60">—</span>
                          )}
                        </td>
                        <td>{r.plataforma ?? <span className="text-tinta-suave/60">—</span>}</td>
                        <td>{r.hospede ?? <span className="text-tinta-suave/60">—</span>}</td>
                        <td className="text-right">
                          <Dinheiro centavos={r.valor} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={comMes ? 4 : 3}>Receita no período</td>
                      <td className="text-right">
                        <Dinheiro centavos={apuracao.receita} destaque />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : (
        <>
          {unidades.length === 0 ? (
            <Card className="mt-6 px-6 py-8">
              <h2 className="text-base font-semibold">Nenhuma unidade de temporada cadastrada</h2>
              <p className="mt-1 max-w-xl text-sm text-tinta-suave">
                Cadastre as unidades (pelo código do apartamento, ex.: 208, 304) para lançar
                limpezas, despesas e recebimentos por unidade.
              </p>
              <form action={criarUnidadeTemporada} className="mt-4 flex items-center gap-2">
                <input
                  name="codigo"
                  placeholder="Código (ex.: 208)"
                  required
                  className={`${inputBase} w-40`}
                />
                <button type="submit" className={btnPrimario}>
                  Cadastrar unidade
                </button>
              </form>
            </Card>
          ) : null}

          {/* 1. LIMPEZAS */}
          <Card className="mt-6">
            <div className="border-b border-contorno px-5 py-3">
              <h2 className="text-sm font-semibold">Limpezas — {formatarCompetencia(mes)}</h2>
              <p className="text-xs text-tinta-suave">
                Total por unidade = quantidade × valor unitário + extra/PDL. O rodapé é o pagamento
                do mês à diarista.
              </p>
            </div>
            {unidades.length === 0 ? (
              <p className="px-5 py-4 text-sm text-tinta-suave">
                Cadastre unidades de temporada para lançar limpezas.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Unidade</th>
                      <th className="text-right">
                        Quantidade{" "}
                        <Ajuda dica="Quantas limpezas a unidade teve no mês. Atualize e clique em Salvar na linha — o total recalcula sozinho." />
                      </th>
                      <th className="text-right">
                        Valor unitário{" "}
                        <Ajuda dica="Preço combinado por limpeza (padrão R$ 50,00). Se a diarista reajustar, altere aqui — vale só para o mês em tela." />
                      </th>
                      <th className="text-right">
                        Extra/PDL{" "}
                        <Ajuda dica="Valores avulsos pagos à diarista além das limpezas (passadoria, lavagem de roupa de cama etc.). Entram no total da unidade." />
                      </th>
                      <th className="text-right">
                        Total{" "}
                        <Ajuda dica="Quantidade × valor unitário + extra/PDL. Calculado pelo sistema e somado ao pagamento do mês da diarista." />
                      </th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {unidades.map((u) => {
                      const l = limpezaPorUnidade.get(u.id);
                      const formId = `limpeza-${u.id}`;
                      return (
                        <tr key={u.id}>
                          <td className="font-medium">{u.codigo}</td>
                          <td className="text-right">
                            <input
                              name="quantidade"
                              form={formId}
                              type="number"
                              min={0}
                              step={1}
                              defaultValue={l?.quantidade ?? 0}
                              className={`${inputBase} w-20 text-right`}
                            />
                          </td>
                          <td className="text-right">
                            <input
                              name="valorUnitario"
                              form={formId}
                              inputMode="decimal"
                              defaultValue={centavosParaInput(l?.valorUnitario ?? 5000)}
                              className={`${inputBase} w-24 text-right`}
                            />
                          </td>
                          <td className="text-right">
                            <input
                              name="extraPdl"
                              form={formId}
                              inputMode="decimal"
                              defaultValue={centavosParaInput(l?.extraPdl ?? 0)}
                              className={`${inputBase} w-24 text-right`}
                            />
                          </td>
                          <td className="text-right">
                            <Dinheiro centavos={l ? totalLimpeza(l) : 0} />
                          </td>
                          <td className="text-right">
                            <button type="submit" form={formId} className={btnSecundario}>
                              Salvar
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4}>Pagamento do mês (diarista)</td>
                      <td className="text-right">
                        <Dinheiro centavos={apuracao.totalLimpezas} destaque />
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            {/* Formulários das linhas (inputs associados via atributo form) */}
            {unidades.map((u) => (
              <form key={u.id} id={`limpeza-${u.id}`} action={salvarLimpeza}>
                <input type="hidden" name="unidadeTemporadaId" value={u.id} />
                <input type="hidden" name="competencia" value={mes} />
              </form>
            ))}
          </Card>

          {/* 2. DESPESAS */}
          <Card className="mt-6">
            <div className="border-b border-contorno px-5 py-3">
              <h2 className="text-sm font-semibold">Despesas — {formatarCompetencia(mes)}</h2>
              <p className="text-xs text-tinta-suave">
                Por unidade ou do mês (sem unidade — produto de limpeza etc.). As linhas LIMPEZA são
                derivadas automaticamente do bloco de limpezas.
              </p>
            </div>
            {despesas.length === 0 && limpezasDerivadas.length === 0 ? (
              <p className="px-5 py-4 text-sm text-tinta-suave">Nenhuma despesa no mês.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>
                        Unidade{" "}
                        <Ajuda dica="Despesa de uma unidade específica ou '— mês' quando é geral (produto de limpeza, por exemplo)." />
                      </th>
                      <th>
                        Tipo{" "}
                        <Ajuda dica="ENERGIA, CONDO, IPTU ou EXTRA — lançados por você. LIMPEZA é derivada automaticamente do bloco de limpezas; não a lance de novo." />
                      </th>
                      <th className="text-right">Valor</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {despesas.map((d) => (
                      <tr key={d.id}>
                        <td>{d.unidadeTemporada?.codigo ?? <span className="text-tinta-suave/60">— mês</span>}</td>
                        <td>
                          <Badge cor={COR_TIPO[d.tipo] ?? "slate"}>{d.tipo}</Badge>
                        </td>
                        <td className="text-right">
                          <Dinheiro centavos={d.valor} />
                        </td>
                        <td className="text-right">
                          <form action={excluirDespesa}>
                            <input type="hidden" name="id" value={d.id} />
                            <button
                              type="submit"
                              className="text-xs text-tinta-suave hover:text-erro"
                            >
                              Excluir
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                    {limpezasDerivadas.map((l) => (
                      <tr key={`limp-${l.codigo}`}>
                        <td>{l.codigo}</td>
                        <td>
                          <Badge cor="verde">LIMPEZA</Badge>{" "}
                          <span className="text-xs text-tinta-suave/60">derivada das limpezas</span>
                        </td>
                        <td className="text-right">
                          <Dinheiro centavos={l.total} />
                        </td>
                        <td></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2}>Total de despesas do mês</td>
                      <td className="text-right">
                        <Dinheiro centavos={apuracao.despesa} destaque />
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <form
              action={lancarDespesa}
              className="flex flex-wrap items-center gap-2 border-t border-contorno px-5 py-3"
            >
              <input type="hidden" name="competencia" value={mes} />
              <select name="unidadeTemporadaId" defaultValue="" className={inputBase}>
                <option value="">Despesa do mês (sem unidade)</option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    Unidade {u.codigo}
                  </option>
                ))}
              </select>
              <select name="tipo" defaultValue="ENERGIA" className={inputBase}>
                <option value="ENERGIA">Energia</option>
                <option value="CONDO">Condomínio</option>
                <option value="IPTU">IPTU</option>
                <option value="EXTRA">Extra</option>
              </select>
              <input
                name="valor"
                inputMode="decimal"
                placeholder="Valor (ex.: 123,45)"
                required
                className={`${inputBase} w-36 text-right`}
              />
              <button type="submit" className={btnPrimario}>
                Lançar despesa
              </button>
            </form>
          </Card>

          {/* 3. RECEBIMENTOS */}
          <Card className="mt-6">
            <div className="border-b border-contorno px-5 py-3">
              <h2 className="text-sm font-semibold">Recebimentos — {formatarCompetencia(mes)}</h2>
              <p className="text-xs text-tinta-suave">
                Repasses das plataformas e hospedagens do mês. A soma é a receita da apuração.
              </p>
            </div>
            {recebimentos.length === 0 ? (
              <p className="px-5 py-4 text-sm text-tinta-suave">Nenhum recebimento no mês.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Unidade</th>
                      <th>Plataforma</th>
                      <th>Hóspede</th>
                      <th className="text-right">Valor</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recebimentos.map((r) => (
                      <tr key={r.id}>
                        <td>{r.unidadeTemporada?.codigo ?? <span className="text-tinta-suave/60">—</span>}</td>
                        <td>{r.plataforma ?? <span className="text-tinta-suave/60">—</span>}</td>
                        <td>{r.hospede ?? <span className="text-tinta-suave/60">—</span>}</td>
                        <td className="text-right">
                          <Dinheiro centavos={r.valor} />
                        </td>
                        <td className="text-right">
                          <form action={excluirRecebimentoTemporada}>
                            <input type="hidden" name="id" value={r.id} />
                            <button
                              type="submit"
                              className="text-xs text-tinta-suave hover:text-erro"
                            >
                              Excluir
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>Receita do mês</td>
                      <td className="text-right">
                        <Dinheiro centavos={apuracao.receita} destaque />
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <form
              action={lancarRecebimentoTemporada}
              className="flex flex-wrap items-center gap-2 border-t border-contorno px-5 py-3"
            >
              <input type="hidden" name="competencia" value={mes} />
              <select name="unidadeTemporadaId" defaultValue="" className={inputBase}>
                <option value="">Sem unidade (repasse geral)</option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    Unidade {u.codigo}
                  </option>
                ))}
              </select>
              <input
                name="plataforma"
                placeholder="Plataforma (AIRBNB, BOOKING...)"
                className={`${inputBase} w-52`}
              />
              <input name="hospede" placeholder="Hóspede" className={`${inputBase} w-44`} />
              <input
                name="valor"
                inputMode="decimal"
                placeholder="Valor (ex.: 1.234,56)"
                required
                className={`${inputBase} w-36 text-right`}
              />
              <button type="submit" className={btnPrimario}>
                Lançar recebimento
              </button>
            </form>
          </Card>

          {/* Cadastro de unidades (compacto, quando já existem unidades) */}
          {unidades.length > 0 ? (
            <Card className="mt-6 px-5 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold">Unidades de temporada</span>
                {unidades.map((u) => (
                  <Badge key={u.id} cor="azul">
                    {u.codigo}
                  </Badge>
                ))}
                <form action={criarUnidadeTemporada} className="flex items-center gap-2">
                  <input
                    name="codigo"
                    placeholder="Novo código (ex.: 208)"
                    required
                    className={`${inputBase} w-44`}
                  />
                  <button type="submit" className={btnSecundario}>
                    Cadastrar
                  </button>
                </form>
              </div>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
