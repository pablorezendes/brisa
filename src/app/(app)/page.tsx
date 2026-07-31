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
  type ItemAlerta,
} from "@/components/ui";
import {
  AreaTendencia,
  BarraComposicao,
  BarrasHorizontais,
  COR_1,
  COR_2,
  Sparkline,
} from "@/components/graficos";
import {
  comissaoDoMesPorEmpreendimento,
  contratosAReajustarDoMes,
  kpisDoMes,
  matrizComissao,
  mesMaisRecenteComLancamentos,
  pendentesDoMes,
} from "@/lib/consultas/relatorios";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import {
  formatarCompetencia,
  NOME_MES_COMPLETO,
  parseCompetencia,
} from "@/lib/dominio/normalizacao";
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
  searchParams: Promise<{ mes?: string }>;
}) {
  const sp = await searchParams;
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? "")
    ? (sp.mes as string)
    : await mesMaisRecenteComLancamentos();
  const { ano, mes: mesNum } = parseCompetencia(mes);
  const nomeMes = NOME_MES_COMPLETO[mesNum].toLowerCase();

  const [kpis, comissaoPorEmp, reajustes, pendentes, matriz] =
    await Promise.all([
      kpisDoMes(mes),
      comissaoDoMesPorEmpreendimento(mes),
      contratosAReajustarDoMes(mes),
      pendentesDoMes(mes),
      matrizComissao(ano),
    ]);
  const topPendentes = pendentes.slice(0, 8);

  // ---- semáforos de cada indicador ----------------------------------------
  const nivelTaxa = nivelTaxaRecebimento(kpis.taxaRecebimento);
  const nivelInad = nivelInadimplencia(
    kpis.inadimplencia.valorDevido,
    kpis.devidoMes
  );
  const nivelCaixa = nivelSaldo(kpis.saldoCaixaMes);
  const nivelReaj = nivelTarefas(kpis.contratosAReajustar);
  const nivelTemporada: Nivel =
    kpis.lucroTemporadaMes > 0
      ? "otimo"
      : kpis.lucroTemporadaMes < 0
        ? "critico"
        : "neutro";

  // comissão do mês vs. média dos meses do ano que já tiveram movimento
  const mesesComComissao = matriz.totalPorMes.filter((v) => v > 0);
  const mediaComissao = mesesComComissao.length
    ? mesesComComissao.reduce((a, v) => a + v, 0) / mesesComComissao.length
    : 0;
  const nivelComissao: Nivel =
    mediaComissao === 0
      ? "neutro"
      : kpis.comissaoMes >= mediaComissao
        ? "otimo"
        : kpis.comissaoMes >= mediaComissao * 0.85
          ? "info"
          : "atencao";

  // atrasos: quantas pendências já passaram de 30 dias
  const vencidasGraves = pendentes.filter(
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
      acao: { rotulo: "Ver lista de cobrança", href: `/paineis/cobranca?mes=${mes}` },
    });
  }
  if (kpis.inadimplencia.quantidade > 0) {
    alertas.push({
      nivel: nivelInad,
      titulo: "Cobranças sem pagamento",
      texto: `${kpis.inadimplencia.quantidade} ${kpis.inadimplencia.quantidade === 1 ? "lançamento" : "lançamentos"} de ${nomeMes} ainda sem recebimento — ${formatarBRL(kpis.inadimplencia.valorDevido)} a entrar. Quando o dinheiro cair, registre em Recebimentos e a linha some sozinha.`,
      acao: { rotulo: "Registrar", href: `/recebimentos?mes=${mes}` },
    });
  }
  if (nivelTaxa === "critico" || nivelTaxa === "atencao") {
    alertas.push({
      nivel: nivelTaxa,
      titulo: "Taxa de recebimento abaixo do esperado",
      texto: `Entrou ${fmtPercentual.format(kpis.taxaRecebimento ?? 0)} do que era devido em ${nomeMes} (${formatarBRL(kpis.recebidoMes)} de ${formatarBRL(kpis.devidoMes)}). Abaixo de 95% já vale passar a lista de cobrança.`,
      acao: { rotulo: "Painel de cobrança", href: `/paineis/cobranca?mes=${mes}` },
    });
  }
  if (kpis.contratosAReajustar > 0) {
    alertas.push({
      nivel: nivelReaj,
      titulo: "Reajustes para aplicar",
      texto: `${kpis.contratosAReajustar} ${kpis.contratosAReajustar === 1 ? "contrato faz" : "contratos fazem"} aniversário de correção em ${nomeMes}. O sistema avisa, mas quem aplica o índice e atualiza o aluguel é você.`,
      acao: { rotulo: "Abrir contratos", href: "/contratos" },
    });
  }
  if (kpis.saldoCaixaMes < 0) {
    alertas.push({
      nivel: "critico",
      titulo: "Caixa negativo no mês",
      texto: `As saídas superaram as entradas em ${formatarBRL(Math.abs(kpis.saldoCaixaMes))} em ${nomeMes}. Confira se alguma despesa foi lançada no centro de custo errado antes de fechar o mês.`,
      acao: { rotulo: "Abrir caixa", href: `/caixa?mes=${mes}` },
    });
  }

  // ---- gráficos ------------------------------------------------------------
  const serieComissao = matriz.totalPorMes.slice(0, Math.max(mesNum, 1));
  const rankingEmp = comissaoPorEmp
    .filter((c) => c.comissao > 0)
    .slice(0, 6)
    .map((c) => ({ rotulo: c.empreendimento, valor: c.comissao }));

  return (
    <div className="max-w-7xl">
      <PageHeader
        titulo="Visão geral"
        descricao={`Resumo gerencial de ${formatarCompetencia(mes)} — comissão, inadimplência, reajustes, caixa e temporada.`}
        acoes={<SeletorMes base="/" mes={mes} />}
      />

      <PainelAlertas
        itens={alertas}
        ajuda="A fila do dia, do mais urgente para o menos. Vermelho é 'aja agora', âmbar é 'olhe hoje, ainda dá tempo'. Cada linha leva direto para a tela onde a pendência se resolve."
        vazio={`Nada pedindo atenção em ${nomeMes} — cobranças recebidas, caixa positivo e nenhum reajuste a aplicar.`}
      />

      {/* ---------- indicadores ---------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Comissão do mês"
          valor={<Dinheiro centavos={kpis.comissaoMes} />}
          detalhe={`mês de lançamento ${formatarCompetencia(mes)}`}
          nivel={nivelComissao}
          selo={
            nivelComissao === "otimo"
              ? "acima da média"
              : nivelComissao === "info"
                ? "na média"
                : "abaixo da média"
          }
          nota={
            mediaComissao > 0 && kpis.comissaoMes < mediaComissao * 0.85
              ? `Média dos meses com movimento no ano: ${formatarBRL(Math.round(mediaComissao))}. Confira se faltam recebimentos por lançar.`
              : undefined
          }
          grafico={<Sparkline valores={serieComissao} />}
          ajuda="O que a administradora ganhou no mês: a taxa vigente (padrão 10%) sobre o aluguel efetivamente recebido. IPTU e condomínio são repasses ao proprietário e nunca entram na conta. Só muda quando você registra pagamentos em Recebimentos."
        />
        <Kpi
          rotulo="Acumulada no ano"
          valor={<Dinheiro centavos={kpis.comissaoAcumuladaAno} />}
          detalhe={`JAN–${formatarCompetencia(mes)}`}
          nivel="info"
          selo={`${mesesComComissao.length} ${mesesComComissao.length === 1 ? "mês" : "meses"}`}
          href={`/relatorios/comissao?ano=${ano}`}
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
          nivel={nivelInad}
          nota={
            vencidasGraves.length > 0
              ? `${vencidasGraves.length} ${vencidasGraves.length === 1 ? "cobrança já passou" : "cobranças já passaram"} de 30 dias — priorize essas.`
              : kpis.inadimplencia.quantidade > 0
                ? "Registre o pagamento em Recebimentos assim que o dinheiro cair."
                : undefined
          }
          href={`/relatorios/inadimplencia?mes=${mes}`}
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
          nivel={nivelTaxa}
          nota={
            nivelTaxa === "critico"
              ? "Abaixo de 80%: passe a lista de cobrança ainda hoje."
              : nivelTaxa === "atencao"
                ? "Entre 80% e 95%: falta pouco, veja quem está pendente."
                : undefined
          }
          grafico={
            kpis.devidoMes > 0 ? (
              <BarraComposicao
                partes={[
                  {
                    rotulo: "recebido",
                    valor: kpis.recebidoMes,
                    cor: COR_1,
                  },
                  {
                    rotulo: "a receber",
                    valor: Math.max(kpis.devidoMes - kpis.recebidoMes, 0),
                    cor: COR_2,
                  },
                ]}
              />
            ) : undefined
          }
          ajuda="Quanto do que era devido no mês já entrou. Pode passar de 100% quando alguém quita um atraso de meses anteriores junto — nesse caso lance tudo em Recebido e anote o motivo na Observação."
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi
          rotulo="Contratos a reajustar"
          valor={kpis.contratosAReajustar}
          detalhe="mês de reajuste igual ao mês atual"
          nivel={nivelReaj}
          selo={kpis.contratosAReajustar === 0 ? "nada a fazer" : "na sua mesa"}
          nota={
            kpis.contratosAReajustar > 0
              ? "Aplique o índice combinado e atualize o valor em Contratos — o sistema não reajusta sozinho."
              : undefined
          }
          href={kpis.contratosAReajustar > 0 ? "/contratos" : undefined}
          ajuda="Contratos que fazem aniversário de correção neste mês. É hora de aplicar o índice (IGP-M, IPCA...) e atualizar o valor do aluguel na tela de Contratos — o sistema não reajusta sozinho."
        />
        <Kpi
          rotulo="Saldo de caixa do mês"
          valor={<Dinheiro centavos={kpis.saldoCaixaMes} />}
          detalhe="entradas − saídas AL − saídas CH"
          nivel={nivelCaixa}
          selo={
            kpis.saldoCaixaMes > 0
              ? "positivo"
              : kpis.saldoCaixaMes < 0
                ? "negativo"
                : undefined
          }
          nota={
            kpis.saldoCaixaMes < 0
              ? "Saiu mais do que entrou. Confira se alguma despesa caiu no centro de custo errado."
              : undefined
          }
          href={`/caixa?mes=${mes}`}
          ajuda="Entradas do caixa menos as saídas dos dois centros (Antonio/Laura e Chácara Brisa). Recebimentos em dinheiro são um registro paralelo de espécie e não entram neste saldo."
        />
        <Kpi
          rotulo="Lucro temporada"
          valor={<Dinheiro centavos={kpis.lucroTemporadaMes} />}
          detalhe="receitas − despesas − limpezas"
          nivel={nivelTemporada}
          selo={
            kpis.lucroTemporadaMes > 0
              ? "no azul"
              : kpis.lucroTemporadaMes < 0
                ? "no vermelho"
                : "sem lançamentos"
          }
          nota={
            kpis.lucroTemporadaMes < 0
              ? "As despesas e limpezas passaram do que as plataformas repassaram no mês."
              : undefined
          }
          href={`/temporada?mes=${mes}`}
          ajuda="Resultado do Airbnb no mês: o que as plataformas repassaram menos despesas (energia, condomínio, IPTU) e o pagamento das limpezas. Lançado na tela Temporada."
        />
      </div>

      {/* ---------- comissão do ano ---------- */}
      <Card className="mt-6 px-5 py-4">
        <TituloCard
          titulo={`Comissão mês a mês em ${ano}`}
          ajuda="A curva do ganho da administradora ao longo do ano, pelo mês de lançamento de cada cobrança. O ponto cheio é o mês que você está vendo. Subidas e quedas acompanham quanto foi efetivamente recebido, não quanto foi cobrado."
          direita={
            <>
              <span className="font-mono text-[12px] text-tinta-suave">
                total {ano}:{" "}
                <strong className="text-tinta">
                  {formatarBRL(matriz.totalGeral)}
                </strong>
              </span>
              <LinkCard href={`/relatorios/comissao?ano=${ano}`}>
                Matriz completa
              </LinkCard>
            </>
          }
        />
        <AreaTendencia
          valores={matriz.totalPorMes}
          destaque={mesNum}
          rotuloAcessivel={`Comissão mês a mês em ${ano}`}
        />
        <p className="mt-2 text-xs text-tinta-suave">
          Passe o mouse em qualquer ponto para ver o valor exato do mês.
        </p>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ---------- comissão por empreendimento ---------- */}
        <Card className="px-5 py-4">
          <TituloCard
            titulo="Comissão por empreendimento no mês"
            ajuda="De onde veio o ganho da administradora neste mês. A barra compara cada empreendimento com o maior deles — quanto mais curta, menor a participação. Serve para ver de quem o resultado depende."
            direita={
              <LinkCard href={`/relatorios/comissao?ano=${ano}`}>
                Matriz completa
              </LinkCard>
            }
          />
          {rankingEmp.length > 0 ? (
            <>
              <BarrasHorizontais itens={rankingEmp} cor={COR_1} />
              {comissaoPorEmp.length > rankingEmp.length ? (
                <p className="mt-2 text-xs text-tinta-suave">
                  Mostrando os {rankingEmp.length} maiores de{" "}
                  {comissaoPorEmp.length} empreendimentos com comissão no mês.
                </p>
              ) : null}
              <div className="mt-3 flex items-center justify-between border-t border-contorno pt-2.5 text-sm">
                <span className="font-semibold text-tinta">Total do mês</span>
                <Dinheiro centavos={kpis.comissaoMes} destaque />
              </div>
            </>
          ) : (
            <p className="py-8 text-center text-sm text-tinta-suave">
              Nenhuma comissão em {formatarCompetencia(mes)}.
            </p>
          )}
        </Card>

        {/* ---------- pendentes ---------- */}
        <Card className="px-5 py-4" nivel={pendentes.length > 0 ? nivelInad : "otimo"}>
          <TituloCard
            titulo="Pendentes do mês"
            nivel={pendentes.length > 0 ? nivelInad : "otimo"}
            ajuda="As cobranças de maior valor ainda sem pagamento registrado. O ponto colorido na frente é o tempo de atraso: verde/azul ainda não venceu, âmbar venceu há pouco, vermelho passou de 30 dias."
            direita={
              <LinkCard href={`/relatorios/inadimplencia?mes=${mes}`}>
                Inadimplência completa
              </LinkCard>
            }
          />
          {topPendentes.length === 0 ? (
            <div className="flex items-center gap-2 py-8 text-center text-sm text-tinta-suave">
              <span className="mx-auto inline-flex items-center gap-2">
                <Selo nivel="otimo">tudo recebido</Selo>
                Nenhuma pendência em {formatarCompetencia(mes)}.
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
                    <td colSpan={3}>
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
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* ---------- reajustes ---------- */}
      <Card
        className="mt-4 px-5 py-4"
        nivel={reajustes.length > 0 ? nivelReaj : undefined}
      >
        <TituloCard
          titulo="Reajustes deste mês"
          nivel={reajustes.length > 0 ? nivelReaj : "otimo"}
          ajuda="Contratos cujo aniversário de correção cai neste mês. Aplique o índice combinado sobre o aluguel-base (sem IPTU nem condomínio) e atualize o valor na tela de Contratos — o sistema avisa, mas não reajusta sozinho."
          direita={
            <>
              <Selo nivel={reajustes.length > 0 ? nivelReaj : "otimo"}>
                {reajustes.length}{" "}
                {reajustes.length === 1 ? "contrato" : "contratos"}
              </Selo>
              {reajustes.length > 0 ? (
                <LinkCard href="/contratos">Abrir contratos</LinkCard>
              ) : null}
            </>
          }
        />
        {reajustes.length === 0 ? (
          <p className="py-4 text-center text-sm text-tinta-suave">
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
      </Card>
    </div>
  );
}
