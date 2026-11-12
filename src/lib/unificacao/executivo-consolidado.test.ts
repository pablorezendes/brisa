import { describe, it, expect } from "vitest";
import { consolidarExecutivo, mesPadraoConsolidado } from "./executivo-consolidado";
import type { LinhaUnificada } from "./tipos";

const exemplo: LinhaUnificada = {
  chave: "WIDESYS:RECEBER:t", origem: "WIDESYS", dominio: "RECEBER", origemId: "t",
  titulo: "Título de teste", nomeNorm: "", descricao: "", href: null, hash: "", qualidade: "OK", campos: {}, motivos: [],
  competencia: "2026-06", vencimento: "2026-06-12", estado: "ATIVO", origens: ["WIDESYS"], fontes: [], versao: 1,
  candidatos: [], avisos: [], divergencias: [], contabiliza: true, valor: 8000, pago: 6500, aberto: 1500,
};
function linha(dados: Partial<LinhaUnificada>) { return { ...exemplo, ...dados }; }

describe("Executivo consolidado", () => {
  it("separa obrigação, pagamento e fluxo de caixa, incluindo os lançamentos manuais novos", () => {
    const linhas = [
      exemplo, linha({ origem: "BRISA", valor: 5300, pago: 5000, aberto: 300 }),
      linha({ estado: "VINCULADO", contabiliza: false }), linha({ estado: "PENDENTE", contabiliza: false }),
      linha({ cancelado: true, contabiliza: false }), linha({ estado: "QUARENTENA", contabiliza: false }),
      linha({ dominio: "BAIXA_RECEBER", valor: 6500, informativo: true, contabiliza: false }),
      linha({ dominio: "PAGAR", valor: 5600, pago: 5600 }),
      linha({ dominio: "MOVIMENTO", natureza: "ENTRADA", data: "2026-06-20", valor: 6500 }),
      linha({ dominio: "MOVIMENTO", natureza: "SAIDA", data: "2026-06-28", valor: 5600 }),
      linha({ dominio: "MOVIMENTO", natureza: "TRANSFERENCIA", informativo: true, contabiliza: false }),
      linha({ dominio: "MOVIMENTO", natureza: "SAIDA", data: "2026-07-01", valor: 900 }),
      linha({ origem: "BRISA", lancamentoManual: true, dominio: "PAGAR", valor: 1200, pago: 1200 }),
      linha({ origem: "BRISA", lancamentoManual: true, dominio: "MOVIMENTO", natureza: "SAIDA", data: "2026-06-29", valor: 1200 }),
      linha({ competencia: "2027-04", valor: 77700, pago: 0, aberto: 77700 }),
    ];
    const r = consolidarExecutivo(linhas, ["2026-06", "2026-07"], ["2026-06"], "2026-06-30");
    expect(r).toMatchObject({ devido: 8000, recebido: 6500, inadQtde: 1, inadValor: 1500, caixaReceita: 6500, caixaDespesa: 6800, saldoCaixa: -300,
      titulosReceber: 1, titulosPagar: 2, despesaPaga: 6800 });
    expect(r.serie.map(m => m.caixa.saldo)).toEqual([-300, -900]);
    expect(r.porEmp).toEqual([{ id: "Sem empreendimento identificado", nome: "Sem empreendimento identificado", recebido: 6500, ticket: 6500 }]);
    expect(r.pendentes[0].diasAtraso).toBe(18);
    expect(mesPadraoConsolidado(linhas, "2026-11-03")).toBe("2026-07");
  });
  it("atribui o recebimento ao empreendimento do imóvel principal, inclusive em vínculo entre fontes", () => {
    const imovel = linha({ chave: "BRISA:IMOVEL:i", dominio: "IMOVEL", fontes: ["BRISA:IMOVEL:i", "WIDESYS:IMOVEL:x"],
      campos: { empreendimento: { rotulo: "Empreendimento", valor: "Residencial de teste" } } });
    const r = consolidarExecutivo([imovel, linha({ imovelChave: "WIDESYS:IMOVEL:x" })], ["2026-06"], ["2026-06"], "2026-11-03");
    expect(r.porEmp[0]).toMatchObject({ nome: "Residencial de teste", recebido: 6500 });
  });
});
