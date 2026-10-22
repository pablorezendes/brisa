import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acesso: vi.fn(), financeira: vi.fn(), redirect: vi.fn(), revalidar: vi.fn(),
  fechamento: vi.fn(), taxa: vi.fn(), transacao: vi.fn(), governado: vi.fn(),
  contrato: vi.fn(), criar: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/acesso/servidor", () => ({ exigirPermissaoAcesso: mocks.acesso }));
vi.mock("@/lib/autorizacao", () => ({ exigirPermissaoFinanceira: mocks.financeira }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidar }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/unificacao/protecao-financeira", () => ({}));
vi.mock("@/lib/consultas/locacao", () => ({
  RE_MES: /^\d{4}-(0[1-9]|1[0-2])$/,
  RE_DATA: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
  VIAS_PAGAMENTO: ["BOLETO", "PIX", "DINHEIRO", "SERVICO"],
  taxaComissaoParaMes: mocks.taxa,
}));
// Contrato e criação existem apenas no cliente transacional. O teste falha
// se a ação voltar a consultar a carteira fora da mesma transação da escrita.
vi.mock("@/lib/db", () => ({ prisma: {
  fechamentoMensal: { findUnique: mocks.fechamento },
  $transaction: mocks.transacao,
} }));

import { criarLancamentoAvulso } from "./actions";

const contratoAtual = {
  id: "contrato", valorBase: 123456, iptu: 12000, condominio: 25000,
  unidade: { id: "unidade", empreendimentoId: "empreendimento-destino" },
};

function formulario(alteracoes: Record<string, string> = {}) {
  const form = new FormData();
  for (const [chave, valor] of Object.entries({
    contratoId: "contrato", mes: "2026-10", ...alteracoes,
  })) form.set(chave, valor);
  return form;
}

async function executar(form = formulario()) {
  await expect(criarLancamentoAvulso(form)).rejects.toThrow("REDIRECT:");
  expect(mocks.redirect).toHaveBeenCalledTimes(1);
  return new URL(mocks.redirect.mock.calls[0][0], "https://brisa.invalid").searchParams;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation((url: string) => { throw new Error(`REDIRECT:${url}`); });
  mocks.fechamento.mockResolvedValue(null);
  mocks.governado.mockResolvedValue(null);
  mocks.taxa.mockResolvedValue(1000);
  mocks.contrato.mockResolvedValue(contratoAtual);
  mocks.criar.mockResolvedValue({ id: "recebimento-novo" });
  mocks.transacao.mockImplementation(async operacao => operacao({
    recursoGovernado: { findUnique: mocks.governado },
    contrato: { findUnique: mocks.contrato },
    recebimento: { create: mocks.criar },
  }));
});

