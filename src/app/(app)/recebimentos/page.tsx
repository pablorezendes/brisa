import Link from "next/link";
import { OperacaoUnificada, podeAcessarUnificacao, type ParametrosUnificacao } from "@/components/operacao-unificada";
import {
  Ajuda,
  PageHeader,
  Card,
  Dinheiro,
  Badge,
  Kpi,
  SeletorMes,
  SeletorPeriodo,
  btnPrimario,
  btnSecundario,
  inputBase,
} from "@/components/ui";
import { calcularRecebimento } from "@/lib/dominio/comissao";
import { statusVisualBoleto } from "@/lib/dominio/boletos";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { formatarCompetencia } from "@/lib/dominio/normalizacao";
import { parsePeriodo } from "@/lib/dominio/periodo";
import {
  nivelInadimplencia,
  nivelTaxaRecebimento,
} from "@/lib/dominio/semaforo";
import {
  RE_MES,
  VIAS_PAGAMENTO,
  formatarDataBR,
  recebimentosDoMes,
  recebimentosDoPeriodo,
  mesPadraoRecebimentos,
  fechamentoDoMes,
  mesesFechadosNoPeriodo,
  contratosParaSelecao,
  type RecebimentoComRelacoes,
  type ContratoComRelacoes,
} from "@/lib/consultas/locacao";
import {
  gerarDevidosDoMes,
  registrarRecebimento,
  limparRecebimento,
  excluirRecebimento,
  criarLancamentoAvulso,
  fecharMes,
  reabrirMes,
} from "./actions";

type SearchParams = Promise<ParametrosUnificacao & {
  visao?: string;
  mes?: string;
  de?: string;
  ate?: string;
  emp?: string;
  editar?: string;
  excluir?: string;
  avulso?: string;
  reabrir?: string;
  erro?: string;
  ok?: string;
}>;

const btnPerigo =
  "inline-flex items-center gap-1.5 rounded-md bg-erro px-3 py-1.5 text-sm font-medium text-white hover:bg-erro/85";

const fmtPercentual = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 1,
});

