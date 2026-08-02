/**
 * /caixa — livro-caixa CONTA_AC, visão mensal (?mes=YYYY-MM) ou por período
 * (?de=YYYY-MM-DD&ate=YYYY-MM-DD — quando presente, vence o ?mes).
 *
 * 4 blocos (grid 2×2 em telas grandes): saídas AL, saídas CH, entradas e
 * recebimentos em dinheiro (registro paralelo — fora do saldo).
 * Consolidação derivada nos KPIs: saldo = receita − despesa AL − despesa CH.
 *
 * No modo período a tela fica ANALÍTICA: KPIs agregados na janela e os 4
 * blocos listam a janela inteira com uma coluna "Mês" a mais. Lançar/editar
 * continua mensal — o botão "Novo lançamento" leva à competência corrente.
 */
import Link from "next/link";
import type { LancamentoCaixa } from "@prisma/client";
import {
  Ajuda,
  Badge,
  Card,
  Dinheiro,
  Kpi,
  PageHeader,
  Ponto,
  Selo,
  SeletorMes,
  SeletorPeriodo,
  btnPrimario,
  btnSecundario,
} from "@/components/ui";
import {
  formatarCompetencia,
  parseCompetencia,
} from "@/lib/dominio/normalizacao";
import { parsePeriodo } from "@/lib/dominio/periodo";
import { nivelSaldo } from "@/lib/dominio/semaforo";
import {
  BarraComposicao,
  COR_1,
  COR_SAIDA,
  COR_SAIDA_2,
} from "@/components/graficos";
import {
  consolidacaoDoMes,
  consolidacaoDoPeriodo,
  lancamentosDoMes,
  lancamentosDoPeriodo,
  mesMaisRecente,
  type BlocoLista,
  type BlocoSaidas,
} from "@/lib/consultas/caixa";
import { BotaoExcluir } from "./BotaoExcluir";

const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "YYYY-MM-DD" → "DD/MM/AAAA"; null → "—". */
function formatarData(d: string | null): string {
  if (!d) return "—";
  const [ano, mes, dia] = d.split("-");
  return `${dia}/${mes}/${ano}`;
}

function resumoDoLancamento(l: LancamentoCaixa): string {
  return l.descricao ?? l.cliente ?? l.categoria ?? "sem descrição";
}

function CelulaAcoes({ l }: { l: LancamentoCaixa }) {
  return (
    <td className="text-right!">
      <span className="inline-flex items-center gap-2">
        <Link
          href={`/caixa/${l.id}/editar`}
          className="text-xs font-medium text-tinta-suave hover:underline"
        >
          Editar
        </Link>
        <BotaoExcluir id={l.id} resumo={resumoDoLancamento(l)} />
      </span>
    </td>
  );
}

/** Coluna extra do modo período: a competência ("YYYY-MM") do lançamento. */
function CelulaMes({ l }: { l: LancamentoCaixa }) {
  return (
    <td className="font-mono text-[12px] text-tinta-suave">
      {formatarCompetencia(l.mesReferencia)}
    </td>
  );
}