describe("lançamento avulso — carteira consistente com o imóvel", () => {
  it("lê a carteira e cria o título na mesma transação, herdando os valores atuais", async () => {
    const retorno = await executar();

    expect(retorno.get("ok")).toBe("Lançamento avulso criado.");
    expect(mocks.acesso).toHaveBeenCalledWith("recebimentos.editar", { global: true });
    expect(mocks.financeira).toHaveBeenCalledWith("CONCILIAR_PAGAMENTOS");
    expect(mocks.transacao).toHaveBeenCalledTimes(1);
    expect(mocks.contrato).toHaveBeenCalledExactlyOnceWith({
      where: { id: "contrato" }, include: { unidade: true },
    });
    expect(mocks.criar).toHaveBeenCalledExactlyOnceWith({ data: {
      contratoId: "contrato", empreendimentoId: "empreendimento-destino",
      mesLancamento: "2026-10", competencia: "2026-10",
      valor: 123456, iptu: 12000, cond: 25000, recebido: null,
      dataPagamento: null, via: null, taxaComissaoBps: 1000, observacao: null,
    } });
    expect(mocks.taxa.mock.invocationCallOrder[0]).toBeLessThan(mocks.transacao.mock.invocationCallOrder[0]);
    expect(mocks.contrato.mock.invocationCallOrder[0]).toBeLessThan(mocks.criar.mock.invocationCallOrder[0]);
    expect(mocks.revalidar).toHaveBeenCalledWith("/recebimentos");
  });

  it("usa a carteira corrigida antes de abrir a transação, sem snapshot antigo", async () => {
    mocks.contrato.mockResolvedValue({ ...contratoAtual, unidade: { empreendimentoId: "origem" } });
    mocks.taxa.mockImplementation(async () => {
      mocks.contrato.mockResolvedValue(contratoAtual);
      return 750;
    });

    await executar();

    expect(mocks.criar.mock.calls[0][0].data).toMatchObject({
      empreendimentoId: "empreendimento-destino", taxaComissaoBps: 750,
    });
  });

  it("preserva zero explícito, valores informados e dados de pagamento", async () => {
    await executar(formulario({
      valor: "0", iptu: "75,34", cond: "0", recebido: "75,34", via: "PIX",
      competencia: "2026-09", dataPagamento: "2026-10-22", observacao: " Correção ",
    }));

    expect(mocks.criar.mock.calls[0][0].data).toMatchObject({
      valor: 0, iptu: 7534, cond: 0, recebido: 7534, via: "PIX",
      competencia: "2026-09", dataPagamento: "2026-10-22", observacao: "Correção",
    });
  });

  it("não grava data ou via sem valor recebido", async () => {
    await executar(formulario({ dataPagamento: "2026-10-22", via: "PIX" }));
    expect(mocks.criar.mock.calls[0][0].data).toMatchObject({ recebido: null, dataPagamento: null, via: null });
  });

  it("confere exclusão do contrato dentro da transação", async () => {
    mocks.governado.mockResolvedValue({ status: "EXCLUIDO" });
    const retorno = await executar();

    expect(retorno.get("erro")).toContain("Contrato excluído");
    expect(mocks.governado).toHaveBeenCalledWith({
      where: { tipo_origemId: { tipo: "CONTRATO", origemId: "contrato" } }, select: { status: true },
    });
    expect(mocks.criar).not.toHaveBeenCalled();
    expect(mocks.revalidar).not.toHaveBeenCalled();
  });

  it("não cria se o contrato já não existir", async () => {
    mocks.contrato.mockResolvedValue(null);
    const retorno = await executar();
    expect(retorno.get("erro")).toBe("Selecione o contrato do lançamento.");
    expect(mocks.criar).not.toHaveBeenCalled();
  });

  it.each([
    { mes: "2026-13" },
    { contratoId: "" },
    { competencia: "2026-13" },
    { dataPagamento: "22/10/2026" },
  ])("preserva validações antes de qualquer escrita: %j", async alteracoes => {
    const retorno = await executar(formulario(alteracoes));
    expect(retorno.get("erro")).toBeTruthy();
    expect(mocks.criar).not.toHaveBeenCalled();
    expect(mocks.transacao).not.toHaveBeenCalled();
  });

  it("mantém a proteção de mês fechado", async () => {
    mocks.fechamento.mockResolvedValue({ id: "fechamento" });
    const retorno = await executar();
    expect(retorno.get("erro")).toContain("Mês fechado");
    expect(mocks.transacao).not.toHaveBeenCalled();
  });

  it("não grava sem autorização", async () => {
    mocks.financeira.mockRejectedValue(new Error("Acesso negado"));
    await expect(criarLancamentoAvulso(formulario())).rejects.toThrow("Acesso negado");
    expect(mocks.transacao).not.toHaveBeenCalled();
  });

  it("propaga falha transacional sem anunciar sucesso nem invalidar telas", async () => {
    mocks.criar.mockRejectedValue(new Error("Transação indisponível"));
    await expect(criarLancamentoAvulso(formulario())).rejects.toThrow("Transação indisponível");
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidar).not.toHaveBeenCalled();
  });
});
