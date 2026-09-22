import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recebimentoFindMany: vi.fn(),
  empreendimentoFindUnique: vi.fn(),
  unidadeFindMany: vi.fn(),
  contratoCount: vi.fn(),
  lancamentoCaixaGroupBy: vi.fn(),
  recebimentoTemporadaAggregate: vi.fn(),
  despesaTemporadaAggregate: vi.fn(),
  limpezaFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    recebimento: { findMany: mocks.recebimentoFindMany },
    empreendimento: { findUnique: mocks.empreendimentoFindUnique },
    unidade: { findMany: mocks.unidadeFindMany },
    contrato: { count: mocks.contratoCount },
    lancamentoCaixa: { groupBy: mocks.lancamentoCaixaGroupBy },
    recebimentoTemporada: {
      aggregate: mocks.recebimentoTemporadaAggregate,
    },
    despesaTemporada: { aggregate: mocks.despesaTemporadaAggregate },
    limpeza: { findMany: mocks.limpezaFindMany },
  },
}));

import {
  kpisDoMes,
  kpisDoPeriodo,
  pendentesDoMes,
  pendentesDoPeriodo,
} from "./relatorios";
import {
  dadosPainelCobranca,
  dadosPainelCobrancaPeriodo,
} from "./painel-cobranca";
import { detalheEmpreendimentoDoPeriodo } from "./painel-empreendimentos";

function recebimento({
  id,
  mes = "2026-09",
  devido,
  recebido,
  locatario = id,
}: {
  id: string;
  mes?: string;
  devido: number;
  recebido: number | null;
  locatario?: string;
}) {
  return {
    id,
    mesLancamento: mes,
    valor: devido,
    iptu: 0,
    cond: 0,
    recebido,
    taxaComissaoBps: 1_000,
    observacao: null,
    empreendimentoId: "emp",
    empreendimento: { nome: "Edifício" },
    contrato: {
      unidadeId: id,
      locatarioId: id,
      diaVencimento: 10,
      locatario: { nome: locatario },
      unidade: { identificacao: id },
    },
  };
}

function cenarioComPagamentosParciais() {
  return [
    recebimento({ id: "parcial", devido: 100_000, recebido: 25_000 }),
    recebimento({ id: "sem-pagamento", devido: 50_000, recebido: null }),
    recebimento({ id: "quitado", devido: 80_000, recebido: 80_000 }),
    recebimento({ id: "sobrepago", devido: 60_000, recebido: 75_000 }),
    recebimento({ id: "sem-cobranca", devido: 0, recebido: null }),
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 20));

  mocks.contratoCount.mockResolvedValue(0);
  mocks.empreendimentoFindUnique.mockResolvedValue({ id: "emp", nome: "Edifício" });
  mocks.unidadeFindMany.mockResolvedValue([]);
  mocks.lancamentoCaixaGroupBy.mockResolvedValue([]);
  mocks.recebimentoTemporadaAggregate.mockResolvedValue({
    _sum: { valor: null },
  });
  mocks.despesaTemporadaAggregate.mockResolvedValue({ _sum: { valor: null } });
  mocks.limpezaFindMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("relatórios de inadimplência", () => {
  it("inclui pagamento parcial e expõe devido, pago e saldo aberto", async () => {
    mocks.recebimentoFindMany.mockResolvedValue(cenarioComPagamentosParciais());

    const resultado = await pendentesDoMes("2026-09");

    expect(mocks.recebimentoFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { mesLancamento: "2026-09" } })
    );
    expect(resultado.map(({ recebimentoId, totalDevido, recebido, saldoAberto }) => ({
      recebimentoId,
      totalDevido,
      recebido,
      saldoAberto,
    }))).toEqual([
      {
        recebimentoId: "parcial",
        totalDevido: 100_000,
        recebido: 25_000,
        saldoAberto: 75_000,
      },
      {
        recebimentoId: "sem-pagamento",
        totalDevido: 50_000,
        recebido: 0,
        saldoAberto: 50_000,
      },
    ]);
  });

  it("aplica a mesma regra na lista por período", async () => {
    mocks.recebimentoFindMany.mockResolvedValue(cenarioComPagamentosParciais());

    const resultado = await pendentesDoPeriodo(["2026-09"]);

    expect(mocks.recebimentoFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { mesLancamento: { gte: "2026-09", lte: "2026-09" } },
      })
    );
    expect(resultado.map((item) => [item.recebimentoId, item.saldoAberto])).toEqual([
      ["parcial", 75_000],
      ["sem-pagamento", 50_000],
    ]);
  });

  it("soma o saldo, e não o valor integral, nos KPIs mensal e por período", async () => {
    mocks.recebimentoFindMany.mockResolvedValue(cenarioComPagamentosParciais());

    const mensal = await kpisDoMes("2026-09");
    const periodo = await kpisDoPeriodo(["2026-09"]);

    expect(mensal.inadimplencia).toEqual({
      quantidade: 2,
      valorDevido: 125_000,
    });
    expect(periodo.inadimplencia).toEqual({
      quantidade: 2,
      valorDevido: 125_000,
    });
  });
});

describe("painel de cobrança", () => {
  it("usa o saldo positivo na lista, no aging e no ranking mensal", async () => {
    mocks.recebimentoFindMany.mockResolvedValue(cenarioComPagamentosParciais());

    const resultado = await dadosPainelCobranca("2026-09");

    expect(resultado.pendentesMesQtde).toBe(2);
    expect(resultado.pendentesMesValor).toBe(125_000);
    expect(resultado.listaCobranca.map((item) => ({
      id: item.recebimentoId,
      devido: item.totalDevido,
      pago: item.recebido,
      saldo: item.saldoAberto,
    }))).toEqual([
      { id: "parcial", devido: 100_000, pago: 25_000, saldo: 75_000 },
      { id: "sem-pagamento", devido: 50_000, pago: 0, saldo: 50_000 },
    ]);
    expect(resultado.aging.reduce((soma, faixa) => soma + faixa.valor, 0)).toBe(
      125_000
    );
    expect(resultado.topDevedores.map((item) => item.valor)).toEqual([
      75_000,
      50_000,
    ]);
  });

  it("não cria saldo negativo no modo por período", async () => {
    mocks.recebimentoFindMany.mockResolvedValue(cenarioComPagamentosParciais());

    const resultado = await dadosPainelCobrancaPeriodo(["2026-09"]);

    expect(resultado.pendentesQtde).toBe(2);
    expect(resultado.pendentesValor).toBe(125_000);
    expect(resultado.listaCobranca.map((item) => item.saldoAberto)).toEqual([
      75_000,
      50_000,
    ]);
    expect(resultado.listaCobranca.some((item) => item.recebimentoId === "sobrepago"))
      .toBe(false);
  });
});

describe("painel por empreendimento", () => {
  it("mantém pagamentos parciais no saldo do empreendimento e do locatário", async () => {
    mocks.recebimentoFindMany.mockResolvedValue(cenarioComPagamentosParciais());

    const resultado = await detalheEmpreendimentoDoPeriodo("emp", ["2026-09"]);

    expect(resultado).not.toBeNull();
    expect(resultado?.pendentesQtde).toBe(2);
    expect(resultado?.pendenteAberto).toBe(125_000);
    expect(resultado?.locatarios.map((locatario) => [
      locatario.nome,
      locatario.pendenteJanela,
    ])).toEqual([
      ["parcial", 75_000],
      ["sem-pagamento", 50_000],
      ["quitado", 0],
      ["sobrepago", 0],
      ["sem-cobranca", 0],
    ]);
  });
});
