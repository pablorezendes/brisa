import {
  Ajuda,
  BuscaCard,
  Card,
  Dinheiro,
  Kpi,
  LinkCard,
  PageHeader,
  PainelAlertas,
  Ponto,
  Selo,
  SeletorGrafico,
  SeletorMes,
  SeletorPeriodo,
  TituloCard,
  type ItemAlerta,
} from "@/components/ui";
import {
  AreaTendencia,
  BarraComposicao,
  BarrasHorizontais,
  BarrasMensais,
  COR_1,
  COR_2,
  Sparkline,
} from "@/components/graficos";
import {
  comissaoDoMesPorEmpreendimento,
  comissaoDoPeriodoPorEmpreendimento,
  contratosAReajustarDoMes,
  contratosAReajustarDoPeriodo,
  kpisDoMes,
  kpisDoPeriodo,
  matrizComissao,
  mesMaisRecenteComLancamentos,
  pendentesDoMes,
  pendentesDoPeriodo,
} from "@/lib/consultas/relatorios";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import {
  formatarCompetencia,
  normalizar,
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
  type Nivel,
} from "@/lib/dominio/semaforo";

const fmtPercentual = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 1,
});

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    mes?: string;
    de?: string;
    ate?: string;
    g?: string;
    qr?: string;
  }>;
}) {
  const sp = await searchParams;
  const periodo = parsePeriodo(sp.de, sp.ate);
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? "")
    ? (sp.mes as string)
    : await mesMaisRecenteComLancamentos();
  const { ano, mes: mesNum } = parseCompetencia(mes);

  // ---- as duas visões desembocam no MESMO view-model -----------------------
  // (modo mês: janela de 1 competência + série do ano; modo período: janela
  //  de N competências + série da própria janela)
  const vm = periodo
    ? await (async () => {
        const [k, porEmp, reajustes, pendentes] = await Promise.all([
          kpisDoPeriodo(periodo.meses),
          comissaoDoPeriodoPorEmpreendimento(periodo.meses),
          contratosAReajustarDoPeriodo(periodo.meses),
          pendentesDoPeriodo(periodo.meses),
        ]);
        return {
          janela: periodo.rotulo,
          janelaCurta: "no período",
          comissao: k.comissaoTotal,
          serie: k.comissaoPorMes,
          rotulosSerie: rotulosCompetencias(periodo.meses),
          destaqueSerie: undefined as number | undefined,
          tituloSerie: `Comissão mês a mês — ${periodo.rotulo}`,
          inadimplencia: k.inadimplencia,
          devido: k.devidoTotal,
          recebido: k.recebidoTotal,
          taxa: k.taxaRecebimento,
          reajustesQtde: k.contratosAReajustar,
          saldoCaixa: k.saldoCaixa,
          lucroTemporada: k.lucroTemporada,
          porEmp,
          reajustes,
          pendentes,
          comMesNaTabela: periodo.meses.length > 1,
        };
      })()
    : await (async () => {
        const [k, porEmp, reajustes, pendentes, matriz] = await Promise.all([
          kpisDoMes(mes),
          comissaoDoMesPorEmpreendimento(mes),
          contratosAReajustarDoMes(mes),
          pendentesDoMes(mes),
          matrizComissao(ano),
        ]);
        return {
          janela: formatarCompetencia(mes),
          janelaCurta: `em ${formatarCompetencia(mes)}`,
          comissao: k.comissaoMes,
          serie: matriz.totalPorMes,
          rotulosSerie: undefined as string[] | undefined,
          destaqueSerie: mesNum as number | undefined,
          tituloSerie: `Comissão mês a mês em ${ano}`,
          inadimplencia: k.inadimplencia,
          devido: k.devidoMes,
          recebido: k.recebidoMes,
          taxa: k.taxaRecebimento,
          reajustesQtde: k.contratosAReajustar,
          saldoCaixa: k.saldoCaixaMes,
          lucroTemporada: k.lucroTemporadaMes,
          porEmp,
          reajustes,
          pendentes: pendentes.map((p) => ({ ...p, mes })),
          comMesNaTabela: false,
        };
      })();

  const topPendentes = vm.pendentes.slice(0, 8);
  const nomeJanela = periodo
    ? "no período"
    : NOME_MES_COMPLETO[mesNum].toLowerCase();

  // links de aprofundamento carregam a MESMA janela em tela: os destinos
  // aceitam ?de/?ate e o clique tem de bater com o que o card afirma
  const qs = periodo ? `de=${periodo.de}&ate=${periodo.ate}` : `mes=${mes}`;
  const qsAno = periodo ? qs : `ano=${ano}`;

  // ---- tipo de gráfico da curva de comissão (?g=) ------------------------
  const TIPOS_GRAFICO = [
    { valor: "area", rotulo: "Área" },
    { valor: "linha", rotulo: "Linha" },
    { valor: "barras", rotulo: "Barras" },
    { valor: "acumulado", rotulo: "Acumulado" },
  ];
  const tipoGrafico = TIPOS_GRAFICO.some((t) => t.valor === sp.g)
    ? (sp.g as string)
    : "area";

  /**
   * Série acumulada: soma progressiva ATÉ o último mês com movimento. Depois
   * dele volta a zero para que o gráfico entenda "ainda não aconteceu" — sem
   * isso a curva seguiria reta até dezembro fingindo que o ano já fechou.
   */
  const ultimoComDado = vm.serie.reduce(
    (ultimo, v, i) => (v > 0 ? i : ultimo),
    -1
  );
  let somaCorrente = 0;
  const serieAcumulada = vm.serie.map((v, i) => {
    if (i > ultimoComDado) return 0;
    somaCorrente += v;
    return somaCorrente;
  });

  // ---- semáforos -----------------------------------------------------------
  const nivelTaxa = nivelTaxaRecebimento(vm.taxa);
  const nivelInad = nivelInadimplencia(vm.inadimplencia.valorDevido, vm.devido);
  const nivelCaixa = nivelSaldo(vm.saldoCaixa);
  const nivelReaj = nivelTarefas(vm.reajustesQtde, periodo ? 8 * Math.max(1, periodo.meses.length / 2) : 8);
  const nivelTemporada: Nivel =
    vm.lucroTemporada > 0 ? "otimo" : vm.lucroTemporada < 0 ? "critico" : "neutro";

  // comissão da janela vs. média dos meses com movimento da série
  const mesesComComissao = vm.serie.filter((v) => v > 0);
  const mediaComissao = mesesComComissao.length
    ? mesesComComissao.reduce((a, v) => a + v, 0) / mesesComComissao.length
    : 0;
  const nivelComissao: Nivel = periodo
    ? "info"
    : mediaComissao === 0
      ? "neutro"
      : vm.comissao >= mediaComissao
        ? "otimo"
        : vm.comissao >= mediaComissao * 0.85
          ? "info"
          : "atencao";

  const vencidasGraves = vm.pendentes.filter(
    (p) => p.diasDesdeVencimento !== null && p.diasDesdeVencimento > 30
  );
  const valorGrave = vencidasGraves.reduce((s, p) => s + p.totalDevido, 0);

  // ---- fila de atenção -----------------------------------------------------
  const alertas: ItemAlerta[] = [];
  if (vencidasGraves.length > 0) {
    alertas.push({
      nivel: "critico",
      titulo: "Atraso acima de 30 dias",
      texto: `${vencidasGraves.length} ${vencidasGraves.length === 1 ? "cobrança passou" : "cobranças passaram"} de 30 dias do vencimento, somando ${formatarBRL(valorGrave)}. Ligue hoje e, se combinar parcelamento, anote na Observação do lançamento.`,
      acao: { rotulo: "Ver lista de cobrança", href: `/paineis/cobranca?${qs}` },
    });
  }
  if (vm.inadimplencia.quantidade > 0) {
    alertas.push({
      nivel: nivelInad,
      titulo: "Cobranças sem pagamento",
      texto: `${vm.inadimplencia.quantidade} ${vm.inadimplencia.quantidade === 1 ? "lançamento" : "lançamentos"} ${nomeJanela} ainda sem recebimento — ${formatarBRL(vm.inadimplencia.valorDevido)} a entrar. Quando o dinheiro cair, registre em Recebimentos e a linha some sozinha.`,
      acao: { rotulo: "Registrar", href: `/recebimentos?${qs}` },
    });
  }
  if (nivelTaxa === "critico" || nivelTaxa === "atencao") {
    alertas.push({
      nivel: nivelTaxa,
      titulo: "Taxa de recebimento abaixo do esperado",
      texto: `Entrou ${fmtPercentual.format(vm.taxa ?? 0)} do que era devido ${nomeJanela} (${formatarBRL(vm.recebido)} de ${formatarBRL(vm.devido)}). Abaixo de 95% já vale passar a lista de cobrança.`,
      acao: { rotulo: "Painel de cobrança", href: `/paineis/cobranca?${qs}` },
    });
  }
  if (vm.reajustesQtde > 0) {
    alertas.push({
      nivel: nivelReaj,
      titulo: "Reajustes para aplicar",
      texto: `${vm.reajustesQtde} ${vm.reajustesQtde === 1 ? "contrato faz" : "contratos fazem"} aniversário de correção ${nomeJanela}. O sistema avisa, mas quem aplica o índice e atualiza o aluguel é você.`,
      acao: { rotulo: "Abrir contratos", href: "/contratos" },
    });
  }
  if (vm.saldoCaixa < 0) {
    alertas.push({
      nivel: "critico",
      titulo: `Caixa negativo ${nomeJanela}`,
      texto: `As saídas superaram as entradas em ${formatarBRL(Math.abs(vm.saldoCaixa))}. Confira se alguma despesa foi lançada no centro de custo errado antes de fechar o mês.`,
      acao: { rotulo: "Abrir caixa", href: `/caixa?${qs}` },
    });
  }

  // busca dentro do quadro de reajustes (?qr=) — normalizada para achar
  // "jose" digitando sem acento e sem se importar com maiúsculas
  const buscaReajuste = (sp.qr ?? "").trim();
  const alvoBusca = normalizar(buscaReajuste);
  const reajustesFiltrados = alvoBusca
    ? vm.reajustes.filter((r) =>
        [r.empreendimento, r.identificacao, r.locatario ?? "", r.indiceReajuste ?? ""]
          .some((campo) => normalizar(campo).includes(alvoBusca))
      )
    : vm.reajustes;

  const rankingEmp = vm.porEmp
    .filter((c) => c.comissao > 0)
    .slice(0, 6)
    .map((c) => ({ rotulo: c.empreendimento, valor: c.comissao }));

  return (
    <div className="max-w-7xl">
      <PageHeader
        titulo="Visão geral"
        descricao={
          periodo
            ? `Resumo gerencial do período ${periodo.rotulo} — comissão, inadimplência, reajustes, caixa e temporada.`
            : `Resumo gerencial de ${vm.janela} — comissão, inadimplência, reajustes, caixa e temporada.`
        }
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            {!periodo ? <SeletorMes base="/" mes={mes} /> : null}
            <SeletorPeriodo base="/" periodo={periodo} />
          </div>
        }
      />

      <PainelAlertas
        itens={alertas}
        ajuda="A fila do dia, do mais urgente para o menos. Vermelho é 'aja agora', âmbar é 'olhe hoje, ainda dá tempo'. Cada linha leva direto para a tela onde a pendência se resolve."
        vazio={`Nada pedindo atenção ${nomeJanela} — cobranças recebidas, caixa positivo e nenhum reajuste a aplicar.`}
      />

      {/* ---------- indicadores, do mais decisivo ao menos ----------
           Ordem pedida pelo cliente: primeiro o que decide o dia (o caixa, o
           que falta entrar, quanto do devido entrou); depois o que é tarefa e
           resultado (reajustes na mesa, comissão, temporada). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi
          rotulo={periodo ? "Saldo de caixa no período" : "Saldo de caixa do mês"}
          valor={<Dinheiro centavos={vm.saldoCaixa} />}
          detalhe="entradas − saídas AL − saídas CH"
          nivel={nivelCaixa}
          destaque
          selo={
            vm.saldoCaixa > 0
              ? "positivo"
              : vm.saldoCaixa < 0
                ? "negativo"
                : undefined
          }
          nota={
            vm.saldoCaixa < 0
              ? "Saiu mais do que entrou. Confira se alguma despesa caiu no centro de custo errado."
              : undefined
          }
          href={`/caixa?${qs}`}
          ajuda="Entradas do caixa menos as saídas dos dois centros (Antonio/Laura e Chácara Brisa) na janela em análise. Recebimentos em dinheiro são um registro paralelo de espécie e não entram neste saldo."
        />
        <Kpi
          rotulo="Inadimplência"
          valor={<Dinheiro centavos={vm.inadimplencia.valorDevido} />}
          detalhe={`${vm.inadimplencia.quantidade} ${
            vm.inadimplencia.quantidade === 1
              ? "lançamento pendente"
              : "lançamentos pendentes"
          } ${nomeJanela}`}
          nivel={nivelInad}
          destaque
          nota={
            vencidasGraves.length > 0
              ? `${vencidasGraves.length} ${vencidasGraves.length === 1 ? "cobrança já passou" : "cobranças já passaram"} de 30 dias — priorize essas.`
              : vm.inadimplencia.quantidade > 0
                ? "Registre o pagamento em Recebimentos assim que o dinheiro cair."
                : undefined
          }
          href={`/relatorios/inadimplencia?${qs}`}
          ajuda="Soma das cobranças da janela que ainda não têm pagamento registrado. Quando o locatário pagar, vá em Recebimentos e registre na linha dele — o valor sai daqui na hora."
        />
        <Kpi
          rotulo="Taxa de recebimento"
          valor={vm.taxa !== null ? fmtPercentual.format(vm.taxa) : "—"}
          detalhe="Σ recebido / Σ total devido"
          nivel={nivelTaxa}
          destaque
          nota={
            nivelTaxa === "critico"
              ? "Abaixo de 80%: passe a lista de cobrança ainda hoje."
              : nivelTaxa === "atencao"
                ? "Entre 80% e 95%: falta pouco, veja quem está pendente."
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
          ajuda="Quanto do que era devido na janela já entrou. Pode passar de 100% quando alguém quita um atraso de meses anteriores junto — nesse caso lance tudo em Recebido e anote o motivo na Observação."
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi
          rotulo="Contratos a reajustar"
          valor={vm.reajustesQtde}
          detalhe={
            periodo
              ? "aniversário de reajuste dentro do período"
              : "mês de reajuste igual ao mês atual"
          }
          nivel={nivelReaj}
          selo={vm.reajustesQtde === 0 ? "nada a fazer" : "na sua mesa"}
          nota={
            vm.reajustesQtde > 0
              ? "Aplique o índice combinado e atualize o valor em Contratos — o sistema não reajusta sozinho."
              : undefined
          }
          href={vm.reajustesQtde > 0 ? "/contratos" : undefined}
          ajuda="Contratos que fazem aniversário de correção na janela em análise. É hora de aplicar o índice (IGP-M, IPCA...) e atualizar o valor do aluguel na tela de Contratos — o sistema não reajusta sozinho."
        />
        {/* comissão do mês e acumulada do ano no MESMO card — são a mesma
            história contada em dois prazos, não merecem dois cartões */}
        <Kpi
          rotulo={periodo ? "Comissão no período" : "Comissão do mês"}
          valor={<Dinheiro centavos={vm.comissao} />}
          detalhe={
            periodo
              ? `${periodo.meses.length} ${periodo.meses.length === 1 ? "competência" : "competências"} somadas`
              : `mês de lançamento ${vm.janela}`
          }
          secundario={{
            rotulo: periodo ? "média mensal" : `acumulada JAN–${vm.janela}`,
            valor: (
              <Dinheiro
                centavos={
                  periodo
                    ? Math.round(vm.comissao / Math.max(1, periodo.meses.length))
                    : vm.serie.slice(0, mesNum).reduce((a, v) => a + v, 0)
                }
              />
            ),
          }}
          nivel={nivelComissao}
          selo={
            periodo
              ? "total da janela"
              : nivelComissao === "otimo"
                ? "acima da média"
                : nivelComissao === "info"
                  ? "na média"
                  : "abaixo da média"
          }
          nota={
            !periodo && mediaComissao > 0 && vm.comissao < mediaComissao * 0.85
              ? `Média dos meses com movimento no ano: ${formatarBRL(Math.round(mediaComissao))}. Confira se faltam recebimentos por lançar.`
              : undefined
          }
          grafico={<Sparkline valores={vm.serie} rotulos={vm.rotulosSerie} />}
          href={`/relatorios/comissao?${qsAno}`}
          ajuda="O que a administradora ganhou na janela em análise: a taxa vigente (padrão 10%) sobre o aluguel efetivamente recebido — e, na linha de baixo, o acumulado do ano até aqui. IPTU e condomínio são repasses ao proprietário e nunca entram na conta."
        />
        <Kpi
          rotulo={periodo ? "Lucro temporada no período" : "Lucro temporada"}
          valor={<Dinheiro centavos={vm.lucroTemporada} />}
          detalhe="receitas − despesas − limpezas"
          nivel={nivelTemporada}
          selo={
            vm.lucroTemporada > 0
              ? "no azul"
              : vm.lucroTemporada < 0
                ? "no vermelho"
                : "sem lançamentos"
          }
          nota={
            vm.lucroTemporada < 0
              ? "As despesas e limpezas passaram do que as plataformas repassaram."
              : undefined
          }
          href={`/temporada?${qs}`}
          ajuda="Resultado do Airbnb na janela: o que as plataformas repassaram menos despesas (energia, condomínio, IPTU) e o pagamento das limpezas. Lançado na tela Temporada."
        />
      </div>

      {/* ---------- pendentes ---------- */}
    <Card
      className="mt-6 px-5 py-4"
        nivel={vm.pendentes.length > 0 ? nivelInad : "otimo"}
      >
        <TituloCard
          titulo={periodo ? "Pendentes do período" : "Pendentes do mês"}
          nivel={vm.pendentes.length > 0 ? nivelInad : "otimo"}
          ajuda="As cobranças de maior valor ainda sem pagamento registrado. O ponto colorido na frente é o tempo de atraso: verde/azul ainda não venceu, âmbar venceu há pouco, vermelho passou de 30 dias."
          direita={
            <LinkCard href={`/relatorios/inadimplencia?${qs}`}>
              Inadimplência completa
            </LinkCard>
          }
        />
        {topPendentes.length === 0 ? (
          <div className="flex items-center gap-2 py-8 text-center text-sm text-tinta-suave">
            <span className="mx-auto inline-flex items-center gap-2">
              <Selo nivel="otimo">tudo recebido</Selo>
              Nenhuma pendência {nomeJanela}.
            </span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead>
                <tr>
                  <th>
                    Situação{" "}
                    <Ajuda dica="Semáforo do atraso: azul = ainda não venceu, âmbar = venceu há até 30 dias, vermelho = passou de 30 dias, cinza = contrato sem dia de vencimento cadastrado." />
                  </th>
                  {vm.comMesNaTabela ? <th>Mês</th> : null}
                  <th>Empreendimento</th>
                  <th>Locatário</th>
                  <th className="text-right">
                    Total devido{" "}
                    <Ajuda dica="Aluguel + IPTU + condomínio da cobrança ainda sem pagamento. Quando entrar o dinheiro, registre em Recebimentos — se vier parcial ou em acordo, anote o motivo na Observação." />
                  </th>
                </tr>
              </thead>
              <tbody>
                {topPendentes.map((p) => {
                  const n = nivelAtraso(p.diasDesdeVencimento);
                  return (
                    <tr key={p.recebimentoId}>
                      <td>
                        <Ponto
                          nivel={n}
                          titulo={
                            p.diasDesdeVencimento === null
                              ? "sem dia de vencimento cadastrado"
                              : p.diasDesdeVencimento <= 0
                                ? `a vencer (dia ${p.diaVencimento})`
                                : `${p.diasDesdeVencimento} dia(s) de atraso`
                          }
                        />
                      </td>
                      {vm.comMesNaTabela ? (
                        <td className="font-mono text-[12px]">
                          {formatarCompetencia(p.mes)}
                        </td>
                      ) : null}
                      <td className="font-medium">{p.empreendimento}</td>
                      <td>
                        {p.locatario ?? (
                          <span className="text-tinta-suave/60">
                            {p.identificacao}
                          </span>
                        )}
                      </td>
                      <td className="text-right">
                        <Dinheiro centavos={p.totalDevido} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={vm.comMesNaTabela ? 4 : 3}>
                    {vm.pendentes.length > topPendentes.length
                      ? `Top ${topPendentes.length} de ${vm.pendentes.length} pendências`
                      : `${vm.pendentes.length} ${
                          vm.pendentes.length === 1
                            ? "pendência"
                            : "pendências"
                        }`}
                  </td>
                  <td className="text-right">
                    <Dinheiro
                      centavos={vm.inadimplencia.valorDevido}
                      destaque
                    />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* ---------- reajustes ---------- */}
      <Card
        className="mt-4 px-5 py-4"
        nivel={vm.reajustes.length > 0 ? nivelReaj : undefined}
      >
        <TituloCard
          titulo={periodo ? "Reajustes no período" : "Reajustes deste mês"}
          nivel={vm.reajustes.length > 0 ? nivelReaj : "otimo"}
          ajuda="Contratos cujo aniversário de correção cai na janela em análise. Aplique o índice combinado sobre o aluguel-base (sem IPTU nem condomínio) e atualize o valor na tela de Contratos — o sistema avisa, mas não reajusta sozinho."
          direita={
            <>
              <Selo nivel={vm.reajustes.length > 0 ? nivelReaj : "otimo"}>
                {alvoBusca
                  ? `${reajustesFiltrados.length} de ${vm.reajustes.length}`
                  : `${vm.reajustes.length} ${vm.reajustes.length === 1 ? "contrato" : "contratos"}`}
              </Selo>
              {vm.reajustes.length > 0 ? (
                <BuscaCard
                  base="/"
                  campo="qr"
                  valor={buscaReajuste}
                  ocultos={{
                    mes: periodo ? undefined : mes,
                    de: periodo?.de,
                    ate: periodo?.ate,
                    g: tipoGrafico === "area" ? undefined : tipoGrafico,
                  }}
                  placeholder="Empreendimento, sala, locatário…"
                />
              ) : null}
              {vm.reajustes.length > 0 ? (
                <LinkCard href="/contratos">Abrir contratos</LinkCard>
              ) : null}
            </>
          }
        />
        {vm.reajustes.length === 0 ? (
          <p className="py-4 text-center text-sm text-tinta-suave">
            Nenhum contrato com reajuste {nomeJanela}.
          </p>
        ) : reajustesFiltrados.length === 0 ? (
          <p className="py-6 text-center text-sm text-tinta-suave">
            Nenhum dos {vm.reajustes.length} contratos a reajustar bate com
            “{buscaReajuste}”.
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
                {reajustesFiltrados.map((r) => (
                  <tr key={r.contratoId}>
                    <td className="font-medium">{r.empreendimento}</td>
                    <td>{r.identificacao}</td>
                    <td>
                      {r.locatario ?? (
                        <span className="text-tinta-suave/60">—</span>
                      )}
                    </td>
                    <td>
                      {r.indiceReajuste ? (
                        <Selo nivel="info" icone={false}>
                          {r.indiceReajuste}
                        </Selo>
                      ) : (
                        <span className="text-tinta-suave/60">
                          índice não cadastrado
                        </span>
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

      {/* ---------- as duas leituras da comissão, lado a lado ---------- */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* ---------- comissão da janela, mês a mês ---------- */}
        <Card className="px-5 py-4">
          <TituloCard
            titulo={vm.tituloSerie}
            ajuda="O ganho da administradora pelo mês de lançamento de cada cobrança. Escolha a forma de ver: Área e Linha mostram a tendência, Barras comparam mês a mês, Acumulado soma o ano até cada mês. A curva termina no último mês com movimento — meses à frente ainda não aconteceram e não valem como zero."
            direita={
              <>
                <span className="font-mono text-[12px] text-tinta-suave">
                  total:{" "}
                  <strong className="text-tinta">
                    {formatarBRL(vm.serie.reduce((a, v) => a + v, 0))}
                  </strong>
                </span>
                <LinkCard href={`/relatorios/comissao?${qsAno}`}>
                  Matriz completa
                </LinkCard>
              </>
            }
          />
          <div className="mb-3">
            <SeletorGrafico
              base="/"
              qs={qs}
              atual={tipoGrafico}
              opcoes={TIPOS_GRAFICO}
            />
          </div>
          {tipoGrafico === "barras" ? (
            <BarrasMensais
              valores={vm.serie}
              mesSelecionado={vm.destaqueSerie}
              rotulos={vm.rotulosSerie}
              rotuloAcessivel={vm.tituloSerie}
            />
          ) : (
            <AreaTendencia
              valores={tipoGrafico === "acumulado" ? serieAcumulada : vm.serie}
              destaque={vm.destaqueSerie}
              rotulos={vm.rotulosSerie}
              rotuloAcessivel={vm.tituloSerie}
              preenchimento={tipoGrafico !== "linha"}
            />
          )}
          <p className="mt-2 text-xs text-tinta-suave">
            {tipoGrafico === "acumulado"
              ? "Cada ponto é a soma de tudo o que entrou de comissão até aquele mês — a curva só sobe."
              : tipoGrafico === "barras"
                ? "Cada coluna é o ganho daquele mês; a etiqueta marca o mês em tela e o melhor do ano."
                : "Passe o mouse em qualquer ponto para ver o valor exato do mês."}
          </p>
        </Card>

        {/* ---------- comissão por empreendimento ---------- */}
        <Card className="px-5 py-4">
          <TituloCard
            titulo={
              periodo
                ? "Comissão por empreendimento no período"
                : "Comissão por empreendimento no mês"
            }
            ajuda="De onde veio o ganho da administradora na janela em análise. A barra compara cada empreendimento com o maior deles — quanto mais curta, menor a participação. Serve para ver de quem o resultado depende."
            direita={
              <LinkCard href={`/relatorios/comissao?${qsAno}`}>
                Matriz completa
              </LinkCard>
            }
          />
          {rankingEmp.length > 0 ? (
            <>
              <BarrasHorizontais itens={rankingEmp} cor={COR_1} />
              {vm.porEmp.length > rankingEmp.length ? (
                <p className="mt-2 text-xs text-tinta-suave">
                  Mostrando os {rankingEmp.length} maiores de {vm.porEmp.length}{" "}
                  empreendimentos com comissão na janela.
                </p>
              ) : null}
              <div className="mt-3 flex items-center justify-between border-t border-contorno pt-2.5 text-sm">
                <span className="font-semibold text-tinta">
                  Total {periodo ? "do período" : "do mês"}
                </span>
                <Dinheiro centavos={vm.comissao} destaque />
              </div>
            </>
          ) : (
            <p className="py-8 text-center text-sm text-tinta-suave">
              Nenhuma comissão {nomeJanela}.
            </p>
          )}
        </Card>
      </div>

      </Card>
    </div>
  );
}