function TabelaSaidas({
  bloco,
  comMes,
  vazio,
}: {
  bloco: BlocoSaidas;
  comMes: boolean;
  vazio: string;
}) {
  if (bloco.grupos.length === 0) {
    return <p className="px-5 pb-5 text-sm text-tinta-suave">{vazio}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="tabela">
        <thead>
          <tr>
            {comMes ? <th>Mês</th> : null}
            <th>Data</th>
            <th>Descrição</th>
            <th className="text-right!">Valor</th>
            <th className="text-right!">Ações</th>
          </tr>
        </thead>
        <tbody>
          {bloco.grupos.map((g) => (
            <FragmentoCategoria key={g.categoria} grupo={g} comMes={comMes} />
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={comMes ? 3 : 2}>Total do centro</td>
            <td className="text-right!">
              <Dinheiro centavos={bloco.total} destaque />
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function FragmentoCategoria({
  grupo,
  comMes,
}: {
  grupo: BlocoSaidas["grupos"][number];
  comMes: boolean;
}) {
  return (
    <>
      <tr className="bg-[#f5f3ef] hover:bg-[#f5f3ef]">
        <td
          colSpan={comMes ? 5 : 4}
          className="text-xs font-semibold uppercase tracking-wide text-tinta-suave"
        >
          {grupo.categoria}
        </td>
      </tr>
      {grupo.lancamentos.map((l) => (
        <tr key={l.id}>
          {comMes ? <CelulaMes l={l} /> : null}
          <td className="text-tinta-suave">{formatarData(l.data)}</td>
          <td className="max-w-64 whitespace-normal!">
            {l.descricao ?? <span className="text-tinta-suave/60">—</span>}
          </td>
          <td className="text-right!">
            <Dinheiro centavos={l.valor} />
          </td>
          <CelulaAcoes l={l} />
        </tr>
      ))}
      <tr className="hover:bg-[#f5f3ef]">
        <td
          colSpan={comMes ? 3 : 2}
          className="text-right! text-xs text-tinta-suave"
        >
          Subtotal {grupo.categoria}
        </td>
        <td className="text-right!">
          <Dinheiro centavos={grupo.subtotal} destaque />
        </td>
        <td />
      </tr>
    </>
  );
}

function TabelaEntradas({
  bloco,
  comMes,
  vazio,
}: {
  bloco: BlocoLista;
  comMes: boolean;
  vazio: string;
}) {
  if (bloco.lancamentos.length === 0) {
    return <p className="px-5 pb-5 text-sm text-tinta-suave">{vazio}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="tabela">
        <thead>
          <tr>
            {comMes ? <th>Mês</th> : null}
            <th>Data</th>
            <th>Descrição</th>
            <th className="text-right!">Valor</th>
            <th className="text-right!">Ações</th>
          </tr>
        </thead>
        <tbody>
          {bloco.lancamentos.map((l) => (
            <tr key={l.id}>
              {comMes ? <CelulaMes l={l} /> : null}
              <td className="text-tinta-suave">{formatarData(l.data)}</td>
              <td className="max-w-64 whitespace-normal!">
                {l.descricao ?? <span className="text-tinta-suave/60">—</span>}
              </td>
              <td className="text-right!">
                <Dinheiro centavos={l.valor} />
              </td>
              <CelulaAcoes l={l} />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={comMes ? 3 : 2}>Total de entradas</td>
            <td className="text-right!">
              <Dinheiro centavos={bloco.total} destaque />
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function TabelaRecebDinheiro({
  bloco,
  comMes,
  vazio,
}: {
  bloco: BlocoLista;
  comMes: boolean;
  vazio: string;
}) {
  if (bloco.lancamentos.length === 0) {
    return <p className="px-5 pb-5 text-sm text-tinta-suave">{vazio}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="tabela">
        <thead>
          <tr>
            {comMes ? <th>Mês</th> : null}
            <th>Data</th>
            <th>Cliente</th>
            <th>Local</th>
            <th className="text-right!">Valor</th>
            <th className="text-right!">Ações</th>
          </tr>
        </thead>
        <tbody>
          {bloco.lancamentos.map((l) => (
            <tr key={l.id}>
              {comMes ? <CelulaMes l={l} /> : null}
              <td className="text-tinta-suave">{formatarData(l.data)}</td>
              <td className="max-w-48 whitespace-normal!">
                {l.cliente ?? <span className="text-tinta-suave/60">—</span>}
              </td>
              <td className="max-w-40 whitespace-normal!">
                {l.local ?? <span className="text-tinta-suave/60">—</span>}
              </td>
              <td className="text-right!">
                <Dinheiro centavos={l.valor} />
              </td>
              <CelulaAcoes l={l} />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={comMes ? 4 : 3}>Total em espécie</td>
            <td className="text-right!">
              <Dinheiro centavos={bloco.total} destaque />
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function CabecalhoBloco({
  titulo,
  badge,
  cor = "slate",
  nota,
}: {
  titulo: string;
  badge: string;
  cor?: "slate" | "verde" | "vermelho" | "ambar" | "azul";
  nota?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
      <div>
        <h2 className="text-sm font-bold">{titulo}</h2>
        {nota ? <p className="mt-0.5 text-xs text-tinta-suave">{nota}</p> : null}
      </div>
      <Badge cor={cor}>{badge}</Badge>
    </div>
  );
}

export default async function PaginaCaixa({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; de?: string; ate?: string }>;
}) {
  const sp = await searchParams;
  const periodo = parsePeriodo(sp.de, sp.ate);
  const mes = sp.mes && RE_MES.test(sp.mes) ? sp.mes : await mesMaisRecente();
  const { ano } = parseCompetencia(mes);

  const [blocos, consolidacao] = periodo
    ? await Promise.all([
        lancamentosDoPeriodo(periodo.meses),
        consolidacaoDoPeriodo(periodo.meses),
      ])
    : await Promise.all([lancamentosDoMes(mes), consolidacaoDoMes(mes)]);

  // coluna "Mês" nos blocos só quando a janela tem mais de uma competência
  const comMes = periodo !== null && periodo.meses.length > 1;
  const nomeJanela = periodo ? "no período" : "neste mês";

  return (
    <>
      <PageHeader
        titulo="Caixa"
        descricao={
          periodo
            ? `Livro-caixa CONTA_AC no período ${periodo.rotulo} — totais e lançamentos da janela inteira`
            : "Livro-caixa CONTA_AC — saídas por centro de custo, entradas e recebimentos em dinheiro"
        }
        acoes={
          <>
            {periodo ? (
              <Link
                href={`/caixa/ano?de=${periodo.de}&ate=${periodo.ate}`}
                className={btnSecundario}
              >
                Mês a mês
              </Link>
            ) : (
              <Link href={`/caixa/ano?ano=${ano}`} className={btnSecundario}>
                Resumo anual
              </Link>
            )}
            <Link href={`/caixa/novo?mes=${mes}`} className={btnPrimario}>
              Novo lançamento
            </Link>
            {!periodo ? <SeletorMes base="/caixa" mes={mes} /> : null}
            <SeletorPeriodo base="/caixa" periodo={periodo} />
          </>
        }
      />

      {/* ---------- consolidação ----------
           O saldo NÃO é mais um cartão igual aos outros três: ele é o
           resultado deles. Fica em faixa própria, com número maior e a barra
           de composição mostrando de que partes o resultado é feito; as três
           parcelas ficam embaixo, menores e do mesmo tamanho entre si. */}
      <Card className="mb-4 px-5 py-4" nivel={nivelSaldo(consolidacao.saldo)}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
          <div className="sm:w-72 sm:shrink-0">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-tinta-suave">
              {periodo ? "Saldo do período" : "Saldo do mês"}
              <Ajuda dica="Entradas menos as saídas dos dois centros, na janela em análise. Positivo: sobrou dinheiro; negativo: as saídas superaram as entradas. O registro de espécie não entra nesta conta." />
              <Selo nivel={nivelSaldo(consolidacao.saldo)}>
                {consolidacao.saldo > 0
                  ? "sobrou"
                  : consolidacao.saldo < 0
                    ? "faltou"
                    : "zerado"}
              </Selo>
            </div>
            <div className="mt-1 font-serif text-3xl font-semibold tabular-nums text-tinta sm:text-[40px] sm:leading-tight">
              <span className="sigilo">
                <span>
                  <Dinheiro centavos={consolidacao.saldo} destaque />
                </span>
              </span>
            </div>
            <div className="mt-1 text-xs text-tinta-suave">
              receita − despesa AL − despesa CH
              {periodo ? ` · ${periodo.rotulo}` : ""}
            </div>
            {consolidacao.saldo < 0 ? (
              <div className="mt-2 flex items-start gap-1.5 text-[11px] font-medium leading-snug text-tinta-suave">
                <span aria-hidden="true" className="mt-[3px]">
                  <Ponto nivel="critico" />
                </span>
                <span>
                  Saiu mais do que entrou. Confira se alguma despesa caiu no
                  centro de custo errado.
                </span>
              </div>
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            {consolidacao.receita > 0 ||
            consolidacao.despesaAL > 0 ||
            consolidacao.despesaCH > 0 ? (
              <BarraComposicao
                altura={16}
                partes={[
                  { rotulo: "entradas", valor: consolidacao.receita, cor: COR_1 },
                  { rotulo: "saídas AL", valor: consolidacao.despesaAL, cor: COR_SAIDA },
                  { rotulo: "saídas CH", valor: consolidacao.despesaCH, cor: COR_SAIDA_2 },
                ]}
              />
            ) : (
              <p className="text-sm text-tinta-suave">
                Nenhum lançamento na janela em análise.
              </p>
            )}
          </div>
        </div>
      </Card>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi
          rotulo="Receita (entradas)"
          valor={<Dinheiro centavos={consolidacao.receita} destaque />}
          detalhe={periodo ? periodo.rotulo : undefined}
          ajuda="Tudo o que entrou na conta na janela em análise (tipo ENTRADA, centro GERAL). Recebimentos em dinheiro NÃO estão aqui — são registro paralelo de espécie e ficam no bloco próprio."
        />
        <Kpi
          rotulo="Despesa Antonio/Laura"
          valor={<Dinheiro centavos={consolidacao.despesaAL} destaque />}
          detalhe={periodo ? periodo.rotulo : undefined}
          ajuda="Soma das saídas do centro de custo AL (Antonio/Laura) na janela em análise, agrupadas por categoria no bloco abaixo. Ao lançar uma saída, escolha o centro certo — é isso que separa as contas de cada núcleo da família."
        />
        <Kpi
          rotulo="Despesa Chácara Brisa"
          valor={<Dinheiro centavos={consolidacao.despesaCH} destaque />}
          detalhe={periodo ? periodo.rotulo : undefined}
          ajuda="Soma das saídas do centro de custo CH (Chácara Brisa) na janela em análise. Gastos da chácara entram aqui; gastos pessoais de Antonio/Laura vão no centro AL."
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <Card>
          <CabecalhoBloco titulo="Saídas — Antonio/Laura" badge="AL" cor="vermelho" />
          <TabelaSaidas
            bloco={blocos.saidasAL}
            comMes={comMes}
            vazio={`Sem saídas ${nomeJanela}.`}
          />
        </Card>

        <Card>
          <CabecalhoBloco titulo="Saídas — Chácara Brisa" badge="CH" cor="vermelho" />
          <TabelaSaidas
            bloco={blocos.saidasCH}
            comMes={comMes}
            vazio={`Sem saídas ${nomeJanela}.`}
          />
        </Card>

        <Card>
          <CabecalhoBloco titulo="Entradas" badge="GERAL" cor="verde" />
          <TabelaEntradas
            bloco={blocos.entradas}
            comMes={comMes}
            vazio={`Sem entradas ${nomeJanela}.`}
          />
        </Card>

        <Card>
          <CabecalhoBloco
            titulo="Recebimentos em dinheiro"
            badge="GERAL"
            cor="ambar"
            nota="Registro paralelo de espécie — não entra no saldo."
          />
          <TabelaRecebDinheiro
            bloco={blocos.recebimentosDinheiro}
            comMes={comMes}
            vazio={`Sem recebimentos em dinheiro ${nomeJanela}.`}
          />
        </Card>
      </div>

      <p className="mt-4 text-xs text-tinta-suave/60">
        Transferências internas entre centros aparecem como saída no centro de origem e
        entrada geral; ressarcimentos são saídas normais identificadas na descrição.
        {periodo
          ? " No modo período os subtotais por categoria somam a janela inteira; lançamentos novos continuam sendo feitos mês a mês."
          : ""}
      </p>
    </>
  );
}
