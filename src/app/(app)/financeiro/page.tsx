import Link from "next/link";
import { IconeMenu, type IconeMenuNome } from "@/components/icones-menu";
import {
  Card,
  Dinheiro,
  Kpi,
  PageHeader,
  PainelAlertas,
  SeletorMes,
  Sigilo,
  Selo,
  btnPrimario,
  btnSecundario,
  type ItemAlerta,
} from "@/components/ui";
import { dadosExecutivos, mesPadrao } from "@/lib/consultas/executivo";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import {
  formatarCompetencia,
  parseCompetencia,
} from "@/lib/dominio/normalizacao";
import {
  NIVEL,
  nivelInadimplencia,
  nivelSaldo,
  nivelTarefas,
  nivelTaxaRecebimento,
  type Nivel,
} from "@/lib/dominio/semaforo";

export const metadata = { title: "Financeiro — Brisa" };
export const dynamic = "force-dynamic";

const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

type IconeFinanceiro = Extract<
  IconeMenuNome,
  "recebimentos" | "cobranca" | "caixa" | "comissoes" | "reajustes"
>;

function percentual(valor: number | null): string {
  if (valor === null) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(valor);
}

function BarraProgresso({ valor, nivel }: { valor: number | null; nivel: Nivel }) {
  const exibido = valor === null ? 0 : Math.max(0, Math.min(valor, 1));
  const aria = Math.round(exibido * 100);

  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-[#e9eef0]"
      role="progressbar"
      aria-label="Percentual do devido já recebido"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={valor === null ? "Sem dados" : "Percentual disponível no texto acima"}
    >
      <div
        className="h-full rounded-full transition-[width]"
        style={{ width: `${aria}%`, backgroundColor: NIVEL[nivel].cor }}
      />
    </div>
  );
}

function MiniValor({
  rotulo,
  valor,
  destaque = false,
}: {
  rotulo: string;
  valor: React.ReactNode;
  destaque?: boolean;
}) {
  return (
    <div>
      <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-tinta-suave">
        {rotulo}
      </div>
      <div
        className={`mt-1 tabular-nums text-tinta ${
          destaque ? "text-lg font-bold" : "text-[13px] font-semibold"
        }`}
      >
        <Sigilo>{valor}</Sigilo>
      </div>
    </div>
  );
}

function ModuloFinanceiro({
  icone,
  titulo,
  descricao,
  nivel,
  status,
  href,
  acao,
  hrefSecundario,
  acaoSecundaria,
  className = "",
  children,
}: {
  icone: IconeFinanceiro;
  titulo: string;
  descricao: string;
  nivel: Nivel;
  status: React.ReactNode;
  href: string;
  acao: string;
  hrefSecundario?: string;
  acaoSecundaria?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={`flex h-full flex-col p-5 ${className}`} nivel={nivel}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#d7e3e1] bg-[#edf4f2] text-[#315f56]">
            <IconeMenu nome={icone} tamanho={21} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold tracking-[-0.02em] text-tinta">
              {titulo}
            </h2>
            <p className="mt-0.5 text-[11px] leading-snug text-tinta-suave">
              {descricao}
            </p>
          </div>
        </div>
        <Selo nivel={nivel}>{status}</Selo>
      </div>

      <div className="mt-5 flex-1">{children}</div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-contorno pt-4">
        <Link href={href} className={btnPrimario}>
          {acao}
          <span aria-hidden="true">→</span>
        </Link>
        {hrefSecundario && acaoSecundaria ? (
          <Link href={hrefSecundario} className={btnSecundario}>
            {acaoSecundaria}
          </Link>
        ) : null}
      </div>
    </Card>
  );
}

