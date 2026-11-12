import { acessoAtual, exigirPaginaAcesso } from "@/lib/acesso/servidor";
import { pode, podeAbrirRota } from "@/lib/acesso/politica";
import { operacaoNaRequisicao } from "@/lib/consultas/operacao-na-requisicao";
import { chavesRestritasUnificacao } from "@/lib/unificacao/privacidade";
import { consolidarExecutivo, mesPadraoConsolidado } from "@/lib/unificacao/executivo-consolidado";
import { prisma } from "@/lib/db";
import Link from "next/link";
import {
  Ajuda,
  Card,
  Dinheiro,
  Kpi,
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
  nivelTaxaRecebimento,
  nivelVariacao,
  type Nivel,
} from "@/lib/dominio/semaforo";
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
  const [operacao, acesso, captura] = await Promise.all([
    operacaoNaRequisicao(), acessoAtual(),
    prisma.importacaoLegadoLote.findFirst({
      where: { origem: "WIDESYS", status: { in: ["CONCLUIDO", "QUARENTENA"] }, concluidoEm: { not: null } },
      orderBy: { capturadoEm: "desc" },
      select: { capturadoEm: true },
    }),
  ]);
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
  const vm = {
    ...consolidado,
    naJanela: periodo ? "no período" : `em ${nomeMes}`,
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
  const podeVerDespesas = perfilFinanceiro && podeAbrirRota(acesso, "/financeiro/contas-a-pagar");
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
  if (vm.temCaixa && vm.saldoCaixa < 0) {
    alertas.push({
      nivel: "critico",
      titulo: periodo ? "Caixa negativo no período" : "Caixa negativo no mês",
      texto: `Saíram ${formatarBRL(Math.abs(vm.saldoCaixa))} a mais do que entraram ${vm.naJanela}. Verifique os centros de custo antes de fechar.`,
      acao: podeVerMovimentos ? { rotulo: "Ver movimentos", href: `/financeiro/movimentacoes?${qsFinanceiro}` } : undefined,
    });
  }

  return (
    <div className="max-w-7xl">
      <PageHeader
        titulo="Dashboard executivo"
        descricao={`Todos os indicadores da operação — ${periodo ? periodo.rotulo : `${NOME_MES_COMPLETO[mesNum]} de ${ano}`}`}
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            {periodo ? <Selo nivel="info">análise por período</Selo> : null}
            {!periodo ? <SeletorMes base="/executivo" mes={mes} /> : null}
            <SeletorPeriodo base="/executivo" periodo={periodo} />
          </div>
        }
      />

      <aside aria-label="Origem dos indicadores" className="mb-4 rounded-xl border border-contorno bg-carta px-5 py-3 text-sm">
        <strong>Fonte financeira · Widesys</strong>{" · "}
        {captura ? `Dados capturados em ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(captura.capturadoEm)}` : "Aguardando a primeira importação"}
      </aside>
      {/* ---------- resumo da janela em linguagem natural ---------- */}
      <Card className="mb-4 px-6 py-4" nivel={nvTaxa}>
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-tinta-suave">
          {periodo ? "O período em uma frase" : "O mês em uma frase"}
          <Ajuda
            dica="Pagamentos e saldos em aberto dos títulos da janela selecionada."
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
            <>{vm.titulosReceber > 0 ? "Os títulos da janela estão quitados" : "Nenhum título a receber contabilizado na janela"}</>
          )}
          .
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
        vazio="Nenhum alerta financeiro na janela."
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
          ajuda="Valor devido nos títulos a receber do Widesys na janela selecionada."
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
          ajuda="Entradas menos saídas dos movimentos do Widesys. Transferências internas ficam fora do saldo."
        />
        <Kpi
          rotulo="Despesas da competência"
          valor={<Dinheiro centavos={vm.despesa} destaque />}
          detalhe={`${vm.titulosPagar} título(s) a pagar na janela`}
          href={podeVerDespesas ? `/financeiro/contas-a-pagar?${qsFinanceiro}` : undefined}
          ajuda="Valor devido nos títulos a pagar do Widesys na competência selecionada."
        />
        <Kpi
          rotulo="Despesas pagas"
          valor={<Dinheiro centavos={vm.despesaPaga} destaque />}
          detalhe="pagamentos dos títulos da competência"
          href={podeVerDespesas ? `/financeiro/contas-a-pagar?${qsFinanceiro}` : undefined}
          ajuda="Valor pago nos títulos a pagar da janela. Consulte as saídas de caixa pela data da movimentação."
        />
      </div>

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
              ajuda="Entradas e saídas registradas no Widesys por mês. A linha mostra o saldo de cada mês."
              direita={
                <span className="font-mono text-[11px] text-tinta-suave">
                  saldo em foco: <strong className="text-tinta">{formatarBRL(vm.saldoCaixa)}</strong>
                </span>
              }
            />
            {vm.caixaLinhas.some(linha => linha.receita || linha.saida) ? (
              <>
                <FluxoCaixaInterativo dados={vm.caixaLinhas} />
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
                      <th className="text-right">Saídas</th>
                      <th className="text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vm.caixaLinhas
                      .filter(linha => linha.receita || linha.saida)
                      .map((linha) => (
                        <tr key={linha.mes}>
                          <td>{linha.rotulo}</td>
                          <td className="text-right"><Dinheiro centavos={linha.receita} /></td>
                          <td className="text-right"><Dinheiro centavos={linha.saida} /></td>
                          <td className="text-right"><Dinheiro centavos={linha.saldo} destaque /></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
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
      <div className="mt-4">
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

    </div>
  );
}
