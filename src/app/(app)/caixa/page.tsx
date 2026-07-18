/**
 * /caixa — livro-caixa CONTA_AC, visão mensal (?mes=YYYY-MM).
 *
 * 4 blocos (grid 2×2 em telas grandes): saídas AL, saídas CH, entradas e
 * recebimentos em dinheiro (registro paralelo — fora do saldo).
 * Consolidação derivada nos KPIs: saldo = receita − despesa AL − despesa CH.
 */
import Link from "next/link";
import type { LancamentoCaixa } from "@prisma/client";
import {
  Badge,
  Card,
  Dinheiro,
  Kpi,
  PageHeader,
  SeletorMes,
  btnPrimario,
  btnSecundario,
} from "@/components/ui";
import { parseCompetencia } from "@/lib/dominio/normalizacao";
import {
  consolidacaoDoMes,
  lancamentosDoMes,
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
          className="text-xs font-medium text-slate-500 hover:underline"
        >
          Editar
        </Link>
        <BotaoExcluir id={l.id} resumo={resumoDoLancamento(l)} />
      </span>
    </td>
  );
}

function TabelaSaidas({ bloco }: { bloco: BlocoSaidas }) {
  if (bloco.grupos.length === 0) {
    return <p className="px-5 pb-5 text-sm text-slate-500">Sem saídas neste mês.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="tabela">
        <thead>
          <tr>
            <th>Data</th>
            <th>Descrição</th>
            <th className="text-right!">Valor</th>
            <th className="text-right!">Ações</th>
          </tr>
        </thead>
        <tbody>
          {bloco.grupos.map((g) => (
            <FragmentoCategoria key={g.categoria} grupo={g} />
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Total do centro</td>
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
}: {
  grupo: BlocoSaidas["grupos"][number];
}) {
  return (
    <>
      <tr className="bg-slate-50 hover:bg-slate-50">
        <td colSpan={4} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          {grupo.categoria}
        </td>
      </tr>
      {grupo.lancamentos.map((l) => (
        <tr key={l.id}>
          <td className="text-slate-500">{formatarData(l.data)}</td>
          <td className="max-w-64 whitespace-normal!">
            {l.descricao ?? <span className="text-slate-400">—</span>}
          </td>
          <td className="text-right!">
            <Dinheiro centavos={l.valor} />
          </td>
          <CelulaAcoes l={l} />
        </tr>
      ))}
      <tr className="hover:bg-white">
        <td colSpan={2} className="text-right! text-xs text-slate-500">
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

function TabelaEntradas({ bloco }: { bloco: BlocoLista }) {
  if (bloco.lancamentos.length === 0) {
    return <p className="px-5 pb-5 text-sm text-slate-500">Sem entradas neste mês.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="tabela">
        <thead>
          <tr>
            <th>Data</th>
            <th>Descrição</th>
            <th className="text-right!">Valor</th>
            <th className="text-right!">Ações</th>
          </tr>
        </thead>
        <tbody>
          {bloco.lancamentos.map((l) => (
            <tr key={l.id}>
              <td className="text-slate-500">{formatarData(l.data)}</td>
              <td className="max-w-64 whitespace-normal!">
                {l.descricao ?? <span className="text-slate-400">—</span>}
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
            <td colSpan={2}>Total de entradas</td>
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

function TabelaRecebDinheiro({ bloco }: { bloco: BlocoLista }) {
  if (bloco.lancamentos.length === 0) {
    return (
      <p className="px-5 pb-5 text-sm text-slate-500">
        Sem recebimentos em dinheiro neste mês.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="tabela">
        <thead>
          <tr>
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
              <td className="text-slate-500">{formatarData(l.data)}</td>
              <td className="max-w-48 whitespace-normal!">
                {l.cliente ?? <span className="text-slate-400">—</span>}
              </td>
              <td className="max-w-40 whitespace-normal!">
                {l.local ?? <span className="text-slate-400">—</span>}
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
            <td colSpan={3}>Total em espécie</td>
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
        {nota ? <p className="mt-0.5 text-xs text-amber-700">{nota}</p> : null}
      </div>
      <Badge cor={cor}>{badge}</Badge>
    </div>
  );
}

export default async function PaginaCaixa({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const sp = await searchParams;
  const mes = sp.mes && RE_MES.test(sp.mes) ? sp.mes : await mesMaisRecente();
  const { ano } = parseCompetencia(mes);

  const [blocos, consolidacao] = await Promise.all([
    lancamentosDoMes(mes),
    consolidacaoDoMes(mes),
  ]);

  return (
    <>
      <PageHeader
        titulo="Caixa"
        descricao="Livro-caixa CONTA_AC — saídas por centro de custo, entradas e recebimentos em dinheiro"
        acoes={
          <>
            <Link href={`/caixa/ano?ano=${ano}`} className={btnSecundario}>
              Resumo anual
            </Link>
            <Link href={`/caixa/novo?mes=${mes}`} className={btnPrimario}>
              Novo lançamento
            </Link>
            <SeletorMes base="/caixa" mes={mes} />
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi
          rotulo="Despesa Antonio/Laura"
          valor={<Dinheiro centavos={consolidacao.despesaAL} destaque />}
        />
        <Kpi
          rotulo="Despesa Chácara Brisa"
          valor={<Dinheiro centavos={consolidacao.despesaCH} destaque />}
        />
        <Kpi
          rotulo="Receita (entradas)"
          valor={<Dinheiro centavos={consolidacao.receita} destaque />}
        />
        <Kpi
          rotulo="Saldo do mês"
          valor={<Dinheiro centavos={consolidacao.saldo} destaque />}
          detalhe="receita − despesa AL − despesa CH"
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <Card>
          <CabecalhoBloco titulo="Saídas — Antonio/Laura" badge="AL" cor="vermelho" />
          <TabelaSaidas bloco={blocos.saidasAL} />
        </Card>

        <Card>
          <CabecalhoBloco titulo="Saídas — Chácara Brisa" badge="CH" cor="vermelho" />
          <TabelaSaidas bloco={blocos.saidasCH} />
        </Card>

        <Card>
          <CabecalhoBloco titulo="Entradas" badge="GERAL" cor="verde" />
          <TabelaEntradas bloco={blocos.entradas} />
        </Card>

        <Card>
          <CabecalhoBloco
            titulo="Recebimentos em dinheiro"
            badge="GERAL"
            cor="ambar"
            nota="Registro paralelo de espécie — não entra no saldo do mês."
          />
          <TabelaRecebDinheiro bloco={blocos.recebimentosDinheiro} />
        </Card>
      </div>

      <p className="mt-4 text-xs text-slate-400">
        Transferências internas entre centros aparecem como saída no centro de origem e
        entrada geral; ressarcimentos são saídas normais identificadas na descrição.
      </p>
    </>
  );
}
