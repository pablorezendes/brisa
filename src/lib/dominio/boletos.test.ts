import { describe, expect, it } from "vitest";
import {
  avaliarConciliacao,
  camposPagadorPendentes,
  vencimentoDoRecebimento,
} from "./boletos";

describe("vencimentoDoRecebimento", () => {
  it("limita o vencimento ao último dia do mês", () => {
    expect(vencimentoDoRecebimento("2026-02", 31)).toBe("2026-02-28");
    expect(vencimentoDoRecebimento("2028-02", 31)).toBe("2028-02-29");
  });

  it("usa dia 10 quando o contrato não tem vencimento", () => {
    expect(vencimentoDoRecebimento("2026-06", null)).toBe("2026-06-10");
  });
});

describe("camposPagadorPendentes", () => {
  it("lista somente os campos obrigatórios ausentes", () => {
    const faltantes = camposPagadorPendentes({
      cpfCnpj: "12345678901",
      endereco: "Rua A",
      numeroEndereco: "1",
      bairro: "Centro",
      cidade: "Salvador",
      cep: null,
      uf: "BA",
    });
    expect(faltantes.map((item) => item.campo)).toEqual(["cep"]);
  });
});

describe("avaliarConciliacao", () => {
  it("concilia apenas quando o valor confirmado fecha exatamente o devido", () => {
    expect(
      avaliarConciliacao({
        total: 100_00,
        totalPagamentosConfirmados: 100_00,
        recebidoLegado: null,
        mesFechado: false,
      }),
    ).toEqual({ tipo: "CONCILIAR", recebido: 100_00 });
  });

  it("mantém parcial, maior, mês fechado e baixa manual na fila", () => {
    expect(avaliarConciliacao({ total: 100, totalPagamentosConfirmados: 60, recebidoLegado: null, mesFechado: false })).toEqual({ tipo: "PENDENTE", motivo: "PAGAMENTO_PARCIAL" });
    expect(avaliarConciliacao({ total: 100, totalPagamentosConfirmados: 120, recebidoLegado: null, mesFechado: false })).toEqual({ tipo: "PENDENTE", motivo: "PAGAMENTO_MAIOR" });
    expect(avaliarConciliacao({ total: 100, totalPagamentosConfirmados: 100, recebidoLegado: null, mesFechado: true })).toEqual({ tipo: "PENDENTE", motivo: "MES_FECHADO" });
    expect(avaliarConciliacao({ total: 100, totalPagamentosConfirmados: 100, recebidoLegado: 80, mesFechado: false })).toEqual({ tipo: "PENDENTE", motivo: "BAIXA_MANUAL_EXISTENTE" });
    expect(avaliarConciliacao({ total: 100, totalPagamentosConfirmados: 100, recebidoLegado: 100, baixaManualSemVinculo: true, mesFechado: false })).toEqual({ tipo: "PENDENTE", motivo: "BAIXA_MANUAL_EXISTENTE" });
  });
});