export default async function PaginaRecebimentos({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  if (sp.visao !== "locacao" && !sp.editar && !sp.excluir && !sp.avulso && !sp.reabrir && !sp.erro && !sp.ok && !sp.emp && await podeAcessarUnificacao()) {
    return <OperacaoUnificada dominio="RECEBER" titulo="Contas a receber" base="/recebimentos" parametros={sp} nativo={{ href: `/recebimentos?visao=locacao${sp.mes ? `&mes=${encodeURIComponent(sp.mes)}` : ""}`, rotulo: "Lançamentos de locação" }} />;
  }
  // ?de/?ate válidos ligam o modo PERÍODO (conferência); sem eles, modo mês.
  const periodo = parsePeriodo(sp.de, sp.ate);
  const mes =
    sp.mes && RE_MES.test(sp.mes)
      ? sp.mes
      : ((await mesPadraoRecebimentos()) ?? "2026-01");

  const [recebimentos, fechamento, mesesFechados] = periodo
    ? await Promise.all([
        recebimentosDoPeriodo(periodo.meses),
        null,
        mesesFechadosNoPeriodo(periodo.meses),
      ])
    : await Promise.all([
        recebimentosDoMes(mes),
        fechamentoDoMes(mes),
        new Set<string>(),
      ]);
  const fechado = fechamento !== null;
  // No modo período o travamento é por LINHA: mês fechado trava só as linhas dele.
  const linhaTravada = (r: RecebimentoComRelacoes) =>
    periodo ? mesesFechados.has(r.mesLancamento) : fechado;
  // Coluna "Mês" só quando a janela cobre mais de um mês.
  const comMes = periodo !== null && periodo.meses.length > 1;

  // Filtro por empreendimento (?emp=id)
  const empreendimentos = Array.from(
    new Map(recebimentos.map((r) => [r.empreendimentoId, r.empreendimento])).values()
  ).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const empFiltro = empreendimentos.some((e) => e.id === sp.emp) ? sp.emp : undefined;
  const exibidos = empFiltro
    ? recebimentos.filter((r) => r.empreendimentoId === empFiltro)
    : recebimentos;

  const montarLinha = (r: RecebimentoComRelacoes) => {
    const calc = calcularRecebimento(r);
    return {
      r,
      calc,
      saldoAberto: Math.max((calc.totalDevido ?? 0) - (r.recebido ?? 0), 0),
    };
  };
  const todasLinhas = recebimentos.map(montarLinha);
  const linhas = exibidos.map(montarLinha);
  const totais = linhas.reduce(
    (t, { r, calc }) => {
      t.valor += r.valor;
      t.iptu += r.iptu;
      t.cond += r.cond;
      t.total += calc.totalDevido ?? 0;
      t.recebido += r.recebido ?? 0;
      return t;
    },
    { valor: 0, iptu: 0, cond: 0, total: 0, recebido: 0 }
  );
  const pendentes = todasLinhas.filter(({ saldoAberto }) => saldoAberto > 0).length;

  // Totais da janela para a conferência (respeitam o filtro de empreendimento).
  const pendentesExibidos = linhas.filter(({ saldoAberto }) => saldoAberto > 0);
  const valorPendente = pendentesExibidos.reduce(
    (s, { saldoAberto }) => s + saldoAberto,
    0
  );
  const taxaJanela = totais.total > 0 ? totais.recebido / totais.total : null;
  const nivelTaxaJanela = nivelTaxaRecebimento(taxaJanela);

  const editando = sp.editar
    ? (recebimentos.find((r) => r.id === sp.editar && !linhaTravada(r)) ?? null)
    : null;
  const excluindo = sp.excluir
    ? (recebimentos.find((r) => r.id === sp.excluir && !linhaTravada(r)) ?? null)
    : null;
  const mostrarAvulso = !periodo && !fechado && sp.avulso === "1";
  const confirmarReabrir = !periodo && fechado && sp.reabrir === "1";
  const contratosSelecao = mostrarAvulso ? await contratosParaSelecao() : [];

  const urlBase = (extras?: Record<string, string>) => {
    const p = new URLSearchParams({ visao: "locacao" });
    if (periodo) {
      p.set("de", periodo.de);
      p.set("ate", periodo.ate);
    } else {
      p.set("mes", mes);
    }
    if (empFiltro) p.set("emp", empFiltro);
    for (const [k, v] of Object.entries(extras ?? {})) p.set(k, v);
    return `/recebimentos?${p.toString()}`;
  };

  /** Link do filtro de empreendimento preservando o modo (mês ou período). */
  const urlComFiltro = (empId?: string) => {
    const p = new URLSearchParams({ visao: "locacao" });
    if (periodo) {
      p.set("de", periodo.de);
      p.set("ate", periodo.ate);
    } else {
      p.set("mes", mes);
    }
    if (empId) p.set("emp", empId);
    return `/recebimentos?${p.toString()}`;
  };

  return (
    <div>
      <PageHeader
        titulo="Recebimentos"
        descricao={
          periodo
            ? `Conferência do período ${periodo.rotulo} — ${recebimentos.length} lançamento(s), ${pendentes} pendente(s)`
            : `${recebimentos.length} lançamento(s) em ${formatarCompetencia(mes)} — ${pendentes} pendente(s)`
        }
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/recebimentos?mes=${mes}`} className={btnSecundario}>Visão unificada</Link>
            {periodo === null ? (
              <SeletorMes base="/recebimentos" mes={mes} extras={{ visao: "locacao" }} />
            ) : null}
            <SeletorPeriodo
              base="/recebimentos"
              periodo={periodo}
              extras={{ visao: "locacao", ...(empFiltro ? { emp: empFiltro } : {}) }}
            />
          </div>
        }
      />

      {sp.erro ? (
        <div className="mb-4 rounded-md border border-erro/25 bg-erro/5 px-4 py-2.5 text-sm text-erro">
          {sp.erro}
        </div>
      ) : null}
      {sp.ok ? (
        <div className="mb-4 rounded-md border border-oliva/30 bg-oliva/10 px-4 py-2.5 text-sm text-oliva-escura">
          {sp.ok}
        </div>
      ) : null}

      {/* Modo período: conferência — geração e fechamento ficam na visão mensal */}
      {periodo ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge cor="azul">Conferência</Badge>
          <span className="text-sm text-tinta-suave">
            Você está vendo todos os lançamentos da janela, mês a mês. Dá para
            registrar pagamentos linha a linha; gerar devidos, lançar avulso e
            fechar/reabrir mês só na visão mensal.
          </span>
          <Link href={`/recebimentos?visao=locacao&mes=${mes}`} className={btnSecundario}>
            Abrir visão mensal
          </Link>
        </div>
      ) : null}

      {periodo && mesesFechados.size > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-tinta-suave">
          <Badge cor="vermelho">
            {mesesFechados.size === 1
              ? "1 mês fechado"
              : `${mesesFechados.size} meses fechados`}
          </Badge>
          <span>
            {[...mesesFechados]
              .sort()
              .map((m) => formatarCompetencia(m))
              .join(", ")}{" "}
            — as linhas desses meses estão travadas; para alterar, reabra o mês
            na visão mensal.
          </span>
        </div>
      ) : null}

      {/* Barra de ações do mês — geração e fechamento só existem no modo mês */}
      {periodo === null ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {fechado ? (
            <>
              <Badge cor="vermelho">Mês fechado</Badge>
              <span className="text-sm text-tinta-suave">
                Fechado em {fechamento.fechadoEm.toLocaleDateString("pt-BR")}
              </span>
              <Link href={urlBase({ reabrir: "1" })} className={btnSecundario}>
                Reabrir
              </Link>
            </>
          ) : (
            <>
              <form action={gerarDevidosDoMes}>
                <input type="hidden" name="mes" value={mes} />
                <button type="submit" className={btnSecundario}>
                  Gerar devidos do mês
                </button>
              </form>
              <Link href={urlBase({ avulso: "1" })} className={btnSecundario}>
                Lançamento avulso
              </Link>
              <form action={fecharMes}>
                <input type="hidden" name="mes" value={mes} />
                <button type="submit" className={btnPrimario}>
                  Fechar mês
                </button>
              </form>
            </>
          )}
        </div>
      ) : null}

      {/* Filtro por empreendimento */}
      {empreendimentos.length > 1 ? (
        <div className="mb-4 flex flex-wrap items-center gap-1.5 text-sm">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-tinta-suave">
            Empreendimento:
          </span>
          <Link
            href={urlComFiltro()}
            className={`rounded-full px-2.5 py-0.5 ${!empFiltro ? "bg-tinta text-white" : "bg-[#efeee9] hover:bg-[#e5e1d8]"}`}
          >
            Todos
          </Link>
          {empreendimentos.map((e) => (
            <Link
              key={e.id}
              href={urlComFiltro(e.id)}
              className={`rounded-full px-2.5 py-0.5 ${empFiltro === e.id ? "bg-tinta text-white" : "bg-[#efeee9] hover:bg-[#e5e1d8]"}`}
            >
              {e.nome}
            </Link>
          ))}
        </div>
      ) : null}

      {/* Totais da janela — só no modo período (conferência) */}
      {periodo ? (
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Kpi
            rotulo="Devido no período"
            valor={<Dinheiro centavos={totais.total} />}
            detalhe={`${linhas.length} ${linhas.length === 1 ? "lançamento" : "lançamentos"} em ${periodo.meses.length} ${periodo.meses.length === 1 ? "mês" : "meses"}${empFiltro ? " (filtro ativo)" : ""}`}
            nivel="info"
            selo="total da janela"
            ajuda="Soma de valor + IPTU + condomínio de todos os lançamentos da janela — o que os locatários deviam pagar no total. Se parecer baixo, confira na visão mensal se algum mês ficou sem gerar os devidos."
          />
          <Kpi
            rotulo="Recebido no período"
            valor={<Dinheiro centavos={totais.recebido} />}
            detalhe={
              taxaJanela !== null
                ? `${fmtPercentual.format(taxaJanela)} do devido`
                : "sem cobranças na janela"
            }
            nivel={nivelTaxaJanela}
            nota={
              nivelTaxaJanela === "critico"
                ? "Abaixo de 80% do devido: passe a lista de cobrança ainda hoje."
                : nivelTaxaJanela === "atencao"
                  ? "Entre 80% e 95%: veja quem segue pendente nas linhas em âmbar."
                  : undefined
            }
            ajuda="O que de fato entrou na janela inteira. Pode passar de 100% quando alguém quita atrasos de meses anteriores junto — a Observação da linha conta a história."
          />
          <Kpi
            rotulo="Pendente no período"
            valor={<Dinheiro centavos={valorPendente} />}
            detalhe={`${pendentesExibidos.length} ${pendentesExibidos.length === 1 ? "lançamento com saldo" : "lançamentos com saldo"}`}
            nivel={nivelInadimplencia(valorPendente, totais.total)}
            nota={
              pendentesExibidos.length > 0
                ? "Registre cada pagamento na própria linha; o saldo diminui e zera na quitação."
                : undefined
            }
            ajuda="Cobranças da janela cujo total devido ainda supera o recebido. Pagamentos parciais permanecem em âmbar até a quitação."
          />
        </div>
      ) : null}

      {confirmarReabrir && fechamento ? (
        <Card className="mb-4 border-ambar/40 bg-ambar/10 p-4">
          <p className="text-sm">
            Reabrir <strong>{formatarCompetencia(mes)}</strong>? O fechamento
            será desfeito e os lançamentos voltarão a aceitar alterações.
          </p>
          <div className="mt-3 flex gap-2">
            <form action={reabrirMes}>
              <input type="hidden" name="mes" value={mes} />
              <button type="submit" className={btnPerigo}>
                Confirmar reabertura
              </button>
            </form>
            <Link href={urlBase()} className={btnSecundario}>
              Cancelar
            </Link>
          </div>
        </Card>
      ) : null}

      {excluindo ? (
        <Card className="mb-4 border-erro/30 bg-erro/5 p-4">
          <p className="text-sm">
            Excluir o lançamento de{" "}
            <strong>{excluindo.empreendimento.nome}</strong> —{" "}
            {excluindo.contrato.unidade.identificacao} (
            {excluindo.contrato.locatario?.nome ?? "Desocupado"}), competência{" "}
            {formatarCompetencia(excluindo.competencia)}, valor{" "}
            <Dinheiro centavos={excluindo.valor} />? Esta ação não pode ser
            desfeita.
          </p>
          <div className="mt-3 flex gap-2">
            <form action={excluirRecebimento}>
              <input type="hidden" name="id" value={excluindo.id} />
              <input
                type="hidden"
                name="retorno"
                value={urlBase({ excluir: excluindo.id })}
              />
              <button type="submit" className={btnPerigo}>
                Confirmar exclusão
              </button>
            </form>
            <Link href={urlBase()} className={btnSecundario}>
              Cancelar
            </Link>
          </div>
        </Card>
      ) : null}

      {editando ? (
        <FormRegistrar
          lancamento={editando}
          urlVoltar={urlBase()}
          retorno={urlBase({ editar: editando.id })}
        />
      ) : null}

      {mostrarAvulso ? (
        <FormAvulso mes={mes} contratos={contratosSelecao} urlVoltar={urlBase()} />
      ) : null}

      <Card>
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                {comMes ? (
                  <th>
                    Mês{" "}
                    <Ajuda dica="Mês operacional em que a cobrança foi lançada — a 'aba' a que a linha pertence. No modo período a tabela junta vários meses; esta coluna diz de qual mês cada linha veio." />
                  </th>
                ) : null}
                <th>Empreendimento</th>
                <th>Locatário</th>
                <th>Localização</th>
                <th style={{ textAlign: "right" }}>
                  Valor{" "}
                  <Ajuda dica="Aluguel-base do contrato, sem IPTU nem condomínio." />
                </th>
                <th style={{ textAlign: "right" }}>
                  IPTU{" "}
                  <Ajuda dica="IPTU cobrado junto com o aluguel, incluído no total devido." />
                </th>
                <th style={{ textAlign: "right" }}>
                  Cond.{" "}
                  <Ajuda dica="Condomínio cobrado junto com o aluguel, incluído no total devido." />
                </th>
                <th style={{ textAlign: "right" }}>
                  Total{" "}
                  <Ajuda dica="Total devido = valor + IPTU + condomínio. É o que o locatário deve pagar no mês. Calculado pelo sistema — você não digita." />
                </th>
                <th style={{ textAlign: "right" }}>
                  Recebido{" "}
                  <Ajuda dica="Total acumulado já pago nesta cobrança. Pode ser menor que o devido quando houver parcial/acordo; nesses casos, explique na Observação." />
                </th>
                <th style={{ textAlign: "right" }}>
                  Saldo{" "}
                  <Ajuda dica="Total devido menos o recebido, nunca abaixo de zero. A cobrança permanece pendente enquanto houver saldo." />
                </th>
                <th>
                  Boleto{" "}
                  <Ajuda dica="Situação do título no Sicoob. 'Pagamento informado' ainda aguarda a confirmação de liquidação antes da baixa financeira." />
                </th>
                <th>Data</th>
                <th>
                  Competência{" "}
                  <Ajuda dica="Mês a que o aluguel se refere — pode ser diferente do mês em tela quando é atraso ou adiantamento. Num pagamento atrasado, a competência continua sendo a do mês devido (aparece destacada)." />
                </th>
                <th>
                  Via{" "}
                  <Ajuda dica="Como o dinheiro entrou: BOLETO, PIX, DINHEIRO ou SERVICO (permuta). Sempre preencha ao registrar — pagamentos em dinheiro também vão no registro de espécie do Caixa." />
                </th>
                <th>Observação</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 ? (
                <tr>
                  <td
                    colSpan={comMes ? 16 : 15}
                    className="py-6 text-center text-tinta-suave/60"
                  >
                    {periodo
                      ? `Nenhum lançamento no período ${periodo.rotulo}.`
                      : `Nenhum lançamento em ${formatarCompetencia(mes)}. Use
                    “Gerar devidos do mês” para criar os devidos dos contratos
                    ativos.`}
                  </td>
                </tr>
              ) : (
                linhas.map(({ r, calc, saldoAberto }) => {
                  const boleto = r.boletos[0];
                  const estadoBoleto = boleto ? statusVisualBoleto(boleto.status) : null;
                  return (
                  <tr key={r.id} className={saldoAberto > 0 ? "bg-ambar/5" : ""}>
                    {comMes ? (
                      <td className="font-mono text-[12px]">
                        {formatarCompetencia(r.mesLancamento)}
                      </td>
                    ) : null}
                    <td>{r.empreendimento.nome}</td>
                    <td>
                      {r.contrato.locatario?.nome ?? (
                        <span className="text-tinta-suave/60">Desocupado</span>
                      )}{" "}
                      {r.origemAgregada ? <Badge cor="azul">Agregado</Badge> : null}
                    </td>
                    <td>{r.contrato.unidade.identificacao}</td>
                    <td className="text-right"><Dinheiro centavos={r.valor} /></td>
                    <td className="text-right"><Dinheiro centavos={r.iptu} /></td>
                    <td className="text-right"><Dinheiro centavos={r.cond} /></td>
                    <td className="text-right"><Dinheiro centavos={calc.totalDevido} /></td>
                    <td className="text-right">
                      {r.recebido === null ? (
                        <Badge cor="ambar">Pendente</Badge>
                      ) : (
                        <span className="inline-flex items-center justify-end gap-1.5">
                          <Dinheiro centavos={r.recebido} destaque />
                          {saldoAberto > 0 ? <Badge cor="ambar">Parcial</Badge> : null}
                        </span>
                      )}
                    </td>
                    <td className="text-right">
                      <Dinheiro centavos={saldoAberto} destaque={saldoAberto > 0} />
                    </td>
                    <td>
                      {boleto && estadoBoleto ? (
                        <Link href={`/financeiro/boletos?mes=${r.mesLancamento}&boleto=${boleto.id}`}>
                          <Badge nivel={estadoBoleto.nivel}>{estadoBoleto.rotulo}</Badge>
                        </Link>
                      ) : r.recebido === null && !r.origemAgregada ? (
                        <Link href={`/financeiro/boletos?mes=${r.mesLancamento}`} className="text-[11px] font-semibold text-oliva-escura hover:underline">
                          A emitir
                        </Link>
                      ) : (
                        <span className="text-tinta-suave">—</span>
                      )}
                    </td>
                    <td>{formatarDataBR(r.dataPagamento)}</td>
                    <td>
                      {r.competencia === r.mesLancamento ? (
                        formatarCompetencia(r.competencia)
                      ) : (
                        <Badge cor="ambar">{formatarCompetencia(r.competencia)}</Badge>
                      )}
                    </td>
                    <td>{r.via ?? "—"}</td>
                    <td className="max-w-48 truncate" title={r.observacao ?? undefined}>
                      {r.observacao ?? "—"}
                    </td>
                    <td>
                      {!linhaTravada(r) ? (
                        <span className="flex gap-2 text-xs">
                          <Link
                            href={urlBase({ editar: r.id })}
                            className="font-semibold text-oliva-escura hover:underline"
                          >
                            {r.recebido === null ? "Registrar" : "Editar"}
                          </Link>
                          <Link
                            href={urlBase({ excluir: r.id })}
                            className="text-erro hover:underline"
                          >
                            Excluir
                          </Link>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
            {linhas.length > 0 ? (
              <tfoot>
                <tr>
                  <td colSpan={comMes ? 4 : 3}>
                    Totais{" "}
                    {empFiltro
                      ? "(empreendimento filtrado)"
                      : periodo
                        ? "do período"
                        : "do mês"}
                  </td>
                  <td className="text-right"><Dinheiro centavos={totais.valor} /></td>
                  <td className="text-right"><Dinheiro centavos={totais.iptu} /></td>
                  <td className="text-right"><Dinheiro centavos={totais.cond} /></td>
                  <td className="text-right"><Dinheiro centavos={totais.total} /></td>
                  <td className="text-right"><Dinheiro centavos={totais.recebido} /></td>
                  <td className="text-right"><Dinheiro centavos={valorPendente} destaque /></td>
                  <td></td>
                  <td colSpan={5}></td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </Card>
    </div>
  );
}

/** Form de registro/edição de recebimento de uma linha (server-side, sem JS). */
function FormRegistrar({
  lancamento,
  urlVoltar,
  retorno,
}: {
  lancamento: RecebimentoComRelacoes;
  urlVoltar: string;
  /** URL desta visão (com período/filtro) — a action volta para cá */
  retorno: string;
}) {
  const calc = calcularRecebimento(lancamento);
  const sugerido = lancamento.recebido ?? calc.totalDevido;
  return (
    <Card className="mb-4 p-4">
      <h2 className="mb-1 text-sm font-semibold">
        {lancamento.recebido === null ? "Registrar recebimento" : "Editar recebimento"} —{" "}
        {lancamento.empreendimento.nome} · {lancamento.contrato.unidade.identificacao} ·{" "}
        {lancamento.contrato.locatario?.nome ?? "Desocupado"}
      </h2>
      <p className="mb-3 text-xs text-tinta-suave">
        Total devido: {formatarBRL(calc.totalDevido)} (valor {formatarBRL(lancamento.valor)}
        {" + "}IPTU {formatarBRL(lancamento.iptu)} + cond. {formatarBRL(lancamento.cond)})
        — IPTU e condomínio compõem o total devido.
      </p>
      <form action={registrarRecebimento} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="id" value={lancamento.id} />
        <input type="hidden" name="retorno" value={retorno} />
        <label className="block text-xs font-medium text-tinta-suave">
          Recebido
          <input
            name="recebido"
            defaultValue={sugerido !== null ? formatarBRL(sugerido) : ""}
            placeholder="1.234,56"
            className={`${inputBase} mt-1 block w-32`}
            required
          />
        </label>
        <label className="block text-xs font-medium text-tinta-suave">
          Data do pagamento
          <input
            type="date"
            name="dataPagamento"
            defaultValue={lancamento.dataPagamento ?? ""}
            className={`${inputBase} mt-1 block`}
          />
        </label>
        <label className="block text-xs font-medium text-tinta-suave">
          Competência
          <input
            type="month"
            name="competencia"
            defaultValue={lancamento.competencia}
            className={`${inputBase} mt-1 block`}
          />
        </label>
        <label className="block text-xs font-medium text-tinta-suave">
          Via
          <select name="via" defaultValue={lancamento.via ?? ""} className={`${inputBase} mt-1 block`}>
            <option value="">—</option>
            {VIAS_PAGAMENTO.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="block grow text-xs font-medium text-tinta-suave">
          Observação
          <input
            name="observacao"
            defaultValue={lancamento.observacao ?? ""}
            className={`${inputBase} mt-1 block w-full`}
          />
        </label>
        <button type="submit" className={btnPrimario}>Salvar</button>
        <Link href={urlVoltar} className={btnSecundario}>Cancelar</Link>
      </form>
      {lancamento.recebido !== null ? (
        <form action={limparRecebimento} className="mt-3">
          <input type="hidden" name="id" value={lancamento.id} />
          <input type="hidden" name="retorno" value={retorno} />
          <button type="submit" className="text-xs text-erro hover:underline">
            Limpar recebimento (voltar a pendente)
          </button>
        </form>
      ) : null}
    </Card>
  );
}

/** Form de lançamento avulso (atrasos/adiantamentos: competência editável). */
function FormAvulso({
  mes,
  contratos,
  urlVoltar,
}: {
  mes: string;
  contratos: ContratoComRelacoes[];
  urlVoltar: string;
}) {
  const grupos = new Map<string, ContratoComRelacoes[]>();
  for (const c of contratos) {
    const nome = c.unidade.empreendimento.nome;
    const lista = grupos.get(nome) ?? [];
    lista.push(c);
    grupos.set(nome, lista);
  }
  return (
    <Card className="mb-4 p-4">
      <h2 className="mb-1 text-sm font-semibold">
        Lançamento avulso em {formatarCompetencia(mes)}
      </h2>
      <p className="mb-3 text-xs text-tinta-suave">
        Para atrasos, a competência pode ser um mês anterior ao lançamento.
        Valor/IPTU/Cond. em branco herdam os valores do contrato.
      </p>
      <form action={criarLancamentoAvulso} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="mes" value={mes} />
        <label className="block text-xs font-medium text-tinta-suave">
          Contrato
          <select name="contratoId" className={`${inputBase} mt-1 block max-w-96`} required defaultValue="">
            <option value="" disabled>— selecione —</option>
            {Array.from(grupos.entries()).map(([nome, lista]) => (
              <optgroup key={nome} label={nome}>
                {lista.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.unidade.identificacao} — {c.locatario?.nome ?? "Desocupado"}
                    {c.status !== "ativo" ? ` (${c.status})` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-tinta-suave">
          Competência
          <input type="month" name="competencia" defaultValue={mes} className={`${inputBase} mt-1 block`} />
        </label>
        <label className="block text-xs font-medium text-tinta-suave">
          Valor
          <input name="valor" placeholder="do contrato" className={`${inputBase} mt-1 block w-28`} />
        </label>
        <label className="block text-xs font-medium text-tinta-suave">
          IPTU
          <input name="iptu" placeholder="do contrato" className={`${inputBase} mt-1 block w-24`} />
        </label>
        <label className="block text-xs font-medium text-tinta-suave">
          Cond.
          <input name="cond" placeholder="do contrato" className={`${inputBase} mt-1 block w-24`} />
        </label>
        <label className="block text-xs font-medium text-tinta-suave">
          Recebido (opcional)
          <input name="recebido" placeholder="pendente" className={`${inputBase} mt-1 block w-28`} />
        </label>
        <label className="block text-xs font-medium text-tinta-suave">
          Data do pagamento
          <input type="date" name="dataPagamento" className={`${inputBase} mt-1 block`} />
        </label>
        <label className="block text-xs font-medium text-tinta-suave">
          Via
          <select name="via" defaultValue="" className={`${inputBase} mt-1 block`}>
            <option value="">—</option>
            {VIAS_PAGAMENTO.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="block grow text-xs font-medium text-tinta-suave">
          Observação
          <input name="observacao" className={`${inputBase} mt-1 block w-full`} />
        </label>
        <button type="submit" className={btnPrimario}>Criar lançamento</button>
        <Link href={urlVoltar} className={btnSecundario}>Cancelar</Link>
      </form>
    </Card>
  );
}
