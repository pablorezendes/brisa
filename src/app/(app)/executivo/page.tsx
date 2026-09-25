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
  NOME_MES_ABREV,
  NOME_MES_COMPLETO,
  parseCompetencia,
} from "@/lib/dominio/normalizacao";
import { parsePeriodo, rotulosCompetencias } from "@/lib/dominio/periodo";
import {
  nivelAtraso,
  nivelInadimplencia,
  nivelSaldo,
  nivelTarefas,
  nivelTaxaRecebimento,
  nivelVariacao,
  type Nivel,
} from "@/lib/dominio/semaforo";
import {
  caixaDoPeriodoPorMes,
  dadosExecutivos,
  empreendimentosDoPeriodo,
  mesPadrao,
  type CaixaMensal,
  type Pendente,
  type Reajuste,
} from "@/lib/consultas/executivo";
import {
  contratosAReajustarDoPeriodo,
  kpisDoPeriodo,
  pendentesDoPeriodo,
} from "@/lib/consultas/relatorios";
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

/**
 * View-model único: os dois modos (mês e período) preenchem os mesmos campos.
 * Modo mês = janela de 1 competência + séries do ano (JAN..DEZ, destaque no
 * mês em tela). Modo período = janela de N competências + séries da própria
 * janela, com rótulos vindos de rotulosCompetencias.
 */
interface VmExecutivo {
  naJanela: string; // "em junho" | "no período" — embutido nos textos
  devido: number;
  recebido: number;
  taxa: number | null;
  inadQtde: number;
  inadValor: number;
  saldoCaixa: number;
  temCaixa: boolean;
  caixaReceita: number;
  caixaDespesa: number;
  lucroTemporada: number | null;
  temporadaDetalhe: string;
  reajustes: Reajuste[];
  pendentes: (Pendente & { mes?: string })[];
  serieDevido: number[];
  serieRecebido: number[];
  caixaLinhas: (CaixaMensal & { rotulo: string })[];
  rotulos?: string[]; // eixo dos gráficos (undefined = JAN..DEZ)
  destaque?: number; // posição 1-based da coluna destacada (só no modo mês)
  linhasSerie: {
    rotulo: string;
    devido: number;
    recebido: number;
    pendentes: number;
  }[];
  porEmp: {
    id: string;
    nome: string;
    recebido: number;
    ticket: number | null;
  }[];
  comMesNaTabela: boolean;
}

