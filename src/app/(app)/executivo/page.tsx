import { acessoAtual, exigirPaginaAcesso } from "@/lib/acesso/servidor";
import { pode, podeAbrirRota } from "@/lib/acesso/politica";
import { operacaoNaRequisicao } from "@/lib/consultas/operacao-na-requisicao";
import { chavesRestritasUnificacao } from "@/lib/unificacao/privacidade";
import { consolidarExecutivo, mesPadraoConsolidado } from "@/lib/unificacao/executivo-consolidado";
import { calcularApuracao, dadosTemporadaDoPeriodo } from "@/lib/consultas/temporada";
import { prisma } from "@/lib/db";
import Link from "next/link";
import {
  Ajuda,
  Card,
  Dinheiro,
  Kpi,
  LinkCard,
  PageHeader,
  PainelAlertas,
  Ponto,
  Selo,
  SeletorMes,
  SeletorPeriodo,
  TituloCard,
  Variacao,
  type ItemAlerta,
} from "@/components/ui";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import {
  formatarCompetencia,
  NOME_MES_COMPLETO,
  parseCompetencia,
} from "@/lib/dominio/normalizacao";
import { hojeISO, mesesEntre, parsePeriodo, rotulosCompetencias } from "@/lib/dominio/periodo";
import {
  nivelAtraso,
  nivelInadimplencia,
  nivelSaldo,
  nivelTarefas,
  nivelTaxaRecebimento,
  nivelVariacao,
  type Nivel,
} from "@/lib/dominio/semaforo";
import { contratosAReajustarDoPeriodo } from "@/lib/consultas/relatorios";
import {
  BarraComposicao,
  BarrasDuplas,
  BarrasHorizontais,
  COR_1,
  COR_2,
} from "@/components/graficos";
import {
  FluxoCaixaInterativo,
  SinaisVitais,
} from "@/components/graficos-interativos";

export const dynamic = "force-dynamic";

function pct(v: number | null): string {
  if (v === null) return "—";
  return `${(v * 100).toFixed(1).replace(".", ",")}%`;
}

