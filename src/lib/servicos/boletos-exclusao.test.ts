import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const db = {
    $transaction: vi.fn(),
    recursoGovernado: { findUnique: vi.fn() },
    boleto: { findUnique: vi.fn(), update: vi.fn() },
    recebimento: { findUnique: vi.fn(), update: vi.fn() },
    contaBancaria: { findUnique: vi.fn() },
    pagamentoRecebimento: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    eventoBoleto: { create: vi.fn(), update: vi.fn() },
  };
  return { db };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: mocks.db }));

import { emitirBoletoSicoob, reprocessarConciliacaoSicoob } from "./boletos-sicoob";

describe("retorno bancário de registro excluído", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const boleto = { id: "boleto-artificial", recebimentoId: "titulo-artificial", nossoNumero: "123", seuNumero: "FICTICIO", liquidadoEm: null, recebimento: { pagamentos: [] } };
    mocks.db.$transaction.mockImplementation(async callback => callback(mocks.db));
    mocks.db.pagamentoRecebimento.findUnique.mockResolvedValue({ id: "pagamento-artificial", origem: "SICOOB", status: "CONFIRMADO", boleto, eventoBoleto: { id: "evento-original" }, chaveIdempotencia: "pagamento:liquidacao-artificial", valor: 10000, dataPagamento: "2026-10-01", dataCredito: null });
    mocks.db.boleto.findUnique.mockResolvedValue(boleto);
    mocks.db.eventoBoleto.create.mockResolvedValue({ id: "evento-revisao" });
  });

  it.each(["BOLETO", "TITULO"])("%s excluído conserva liquidação como pendência sem recriar pagamento nem atualizar recebido", async tipo => {
    mocks.db.recursoGovernado.findUnique.mockImplementation(async ({ where }) => where.tipo_origemId.tipo === tipo ? { status: "EXCLUIDO" } : null);
    await expect(reprocessarConciliacaoSicoob("pagamento-artificial", "admin-artificial")).resolves.toBe("ERRO");
    expect(mocks.db.pagamentoRecebimento.create).not.toHaveBeenCalled();
    expect(mocks.db.pagamentoRecebimento.update).not.toHaveBeenCalled();
    expect(mocks.db.pagamentoRecebimento.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.recebimento.update).not.toHaveBeenCalled();
    expect(mocks.db.boleto.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "LIQUIDADO", conciliacaoStatus: "DIVERGENTE", conciliacaoMotivo: "REGISTRO_EXCLUIDO" }) }));
    expect(mocks.db.eventoBoleto.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "evento-original" }, data: expect.objectContaining({ statusProcessamento: "ERRO" }) }));
  });

  it.each(["CONTA", "CONTRATO", "UNIDADE", "EMPREENDIMENTO", "LOCATARIO", "PESSOA"])("%s excluído não autoriza nova emissão, mesmo com cadastro original ativo", async tipo => {
    mocks.db.recursoGovernado.findUnique.mockImplementation(async ({ where }) => where.tipo_origemId.tipo === tipo ? { status: "EXCLUIDO" } : null);
    mocks.db.recebimento.findUnique.mockResolvedValue({ id: "titulo-artificial", empreendimentoId: "emp-artificial", contrato: { id: "contrato-artificial", unidadeId: "unidade-artificial", locatarioId: "locatario-artificial", unidade: { empreendimentoId: "emp-artificial" }, locatario: { pessoaId: "pessoa-artificial" } } });
    mocks.db.contaBancaria.findUnique.mockResolvedValue({ id: "conta-artificial", ativa: true, integracaoHabilitada: true });
    await expect(emitirBoletoSicoob({ recebimentoId: "titulo-artificial", contaBancariaId: "conta-artificial", dataVencimento: "2099-12-01", usuarioId: "admin-artificial" })).rejects.toMatchObject({ codigo: "REGISTRO_EXCLUIDO" });
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
    expect(mocks.db.recebimento.update).not.toHaveBeenCalled();
  });
});
