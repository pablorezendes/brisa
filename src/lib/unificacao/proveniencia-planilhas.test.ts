import { describe, expect, it } from "vitest";

import {
  reconstruirProvenienciaPlanilhas,
  type CaixaParaProveniencia,
  type DatasetProveniencia,
  type RecebimentoParaProveniencia,
} from "./proveniencia-planilhas";

const recebimento: RecebimentoParaProveniencia = {
  id: "recebimento-artificial-1", empreendimentoNome: "EDIFICIO TESTE", unidadeIdentificacao: "SALA 01",
  locatarioNome: "Pessoa de teste", mesLancamento: "2026-01", competencia: "2025-12",
  valor: 120000, iptu: 1500, cond: 20000, recebido: 100000, dataPagamento: "2026-01-15",
  via: "PIX", taxaComissaoBps: 1000, observacao: "parcela parcial", origemAgregada: false,
};

const caixa: CaixaParaProveniencia = {
  id: "caixa-artificial-1", mesReferencia: "2026-01", centroCusto: "GERAL", tipo: "RECEB_DINHEIRO",
  categoria: null, data: "2026-01-04", valor: 35000, descricao: null, cliente: "Cliente teste", local: "SALA 02",
};

function dataset(): DatasetProveniencia {
  return {
    origem: { relatorio: "relatorio.xlsx", conta_ac: "caixa.xlsx" },
    recebimentos: [{
      mes: 1, mes_ref: "JAN", empreendimento: "Edifício Teste", locatario: "PESSOA DE TESTE",
      localizacao: "Sala 01", cpf_cnpj: null, valor: 1200, iptu: 15, cond: 200, recebido: 1000,
      data_pagamento: "2026-01-15T00:00:00", competencia: "2025-12-01", via: "Pix",
      taxa_comissao: 0.1, observacao: "parcela parcial", base_calculo_planilha: 785, comissao_planilha: 78.5,
    }],
    livro_caixa: { "JAN 2026": {
      saida_ac: [], saida_ch: [], entrada: [],
      receb_dinheiro: [{ linha: 9, secao: null, data: "2026-01-04T00:00:00", valor: 350, descricao: "Cliente teste", local: "SALA 02" }],
    } },
  };
}

describe("proveniência recuperada das planilhas originais", () => {
  it("identifica o conteúdo exato preservando competência, pagamento parcial e a linha real do caixa", () => {
    const resultado = reconstruirProvenienciaPlanilhas(dataset(), { recebimentos: [recebimento], lancamentosCaixa: [caixa] });
    expect(resultado.recebimentos.get(recebimento.id)).toMatchObject({ arquivo: "relatorio.xlsx", aba: "RECEB JAN", linha: null, indiceDataset: 0 });
    expect(resultado.lancamentosCaixa.get(caixa.id)).toMatchObject({ arquivo: "caixa.xlsx", aba: "JAN 2026", linha: 9, faixa: "receb_dinheiro" });
    expect(resultado.resumo.recebimentos).toEqual({ fonte: 1, atuais: 1, identificados: 1, ambiguos: 0, semCorrespondencia: 0 });
    expect(resultado.recebimentos.get(recebimento.id)?.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    { recebido: 100001 }, { competencia: "2026-01" }, { observacao: "alterado" },
    { unidadeIdentificacao: "SALA 02" }, { locatarioNome: "Outra pessoa" }, { taxaComissaoBps: 1200 },
  ])("não atribui origem completa a uma linha alterada (%j)", (alteracao) => {
    const resultado = reconstruirProvenienciaPlanilhas(dataset(), { recebimentos: [{ ...recebimento, ...alteracao }], lancamentosCaixa: [] });
    expect(resultado.recebimentos.size).toBe(0);
    expect(resultado.resumo.recebimentos.semCorrespondencia).toBe(1);
  });

  it("não escolhe arbitrariamente entre linhas idênticas na fonte ou no destino", () => {
    const fonteDuplicada = dataset();
    fonteDuplicada.recebimentos.push({ ...fonteDuplicada.recebimentos[0] });
    const duplicadaFonte = reconstruirProvenienciaPlanilhas(fonteDuplicada, { recebimentos: [recebimento], lancamentosCaixa: [] });
    const duplicadaDestino = reconstruirProvenienciaPlanilhas(dataset(), {
      recebimentos: [recebimento, { ...recebimento, id: "recebimento-artificial-2" }], lancamentosCaixa: [],
    });
    expect(duplicadaFonte.recebimentos.size).toBe(0);
    expect(duplicadaFonte.resumo.recebimentos.ambiguos).toBe(1);
    expect(duplicadaDestino.recebimentos.size).toBe(0);
    expect(duplicadaDestino.resumo.recebimentos.ambiguos).toBe(2);
  });

  it("não atribui linha Excel quando duas posições do caixa têm o mesmo conteúdo", () => {
    const ds = dataset();
    ds.livro_caixa["JAN 2026"].receb_dinheiro.push({ ...ds.livro_caixa["JAN 2026"].receb_dinheiro[0], linha: 10 });
    const resultado = reconstruirProvenienciaPlanilhas(ds, { recebimentos: [], lancamentosCaixa: [caixa] });
    expect(resultado.lancamentosCaixa.size).toBe(0);
    expect(resultado.resumo.lancamentosCaixa.ambiguos).toBe(1);
  });

  it("distingue não recebido de zero e não inclui dados pessoais no resultado", () => {
    const ds = dataset();
    ds.recebimentos[0].recebido = null;
    const resultado = reconstruirProvenienciaPlanilhas(ds, { recebimentos: [{ ...recebimento, recebido: 0 }], lancamentosCaixa: [caixa] });
    expect(resultado.recebimentos.size).toBe(0);
    expect(JSON.stringify([...resultado.lancamentosCaixa.values()])).not.toContain("Cliente teste");
  });
});
