import { describe, expect, it } from "vitest";
import { calcularRecebimento, comissaoTotal } from "./comissao";

// Os 6 testes obrigatórios de references/02-locacao-e-recebimentos.md.
// Valores em centavos; taxa em bps (1000 = 10%).

describe("calcularRecebimento", () => {
  it("1. caminho feliz: aluguel cheio sem repasses", () => {
    const r = calcularRecebimento({
      valor: 534700, iptu: 0, cond: 0, recebido: 534700, taxaComissaoBps: 1000,
    });
    expect(r.totalDevido).toBe(534700);
    expect(r.baseCalculo).toBe(534700);
    expect(r.comissao).toBe(53470); // R$534,70
  });

  it("2. com repasses: IPTU/condomínio NÃO entram na comissão", () => {
    const r = calcularRecebimento({
      valor: 108400, iptu: 0, cond: 15500, recebido: 123900, taxaComissaoBps: 1000,
    });
    expect(r.totalDevido).toBe(123900);
    expect(r.baseCalculo).toBe(108400); // recebido − cond
    expect(r.comissao).toBe(10840); // R$108,40 — condo fora da base
  });

  it("3. pagamento parcial: comissão proporcional ao recebido", () => {
    const r = calcularRecebimento({
      valor: 100000, iptu: 10000, cond: 5000, recebido: 60000, taxaComissaoBps: 1000,
    });
    expect(r.totalDevido).toBe(115000);
    expect(r.baseCalculo).toBe(45000); // 600 − 100 − 50
    expect(r.comissao).toBe(4500);
  });

  it("4. recebido a maior (quitando atraso): base sobe", () => {
    const r = calcularRecebimento({
      valor: 92500, iptu: 0, cond: 0, recebido: 122500, taxaComissaoBps: 1000,
    });
    expect(r.totalDevido).toBe(92500);
    expect(r.baseCalculo).toBe(122500); // 925 + 300 de dívida abatida
    expect(r.comissao).toBe(12250);
  });

  it("5. sem recebimento: total existe, base/comissão nulos", () => {
    const r = calcularRecebimento({
      valor: 100000, iptu: 5000, cond: 0, recebido: null, taxaComissaoBps: 1000,
    });
    expect(r.totalDevido).toBe(105000);
    expect(r.baseCalculo).toBeNull();
    expect(r.comissao).toBeNull();
  });

  it("6. nada a cobrar: valor=iptu=cond=0 → total nulo (vazio, não zero)", () => {
    const r = calcularRecebimento({
      valor: 0, iptu: 0, cond: 0, recebido: null, taxaComissaoBps: 1000,
    });
    expect(r.totalDevido).toBeNull();
    expect(r.baseCalculo).toBeNull();
    expect(r.comissao).toBeNull();
  });

  it("taxa parametrizável: 8% em bps", () => {
    const r = calcularRecebimento({
      valor: 100000, iptu: 0, cond: 0, recebido: 100000, taxaComissaoBps: 800,
    });
    expect(r.comissao).toBe(8000);
  });

  it("arredondamento ao centavo (meio para cima)", () => {
    // base 925,33 → 10% = 92,533 → 92,53
    const r = calcularRecebimento({
      valor: 92533, iptu: 0, cond: 0, recebido: 92533, taxaComissaoBps: 1000,
    });
    expect(r.comissao).toBe(9253);
  });
});

describe("comissaoTotal", () => {
  it("soma só recebimentos com comissão (equivale ao SUBTOTAL)", () => {
    const total = comissaoTotal([
      { valor: 534700, iptu: 0, cond: 0, recebido: 534700, taxaComissaoBps: 1000 },
      { valor: 108400, iptu: 0, cond: 15500, recebido: 123900, taxaComissaoBps: 1000 },
      { valor: 100000, iptu: 0, cond: 0, recebido: null, taxaComissaoBps: 1000 },
    ]);
    expect(total).toBe(53470 + 10840);
  });
});
