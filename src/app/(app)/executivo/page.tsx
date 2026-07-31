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
import {
  nivelAtraso,
  nivelInadimplencia,
  nivelSaldo,
  nivelTarefas,
  nivelTaxaRecebimento,
  nivelVariacao,
  type Nivel,
} from "@/lib/dominio/semaforo";
import { dadosExecutivos, mesPadrao } from "@/lib/consultas/executivo";
import {
  BarraComposicao,
  BarrasCaixa,
  BarrasDuplas,
  BarrasMensais,
  COR_1,
  COR_2,
  COR_3,
  Legenda,
  Medidor,
  Rosca,
} from "@/components/graficos";

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
  const mesAnterior = mesNum > 1 ? d.porMes[mesNum - 2] : null;
  const caixaAnterior = mesNum > 1 ? d.caixaPorMes[mesNum - 2] : null;
  const nomeMes = NOME_MES_COMPLETO[mesNum].toLowerCase();
  const taxaPct = d.taxaRecebimento !== null ? d.taxaRecebimento * 100 : null;

  // rosca: composição da comissão do mês — top 3 empreendimentos + "Outros"
  const empOrdenados = [...d.porEmpreendimento]
    .filter((e) => e.comissaoMes > 0)
    .sort((a, b) => b.comissaoMes - a.comissaoMes);
  const roscaFatias = [
    ...empOrdenados.slice(0, 3).map((e) => ({
      rotulo: e.nome,
      valor: e.comissaoMes,
    })),
    ...(empOrdenados.length > 3
      ? [
          {
            rotulo: `Outros (${empOrdenados.length - 3})`,
            valor: empOrdenados
              .slice(3)
              .reduce((s, e) => s + e.comissaoMes, 0),
          },
        ]
      : []),
  ];

  // ---- semáforos -----------------------------------------------------------
  const nvTaxa = nivelTaxaRecebimento(d.taxaRecebimento);
  const nvInad = nivelInadimplencia(d.inadimplentesValor, d.devidoMes);
  const nvCaixa = d.caixaMes ? nivelSaldo(d.saldoCaixaMes) : "neutro";
  const nvReaj = nivelTarefas(d.reajustesDoMes.length);
  const nvComissao = nivelVariacao(d.comissaoMes, mesAnterior?.comissao ?? null);
  const nvTemporada: Nivel =
    d.lucroTemporadaMes === null
      ? "neutro"
      : d.lucroTemporadaMes > 0
        ? "otimo"
        : d.lucroTemporadaMes < 0
          ? "critico"
          : "neutro";
  const gravesQtde = d.pendentesDoMes.filter(
    (p) => p.diasAtraso !== null && p.diasAtraso > 30
  ).length;

  const alertas: ItemAlerta[] = [];
  if (gravesQtde > 0) {
    alertas.push({
      nivel: "critico",
      titulo: "Cobranças acima de 30 dias",
      texto: `${gravesQtde} ${gravesQtde === 1 ? "cobrança passou" : "cobranças passaram"} de 30 dias do vencimento em ${nomeMes}. Essas encabeçam a lista de hoje.`,
      acao: { rotulo: "Painel de cobrança", href: `/paineis/cobranca?mes=${mes}` },
    });
  }
  if (nvTaxa !== "otimo" && d.taxaRecebimento !== null) {
    alertas.push({
      nivel: nvTaxa,
      titulo: "Taxa de recebimento abaixo de 95%",
      texto: `Entrou ${pct(d.taxaRecebimento)} do devido — ${formatarBRL(d.recebidoMes)} de ${formatarBRL(d.devidoMes)}. A diferença está nos ${d.inadimplentesQtde} pendentes listados abaixo.`,
      acao: { rotulo: "Registrar", href: `/recebimentos?mes=${mes}` },
    });
  }
  if (d.reajustesDoMes.length > 0) {
    alertas.push({
      nivel: nvReaj,
      titulo: "Reajustes para aplicar",
      texto: `${d.reajustesDoMes.length} ${d.reajustesDoMes.length === 1 ? "contrato faz" : "contratos fazem"} aniversário de correção em ${nomeMes}. Aplique o índice e atualize o aluguel-base.`,
      acao: { rotulo: "Abrir contratos", href: "/contratos" },
    });
  }
  if (d.caixaMes && d.saldoCaixaMes < 0) {
    alertas.push({
      nivel: "critico",
      titulo: "Caixa negativo no mês",
      texto: `Saíram ${formatarBRL(Math.abs(d.saldoCaixaMes))} a mais do que entraram em ${nomeMes}. Verifique os centros de custo antes de fechar.`,
      acao: { rotulo: "Abrir caixa", href: `/caixa?mes=${mes}` },
    });
  }
  if (!d.mesFechado) {
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
        descricao={`Todos os indicadores da operação — ${NOME_MES_COMPLETO[mesNum]} de ${d.ano}`}
        acoes={
          <div className="flex items-center gap-3">
            {d.mesFechado ? (
              <Selo nivel="otimo">mês fechado</Selo>
            ) : (
              <Selo nivel="info">mês aberto</Selo>
            )}
            <SeletorMes base="/executivo" mes={mes} />
          </div>
        }
      />

      {/* ---------- resumo do mês em linguagem natural ---------- */}
      <Card className="mb-4 px-6 py-4" nivel={nvTaxa}>
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-tinta-suave">
          O mês em uma frase
          <Ajuda dica="A leitura do mês em português, para quem não quer ler tabela: quanto entrou, quanto virou comissão, o que ficou pendente e o que está na sua mesa. A cor da faixa lateral é a do indicador mais importante — a taxa de recebimento." />
        </div>
        <p className="text-sm leading-relaxed text-tinta">
          Em <strong>{nomeMes}</strong>, entraram{" "}
          <strong>{formatarBRL(d.recebidoMes)}</strong> dos locatários e a
          administradora ganhou{" "}
          <strong className="font-serif text-base text-oliva-escura">
            {formatarBRL(d.comissaoMes)}
          </strong>{" "}
          de comissão.{" "}
          {d.inadimplentesQtde > 0 ? (
            <>
              <strong>{d.inadimplentesQtde} cobrança(s)</strong> somando{" "}
              <strong>{formatarBRL(d.inadimplentesValor)}</strong> ainda não
              foram pagas
            </>
          ) : (
            <>Todas as cobranças do mês foram pagas</>
          )}
          {d.reajustesDoMes.length > 0 ? (
            <>
              {" "}e <strong>{d.reajustesDoMes.length} contrato(s)</strong>{" "}
              fazem aniversário de reajuste.
            </>
          ) : (
            <>.</>
          )}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {taxaPct !== null ? (
            <Selo nivel={nvTaxa}>
              recebemos {pct(d.taxaRecebimento)} do devido
            </Selo>
          ) : null}
          {d.caixaMes ? (
            <Selo nivel={nvCaixa}>
              caixa {d.saldoCaixaMes >= 0 ? "positivo" : "negativo"} no mês
            </Selo>
          ) : null}
          {d.reajustesDoMes.length > 0 ? (
            <Selo nivel={nvReaj}>
              {d.reajustesDoMes.length} reajuste(s) para aplicar
            </Selo>
          ) : null}
          {d.inadimplentesQtde > 0 ? (
            <Selo nivel={nvInad}>
              {d.inadimplentesQtde} cobrança(s) em aberto
            </Selo>
          ) : (
            <Selo nivel="otimo">nenhuma cobrança em aberto</Selo>
          )}
        </div>
      </Card>

      <PainelAlertas
        itens={alertas}
        ajuda="Fila de atenção do mês, do mais urgente para o menos. Cada linha diz o que aconteceu, o que fazer e leva direto para a tela certa."
        vazio={`${NOME_MES_COMPLETO[mesNum]} está fechado e em dia — nada pendente de cobrança, caixa positivo e nenhum reajuste a aplicar.`}
      />

      {/* ---------- KPIs ---------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Comissão do mês"
          valor={<Dinheiro centavos={d.comissaoMes} destaque />}
          variacao={
            <Variacao
              atual={d.comissaoMes}
              anterior={mesAnterior?.comissao ?? null}
            />
          }
          detalhe="o que a administradora ganhou"
          nivel={nvComissao}
          selo={
            nvComissao === "otimo"
              ? "cresceu"
              : nvComissao === "atencao"
                ? "caiu"
                : "estável"
          }
          ajuda="Calculada sobre o que realmente entrou: (recebido − IPTU − condomínio) × taxa do mês (padrão 10%). Repasses nunca entram. O número cresce conforme você registra pagamentos em Recebimentos."
        />
        <Kpi
          rotulo="Comissão acumulada no ano"
          valor={<Dinheiro centavos={d.comissaoAcumuladaAno} destaque />}
          detalhe={`somando JAN a ${NOME_MES_ABREV[mesNum]} de ${d.ano}`}
          nivel="info"
          selo={`${d.ultimoMesComDados} ${d.ultimoMesComDados === 1 ? "mês" : "meses"}`}
          href={`/relatorios/comissao?ano=${d.ano}`}
          ajuda="Soma das comissões de janeiro até o mês selecionado, pelo mês de lançamento de cada cobrança. Bate com o subtotal da matriz de comissão em Relatórios."
        />
        <Kpi
          rotulo="Taxa de recebimento"
          valor={pct(d.taxaRecebimento)}
          detalhe={`entrou ${formatarBRL(d.recebidoMes)} de ${formatarBRL(d.devidoMes)} devidos (acima de 100% = atrasos quitados)`}
          nivel={nvTaxa}
          nota={
            nvTaxa === "critico"
              ? "Abaixo de 80% do devido: a lista de cobrança é a prioridade do dia."
              : nvTaxa === "atencao"
                ? "Entre 80% e 95%: falta pouco — veja quem ainda não pagou."
                : undefined
          }
          grafico={
            d.devidoMes > 0 ? (
              <BarraComposicao
                partes={[
                  { rotulo: "recebido", valor: d.recebidoMes, cor: COR_1 },
                  {
                    rotulo: "a receber",
                    valor: Math.max(d.devidoMes - d.recebidoMes, 0),
                    cor: COR_2,
                  },
                ]}
              />
            ) : undefined
          }
          ajuda="Total recebido dividido pelo total devido do mês. Acima de 100% é bom sinal: alguém quitou atrasos de meses anteriores. Bem abaixo de 100%, veja a lista de pendentes e cobre."
        />
        <Kpi
          rotulo="Inadimplência do mês"
          valor={<Dinheiro centavos={d.inadimplentesValor} destaque />}
          variacao={
            <Variacao
              atual={d.inadimplentesValor}
              anterior={mesAnterior?.pendenteValor ?? null}
              bomQuandoSobe={false}
            />
          }
          detalhe={`${d.inadimplentesQtde} cobrança(s) aguardando pagamento`}
          nivel={nvInad}
          nota={
            gravesQtde > 0
              ? `${gravesQtde} ${gravesQtde === 1 ? "cobrança já passou" : "cobranças já passaram"} de 30 dias — comece por elas.`
              : undefined
          }
          href={`/relatorios/inadimplencia?mes=${mes}`}
          ajuda="Cobranças do mês ainda sem pagamento registrado (aluguel + repasses). Quando o locatário pagar, registre em Recebimentos com a data e a via — a pendência some automaticamente."
        />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Recebido no mês"
          valor={<Dinheiro centavos={d.recebidoMes} destaque />}
          variacao={
            <Variacao
              atual={d.recebidoMes}
              anterior={mesAnterior?.recebido ?? null}
            />
          }
          detalhe="aluguel + repasses (IPTU/cond.)"
          nivel={nivelVariacao(d.recebidoMes, mesAnterior?.recebido ?? null)}
          selo="vs mês anterior"
          ajuda="Tudo o que os locatários pagaram no mês, incluindo IPTU e condomínio (que são repassados ao proprietário). Não é o ganho da administradora — o ganho é a comissão."
        />
        <Kpi
          rotulo="Saldo de caixa do mês"
          valor={<Dinheiro centavos={d.saldoCaixaMes} destaque />}
          variacao={
            d.caixaMes ? (
              <Variacao
                atual={d.saldoCaixaMes}
                anterior={caixaAnterior?.saldo ?? null}
              />
            ) : undefined
          }
          detalhe={
            d.caixaMes
              ? `entrou ${formatarBRL(d.caixaMes.receita)}, saiu ${formatarBRL(d.caixaMes.despesaAL + d.caixaMes.despesaCH)}`
              : "sem lançamentos no mês"
          }
          nivel={nvCaixa}
          selo={
            !d.caixaMes
              ? undefined
              : d.saldoCaixaMes >= 0
                ? "positivo"
                : "negativo"
          }
          nota={
            d.caixaMes && d.saldoCaixaMes < 0
              ? "Saiu mais do que entrou — confira os centros de custo dos lançamentos."
              : undefined
          }
          href={`/caixa?mes=${mes}`}
          ajuda="Entradas menos as saídas dos centros Antonio/Laura e Chácara Brisa, do livro-caixa. Recebimentos em dinheiro são registro paralelo de espécie e ficam fora do saldo. Lançado na tela Caixa."
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
              ? `entrou ${formatarBRL(d.receitaTemporadaMes)}, gastou ${formatarBRL(d.despesaTemporadaMes)}`
              : `Airbnb rendeu ${formatarBRL(d.comissaoAirbnbMes)} de comissão no mês`
          }
          nivel={nvTemporada}
          selo={
            d.lucroTemporadaMes === null
              ? undefined
              : d.lucroTemporadaMes > 0
                ? "no azul"
                : d.lucroTemporadaMes < 0
                  ? "no vermelho"
                  : undefined
          }
          nota={
            d.lucroTemporadaMes !== null && d.lucroTemporadaMes < 0
              ? "Despesas e limpezas passaram do que as plataformas repassaram."
              : undefined
          }
          href={`/temporada?mes=${mes}`}
          ajuda="Repasses do Airbnb menos despesas (energia, condomínio, IPTU, extras) e limpezas do mês, lançados na tela Temporada. A receita deve conciliar com a linha AIRBNB do núcleo de recebimentos."
        />
        <Kpi
          rotulo="Contratos a reajustar"
          valor={String(d.reajustesDoMes.length)}
          detalhe={`aluguéis com aniversário em ${nomeMes} — hora de corrigir o valor`}
          nivel={nvReaj}
          selo={d.reajustesDoMes.length === 0 ? "nada a fazer" : "na sua mesa"}
          nota={
            d.reajustesDoMes.length > 0
              ? "O sistema avisa, mas quem aplica o índice e atualiza o aluguel é você."
              : undefined
          }
          href={d.reajustesDoMes.length > 0 ? "/contratos" : undefined}
          ajuda="Contratos cujo mês de reajuste é o mês em tela. Aplique o índice combinado (IGP-M, IPCA...) e atualize o valor em Contratos — o sistema avisa, mas não reajusta sozinho."
        />
      </div>

      {/* ---------- visão rápida: medidor + rosca ---------- */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <TituloCard
            titulo="Quanto do mês já entrou"
            nivel={nvTaxa}
            ajuda="Do total que era devido no mês, quanto já foi recebido. O arco traz as três zonas do semáforo desenhadas: verde a partir de 95%, âmbar de 80% a 95%, vermelho abaixo disso. Passa de 100% quando alguém quita atrasos de meses anteriores."
          />
          {d.taxaRecebimento !== null ? (
            <>
              <Medidor
                fracao={d.taxaRecebimento}
                rotulo="Taxa de recebimento"
              />
              <p className="mt-1 text-center text-xs text-tinta-suave">
                recebido{" "}
                <strong className="font-mono text-tinta">
                  {formatarBRL(d.recebidoMes)}
                </strong>{" "}
                de {formatarBRL(d.devidoMes)} devidos
              </p>
              {d.inadimplentesValor > 0 ? (
                <p className="mt-2 text-center text-xs text-tinta-suave">
                  faltam {formatarBRL(d.inadimplentesValor)} em{" "}
                  {d.inadimplentesQtde} cobrança(s) —{" "}
                  <Link
                    href={`/paineis/cobranca?mes=${mes}`}
                    className="font-semibold text-oliva-escura hover:underline"
                  >
                    ver quem falta
                  </Link>
                </p>
              ) : null}
            </>
          ) : (
            <p className="py-8 text-center text-sm text-tinta-suave">
              Nada devido neste mês ainda.
            </p>
          )}
        </Card>

        <Card className="p-5">
          <TituloCard
            titulo="De onde veio a comissão do mês"
            ajuda="Participação de cada empreendimento na comissão do mês. Mostra os 3 maiores e agrupa o resto em Outros — útil para enxergar de quem o resultado depende e o que aconteceria se aquele contrato encerrasse."
          />
          {roscaFatias.length > 0 ? (
            <Rosca
              fatias={roscaFatias}
              centroTitulo="total"
              centroValor={formatarBRL(comissaoMesTotal).replace("R$ ", "")}
            />
          ) : (
            <p className="py-8 text-center text-sm text-slate-500">
              Sem comissão registrada neste mês.
            </p>
          )}
        </Card>
      </div>

      {/* ---------- gráficos do núcleo ---------- */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <TituloCard
            titulo="Comissão mês a mês"
            ajuda="Cada coluna é o ganho da administradora naquele mês, pelo mês de lançamento da cobrança. A coluna com halo é o mês em tela. Passe o mouse em qualquer coluna para ver o valor exato."
            direita={
              <span className="font-mono text-[12px] text-tinta-suave">
                total {d.ano}:{" "}
                <strong className="text-tinta">
                  {formatarBRL(d.porMes.reduce((a, l) => a + l.comissao, 0))}
                </strong>
              </span>
            }
          />
          <BarrasMensais
            valores={d.porMes.map((l) => l.comissao)}
            mesSelecionado={mesNum}
          />
          <p className="mt-2 text-xs text-tinta-suave">
            A coluna destacada é o mês que você está vendo; a etiqueta de valor
            aparece nele e no melhor mês do ano.
          </p>
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
          <TituloCard
            titulo="Devido × Recebido"
            ajuda="Lado a lado, mês a mês: a coluna ocre é o que era para entrar, a verde é o que entrou. Verde menor que ocre = mês com pendência. Verde maior = alguém quitou atraso de outro mês ali."
            direita={
              <Legenda
                itens={[
                  { cor: COR_2, nome: "Devido" },
                  { cor: COR_1, nome: "Recebido" },
                ]}
              />
            }
          />
          <BarrasDuplas
            serieA={d.porMes.map((l) => l.devido)}
            serieB={d.porMes.map((l) => l.recebido)}
            nomeA="Devido"
            nomeB="Recebido"
            corA={COR_2}
            corB={COR_1}
            mesSelecionado={mesNum}
          />
          <p className="mt-2 text-xs text-tinta-suave">
            Recebido acima do devido indica atrasos quitados no mês; abaixo,
            inadimplência ou pagamentos parciais.
          </p>
        </Card>
      </div>

      {/* ---------- comissão por empreendimento ---------- */}
      <Card className="mt-4 p-5">
        <TituloCard
          titulo={`Comissão por empreendimento — ${formatarCompetencia(mes)}`}
          ajuda="Quanto cada empreendimento rendeu de comissão no mês e no ano, com o ticket médio por cobrança e a curva de evolução. O ponto colorido na frente marca quem está puxando o resultado para cima ou para baixo."
          direita={<LinkCard href="/relatorios/comissao">Matriz completa</LinkCard>}
        />
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                <th>
                  <span className="sr-only">Situação</span>
                  <Ajuda dica="Compara a comissão do mês com a média deste mesmo empreendimento nos meses com movimento do ano. Verde = acima da média, âmbar = abaixo, cinza = sem histórico para comparar." />
                </th>
                <th>Empreendimento</th>
                <th className="text-right">
                  Comissão no mês{" "}
                  <Ajuda dica="Ganho da administradora neste empreendimento no mês: (recebido − IPTU − condomínio) × taxa de cada contrato." />
                </th>
                <th className="text-right">
                  % do mês{" "}
                  <Ajuda dica="Fatia deste empreendimento na comissão total do mês. Mostra de onde vem o ganho da administradora." />
                </th>
                <th className="text-right">Acumulada no ano</th>
                <th className="text-right">Recebido no mês</th>
                <th className="text-right">
                  Ticket médio{" "}
                  <Ajuda dica="Valor médio recebido por cobrança paga do empreendimento no mês. Ajuda a comparar empreendimentos de portes diferentes." />
                </th>
                <th>Evolução ({NOME_MES_ABREV[1]}–{NOME_MES_ABREV[d.ultimoMesComDados]})</th>
              </tr>
            </thead>
            <tbody>
              {d.porEmpreendimento.map((e) => {
                const meses = e.serieComissao.filter((v) => v > 0);
                const media = meses.length
                  ? meses.reduce((a, v) => a + v, 0) / meses.length
                  : 0;
                const nv: Nivel =
                  media === 0
                    ? "neutro"
                    : e.comissaoMes >= media
                      ? "otimo"
                      : "atencao";
                return (
                <tr key={e.id}>
                  <td>
                    <Ponto
                      nivel={nv}
                      titulo={
                        media === 0
                          ? "sem histórico para comparar"
                          : e.comissaoMes >= media
                            ? `acima da média do ano (${formatarBRL(Math.round(media))})`
                            : `abaixo da média do ano (${formatarBRL(Math.round(media))})`
                      }
                    />
                  </td>
                  <td className="font-medium">{e.nome}</td>
                  <td className="text-right"><Dinheiro centavos={e.comissaoMes} /></td>
                  <td className="text-right text-tinta-suave">
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
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td />
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
        <TituloCard
          titulo="Caixa — receita × despesas por centro"
          nivel={nvCaixa}
          ajuda="Mês a mês: a coluna verde é quanto entrou no livro-caixa; a coluna ao lado empilha as saídas dos dois centros de custo (Antonio/Laura embaixo, Chácara Brisa em cima). Mês saudável é aquele em que o verde supera a pilha."
          direita={
            <Legenda
              itens={[
                { cor: COR_1, nome: "Receita (entradas)" },
                { cor: COR_2, nome: "Despesa Antonio/Laura" },
                { cor: COR_3, nome: "Despesa Chácara Brisa" },
              ]}
            />
          }
        />
        <BarrasCaixa
          receita={d.caixaPorMes.map((c) => c.receita)}
          despesaAL={d.caixaPorMes.map((c) => c.despesaAL)}
          despesaCH={d.caixaPorMes.map((c) => c.despesaCH)}
        />
        <p className="mt-2 text-xs text-tinta-suave">
          Verde = quanto entrou; a pilha ocre + índigo = quanto saiu em cada
          centro. Mês bom é o verde maior que a pilha.
        </p>
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
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card
          className="p-5"
          nivel={d.reajustesDoMes.length > 0 ? nvReaj : undefined}
        >
          <TituloCard
            titulo={`Reajustes de ${NOME_MES_COMPLETO[mesNum].toLowerCase()}`}
            nivel={d.reajustesDoMes.length > 0 ? nvReaj : "otimo"}
            ajuda="Contratos cujo aniversário de correção cai neste mês. Aplique o índice combinado sobre o aluguel-base (sem IPTU nem condomínio) e atualize o valor em Contratos — nada disso é automático."
            direita={
              d.reajustesDoMes.length > 0 ? (
                <LinkCard href="/contratos">Abrir contratos</LinkCard>
              ) : (
                <Selo nivel="otimo">nada a aplicar</Selo>
              )
            }
          />
          {d.reajustesDoMes.length === 0 ? (
            <p className="text-sm text-tinta-suave">
              Nenhum contrato com aniversário de reajuste neste mês.
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
            </div>
          )}
        </Card>

        <Card className="p-5">
          <TituloCard
            titulo="Pendentes do mês (sem recebimento)"
            nivel={d.pendentesDoMes.length > 0 ? nvInad : "otimo"}
            ajuda="As dez maiores cobranças do mês ainda sem pagamento registrado. O ponto colorido é o semáforo do atraso: âmbar venceu há até 30 dias, vermelho passou disso, azul ainda não venceu."
            direita={
              <span className="font-mono text-[12px] text-tinta-suave">
                {d.inadimplentesQtde} ·{" "}
                <strong className="text-tinta">
                  {formatarBRL(d.inadimplentesValor)}
                </strong>
              </span>
            }
          />
          {d.pendentesDoMes.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-tinta-suave">
              <Selo nivel="otimo">tudo recebido</Selo>
              Todas as cobranças do mês foram recebidas.
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
                    <th>Empreendimento</th>
                    <th>Locatário</th>
                    <th>Localização</th>
                    <th className="text-right">
                      Devido{" "}
                      <Ajuda dica="Aluguel + IPTU + condomínio da cobrança pendente. Registre o pagamento em Recebimentos assim que entrar." />
                    </th>
                    <th className="text-right">
                      Atraso{" "}
                      <Ajuda dica="Dias corridos desde o vencimento do contrato. Acima de 30 dias fica vermelho — priorize a cobrança." />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.pendentesDoMes.slice(0, 10).map((p, i) => {
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
                      <td>{p.empreendimento}</td>
                      <td>{p.locatario}</td>
                      <td>{p.localizacao}</td>
                      <td className="text-right"><Dinheiro centavos={p.totalDevido} /></td>
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
          {d.pendentesDoMes.length > 10 ? (
            <p className="mt-2 text-xs text-slate-500">
              Mostrando 10 de {d.pendentesDoMes.length} — lista completa em{" "}
              <Link href={`/relatorios/inadimplencia?mes=${mes}`} className="font-semibold text-oliva-escura hover:underline">
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
import { Sparkline } from "@/components/graficos";
function BarraSparkline({ valores }: { valores: number[] }) {
  return <Sparkline valores={valores} />;
}
