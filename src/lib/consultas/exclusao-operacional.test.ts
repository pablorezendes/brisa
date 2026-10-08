import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tabela = () => ({ findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), groupBy: vi.fn() });
  return { db: {
    recursoGovernado: tabela(), contrato: tabela(), empreendimento: tabela(), unidade: tabela(), unidadeTemporada: tabela(), limpeza: tabela(),
    despesaTemporada: tabela(), recebimentoTemporada: tabela(), boleto: tabela(), recebimento: tabela(),
    contaBancaria: tabela(), fechamentoMensal: tabela(), pagamentoRecebimento: tabela(), eventoBoleto: tabela(), sincronizacaoBancaria: tabela(),
  } };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: mocks.db }));
vi.mock("./filtro-unificacao-nativa", () => ({ filtroRecebimentosUnificados: async () => ({ id: { notIn: ["recebimento-excluido"] } }) }));

import { contratosAtivos, contratosParaLista, contratosParaSelecao, contratoDetalhe } from "./locacao";
import { dadosTemporadaDoMes, dadosTemporadaDoPeriodo } from "./temporada";
import { dadosPaginaBoletos, dadosPaginaConciliacao } from "./boletos";
import { painelEmpreendimentosDoPeriodo, detalheEmpreendimentoDoPeriodo } from "./painel-empreendimentos";

beforeEach(() => {
  vi.resetAllMocks();
  for (const tabela of Object.values(mocks.db)) {
    tabela.findMany.mockResolvedValue([]);
    tabela.findUnique.mockResolvedValue(null);
    tabela.count.mockResolvedValue(0);
    tabela.groupBy.mockResolvedValue([]);
  }
  mocks.db.recursoGovernado.findMany.mockImplementation(async ({ where }) => [{ origemId: `excluido-${where.tipo}` }]);
});

describe("exclusões nos leitores operacionais", () => {
  it("cards e ocupação não apresentam dimensões excluídas; títulos históricos não são apagados", async () => {
    const recebimentos = ["emp-ativo", "emp-excluido"].map(empreendimentoId => ({ empreendimentoId, mesLancamento: "2026-06", valor: 10000, recebido: 10000, iptu: 0, cond: 0, taxaComissaoBps: 1000 }));
    mocks.db.recebimento.findMany.mockResolvedValue(recebimentos);
    mocks.db.empreendimento.findMany.mockResolvedValue([{ id: "emp-ativo", nome: "Empreendimento ativo" }]);
    const resultado = await painelEmpreendimentosDoPeriodo(["2026-06"]);
    expect(resultado.cartoes.map(c => c.id)).toEqual(["emp-ativo"]);
    const consulta = mocks.db.unidade.findMany.mock.calls[0][0];
    expect(JSON.stringify(consulta.where)).toContain("excluido-UNIDADE");
    expect(JSON.stringify(consulta.where)).toContain("excluido-EMPREENDIMENTO");
    expect(JSON.stringify(consulta.select.contratos.where)).toContain("excluido-CONTRATO");
    expect(JSON.stringify(consulta.select.contratos.where)).toContain("excluido-LOCATARIO");
    expect(recebimentos).toHaveLength(2);
    mocks.db.recursoGovernado.findUnique.mockResolvedValue({ status: "EXCLUIDO" });
    expect(await detalheEmpreendimentoDoPeriodo("emp-excluido", ["2026-06"])).toBeNull();
  });
  it("contrato excluído sai de listas e seletores e não abre como contrato ativo", async () => {
    await contratosAtivos(); await contratosParaLista(true); await contratosParaSelecao();
    for (const [args] of mocks.db.contrato.findMany.mock.calls) expect(args.where.id).toEqual({ notIn: ["excluido-CONTRATO"] });
    mocks.db.recursoGovernado.findUnique.mockResolvedValue({ status: "EXCLUIDO" });
    expect(await contratoDetalhe("excluido-CONTRATO")).toBeNull();
    expect(mocks.db.contrato.findUnique).not.toHaveBeenCalled();
  });

  it("temporada mensal e por período filtram cada tipo antes da apuração", async () => {
    await dadosTemporadaDoMes("2026-06"); await dadosTemporadaDoPeriodo(["2026-05", "2026-06"]);
    for (const [tipo, tabela] of [
      ["TEMPORADA_UNIDADE", mocks.db.unidadeTemporada], ["TEMPORADA_RECEBIMENTO", mocks.db.recebimentoTemporada],
      ["TEMPORADA_DESPESA", mocks.db.despesaTemporada], ["TEMPORADA_LIMPEZA", mocks.db.limpeza],
    ] as const) for (const [args] of tabela.findMany.mock.calls) expect(args.where.id).toEqual({ notIn: [`excluido-${tipo}`] });
  });

  it("boleto e título excluídos ficam fora das listas, contagens e KPIs de emissão", async () => {
    await dadosPaginaBoletos("2026-06");
    for (const metodo of [mocks.db.boleto.findMany, mocks.db.boleto.count, mocks.db.boleto.groupBy]) {
      expect(metodo).toHaveBeenCalled();
      for (const [args] of metodo.mock.calls) {
        expect(JSON.stringify(args.where)).toContain("excluido-BOLETO");
        expect(JSON.stringify(args.where)).toContain("recebimento-excluido");
      }
    }
    expect(JSON.stringify(mocks.db.recebimento.findMany.mock.calls[0][0].where)).toContain("recebimento-excluido");
    expect(mocks.db.contaBancaria.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ativa: true, id: { notIn: ["excluido-CONTA"] } } }));
  });

  it("conciliação filtra pagamentos excluídos mas mantém eventos para auditoria", async () => {
    await dadosPaginaConciliacao();
    for (const metodo of [mocks.db.pagamentoRecebimento.findMany, mocks.db.pagamentoRecebimento.count]) {
      for (const [args] of metodo.mock.calls) {
        expect(JSON.stringify(args.where)).toContain("excluido-BOLETO");
        expect(JSON.stringify(args.where)).toContain("recebimento-excluido");
      }
    }
    expect(mocks.db.eventoBoleto.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { statusProcessamento: { in: ["PENDENTE", "ERRO"] } } }));
  });
});