export default async function PaginaExecutivo({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; de?: string; ate?: string }>;
}) {
  const sp = await searchParams;
  const periodo = parsePeriodo(sp.de, sp.ate);
  const mes = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : await mesPadrao();
  const { ano, mes: mesNum } = parseCompetencia(mes);
  const nomeMes = NOME_MES_COMPLETO[mesNum].toLowerCase();

  // links de aprofundamento carregam a MESMA janela em tela — os destinos
  // aceitam ?de/?ate e o clique tem de bater com o que o alerta/KPI afirma
  const qs = periodo ? `de=${periodo.de}&ate=${periodo.ate}` : `mes=${mes}`;

  // Modo mês mantém a consulta completa de sempre; no período ela não roda.
  const d = periodo ? null : await dadosExecutivos(mes);

  const vm: VmExecutivo = periodo
    ? await (async () => {
        const [k, emp, caixaJanela, reajustesP, pendentesP] = await Promise.all([
          kpisDoPeriodo(periodo.meses),
          empreendimentosDoPeriodo(periodo.meses),
          caixaDoPeriodoPorMes(periodo.meses),
          contratosAReajustarDoPeriodo(periodo.meses),
          pendentesDoPeriodo(periodo.meses),
        ]);
        const rotulos = rotulosCompetencias(periodo.meses);
        const pendPorMes = new Map<string, number>();
        for (const p of pendentesP)
          pendPorMes.set(p.mes, (pendPorMes.get(p.mes) ?? 0) + 1);
        const caixaReceita = caixaJanela.reduce((a, c) => a + c.receita, 0);
        const caixaDespesa = caixaJanela.reduce(
          (a, c) => a + c.despesaAL + c.despesaCH,
          0
        );
        return {
          naJanela: "no período",
          devido: k.devidoTotal,
          recebido: k.recebidoTotal,
          taxa: k.taxaRecebimento,
          inadQtde: k.inadimplencia.quantidade,
          inadValor: k.inadimplencia.valorDevido,
          saldoCaixa: caixaReceita - caixaDespesa,
          temCaixa: caixaReceita > 0 || caixaDespesa > 0,
          caixaReceita,
          caixaDespesa,
          lucroTemporada: k.lucroTemporada,
          temporadaDetalhe: "receitas − despesas − limpezas do período",
          reajustes: reajustesP.map((r) => ({
            empreendimento: r.empreendimento,
            localizacao: r.identificacao,
            locatario: r.locatario ?? "Desocupado",
            valorBase: r.valorBase,
          })),
          pendentes: pendentesP.map((p) => ({
            empreendimento: p.empreendimento,
            locatario: p.locatario ?? "—",
            localizacao: p.identificacao,
            totalDevido: p.totalDevido,
            recebido: p.recebido,
            saldoAberto: p.saldoAberto,
            diasAtraso:
              p.diasDesdeVencimento !== null && p.diasDesdeVencimento > 0
                ? p.diasDesdeVencimento
                : null,
            mes: p.mes,
          })),
          serieDevido: k.devidoPorMes,
          serieRecebido: k.recebidoPorMes,
          caixaLinhas: caixaJanela.map((c, i) => ({ ...c, rotulo: rotulos[i] })),
          rotulos,
          destaque: undefined,
          linhasSerie: periodo.meses.map((m, i) => ({
            rotulo: rotulos[i],
            devido: k.devidoPorMes[i],
            recebido: k.recebidoPorMes[i],
            pendentes: pendPorMes.get(m) ?? 0,
          })),
          porEmp: emp.map((e) => ({
            id: e.id,
            nome: e.nome,
            recebido: e.recebidoJanela,
            ticket: e.ticketMedioJanela,
          })),
          comMesNaTabela: periodo.meses.length > 1,
        };
      })()
    : (() => {
        const dm = d!;
        return {
          naJanela: `em ${nomeMes}`,
          devido: dm.devidoMes,
          recebido: dm.recebidoMes,
          taxa: dm.taxaRecebimento,
          inadQtde: dm.inadimplentesQtde,
          inadValor: dm.inadimplentesValor,
          saldoCaixa: dm.saldoCaixaMes,
          temCaixa: !!dm.caixaMes,
          caixaReceita: dm.caixaMes?.receita ?? 0,
          caixaDespesa:
            (dm.caixaMes?.despesaAL ?? 0) + (dm.caixaMes?.despesaCH ?? 0),
          lucroTemporada: dm.lucroTemporadaMes,
          temporadaDetalhe:
            dm.lucroTemporadaMes !== null
              ? `entrou ${formatarBRL(dm.receitaTemporadaMes)}, gastou ${formatarBRL(dm.despesaTemporadaMes)}`
              : "Despesas da temporada ainda não informadas",
          reajustes: dm.reajustesDoMes,
          pendentes: dm.pendentesDoMes,
          serieDevido: dm.porMes.map((l) => l.devido),
          serieRecebido: dm.porMes.map((l) => l.recebido),
          caixaLinhas: dm.caixaPorMes.map((c) => {
            const { mes: m } = parseCompetencia(c.mes);
            return { ...c, rotulo: NOME_MES_ABREV[m] };
          }),
          rotulos: undefined,
          destaque: mesNum,
          linhasSerie: dm.porMes.slice(0, dm.ultimoMesComDados).map((l, i) => ({
            rotulo: NOME_MES_ABREV[i + 1],
            devido: l.devido,
            recebido: l.recebido,
            pendentes: l.pendentes,
          })),
          porEmp: dm.porEmpreendimento.map((e) => ({
            id: e.id,
            nome: e.nome,
            recebido: e.recebidoMes,
            ticket: e.ticketMedioMes,
          })),
          comMesNaTabela: false,
        };
      })();

  // extras exclusivos do modo mês (variação vs mês anterior e fechamento)
  const mesAnterior = d && mesNum > 1 ? d.porMes[mesNum - 2] : null;
  const caixaAnterior = d && mesNum > 1 ? d.caixaPorMes[mesNum - 2] : null;
  // Distribuição dos recebimentos por empreendimento.
  const empOrdenados = vm.porEmp
    .filter((e) => e.recebido > 0)
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
      acao: { rotulo: "Painel de cobrança", href: `/paineis/cobranca?${qs}` },
    });
  }
  if (nvTaxa !== "otimo" && vm.taxa !== null) {
    alertas.push({
      nivel: nvTaxa,
      titulo: "Taxa de recebimento abaixo de 95%",
      texto: `Entrou ${pct(vm.taxa)} do devido — ${formatarBRL(vm.recebido)} de ${formatarBRL(vm.devido)}. A diferença está nos ${vm.inadQtde} pendentes listados abaixo.`,
      acao: { rotulo: "Registrar", href: `/recebimentos?${qs}` },
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
      acao: { rotulo: "Abrir caixa", href: `/caixa?${qs}` },
    });
  }
  if (!periodo && d && !d.mesFechado) {
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
            ) : d?.mesFechado ? (
              <Selo nivel="otimo">mês fechado</Selo>
            ) : (
              <Selo nivel="info">mês aberto</Selo>
            )}
            {!periodo ? <SeletorMes base="/executivo" mes={mes} /> : null}
            <SeletorPeriodo base="/executivo" periodo={periodo} />
          </div>
        }
      />

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
          <strong>{formatarBRL(vm.recebido)}</strong> dos locatários.{" "}
          {vm.inadQtde > 0 ? (
            <>
              <strong>{vm.inadQtde} cobrança(s)</strong> somando{" "}
              <strong>{formatarBRL(vm.inadValor)}</strong> ainda não foram
              pagas
            </>
          ) : (
            <>Todas as cobranças {periodo ? "do período" : "do mês"} foram pagas</>
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
          detalhe="aluguel + repasses (IPTU/cond.)"
          nivel={periodo ? "info" : nivelVariacao(vm.recebido, mesAnterior?.recebido ?? null)}
          href={`/recebimentos?${qs}`}
          ajuda="Soma dos pagamentos registrados na janela, incluindo IPTU e condomínio quando cobrados junto com o aluguel."
        />
        <Kpi
          rotulo={periodo ? "Devido no período" : "Devido no mês"}
          valor={<Dinheiro centavos={vm.devido} destaque />}
          detalhe="aluguéis e repasses cobrados"
          nivel="info"
          href={`/recebimentos?${qs}`}
          ajuda="Soma do aluguel e dos repasses de IPTU e condomínio lançados na janela, antes de descontar pagamentos."
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
          rotulo={periodo ? "Inadimplência no período" : "Inadimplência do mês"}
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
          href={`/relatorios/inadimplencia?${qs}`}
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
          href={`/caixa?${qs}`}
          ajuda="Entradas menos as saídas dos centros Antonio/Laura e Chácara Brisa, do livro-caixa. Recebimentos em dinheiro são registro paralelo de espécie e ficam fora do saldo. Lançado na tela Caixa."
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
              <div className="mt-2 overflow-x-auto">
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
                    : "Sem pagamentos nesta janela",
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
            {vm.caixaLinhas.some((linha) => linha.receita || linha.despesaAL || linha.despesaCH) ? (
              <>
                <FluxoCaixaInterativo
                  dados={vm.caixaLinhas.map((linha) => ({
                    rotulo: linha.rotulo,
                    receita: linha.receita,
                    despesaAL: linha.despesaAL,
                    despesaCH: linha.despesaCH,
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
                    {vm.caixaLinhas
                      .filter((linha) => linha.receita || linha.despesaAL || linha.despesaCH || linha.dinheiro)
                      .map((linha) => (
                        <tr key={linha.mes}>
                          <td>{linha.rotulo}</td>
                          <td className="text-right"><Dinheiro centavos={linha.receita} /></td>
                          <td className="text-right"><Dinheiro centavos={linha.despesaAL} /></td>
                          <td className="text-right"><Dinheiro centavos={linha.despesaCH} /></td>
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
        <div className="overflow-x-auto">
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
            <div className="overflow-x-auto">
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
          {vm.pendentes.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-tinta-suave">
              <Selo nivel="otimo">tudo recebido</Selo>
              Todas as cobranças {periodo ? "do período" : "do mês"} foram
              recebidas.
            </div>
          ) : (
            <div className="overflow-x-auto">
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
          {vm.pendentes.length > 10 ? (
            <p className="mt-2 text-xs text-tinta-suave">
              Mostrando 10 de {vm.pendentes.length} — lista completa em{" "}
              <Link href={`/relatorios/inadimplencia?${qs}`} className="font-semibold text-oliva-escura hover:underline">
                Relatórios → Inadimplência
              </Link>
              .
            </p>
          ) : null}
        </Card>
      </div>

      <p className="mt-6 text-xs text-tinta-suave/60">
        Fonte: recebimentos e movimentações lançados no sistema.
      </p>
    </div>
  );
}