export default async function PaginaExecutivo({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; de?: string; ate?: string }>;
}) {
  await exigirPaginaAcesso("/executivo");
  const sp = await searchParams;
  const periodo = parsePeriodo(sp.de, sp.ate);
  const [operacao, acesso] = await Promise.all([operacaoNaRequisicao(), acessoAtual()]);
  const restritas = pode(acesso, "comissoes.ver") ? new Set<string>() : chavesRestritasUnificacao(operacao.fontes, operacao.decisoes);
  const linhas = operacao.linhas.filter(l => !restritas.has(l.chave));
  const hoje = hojeISO();
  const mes = periodo?.meses[0] ?? (sp.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) ? sp.mes : mesPadraoConsolidado(linhas, hoje));
  const { ano, mes: mesNum } = parseCompetencia(mes);
  const nomeMes = NOME_MES_COMPLETO[mesNum].toLowerCase();
  const meses = periodo?.meses ?? [mes];
  const mesesSerie = periodo?.meses ?? mesesEntre(`${ano}-01`, `${ano}-12`);
  const rotulos = rotulosCompetencias(mesesSerie);
  const consolidado = consolidarExecutivo(linhas, mesesSerie, meses, hoje);
  const [temporada, reajustes, fechamento] = await Promise.all([
    dadosTemporadaDoPeriodo(meses),
    contratosAReajustarDoPeriodo(meses),
    periodo ? null : prisma.fechamentoMensal.findUnique({ where: { mesLancamento: mes }, select: { id: true } }),
  ]);
  const apuracao = calcularApuracao(temporada);
  const temTemporada = temporada.limpezas.length + temporada.recebimentos.length + temporada.despesas.length > 0;
  const vm = {
    ...consolidado,
    naJanela: periodo ? "no período" : `em ${nomeMes}`,
    lucroTemporada: temTemporada ? apuracao.lucro : null,
    temporadaDetalhe: temTemporada ? `entrou ${formatarBRL(apuracao.receita)}, gastou ${formatarBRL(apuracao.despesa)}` : "Sem lançamentos de temporada",
    reajustes: reajustes.map(r => ({ empreendimento: r.empreendimento, localizacao: r.identificacao, locatario: r.locatario ?? "Desocupado", valorBase: r.valorBase })),
    rotulos,
    serieDevido: consolidado.serie.map(m => m.devido),
    serieRecebido: consolidado.serie.map(m => m.recebido),
    linhasSerie: consolidado.serie.map((m, i) => ({ ...m, rotulo: rotulos[i] })),
    caixaLinhas: consolidado.serie.map((m, i) => ({ ...m.caixa, rotulo: rotulos[i] })),
    comMesNaTabela: meses.length > 1,
  };
  const mesAnterior = !periodo && mesNum > 1 ? consolidado.serie[mesNum - 2] : null;
  const caixaAnterior = mesAnterior?.caixa;
  const qs = periodo ? `de=${periodo.de}&ate=${periodo.ate}` : `mes=${mes}`;
  // O seletor do Executivo usa meses inteiros. Os links financeiros aplicam
  // essa mesma janela às listas, que também aceitam filtros de dias exatos.
  const ultimo = parseCompetencia(meses[meses.length - 1]);
  const ultimoDia = new Date(Date.UTC(ultimo.ano, ultimo.mes, 0)).getUTCDate();
  const qsFinanceiro = periodo ? `de=${meses[0]}-01&ate=${meses[meses.length - 1]}-${ultimoDia}` : qs;
  const perfilFinanceiro = acesso.perfil === "ADMINISTRADOR" || acesso.perfil === "FINANCEIRO";
  const podeVerTitulos = perfilFinanceiro && podeAbrirRota(acesso, "/financeiro/contas-a-receber");
  const podeVerMovimentos = perfilFinanceiro && podeAbrirRota(acesso, "/financeiro/movimentacoes");
  // Distribuição dos recebimentos por empreendimento.
  const empOrdenados = vm.porEmp
    .filter((e) => e.recebido > 0 && e.nome !== "Sem empreendimento identificado")
    .sort((a, b) => b.recebido - a.recebido);
  const rankingRecebido = empOrdenados.slice(0, 6).map((e) => ({ rotulo: e.nome, valor: e.recebido }));

  // ---- instrumentos derivados (nenhum dado novo: só outras leituras) --------

  /** Concentração: fatia do maior empreendimento nos recebimentos. */
  const concentracao =
    vm.recebido > 0 && empOrdenados.length > 0
      ? empOrdenados[0].recebido / vm.recebido
      : 0;

  /** Desempenho da janela contra o melhor mês da série (100% = é o melhor). */
  const melhorMes = Math.max(...vm.serieRecebido, 0);
  const referenciaRecebido = periodo
    ? vm.recebido / Math.max(1, periodo.meses.length)
    : vm.recebido;
  const vsMelhor = melhorMes > 0 ? referenciaRecebido / melhorMes : 0;

  // ---- semáforos -----------------------------------------------------------
  const nvTaxa = nivelTaxaRecebimento(vm.taxa);
  const nvInad = nivelInadimplencia(vm.inadValor, vm.devido);
  const nvCaixa: Nivel = vm.temCaixa ? nivelSaldo(vm.saldoCaixa) : "neutro";
  const nvReaj = nivelTarefas(
    vm.reajustes.length,
    periodo ? 8 * Math.max(1, periodo.meses.length / 2) : 8
  );
  const nvTemporada: Nivel =
    vm.lucroTemporada === null
      ? "neutro"
      : vm.lucroTemporada > 0
        ? "otimo"
        : vm.lucroTemporada < 0
          ? "critico"
          : "neutro";
  const gravesQtde = vm.pendentes.filter(
    (p) => p.diasAtraso !== null && p.diasAtraso > 30
  ).length;

  const alertas: ItemAlerta[] = [];
  if (gravesQtde > 0) {
    alertas.push({
      nivel: "critico",
      titulo: "Cobranças acima de 30 dias",
      texto: `${gravesQtde} ${gravesQtde === 1 ? "cobrança passou" : "cobranças passaram"} de 30 dias do vencimento ${vm.naJanela}. Essas encabeçam a lista de hoje.`,
      acao: podeVerTitulos ? { rotulo: "Conferir cobranças", href: `/financeiro/contas-a-receber?${qsFinanceiro}&vencidos=1` } : undefined,
    });
  }
  if (nvTaxa !== "otimo" && vm.taxa !== null) {
    alertas.push({
      nivel: nvTaxa,
      titulo: "Taxa de recebimento abaixo de 95%",
      texto: `Entrou ${pct(vm.taxa)} do devido — ${formatarBRL(vm.recebido)} de ${formatarBRL(vm.devido)}. A diferença está nos ${vm.inadQtde} pendentes listados abaixo.`,
      acao: podeVerTitulos ? { rotulo: "Contas a receber", href: `/financeiro/contas-a-receber?${qsFinanceiro}` } : undefined,
    });
  }
  if (vm.reajustes.length > 0) {
    alertas.push({
      nivel: nvReaj,
      titulo: "Reajustes para aplicar",
      texto: `${vm.reajustes.length} ${vm.reajustes.length === 1 ? "contrato faz" : "contratos fazem"} aniversário de correção ${vm.naJanela}. Aplique o índice e atualize o aluguel-base.`,
      acao: { rotulo: "Abrir contratos", href: "/contratos" },
    });
  }
  if (vm.temCaixa && vm.saldoCaixa < 0) {
    alertas.push({
      nivel: "critico",
      titulo: periodo ? "Caixa negativo no período" : "Caixa negativo no mês",
      texto: `Saíram ${formatarBRL(Math.abs(vm.saldoCaixa))} a mais do que entraram ${vm.naJanela}. Verifique os centros de custo antes de fechar.`,
      acao: podeVerMovimentos ? { rotulo: "Ver movimentos", href: `/financeiro/movimentacoes?${qsFinanceiro}` } : undefined,
    });
  }
  if (!periodo && !fechamento) {
    alertas.push({
      nivel: "info",
      titulo: "Mês ainda aberto",
      texto: `${NOME_MES_COMPLETO[mesNum]} continua recebendo lançamentos, então os números desta tela ainda vão mudar.`,
    });
  }

  return (
    <div className="max-w-7xl">
      <PageHeader
        titulo="Dashboard executivo"
        descricao={`Todos os indicadores da operação — ${periodo ? periodo.rotulo : `${NOME_MES_COMPLETO[mesNum]} de ${ano}`}`}
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            {periodo ? (
              <Selo nivel="info">análise por período</Selo>
            ) : fechamento ? (
              <Selo nivel="otimo">locações fechadas</Selo>
            ) : (
              <Selo nivel="info">mês aberto</Selo>
            )}
            {!periodo ? <SeletorMes base="/executivo" mes={mes} /> : null}
            <SeletorPeriodo base="/executivo" periodo={periodo} />
          </div>
        }
      />

      <aside aria-label="Origem dos indicadores" className="mb-4 rounded-xl border border-contorno bg-carta px-5 py-3 text-sm">
        <strong>Financeiro consolidado · Brisa, planilhas e Widesys.</strong>{" "}
        O Widesys participa desta janela com {vm.origens.WIDESYS.receber} títulos a receber, {vm.origens.WIDESYS.pagar} a pagar e {vm.origens.WIDESYS.movimentos} movimentos de caixa.{" "}
        <a href="#composicao-por-origem" className="font-semibold text-oliva-escura underline underline-offset-4">Ver valores por origem</a>
      </aside>
      {/* ---------- resumo da janela em linguagem natural ---------- */}
      <Card className="mb-4 px-6 py-4" nivel={nvTaxa}>
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-tinta-suave">
          {periodo ? "O período em uma frase" : "O mês em uma frase"}
          <Ajuda
            dica={`A leitura ${periodo ? "do período" : "do mês"} em português: quanto entrou, o que ficou pendente e o que está na sua mesa. A cor da faixa lateral representa a taxa de recebimento.`}
          />
        </div>
        <p className="text-sm leading-relaxed text-tinta">
          {periodo ? (
            <>
              No <strong>período</strong> selecionado, entraram{" "}
            </>
          ) : (
            <>
              Em <strong>{nomeMes}</strong>, entraram{" "}
            </>
          )}
          <strong>{formatarBRL(vm.recebido)}</strong> nos títulos a receber.{" "}
          {vm.inadQtde > 0 ? (
            <>
              <strong>{vm.inadQtde} cobrança(s)</strong> somando{" "}
              <strong>{formatarBRL(vm.inadValor)}</strong> ainda não foram
              pagas
            </>
          ) : (
            <>{vm.origens.WIDESYS.receber + vm.origens.BRISA.receber > 0 ? "Os títulos da janela estão quitados" : "Nenhum título a receber contabilizado na janela"}</>
          )}
          {vm.reajustes.length > 0 ? (
            <>
              {" "}e <strong>{vm.reajustes.length} contrato(s)</strong>{" "}
              fazem aniversário de reajuste.
            </>
          ) : (
            <>.</>
          )}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {vm.taxa !== null ? (
            <Selo nivel={nvTaxa}>recebemos {pct(vm.taxa)} do devido</Selo>
          ) : null}
          {vm.temCaixa ? (
            <Selo nivel={nvCaixa}>
              caixa {vm.saldoCaixa >= 0 ? "positivo" : "negativo"}{" "}
              {periodo ? "no período" : "no mês"}
            </Selo>
          ) : null}
          {vm.reajustes.length > 0 ? (
            <Selo nivel={nvReaj}>
              {vm.reajustes.length} reajuste(s) para aplicar
            </Selo>
          ) : null}
          {vm.inadQtde > 0 ? (
            <Selo nivel={nvInad}>{vm.inadQtde} cobrança(s) em aberto</Selo>
          ) : (
            <Selo nivel="otimo">nenhuma cobrança em aberto</Selo>
          )}
        </div>
      </Card>

      <PainelAlertas
        itens={alertas}
        ajuda={`Fila de atenção ${periodo ? "do período" : "do mês"}, do mais urgente para o menos. Cada linha diz o que aconteceu, o que fazer e leva direto para a tela certa.`}
        vazio={
          periodo
            ? "O período está em dia — nada pendente de cobrança, caixa positivo e nenhum reajuste a aplicar."
            : `${NOME_MES_COMPLETO[mesNum]} está fechado e em dia — nada pendente de cobrança, caixa positivo e nenhum reajuste a aplicar.`
        }
      />

      {/* ---------- KPIs ---------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo={periodo ? "Recebido no período" : "Recebido no mês"}
          valor={<Dinheiro centavos={vm.recebido} destaque />}
          variacao={
            !periodo ? (
              <Variacao
                atual={vm.recebido}
                anterior={mesAnterior?.recebido ?? null}
              />
            ) : undefined
          }
          detalhe="pagamentos dos títulos da competência"
          nivel={periodo ? "info" : nivelVariacao(vm.recebido, mesAnterior?.recebido ?? null)}
          href={podeVerTitulos ? `/financeiro/contas-a-receber?${qsFinanceiro}` : undefined}
          ajuda="Valor pago dos títulos incluídos na janela pela competência. Consulte as entradas de caixa pela data da movimentação."
        />
        <Kpi
          rotulo={periodo ? "Devido no período" : "Devido no mês"}
          valor={<Dinheiro centavos={vm.devido} destaque />}
          detalhe="títulos a receber incluídos na soma"
          nivel="info"
          href={podeVerTitulos ? `/financeiro/contas-a-receber?${qsFinanceiro}` : undefined}
          ajuda="Valor devido nos títulos a receber do Brisa, das planilhas e do Widesys na janela selecionada."
        />
        <Kpi
          rotulo="Taxa de recebimento"
          valor={pct(vm.taxa)}
          detalhe={`entrou ${formatarBRL(vm.recebido)} de ${formatarBRL(vm.devido)} devidos (acima de 100% = atrasos quitados)`}
          nivel={nvTaxa}
          nota={
            nvTaxa === "critico"
              ? "Abaixo de 80% do devido: a lista de cobrança é a prioridade do dia."
              : nvTaxa === "atencao"
                ? "Entre 80% e 95%: falta pouco — veja quem ainda não pagou."
                : undefined
          }
          grafico={
            vm.devido > 0 ? (
              <BarraComposicao
                partes={[
                  { rotulo: "recebido", valor: vm.recebido, cor: COR_1 },
                  {
                    rotulo: "a receber",
                    valor: Math.max(vm.devido - vm.recebido, 0),
                    cor: COR_2,
                  },
                ]}
              />
            ) : undefined
          }
          ajuda={`Total recebido dividido pelo total devido ${periodo ? "do período" : "do mês"}. Acima de 100% é bom sinal: alguém quitou atrasos de meses anteriores. Bem abaixo de 100%, veja a lista de pendentes e cobre.`}
        />
        <Kpi
          rotulo="Saldo a receber"
          valor={<Dinheiro centavos={vm.inadValor} destaque />}
          variacao={
            !periodo ? (
              <Variacao
                atual={vm.inadValor}
                anterior={mesAnterior?.pendenteValor ?? null}
                bomQuandoSobe={false}
              />
            ) : undefined
          }
          detalhe={`${vm.inadQtde} cobrança(s) com saldo aberto`}
          nivel={nvInad}
          nota={
            gravesQtde > 0
              ? `${gravesQtde} ${gravesQtde === 1 ? "cobrança já passou" : "cobranças já passaram"} de 30 dias — comece por elas.`
              : undefined
          }
          href={podeVerTitulos ? `/financeiro/contas-a-receber?${qsFinanceiro}` : undefined}
          ajuda={`Saldo das cobranças ${periodo ? "da janela" : "do mês"} após descontar o que já foi recebido. Registre pagamentos parciais com data e via; a pendência só some na quitação.`}
        />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi
          rotulo={periodo ? "Saldo de caixa no período" : "Saldo de caixa do mês"}
          valor={<Dinheiro centavos={vm.saldoCaixa} destaque />}
          variacao={
            !periodo && vm.temCaixa ? (
              <Variacao
                atual={vm.saldoCaixa}
                anterior={caixaAnterior?.saldo ?? null}
              />
            ) : undefined
          }
          detalhe={
            vm.temCaixa
              ? `entrou ${formatarBRL(vm.caixaReceita)}, saiu ${formatarBRL(vm.caixaDespesa)}`
              : periodo
                ? "sem lançamentos no período"
                : "sem lançamentos no mês"
          }
          nivel={nvCaixa}
          selo={
            !vm.temCaixa
              ? undefined
              : vm.saldoCaixa >= 0
                ? "positivo"
                : "negativo"
          }
          nota={
            vm.temCaixa && vm.saldoCaixa < 0
              ? "Saiu mais do que entrou — confira os centros de custo dos lançamentos."
              : undefined
          }
          href={podeVerMovimentos ? `/financeiro/movimentacoes?${qsFinanceiro}` : undefined}
          ajuda="Entradas menos saídas dos movimentos incluídos na base unificada. Transferências e registros informativos de espécie ficam fora do saldo."
        />
        <Kpi
          rotulo="Lucro de temporada"
          valor={
            vm.lucroTemporada !== null ? (
              <Dinheiro centavos={vm.lucroTemporada} destaque />
            ) : (
              "—"
            )
          }
          detalhe={vm.temporadaDetalhe}
          nivel={nvTemporada}
          selo={
            vm.lucroTemporada === null
              ? undefined
              : vm.lucroTemporada > 0
                ? "no azul"
                : vm.lucroTemporada < 0
                  ? "no vermelho"
                  : undefined
          }
          nota={
            vm.lucroTemporada !== null && vm.lucroTemporada < 0
              ? "Despesas e limpezas passaram do que as plataformas repassaram."
              : undefined
          }
          href={`/temporada?${qs}`}
          ajuda={`Repasses do Airbnb menos despesas (energia, condomínio, IPTU, extras) e limpezas ${periodo ? "da janela" : "do mês"}, lançados na tela Temporada. A receita deve conciliar com a linha AIRBNB do núcleo de recebimentos.`}
        />
        <Kpi
          rotulo="Contratos a reajustar"
          valor={String(vm.reajustes.length)}
          detalhe={
            periodo
              ? "aluguéis com aniversário dentro do período — hora de corrigir o valor"
              : `aluguéis com aniversário em ${nomeMes} — hora de corrigir o valor`
          }
          nivel={nvReaj}
          selo={vm.reajustes.length === 0 ? "nada a fazer" : "na sua mesa"}
          nota={
            vm.reajustes.length > 0
              ? "O sistema avisa, mas quem aplica o índice e atualiza o aluguel é você."
              : undefined
          }
          href={vm.reajustes.length > 0 ? "/contratos" : undefined}
          ajuda={
            periodo
              ? "Contratos cujo aniversário de reajuste cai em algum mês da janela. Aplique o índice combinado (IGP-M, IPCA...) e atualize o valor em Contratos — o sistema avisa, mas não reajusta sozinho."
              : "Contratos cujo mês de reajuste é o mês em tela. Aplique o índice combinado (IGP-M, IPCA...) e atualize o valor em Contratos — o sistema avisa, mas não reajusta sozinho."
          }
        />
      </div>

      <Card className="mt-4 p-5">
        <div id="composicao-por-origem" className="scroll-mt-20" />
        <TituloCard titulo="Composição por origem" ajuda="Cada lançamento entra pela sua origem principal. As baixas detalhadas já estão no valor pago dos títulos. Entradas e saídas vêm dos movimentos de caixa." />
        <div className="grid gap-4 lg:grid-cols-2">
          {(["WIDESYS", "BRISA"] as const).map(origem => {
            const r = vm.origens[origem];
            return <section key={origem} className="min-w-0 rounded-lg border border-contorno p-4">
              <h3 className="mb-3 text-sm font-bold">{origem === "WIDESYS" ? "Widesys" : "Brisa e planilhas"}</h3>
              <dl className="space-y-3 text-xs">
                <div><dt className="font-semibold">{r.receber} títulos a receber</dt><dd>Devido <Dinheiro centavos={r.devido} /> · Recebido <Dinheiro centavos={r.recebido} /></dd></div>
                <div><dt className="font-semibold">{r.pagar} títulos a pagar</dt><dd>Devido <Dinheiro centavos={r.despesa} /> · Pago <Dinheiro centavos={r.pago} /></dd></div>
                <div><dt className="font-semibold">{r.movimentos} movimentos de caixa</dt><dd>Entradas <Dinheiro centavos={r.entradas} /> · Saídas <Dinheiro centavos={r.saidas} /></dd></div>
              </dl>
              {(r.vinculados + r.conciliar + r.inconsistentes > 0) && <p className="mt-3 border-t border-contorno pt-3 text-xs leading-relaxed text-tinta-suave">
                {r.vinculados > 0 && <>{r.vinculados} já representado(s) pelo principal. </>}
                {r.conferidosNaOrigemAConciliar > 0 && <>{r.conferidosNaOrigemAConciliar} conferido(s) no Widesys aguardam conciliação com o Brisa ou as planilhas, fora da soma. </>}
                {r.conciliar > r.conferidosNaOrigemAConciliar && <>{r.conciliar - r.conferidosNaOrigemAConciliar} aguardando conferência, fora da soma. </>}
                {r.inconsistentes > 0 && <>{r.inconsistentes} com inconsistência de importação.</>}
              </p>}
            </section>;
          })}
        </div>
        {podeVerTitulos && <div className="mt-4 flex flex-wrap gap-4 text-xs font-semibold text-oliva-escura">
          <Link href={`/financeiro/contas-a-receber?${qsFinanceiro}&origem=WIDESYS`}>Ver contas a receber do Widesys →</Link>
          <Link href={`/financeiro/contas-a-pagar?${qsFinanceiro}&origem=WIDESYS`}>Ver contas a pagar do Widesys →</Link>
        </div>}
      </Card>

      {/* ---------- cockpit visual: comparação primeiro, detalhe depois ---------- */}
      <section className="mt-6">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#6d8285]">
              Análise visual
            </p>
            <h2 className="mt-1 font-serif text-[23px] font-semibold tracking-[-0.025em] text-tinta">
              O pulso da operação
            </h2>
          </div>
          <p className="max-w-xl text-xs leading-relaxed text-tinta-suave sm:text-right">
            Compare receita, cobrança e resultado sem trocar de contexto. Toque nas séries para isolar o que importa.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 min-[1180px]:grid-cols-12">
          <Card className="p-5 min-[1180px]:col-span-8">
            <TituloCard
              titulo={periodo ? `Fluxo financeiro — ${periodo.rotulo}` : `Fluxo financeiro de ${ano}`}
              ajuda="Compare os valores devidos e os pagamentos registrados mês a mês. Passe o cursor para conferir os valores."
              direita={
                <span className="rounded-full border border-[#d7e2e3] bg-[#f5f8f8] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.11em] text-[#557074]">
                  interativo
                </span>
              }
            />
            <BarrasDuplas
              serieA={vm.serieDevido}
              serieB={vm.serieRecebido}
              nomeA="Devido"
              nomeB="Recebido"
              corA={COR_2}
              corB={COR_1}
              rotulos={vm.rotulos}
            />
            <details className="mt-2 text-xs text-tinta-suave">
              <summary className="cursor-pointer select-none">Ver dados do gráfico</summary>
              <div className="mt-2 tabela-scroll overflow-x-auto" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}>
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Mês</th>
                      <th className="text-right">Devido</th>
                      <th className="text-right">Recebido</th>
                      <th className="text-right">Pendentes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vm.linhasSerie.map((linha) => (
                      <tr key={linha.rotulo}>
                        <td>{linha.rotulo}</td>
                        <td className="text-right"><Dinheiro centavos={linha.devido} /></td>
                        <td className="text-right"><Dinheiro centavos={linha.recebido} /></td>
                        <td className="text-right">{linha.pendentes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Card>

          <Card className="p-5 min-[1180px]:col-span-4">
            <TituloCard
              titulo="Sinais vitais"
              ajuda="Eficiência de recebimento, participação do maior empreendimento e comparação com o melhor mês de pagamentos."
            />
            <SinaisVitais
              itens={[
                {
                  rotulo: "Do devido já entrou",
                  valor: vm.taxa ?? 0,
                  texto: vm.taxa !== null ? `${(vm.taxa * 100).toFixed(0)}%` : "—",
                  nivel: nvTaxa,
                  detalhe: `${formatarBRL(vm.recebido)} de ${formatarBRL(vm.devido)} recebidos`,
                },
                {
                  rotulo: "Vem do maior empreendimento",
                  valor: concentracao,
                  texto: `${(concentracao * 100).toFixed(0)}%`,
                  nivel: concentracao >= 0.5 ? "atencao" : "info",
                  detalhe: empOrdenados[0]
                    ? `${empOrdenados[0].nome} lidera a composição`
                    : vm.recebido > 0 ? "Empreendimento a identificar" : "Sem pagamentos nesta janela",
                },
                {
                  rotulo: periodo ? "Média frente ao melhor mês" : "Do melhor mês da série",
                  valor: Math.min(vsMelhor, 1),
                  texto: `${(vsMelhor * 100).toFixed(0)}%`,
                  nivel: vsMelhor >= 0.95 ? "otimo" : "info",
                  detalhe: vsMelhor >= 1 ? "Ritmo no pico da série" : "Distância até o melhor resultado",
                },
              ]}
            />
          </Card>

          <Card className="p-5 min-[1180px]:col-span-8">
            <TituloCard
              titulo="Entradas, saídas e saldo"
              nivel={nvCaixa}
              ajuda="As saídas aparecem empilhadas por centro de custo e a linha azul mostra o saldo final de cada mês. Assim, a causa de qualquer aperto de caixa fica visível sem abrir outra tela."
              direita={
                <span className="font-mono text-[11px] text-tinta-suave">
                  saldo em foco: <strong className="text-tinta">{formatarBRL(vm.saldoCaixa)}</strong>
                </span>
              }
            />
            {vm.caixaLinhas.some((linha) => linha.receita || linha.despesaAL || linha.despesaCH || linha.despesaOutros) ? (
              <>
                <FluxoCaixaInterativo
                  dados={vm.caixaLinhas.map((linha) => ({
                    rotulo: linha.rotulo,
                    receita: linha.receita,
                    despesaAL: linha.despesaAL,
                    despesaCH: linha.despesaCH,
                    despesaOutros: linha.despesaOutros,
                    saldo: linha.saldo,
                  }))}
                />
                <p className="mt-2 text-xs leading-relaxed text-tinta-suave">
                  {periodo ? "Na janela selecionada" : `Em ${nomeMes}`}, entraram {formatarBRL(vm.caixaReceita)} e saíram {formatarBRL(vm.caixaDespesa)} — saldo de{" "}
                  <strong className="font-mono text-tinta">{formatarBRL(vm.saldoCaixa)}</strong>.
                </p>
              </>
            ) : (
              <p className="py-12 text-center text-sm text-tinta-suave">Sem lançamentos de caixa nesta janela.</p>
            )}
            <details className="mt-2 text-xs text-tinta-suave">
              <summary className="cursor-pointer select-none">Ver dados do caixa</summary>
              <div className="mt-2 tabela-scroll overflow-x-auto" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}>
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Mês</th>
                      <th className="text-right">Receita</th>
                      <th className="text-right">Despesa AL</th>
                      <th className="text-right">Despesa CH</th>
                      {vm.caixaLinhas.some(linha => linha.despesaOutros !== 0) ? <th className="text-right">Brisa / outros</th> : null}
                      <th className="text-right">Saldo</th>
                      <th className="text-right">Receb. dinheiro*</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vm.caixaLinhas
                      .filter((linha) => linha.receita || linha.despesaAL || linha.despesaCH || linha.despesaOutros || linha.dinheiro)
                      .map((linha) => (
                        <tr key={linha.mes}>
                          <td>{linha.rotulo}</td>
                          <td className="text-right"><Dinheiro centavos={linha.receita} /></td>
                          <td className="text-right"><Dinheiro centavos={linha.despesaAL} /></td>
                          <td className="text-right"><Dinheiro centavos={linha.despesaCH} /></td>
                          {vm.caixaLinhas.some(linha => linha.despesaOutros !== 0) ? <td className="text-right"><Dinheiro centavos={linha.despesaOutros} /></td> : null}
                          <td className="text-right"><Dinheiro centavos={linha.saldo} destaque /></td>
                          <td className="text-right"><Dinheiro centavos={linha.dinheiro} /></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <p className="mt-1 text-[11px] text-tinta-suave">* registro paralelo de espécie — não entra no saldo.</p>
              </div>
            </details>
          </Card>

          <Card className="p-5 min-[1180px]:col-span-4">
            <TituloCard
              titulo={periodo ? "Recebimentos por empreendimento no período" : "Recebimentos por empreendimento no mês"}
              ajuda="Empreendimentos com mais pagamentos registrados na janela."
            />
            {rankingRecebido.length > 0 ? (
              <BarrasHorizontais itens={rankingRecebido} cor={COR_1} />
            ) : (
              <p className="py-8 text-center text-sm text-tinta-suave">Sem pagamentos nesta janela.</p>
            )}
          </Card>
        </div>
      </section>

      {/* ---------- recebimentos por empreendimento ---------- */}
      <Card className="mt-4 p-5">
        <TituloCard
          titulo={`Recebimentos por empreendimento — ${periodo ? periodo.rotulo : formatarCompetencia(mes)}`}
          ajuda="Pagamentos registrados por empreendimento na janela selecionada, incluindo aluguel e repasses. O ticket médio divide o recebido pelas cobranças pagas."
        />
        <div className="tabela-scroll overflow-x-auto" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}>
          <table className="tabela">
            <thead>
              <tr>
                <th>Empreendimento</th>
                <th className="text-right">
                  Recebido {periodo ? "no período" : "no mês"}
                </th>
                <th className="text-right">
                  % {periodo ? "do período" : "do mês"}{" "}
                  <Ajuda dica="Participação do empreendimento no total de pagamentos registrados na janela." />
                </th>
                <th className="text-right">
                  Ticket médio{" "}
                  <Ajuda dica={`Valor médio recebido por cobrança paga do empreendimento ${periodo ? "no período" : "no mês"}. Ajuda a comparar empreendimentos de portes diferentes.`} />
                </th>
              </tr>
            </thead>
            <tbody>
              {[...vm.porEmp].sort((a, b) => b.recebido - a.recebido).map((e) => (
                <tr key={e.id}>
                  <td className="font-medium">{e.nome}</td>
                  <td className="text-right"><Dinheiro centavos={e.recebido} /></td>
                  <td className="text-right text-tinta-suave">
                    {vm.recebido > 0 ? pct(e.recebido / vm.recebido) : "—"}
                  </td>
                  <td className="text-right"><Dinheiro centavos={e.ticket} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="text-right"><Dinheiro centavos={vm.recebido} destaque /></td>
                <td className="text-right">100%</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* ---------- listas operacionais ---------- */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card
          className="p-5"
          nivel={vm.reajustes.length > 0 ? nvReaj : undefined}
        >
          <TituloCard
            titulo={periodo ? "Reajustes no período" : `Reajustes de ${nomeMes}`}
            nivel={vm.reajustes.length > 0 ? nvReaj : "otimo"}
            ajuda={`Contratos cujo aniversário de correção cai ${periodo ? "dentro do período" : "neste mês"}. Aplique o índice combinado sobre o aluguel-base (sem IPTU nem condomínio) e atualize o valor em Contratos — nada disso é automático.`}
            direita={
              vm.reajustes.length > 0 ? (
                <LinkCard href="/contratos">Abrir contratos</LinkCard>
              ) : (
                <Selo nivel="otimo">nada a aplicar</Selo>
              )
            }
          />
          {vm.reajustes.length === 0 ? (
            <p className="text-sm text-tinta-suave">
              Nenhum contrato com aniversário de reajuste{" "}
              {periodo ? "no período" : "neste mês"}.
            </p>
          ) : (
            <div className="tabela-scroll overflow-x-auto" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}>
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
                  {vm.reajustes.map((r, i) => (
                    <tr key={i}>
                      <td>{r.empreendimento}</td>
                      <td>{r.localizacao}</td>
                      <td>{r.locatario}</td>
                      <td className="text-right"><Dinheiro centavos={r.valorBase} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <TituloCard
            titulo={
              periodo
                ? "Saldos pendentes do período"
                : "Saldos pendentes do mês"
            }
            nivel={vm.pendentes.length > 0 ? nvInad : "otimo"}
            ajuda={`As dez maiores cobranças ${periodo ? "do período" : "do mês"} com saldo após pagamentos parciais. O ponto colorido é o semáforo do atraso: âmbar venceu há até 30 dias, vermelho passou disso, azul ainda não venceu.`}
            direita={
              <span className="font-mono text-[12px] text-tinta-suave">
                {vm.inadQtde} ·{" "}
                <strong className="text-tinta">
                  {formatarBRL(vm.inadValor)}
                </strong>
              </span>
            }
          />
          {!podeVerTitulos ? <p className="text-sm text-tinta-suave">Seu perfil visualiza os totais consolidados.</p> : vm.pendentes.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-tinta-suave">
              <Selo nivel="otimo">tudo recebido</Selo>
              Todas as cobranças {periodo ? "do período" : "do mês"} foram
              recebidas.
            </div>
          ) : (
            <div className="tabela-scroll overflow-x-auto" role="region" aria-label="Tabela com rolagem horizontal" tabIndex={0}>
              <table className="tabela">
                <thead>
                  <tr>
                    <th>
                      <span className="sr-only">Situação</span>
                      <Ajuda dica="Semáforo do atraso: azul = ainda não venceu, âmbar = venceu há até 30 dias, vermelho = passou de 30 dias, cinza = contrato sem dia de vencimento cadastrado." />
                    </th>
                    {vm.comMesNaTabela ? <th>Mês</th> : null}
                    <th>Empreendimento</th>
                    <th>Locatário</th>
                    <th>Localização</th>
                    <th className="text-right">Devido</th>
                    <th className="text-right">Pago</th>
                    <th className="text-right">
                      Saldo{" "}
                      <Ajuda dica="Valor devido menos tudo o que já foi recebido. Pagamentos parciais reduzem este saldo sem retirar a cobrança da lista." />
                    </th>
                    <th className="text-right">
                      Atraso{" "}
                      <Ajuda dica="Dias corridos desde o vencimento do contrato. Acima de 30 dias fica vermelho — priorize a cobrança." />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {vm.pendentes.slice(0, 10).map((p, i) => {
                    const nv = nivelAtraso(p.diasAtraso);
                    return (
                    <tr key={i}>
                      <td>
                        <Ponto
                          nivel={nv}
                          titulo={
                            p.diasAtraso === null
                              ? "sem dia de vencimento cadastrado"
                              : p.diasAtraso <= 0
                                ? "ainda não venceu"
                                : `${p.diasAtraso} dia(s) de atraso`
                          }
                        />
                      </td>
                      {vm.comMesNaTabela ? (
                        <td className="font-mono text-[12px]">
                          {p.mes ? formatarCompetencia(p.mes) : "—"}
                        </td>
                      ) : null}
                      <td>{p.empreendimento}</td>
                      <td>{p.locatario}</td>
                      <td>{p.localizacao}</td>
                      <td className="text-right"><Dinheiro centavos={p.totalDevido} /></td>
                      <td className="text-right"><Dinheiro centavos={p.recebido} /></td>
                      <td className="text-right"><Dinheiro centavos={p.saldoAberto} destaque /></td>
                      <td className="text-right">
                        {p.diasAtraso !== null ? (
                          <Selo nivel={nv}>{p.diasAtraso}d</Selo>
                        ) : (
                          <span className="text-tinta-suave/60">—</span>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {podeVerTitulos && vm.pendentes.length > 10 ? (
            <p className="mt-2 text-xs text-tinta-suave">
              Mostrando 10 de {vm.pendentes.length} — lista completa em{" "}
              <Link href={`/financeiro/contas-a-receber?${qsFinanceiro}`} className="font-semibold text-oliva-escura hover:underline">
                Contas a receber
              </Link>
              .
            </p>
          ) : null}
        </Card>
      </div>

      <p className="mt-6 text-xs text-tinta-suave/60">
        Fonte financeira: lançamentos principais da base unificada. Temporada e reajustes vêm dos respectivos módulos do Brisa.
      </p>
    </div>
  );
}
