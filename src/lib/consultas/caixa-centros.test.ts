import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ groupBy: vi.fn(), findMany: vi.fn(), categorias: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {
  lancamentoCaixa: { groupBy: mocks.groupBy, findMany: mocks.findMany },
  categoriaCentroCusto: { findMany: mocks.categorias },
} }));
vi.mock("@/lib/consultas/filtro-unificacao-nativa", () => ({
  filtroCaixaUnificado: async () => ({}), filtroRecebimentosUnificados: async () => ({}),
}));

import { categoriasPorCentro, consolidacaoAnual, consolidacaoDoMes, consolidacaoDoPeriodo, consolidacaoMensalDoPeriodo, lancamentosDoMes } from "./caixa";
import { painelCaixa, painelCaixaPeriodo } from "./painel-caixa-temporada";
import { caixaDoPeriodoPorMes } from "./executivo";
import { rotuloCaixaOrigem } from "../dominio/caixa-origem";

const grupos = [
  { mesReferencia: "2026-09", centroCusto: "AL", tipo: "SAIDA", _sum: { valor: 100 } },
  { mesReferencia: "2026-09", centroCusto: "CH", tipo: "SAIDA", _sum: { valor: 200 } },
  { mesReferencia: "2026-09", centroCusto: "BRISA", tipo: "SAIDA", _sum: { valor: 300 } },
  { mesReferencia: "2026-09", centroCusto: "GERAL", tipo: "SAIDA", _sum: { valor: 50 } },
  { mesReferencia: "2026-09", centroCusto: "GERAL", tipo: "ENTRADA", _sum: { valor: 1000 } },
  { mesReferencia: "2026-09", centroCusto: "GERAL", tipo: "RECEB_DINHEIRO", _sum: { valor: 9000 } },
];
const esperado = { despesaAL: 100, despesaCH: 200, despesaOutros: 350, receita: 1000, recebDinheiro: 9000, saldo: 350 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.groupBy.mockImplementation(async ({ by }: { by: string[] }) => by.includes("categoria")
    ? grupos.filter(g => g.tipo === "SAIDA").map(g => ({ centroCusto: g.centroCusto, categoria: "Categoria artificial", _sum: g._sum }))
    : grupos);
  mocks.findMany.mockResolvedValue([]);
  mocks.categorias.mockResolvedValue([]);
});

describe("caixa inclui todos os centros sem resomar espécie", () => {
  it("consolida mês e período com saídas BRISA e GERAL", async () => {
    expect(await consolidacaoDoMes("2026-09")).toEqual(esperado);
    expect(await consolidacaoDoPeriodo(["2026-09"])).toEqual(esperado);
  });

  it("preserva resumo anual, mensal e acumulado com outros centros", async () => {
    const ano = await consolidacaoAnual(2026);
    expect(ano.totais).toEqual(esperado);
    expect(ano.linhas[8]).toMatchObject({ ...esperado, acumulado: 350, temLancamentos: true });
    expect(ano.linhas[9]).toMatchObject({ despesaOutros: 0, saldo: 0, acumulado: 350, temLancamentos: false });
    const periodo = await consolidacaoMensalDoPeriodo(["2026-09", "2026-10"]);
    expect(periodo.totais).toEqual(esperado);
    expect(periodo.linhas.map(l => l.acumulado)).toEqual([350, 350]);
  });

  it("mostra cada centro novo em bloco próprio, sem atribuir suas saídas a AL ou CH", async () => {
    mocks.findMany.mockResolvedValue(grupos.map((g, i) => ({
      id: String(i), mesReferencia: g.mesReferencia, centroCusto: g.centroCusto, caixaOrigem: null,
      tipo: g.tipo, categoria: "Categoria artificial", data: "2026-09-10", valor: g._sum.valor,
      descricao: "Descrição artificial", cliente: null, local: null,
    })));
    const blocos = await lancamentosDoMes("2026-09");
    expect(blocos.saidasAL.total).toBe(100);
    expect(blocos.saidasCH.total).toBe(200);
    expect(blocos.saidasOutros.map(b => [b.centroCusto, b.total])).toEqual([["BRISA", 300], ["GERAL", 50]]);
    expect(blocos.entradas.total).toBe(1000);
    expect(blocos.recebimentosDinheiro.total).toBe(9000);
  });

  it("painéis anual e por período conciliam total e composição de categorias", async () => {
    const periodo = await painelCaixaPeriodo(["2026-09"]);
    expect(periodo.totais).toEqual(esperado);
    expect(periodo.categorias).toEqual([{ categoria: "Categoria artificial", total: 650, al: 100, ch: 200, outros: 350 }]);
    const ano = await painelCaixa(2026);
    expect(ano.resumo.totais).toEqual(esperado);
    expect(ano.categorias).toEqual(periodo.categorias);
  });

  it("executivo por período considera saídas de qualquer centro", async () => {
    mocks.findMany.mockResolvedValue(grupos.map(g => ({ ...g, valor: g._sum.valor })));
    expect(await caixaDoPeriodoPorMes(["2026-09"])).toEqual([
      { mes: "2026-09", receita: 1000, despesaAL: 100, despesaCH: 200, despesaOutros: 350, dinheiro: 9000, saldo: 350 },
    ]);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [{ mesReferencia: { gte: "2026-09", lte: "2026-09" } }, {}] },
    }));
  });

  it("lista categorias BRISA para edição preservando as categorias AL e CH", async () => {
    mocks.categorias.mockResolvedValue([{ centroCusto: "BRISA", nome: "Manutenção" }, { centroCusto: "AL", nome: "Pessoal" }]);
    mocks.findMany.mockResolvedValue([{ centroCusto: "BRISA", categoria: "Serviço" }, { centroCusto: "BRISA", categoria: "Manutenção" }]);
    expect(await categoriasPorCentro()).toEqual({ AL: ["Pessoal"], CH: [], BRISA: ["Manutenção", "Serviço"] });
  });

  it("continua compatível com janelas apenas AL/CH", async () => {
    mocks.groupBy.mockResolvedValue(grupos.filter(g => g.centroCusto === "AL" || g.centroCusto === "CH" || g.tipo === "ENTRADA"));
    expect(await consolidacaoDoMes("2026-09")).toEqual({ despesaAL: 100, despesaCH: 200, despesaOutros: 0, receita: 1000, recebDinheiro: 0, saldo: 700 });
  });

  it("separa caixas distintos de GASTOS mesmo com a mesma descrição e valor", async () => {
    mocks.findMany.mockResolvedValue(["Plan1", "Plan3", "Plan4", "ALIANA"].map(aba => ({
      id: aba, mesReferencia: "2026-09", centroCusto: "BRISA", caixaOrigem: `GASTOS_BRISA:${aba}`,
      tipo: "SAIDA", categoria: "Categoria artificial", data: "2026-09-10", valor: 300,
      descricao: "Descrição artificial", cliente: null, local: null,
    })));
    const blocos = await lancamentosDoMes("2026-09");
    expect(blocos.saidasOutros).toHaveLength(4);
    expect(blocos.saidasOutros.map(b => b.caixaOrigem)).toEqual(["GASTOS_BRISA:ALIANA", "GASTOS_BRISA:Plan1", "GASTOS_BRISA:Plan3", "GASTOS_BRISA:Plan4"]);
    expect(blocos.saidasOutros.reduce((s, b) => s + b.total, 0)).toBe(1200);
    expect(blocos.saidasOutros.map(b => rotuloCaixaOrigem(b.caixaOrigem))).toEqual(["Brisa · ALIANA", "Brisa · Plan1", "Brisa · Plan3", "Brisa · Plan4"]);
  });
});