export default async function PaginaFinanceiro({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const sp = await searchParams;
  const mes = sp.mes && RE_MES.test(sp.mes) ? sp.mes : await mesPadrao();
  const dados = await dadosExecutivos(mes);
  const { ano, mes: mesNumero } = parseCompetencia(mes);
  const linhaAnterior = mesNumero > 1 ? dados.porMes[mesNumero - 2] : null;

  const nivelTaxa = nivelTaxaRecebimento(dados.taxaRecebimento);
  const nivelInadimplenciaMes = nivelInadimplencia(
    dados.inadimplentesValor,
    dados.devidoMes,
  );
  const nivelCaixa = dados.caixaMes
    ? nivelSaldo(dados.saldoCaixaMes)
    : "neutro";
  const nivelReajustes = nivelTarefas(dados.reajustesDoMes.length, 5);
  const totalSaidas = dados.caixaMes
    ? dados.caixaMes.despesaAL + dados.caixaMes.despesaCH
    : 0;
  const baseComparacaoRecebido = linhaAnterior?.recebido ?? null;
  const variacaoRecebido =
    baseComparacaoRecebido && baseComparacaoRecebido > 0
      ? (dados.recebidoMes - baseComparacaoRecebido) / baseComparacaoRecebido
      : null;

  const statusTitulo = dados.mesFechado
    ? "Recebimentos fechados para o mês"
    : dados.devidoMes === 0
      ? "Mês aguardando cobranças"
      : dados.inadimplentesQtde > 0
        ? "Cobranças em acompanhamento"
        : "Fluxo financeiro em dia";

  const alertas: ItemAlerta[] = [];
  if (dados.inadimplentesQtde > 0) {
    alertas.push({
      nivel: nivelInadimplenciaMes,
      titulo: "Cobranças em aberto",
      texto: (
        <>
          <Sigilo>{dados.inadimplentesQtde}</Sigilo> título(s) somam{" "}
          <Sigilo>{formatarBRL(dados.inadimplentesValor)}</Sigilo> sem recebimento registrado.
        </>
      ),
      acao: {
        rotulo: "Abrir cobrança",
        href: `/paineis/cobranca?mes=${mes}`,
      },
    });
  } else if (dados.taxaRecebimento !== null && dados.taxaRecebimento < 0.8) {
    alertas.push({
      nivel: "critico",
      titulo: "Recebimento abaixo do previsto",
      texto: (
        <>
          Entrou <Sigilo>{percentual(dados.taxaRecebimento)}</Sigilo> do devido. Confira pagamentos parciais e competências antes do fechamento.
        </>
      ),
      acao: {
        rotulo: "Conferir recebimentos",
        href: `/recebimentos?mes=${mes}`,
      },
    });
  }
  if (dados.caixaMes && dados.saldoCaixaMes < 0) {
    alertas.push({
      nivel: "critico",
      titulo: "Caixa negativo",
      texto: (
        <>
          As saídas superam as entradas em{" "}
          <Sigilo>{formatarBRL(Math.abs(dados.saldoCaixaMes))}</Sigilo>. Revise centros de custo e lançamentos do mês.
        </>
      ),
      acao: { rotulo: "Revisar caixa", href: `/caixa?mes=${mes}` },
    });
  }
  if (dados.reajustesDoMes.length > 0) {
    alertas.push({
      nivel: nivelReajustes,
      titulo: "Reajustes contratuais",
      texto: (
        <>
          <Sigilo>{dados.reajustesDoMes.length}</Sigilo> contrato(s) fazem aniversário neste mês e precisam de conferência manual.
        </>
      ),
      acao: { rotulo: "Abrir contratos", href: "/contratos" },
    });
  }

  const maioresComissoes = dados.porEmpreendimento
    .filter((item) => item.comissaoMes > 0)
    .slice(0, 4);
  const maiorComissao = Math.max(
    1,
    ...maioresComissoes.map((item) => item.comissaoMes),
  );

  return (
    <div>
      <PageHeader
        titulo="Financeiro"
        descricao="Uma central para acompanhar o que deve entrar, priorizar cobranças e manter caixa, comissões e reajustes sob controle."
        acoes={
          <>
            <Link href={`/executivo?mes=${mes}`} className={btnSecundario}>
              Dashboard executivo
            </Link>
            <SeletorMes base="/financeiro" mes={mes} />
          </>
        }
      />

      <Card
        className="relative mb-5 overflow-hidden border-0 p-0 text-white"
        style={{
          background:
            "linear-gradient(132deg, #102f33 0%, #183f3d 58%, #2d5c4e 100%)",
        }}
      >
        <span className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full border border-white/10" />
        <span className="pointer-events-none absolute -bottom-32 right-28 h-56 w-56 rounded-full bg-white/[0.035]" />
        <div className="relative grid gap-7 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:px-7">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9ec9bf]">
                Posição financeira · {formatarCompetencia(mes)}
              </span>
              <span className="rounded-md border border-white/15 bg-white/[0.08] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.09em] text-white/80">
                {dados.mesFechado ? "mês fechado" : "em andamento"}
              </span>
            </div>
            <h2 className="mt-3 text-[25px] font-bold leading-tight tracking-[-0.035em] text-white sm:text-[30px]">
              {statusTitulo}
            </h2>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/70">
              Entrou <Sigilo>{formatarBRL(dados.recebidoMes)}</Sigilo> de{" "}
              <Sigilo>{formatarBRL(dados.devidoMes)}</Sigilo> devido.
              {dados.inadimplentesQtde > 0
                ? <>{" "}Ainda há <Sigilo>{dados.inadimplentesQtde}</Sigilo> cobrança(s) esperando baixa.</>
                : " Não há cobrança integralmente pendente na competência."}
            </p>
            <div className="mt-5 max-w-2xl">
              <div className="mb-2 flex items-center justify-between text-[10px] font-semibold text-white/60">
                <span>Recebido sobre o devido</span>
                <span className="font-mono text-white"><Sigilo>{percentual(dados.taxaRecebimento)}</Sigilo></span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[#72d3b4]"
                  style={{
                    width: `${Math.round(Math.max(0, Math.min(dados.taxaRecebimento ?? 0, 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-white/10 pt-5 sm:grid-cols-3 lg:min-w-[430px] lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/70">
                Recebido
              </div>
              <div className="mt-1 text-lg font-bold text-white">
                <Sigilo><Dinheiro centavos={dados.recebidoMes} destaque /></Sigilo>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/70">
                Em aberto
              </div>
              <div className="mt-1 text-lg font-bold text-white">
                <Sigilo><Dinheiro centavos={dados.inadimplentesValor} destaque /></Sigilo>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/70">
                Saldo caixa
              </div>
              <div className="mt-1 text-lg font-bold text-white">
                <Sigilo><Dinheiro centavos={dados.saldoCaixaMes} destaque /></Sigilo>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <PainelAlertas
        itens={alertas}
        ajuda="Reúne apenas situações que já podem ser tratadas nos módulos existentes: cobrança, caixa e contratos."
        vazio="Nenhuma cobrança integralmente pendente, caixa negativo ou reajuste na mesa para este mês."
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi
          rotulo="Recebido no mês"
          valor={<Dinheiro centavos={dados.recebidoMes} destaque />}
          detalhe={
            variacaoRecebido === null
              ? "sem base no mês anterior"
              : <Sigilo>{`${variacaoRecebido >= 0 ? "+" : ""}${(variacaoRecebido * 100).toFixed(1).replace(".", ",")}% vs mês anterior`}</Sigilo>
          }
          href={`/recebimentos?mes=${mes}`}
          ajuda="Soma dos pagamentos registrados nesta competência, incluindo os repasses de IPTU e condomínio."
        />
        <Kpi
          rotulo="Taxa de recebimento"
          valor={percentual(dados.taxaRecebimento)}
          detalhe={<Sigilo>{`${formatarBRL(dados.recebidoMes)} de ${formatarBRL(dados.devidoMes)}`}</Sigilo>}
          nivel={nivelTaxa}
          selo={dados.taxaRecebimento === null ? undefined : "do devido"}
          href={`/recebimentos?mes=${mes}`}
          ajuda="Total recebido dividido pelo total devido. Acima de 100% pode indicar quitação de competências anteriores."
        />
        <Kpi
          rotulo="Cobranças em aberto"
          valor={<Dinheiro centavos={dados.inadimplentesValor} destaque />}
          detalhe={<Sigilo>{`${dados.inadimplentesQtde} lançamento(s) sem baixa`}</Sigilo>}
          nivel={nivelInadimplenciaMes}
          selo={dados.inadimplentesQtde === 0 ? "em dia" : "cobrar"}
          href={`/paineis/cobranca?mes=${mes}`}
          ajuda="Valor integral dos lançamentos desta competência que ainda não possuem recebimento registrado."
        />
        <Kpi
          rotulo="Saldo de caixa"
          valor={<Dinheiro centavos={dados.saldoCaixaMes} destaque />}
          detalhe={
            dados.caixaMes
              ? <Sigilo>{`${formatarBRL(dados.caixaMes.receita)} entrou · ${formatarBRL(totalSaidas)} saiu`}</Sigilo>
              : "sem movimentações no mês"
          }
          nivel={nivelCaixa}
          selo={dados.caixaMes ? (dados.saldoCaixaMes >= 0 ? "positivo" : "negativo") : undefined}
          href={`/caixa?mes=${mes}`}
          ajuda="Entradas menos as saídas AL e CH no livro-caixa. Recebimentos em espécie ficam fora desse saldo."
        />
        <Kpi
          rotulo="Comissão"
          valor={<Dinheiro centavos={dados.comissaoMes} destaque />}
          detalhe={<><Sigilo>{formatarBRL(dados.comissaoAcumuladaAno)}</Sigilo> acumulados em {ano}</>}
          nivel={dados.comissaoMes > 0 ? "info" : "neutro"}
          selo={dados.comissaoMes > 0 ? "apurada" : undefined}
          href={`/relatorios/comissao?ano=${ano}`}
          ajuda="Comissão calculada sobre o aluguel efetivamente recebido, sem incluir IPTU e condomínio."
        />
      </div>

      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.17em] text-oliva">
            Módulos financeiros
          </div>
          <h2 className="mt-1 text-xl font-bold tracking-[-0.03em] text-tinta">
            Um caminho claro para cada tarefa
          </h2>
        </div>
        <p className="text-[11px] text-tinta-suave">
          Dados reais da competência selecionada, sem duplicar lançamentos.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <ModuloFinanceiro
          icone="recebimentos"
          titulo="Contas a receber"
          descricao="Gere os devidos, dê baixa nos pagamentos e feche o mês."
          nivel={nivelTaxa}
          status={dados.mesFechado ? "fechado" : "operacional"}
          href={`/recebimentos?mes=${mes}`}
          acao="Abrir recebimentos"
          className="xl:col-span-4"
        >
          <div className="grid grid-cols-2 gap-4">
            <MiniValor rotulo="Devido" valor={<Dinheiro centavos={dados.devidoMes} />} />
            <MiniValor
              rotulo="Recebido"
              valor={<Dinheiro centavos={dados.recebidoMes} />}
              destaque
            />
          </div>
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between text-[10px] text-tinta-suave">
              <span>Avanço da arrecadação</span>
              <strong className="font-mono text-tinta">
                <Sigilo>{percentual(dados.taxaRecebimento)}</Sigilo>
              </strong>
            </div>
            <BarraProgresso valor={dados.taxaRecebimento} nivel={nivelTaxa} />
          </div>
        </ModuloFinanceiro>

        <ModuloFinanceiro
          icone="cobranca"
          titulo="Cobrança"
          descricao="Priorize quem ainda não teve pagamento registrado."
          nivel={nivelInadimplenciaMes}
          status={
            dados.inadimplentesQtde === 0
              ? "fila limpa"
              : <><Sigilo>{dados.inadimplentesQtde}</Sigilo> na fila</>
          }
          href={`/paineis/cobranca?mes=${mes}`}
          acao="Abrir painel"
          hrefSecundario={`/relatorios/inadimplencia?mes=${mes}`}
          acaoSecundaria="Lista completa"
          className="xl:col-span-4"
        >
          {dados.pendentesDoMes.length === 0 ? (
            <div className="rounded-lg border border-contorno bg-[#f8faf9] px-4 py-4 text-[13px] leading-relaxed text-tinta-suave">
              Nenhuma cobrança integralmente pendente nesta competência.
            </div>
          ) : (
            <div className="space-y-3">
              {dados.pendentesDoMes.slice(0, 3).map((item, indice) => (
                <div
                  key={`${item.empreendimento}-${item.localizacao}-${indice}`}
                  className="flex items-center justify-between gap-4 border-b border-contorno/70 pb-3 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold text-tinta">
                      {item.locatario}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-tinta-suave">
                      {item.empreendimento} · {item.localizacao}
                      {item.diasAtraso ? <> · <Sigilo>{item.diasAtraso} dias</Sigilo></> : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-[12px] font-semibold text-tinta">
                    <Sigilo><Dinheiro centavos={item.totalDevido} /></Sigilo>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ModuloFinanceiro>

        <ModuloFinanceiro
          icone="caixa"
          titulo="Movimentações e caixa"
          descricao="Registre entradas e saídas por centro de custo."
          nivel={nivelCaixa}
          status={
            dados.caixaMes
              ? dados.saldoCaixaMes >= 0
                ? "saldo positivo"
                : "saldo negativo"
              : "sem movimento"
          }
          href={`/caixa?mes=${mes}`}
          acao="Abrir caixa"
          hrefSecundario={`/caixa/novo?mes=${mes}`}
          acaoSecundaria="Novo lançamento"
          className="xl:col-span-4"
        >
          {dados.caixaMes ? (
            <div className="grid grid-cols-3 gap-3">
              <MiniValor
                rotulo="Entradas"
                valor={<Dinheiro centavos={dados.caixaMes.receita} />}
              />
              <MiniValor rotulo="Saídas" valor={<Dinheiro centavos={totalSaidas} />} />
              <MiniValor
                rotulo="Saldo"
                valor={<Dinheiro centavos={dados.saldoCaixaMes} />}
                destaque
              />
            </div>
          ) : (
            <div className="rounded-lg border border-contorno bg-[#f8faf9] px-4 py-4 text-[13px] leading-relaxed text-tinta-suave">
              Ainda não há entradas ou saídas no livro-caixa desta competência.
            </div>
          )}
        </ModuloFinanceiro>

        <ModuloFinanceiro
          icone="comissoes"
          titulo="Comissões"
          descricao="Acompanhe o ganho da administradora por empreendimento."
          nivel={dados.comissaoMes > 0 ? "info" : "neutro"}
          status={dados.comissaoMes > 0 ? "apurada" : "sem base"}
          href={`/relatorios/comissao?ano=${ano}`}
          acao="Abrir matriz"
          hrefSecundario={`/executivo?mes=${mes}`}
          acaoSecundaria="Ver análise"
          className="xl:col-span-6"
        >
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <MiniValor
              rotulo="Comissão do mês"
              valor={<Dinheiro centavos={dados.comissaoMes} destaque />}
              destaque
            />
            <MiniValor
              rotulo={`Acumulado ${ano}`}
              valor={<Dinheiro centavos={dados.comissaoAcumuladaAno} />}
            />
          </div>
          {maioresComissoes.length > 0 ? (
            <div className="space-y-2.5">
              {maioresComissoes.map((item) => (
                <div key={item.id} className="grid grid-cols-[minmax(80px,0.8fr)_1.4fr_auto] items-center gap-3">
                  <span className="truncate text-[10px] font-semibold text-tinta-suave">
                    {item.nome}
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-[#e9eef0]">
                    <span
                      className="block h-full rounded-full bg-[#4a68a8]"
                      style={{
                        width: `${Math.max(5, Math.round((item.comissaoMes / maiorComissao) * 100))}%`,
                      }}
                    />
                  </span>
                  <span className="font-mono text-[10px] font-semibold text-tinta">
                    <Sigilo>{formatarBRL(item.comissaoMes)}</Sigilo>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-tinta-suave">
              A comissão aparece conforme os recebimentos são registrados.
            </p>
          )}
        </ModuloFinanceiro>

        <ModuloFinanceiro
          icone="reajustes"
          titulo="Reajustes"
          descricao="Veja os contratos que fazem aniversário nesta competência."
          nivel={nivelReajustes}
          status={
            dados.reajustesDoMes.length === 0
              ? "agenda limpa"
              : <><Sigilo>{dados.reajustesDoMes.length}</Sigilo> a revisar</>
          }
          href="/contratos"
          acao="Abrir contratos"
          className="xl:col-span-6"
        >
          {dados.reajustesDoMes.length === 0 ? (
            <div className="rounded-lg border border-contorno bg-[#f8faf9] px-4 py-4 text-[13px] leading-relaxed text-tinta-suave">
              Nenhum contrato faz aniversário de reajuste em {formatarCompetencia(mes)}.
            </div>
          ) : (
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {dados.reajustesDoMes.slice(0, 4).map((item, indice) => (
                <div
                  key={`${item.empreendimento}-${item.localizacao}-${indice}`}
                  className="flex items-center justify-between gap-3 border-b border-contorno/70 pb-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold text-tinta">
                      {item.locatario}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-tinta-suave">
                      {item.empreendimento} · {item.localizacao}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] font-semibold text-tinta">
                    <Sigilo>{formatarBRL(item.valorBase)}</Sigilo>
                  </span>
                </div>
              ))}
            </div>
          )}
        </ModuloFinanceiro>
      </div>

      <p className="mt-5 text-[10px] leading-relaxed text-tinta-suave/70">
        O hub consolida recebimentos, livro-caixa, comissão e contratos já registrados no Brisa. Valores de IPTU e condomínio são repasses e não entram na base da comissão.
      </p>
    </div>
  );
}
