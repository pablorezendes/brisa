import { describe, expect, it } from "vitest";
import { centavosRateio, conferirValoresRateio, modoCustoInicial, rateiosDoFormulario, valorEditavel } from "./rateio-formulario";

describe("valores manuais do rateio", () => {
  it.each([["2.560,00", 256000], ["2560", 256000], ["2.560", 256000], ["2560.00", 256000], ["R$ 430,00", 43000], ["0,01", 1], ["10,5", 1050], ["0", 0]])("converte %s em centavos sem arredondar", (entrada, esperado) => {
    expect(centavosRateio(String(entrada))).toBe(esperado);
  });
  it.each(["", " ", "-10", "1,234", "1.2345", "1,2,3", "abc", "1e5", "Infinity", "999999999999999999999999"])('rejeita "%s"', entrada => {
    expect(centavosRateio(entrada)).toBeNull();
  });
  it("fecha somente a soma exata, sem dividir valores automaticamente", () => {
    const valores = ["430,00", "950,00", "250,00", "930,00"].map(valor => ({ valor }));
    expect(conferirValoresRateio("2560,00", valores)).toEqual({ total: 256000, distribuido: 256000, restante: 0, completo: true });
    expect(valores[3].valor).toBe("930,00");
    expect(conferirValoresRateio("2560,00", valores.slice(0, 3))).toEqual({ total: 256000, distribuido: 163000, restante: 93000, completo: false });
  });
  it("não trata vazio, zero, centavo excedente ou total inválido como conferido", () => {
    expect(conferirValoresRateio("1,00", [{ valor: "1,01" }])).toMatchObject({ restante: -1, completo: false });
    expect(conferirValoresRateio("1,00", [{ valor: "1" }, { valor: "" }]).completo).toBe(false);
    expect(conferirValoresRateio("0", [{ valor: "0" }]).completo).toBe(false);
    expect(conferirValoresRateio("abc", []).completo).toBe(false);
    expect(conferirValoresRateio("1", []).completo).toBe(false);
  });
  it("conserva os centavos ao editar", () => {
    expect(valorEditavel(101)).toBe("1,01");
    expect(centavosRateio(valorEditavel(2147483647))).toBe(2147483647);
  });
});

describe("destinos da despesa sem duplicar o total", () => {
  const dados = { modo: "VARIOS" as const, total: "100,01", descricao: "Manutenção", categoria: "Manutenção e serviços", unico: { empreendimentoId: "e1", unidadeId: "u1", categoria: "Categoria anterior" }, linhas: [{ chave: "a", empreendimentoId: "e1", unidadeId: null, descricao: "Serviço A", categoria: null, valor: "60,01" }, { chave: "b", empreendimentoId: "e2", unidadeId: null, descricao: "Serviço B", categoria: "Categoria específica", valor: "40,00" }] };
  it("administradora não gera parcelas fictícias nem descarta o rateio em edição", () => {
    expect(rateiosDoFormulario({ ...dados, modo: "ADMINISTRADORA" })).toEqual([]);
    expect(dados.linhas).toHaveLength(2);
    expect(rateiosDoFormulario(dados).map(linha => linha.valor)).toEqual([6001, 4000]);
  });
  it("um empreendimento recebe o total exato e a classificação principal", () => {
    expect(rateiosDoFormulario({ ...dados, modo: "UM_EMPREENDIMENTO" })).toEqual([{ empreendimentoId: "e1", unidadeId: "u1", descricao: "Manutenção", categoria: "Manutenção e serviços", valor: 10001 }]);
    expect(rateiosDoFormulario({ ...dados, modo: "UM_EMPREENDIMENTO", categoria: null })[0].categoria).toBe("Categoria anterior");
    expect(dados.linhas.map(linha => linha.valor)).toEqual(["60,01", "40,00"]);
  });
  it("rateio preserva valores e categorias de cada linha, sem redistribuir automaticamente", () => {
    expect(rateiosDoFormulario(dados)).toEqual([{ empreendimentoId: "e1", unidadeId: null, descricao: "Serviço A", categoria: "Manutenção e serviços", valor: 6001 }, { empreendimentoId: "e2", unidadeId: null, descricao: "Serviço B", categoria: "Categoria específica", valor: 4000 }]);
    expect(() => rateiosDoFormulario({ ...dados, linhas: [{ ...dados.linhas[0], empreendimentoId: "" }] })).toThrow("empreendimento");
    expect(() => rateiosDoFormulario({ ...dados, modo: "UM_EMPREENDIMENTO", total: "1,001" })).toThrow("valor maior");
  });
  it("reabre a distribuição compatível com os dados salvos", () => {
    const rateios = rateiosDoFormulario(dados);
    expect(modoCustoInicial({ destinoCusto: "ADMINISTRADORA", rateios: [], total: 10001 })).toBe("ADMINISTRADORA");
    expect(modoCustoInicial({ destinoCusto: "EMPREENDIMENTOS", rateios: [rateios[0]], total: 6001 })).toBe("UM_EMPREENDIMENTO");
    expect(modoCustoInicial({ destinoCusto: "EMPREENDIMENTOS", rateios, total: 10001 })).toBe("VARIOS");
  });
  it("reabrir e salvar rascunho com uma parcela parcial mantém valor e saldo a distribuir", () => {
    const parcela = { empreendimentoId: "e1", unidadeId: null, descricao: "Serviço parcial", categoria: "Manutenção", valor: 43000 };
    const modo = modoCustoInicial({ destinoCusto: "EMPREENDIMENTOS", rateios: [parcela], total: 256000 });
    expect(modo).toBe("VARIOS");
    const linhas = [{ ...parcela, chave: "parcial", valor: valorEditavel(parcela.valor) }];
    expect(rateiosDoFormulario({ ...dados, modo, total: "2560,00", linhas })).toEqual([parcela]);
    expect(conferirValoresRateio("2560,00", linhas)).toMatchObject({ restante: 213000, completo: false });
  });
  it("não simplifica linha com detalhamento próprio que seria perdido", () => {
    const parcela = { empreendimentoId: "e1", descricao: "Iluminação do corredor", categoria: "Elétrica", valor: 10001 };
    expect(modoCustoInicial({ destinoCusto: "EMPREENDIMENTOS", rateios: [parcela], total: 10001, descricao: "Manutenção do prédio" })).toBe("VARIOS");
    expect(modoCustoInicial({ destinoCusto: "EMPREENDIMENTOS", rateios: [parcela], total: 10001, descricao: parcela.descricao, categoriaCodigo: "MANUTENCAO_SERVICOS" })).toBe("VARIOS");
  });
});
