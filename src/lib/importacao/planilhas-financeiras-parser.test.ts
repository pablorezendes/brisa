import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { calcularAritmeticaPlanilha, parseWorkbookFinanceiro, type TipoArquivoPlanilha } from "./planilhas-financeiras-parser";

function fixture(tipoArquivo: TipoArquivoPlanilha, aba: string) {
  const workbook = new ExcelJS.Workbook();
  const s = workbook.addWorksheet(aba);
  const parse = () => parseWorkbookFinanceiro(workbook, { origemArquivo: "fixture.xlsx", hashArquivo: "hash-fixture", tipoArquivo });
  return { workbook, s, parse };
}
const date = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("extração financeira de planilhas sem efeito na operação", () => {
  it("aceita aritmética simples com precedência, não executa referências ou código", () => {
    expect(calcularAritmeticaPlanilha("=10 + 2 * (3 - 1)")).toBe(14);
    expect(calcularAritmeticaPlanilha("130.16*2")).toBe(260.32);
    expect(calcularAritmeticaPlanilha("-10/2")).toBe(-5);
    for (const invalid of ["process.exit()", "SUM(A1:A3)", "A1+A2", "10/0", "2**3", "1..2", "(1+2", "1 2"]) {
      expect(calcularAritmeticaPlanilha(invalid)).toBeNull();
    }
  });
  it("separa saldo transportado, subtotais e movimentos sem inventar receita", () => {
    const { s, parse } = fixture("CONTA_ACAMARGO", "JAN 2026");
    s.getCell("A2").value = "SAIDA"; s.getCell("I2").value = "ENTRADA";
    s.getCell("J3").value = 100;
    s.getCell("J4").value = { formula: "SUM(J3)", result: 100 };
    s.getCell("I7").value = date("2026-01-07"); s.getCell("J7").value = 40; s.getCell("K7").value = "Aporte documentado";
    s.getCell("J8").value = { formula: "SUM(J7)", result: 40 };
    s.getCell("J12").value = { formula: "J4+J8", result: 140 };
    const out = parse();
    expect(out.registros).toHaveLength(1);
    expect(out.registros[0]).toMatchObject({ tipo: "ENTRADA", valor: 4000, status: "PRONTO", data: "2026-01-07", faixa: "ENTRADA" });
    expect(out.controles.find((c) => c.tipo === "SALDO_INICIAL")?.valorFonte).toBe(10000);
    expect(out.controles.find((c) => c.tipo === "TOTAL_FAIXA")).toMatchObject({ valorFonte: 14000, valorCalculado: 14000, diferenca: 0 });
  });
  it("reconhece deslocamento de julho e calcula cada centro sem misturar categorias", () => {
    const { s, parse } = fixture("CONTA_ACAMARGO", "JULHO 2026");
    s.getCell("B3").value = "SAIDA"; s.getCell("J3").value = "ENTRADA";
    s.getCell("B5").value = "CONSUMO"; s.getCell("F5").value = "ENERGIA/GAS";
    s.getCell("B6").value = date("2026-07-06"); s.getCell("C6").value = 12.45; s.getCell("D6").value = "Compra teste";
    s.getCell("F6").value = date("2026-07-06"); s.getCell("G6").value = 22; s.getCell("H6").value = "Gás teste";
    const records = parse().registros;
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ centroCusto: "AL", categoria: "CONSUMO", celulas: "B6:D6", valor: 1245 });
    expect(records[1]).toMatchObject({ centroCusto: "CH", categoria: "ENERGIA/GAS", celulas: "F6:H6", valor: 2200 });
  });
  it("captura saída adicional em junho e dinheiro com cliente/local", () => {
    const { workbook, s, parse } = fixture("CONTA_ACAMARGO", "JUNHO 2026");
    s.getCell("A2").value = "SAIDA"; s.getCell("L2").value = "SAIDA";
    s.getCell("L3").value = date("2026-06-03"); s.getCell("M3").value = 19; s.getCell("N3").value = "Saída avulsa";
    const maio = workbook.addWorksheet("MAIO 2026");
    maio.getCell("A2").value = "SAIDA"; maio.getCell("M2").value = "RECEBIMENTOS EM DINHEIRO";
    maio.getCell("M3").value = date("2026-05-03"); maio.getCell("N3").value = 30; maio.getCell("O3").value = "Pessoa Fictícia"; maio.getCell("P3").value = "Unidade X";
    expect(parse().registros).toEqual(expect.arrayContaining([
      expect.objectContaining({ faixa: "SAIDA_EXTRA", tipo: "SAIDA", valor: 1900, centroCusto: "GERAL" }),
      expect.objectContaining({ faixa: "RECEB_DINHEIRO", tipo: "RECEB_DINHEIRO", valor: 3000, cliente: "Pessoa Fictícia", local: "Unidade X", descricao: null }),
    ]));
  });
  it("não preenche data ausente nem troca o ano de uma data completa contraditória", () => {
    const { s, parse } = fixture("CONTA_ACAMARGO", "FEV 2026"); s.getCell("A2").value = "SAIDA";
    s.getCell("B5").value = 10; s.getCell("C5").value = "Sem data";
    s.getCell("A6").value = date("2025-02-06"); s.getCell("B6").value = 11; s.getCell("C6").value = "Ano original";
    s.getCell("A7").value = "31/02/2026"; s.getCell("B7").value = 12; s.getCell("C7").value = "Data inválida";
    const r = parse().registros;
    expect(r[0]).toMatchObject({ data: null, mesReferencia: "2026-02", status: "PENDENTE", motivos: ["DATA_AUSENTE"] });
    expect(r[1]).toMatchObject({ data: "2025-02-06", mesReferencia: "2026-02", status: "PENDENTE", motivos: ["DATA_FORA_PERIODO"] });
    expect(r[2].motivos).toContain("DATA_INVALIDA");
  });
  it("mantém cache de fórmula aritmética, bloqueia divergência e não importa SUM como valor", () => {
    const { s, parse } = fixture("GASTOS_BRISA", "Plan1");
    s.getCell("A1").value = 2026; s.getCell("A2").value = "JANEIRO";
    s.getCell("A3").value = date("2026-01-03"); s.getCell("B3").value = "Parcela"; s.getCell("C3").value = { formula: "15.8*2", result: 31.6 };
    s.getCell("A4").value = date("2026-01-04"); s.getCell("B4").value = "Outra parcela"; s.getCell("C4").value = { formula: "10+20", result: 29 };
    s.getCell("C5").value = { formula: "SUM(C3:C4)", result: 60.6 };
    const out = parse();
    expect(out.registros).toHaveLength(2);
    expect(out.registros[0]).toMatchObject({ valor: 3160, status: "PRONTO" });
    expect(out.registros[1]).toMatchObject({ valor: 2900, status: "PENDENTE", motivos: ["FORMULA_CACHE_DIVERGENTE"] });
    expect(JSON.parse(out.registros[0].sourceJSON).celulas.C3).toEqual({ formula: "15.8*2", resultado: 31.6 });
    expect(out.controles[0].diferenca).toBe(0);
  });
  it("mantém períodos independentes e propaga só ano compartilhado sem cabeçalho direito próprio", () => {
    const { s, parse } = fixture("GASTOS_BRISA", "Plan1");
    s.getCell("A1").value = 2022; s.getCell("E1").value = 2022;
    s.getCell("A2").value = "DEZEMBRO"; s.getCell("E2").value = "DEZEMBRO";
    s.getCell("A4").value = 2023; s.getCell("A5").value = "JANEIRO";
    s.getCell("E5").value = date("2022-12-29"); s.getCell("F5").value = "Entrada antiga"; s.getCell("G5").value = 20;
    s.getCell("E6").value = 2023; s.getCell("E7").value = "JANEIRO";
    s.getCell("A8").value = 2024; s.getCell("A9").value = "FEVEREIRO"; s.getCell("E9").value = "JANEIRO";
    s.getCell("A10").value = date("2024-02-10"); s.getCell("B10").value = "Saída fevereiro"; s.getCell("C10").value = 10;
    s.getCell("E10").value = date("2024-01-10"); s.getCell("F10").value = "Entrada janeiro"; s.getCell("G10").value = 10;
    const r = parse().registros;
    expect(r.find((v) => v.linha === 5)?.mesReferencia).toBe("2022-12");
    expect(r.find((v) => v.faixa === "SAIDA_BRISA")?.mesReferencia).toBe("2024-02");
    expect(r.find((v) => v.linha === 10 && v.faixa === "ENTRADA_BRISA")?.mesReferencia).toBe("2024-01");
    expect(r.every((v) => v.status === "PRONTO")).toBe(true);
  });
  it("separa caixas confirmados, mantém resumos fora da operação e comissão reservada", () => {
    const { workbook, s, parse } = fixture("GASTOS_BRISA", "Plan1");
    s.getCell("A1").value = date("2026-01-03"); s.getCell("B1").value = "Comissão administração"; s.getCell("C1").value = 92341.73;
    for (const nome of ["Plan3", "Plan4", "ALIANA"]) {
      const aux = workbook.addWorksheet(nome);
      aux.getCell("A1").value = date("2026-01-03"); aux.getCell("B1").value = "Lançamento auxiliar"; aux.getCell("C1").value = 11;
    }
    const resumo = workbook.addWorksheet("Plan2"); resumo.getCell("B2").value = { formula: "Plan1!C1", result: 92341.73 };
    const out = parse();
    expect(out.registros).toHaveLength(4);
    expect(out.registros[0].status).toBe("PENDENTE_RESERVADO");
    expect(out.registros.slice(1).every((r) => r.status === "PRONTO")).toBe(true);
    expect(new Set(out.registros.map((r) => r.caixaOrigem)).size).toBe(4);
    expect(out.controles.some((c) => c.aba === "Plan2" && c.tipo === "RESUMO")).toBe(true);
    expect(JSON.stringify(out.avisos)).not.toContain("92341");
  });
  it("compara total de faixa com movimentos independentemente de subtotais omitidos", () => {
    const { s, parse } = fixture("CONTA_ACAMARGO", "JAN 2026"); s.getCell("A2").value = "SAIDA";
    s.getCell("A3").value = date("2026-01-03"); s.getCell("B3").value = 10; s.getCell("C3").value = "Item A";
    s.getCell("B4").value = { formula: "SUM(B3)", result: 10 };
    s.getCell("A5").value = date("2026-01-05"); s.getCell("B5").value = 20; s.getCell("C5").value = "Item B";
    s.getCell("B6").value = { formula: "SUM(B5)", result: 20 };
    s.getCell("A7").value = date("2026-01-07"); s.getCell("B7").value = 30; s.getCell("C7").value = "Item C omitido no total";
    s.getCell("B8").value = { formula: "B4+B6", result: 30 };
    expect(parse().controles.find((c) => c.tipo === "TOTAL_FAIXA")).toMatchObject({ valorCalculado: 6000, valorFonte: 3000, diferenca: -3000, motivos: ["CONTROLE_DIVERGENTE"] });
  });
  it("preserva inválidos em staging, zero e células de fórmula sem resultado", () => {
    const { s, parse } = fixture("GASTOS_BRISA", "Plan1");
    for (const [row, v] of [[1, 0], [2, -2], [3, "não informado"], [4, { formula: "10+20" }]] as const) {
      s.getCell(row, 1).value = date("2026-01-03"); s.getCell(row, 2).value = "Item fictício"; s.getCell(row, 3).value = v;
    }
    const out = parse();
    expect(out.registros).toHaveLength(4);
    expect(out.registros.every((r) => r.status === "PENDENTE")).toBe(true);
    expect(out.registros[2].valor).toBeNull();
    expect(out.registros[3].valor).toBeNull();
  });
  it("mantém zero em cache e saldo fora das colunas financeiras como controles", () => {
    const { s, parse } = fixture("CONTA_ACAMARGO", "FEV 2026");
    s.getCell("A2").value = "SAIDA"; s.getCell("M2").value = "RECEBIMENTOS EM DINHEIRO";
    s.getCell("F7").value = { formula: "SUM(F6)", result: 0 };
    s.getCell("M51").value = { formula: "#REF!-B51-F51", result: { error: "#REF!" } };
    s.getCell("N51").value = "SALDO";
    const out = parse();
    expect(out.registros).toHaveLength(0);
    expect(out.controles.find((c) => c.celula === "F7")).toMatchObject({ valorFonte: 0, motivos: [] });
    expect(out.controles.find((c) => c.celula === "M51")).toMatchObject({ tipo: "RESUMO", motivos: ["CONTROLE_SEM_RESULTADO_VALIDO"] });
  });
  it("caixa sem ano ancora mês em data completa e preserva datas contraditórias para revisão", () => {
    const { s, parse } = fixture("GASTOS_BRISA", "Plan4"); s.getCell("A1").value = "MARÇO";
    s.getCell("A2").value = date("2026-03-02"); s.getCell("B2").value = "Pagamento atual"; s.getCell("C2").value = 10;
    s.getCell("A3").value = date("2025-03-03"); s.getCell("B3").value = "Pagamento histórico"; s.getCell("C3").value = 20;
    const r = parse().registros;
    expect(r[0]).toMatchObject({ caixaOrigem: "GASTOS_BRISA:Plan4", mesReferencia: "2026-03", status: "PRONTO" });
    expect(r[1]).toMatchObject({ data: "2025-03-03", mesReferencia: "2026-03", motivos: ["DATA_FORA_PERIODO"], status: "PENDENTE" });
  });
  it("preserva a memória de vales separada dos caixas e sem transformar em nova saída", () => {
    const { s, parse } = fixture("GASTOS_BRISA", "Plan1");
    s.getCell("J3").value = "Referência fictícia"; s.getCell("K3").value = date("2026-03-02"); s.getCell("L3").value = 10; s.getCell("M3").value = "Abatido no vale";
    expect(parse().registros[0]).toMatchObject({ faixa: "VALES_AUXILIAR_12", status: "PENDENTE_AUXILIAR", motivos: ["ABA_OU_TABELA_AUXILIAR"] });
  });
  it("não adiciona saldo inicial ao subtotal que soma apenas entradas correntes", () => {
    const { s, parse } = fixture("CONTA_ACAMARGO", "FEV 2026"); s.getCell("A2").value = "SAIDA";
    s.getCell("J3").value = 100;
    s.getCell("I8").value = date("2026-02-08"); s.getCell("J8").value = 20; s.getCell("K8").value = "Entrada teste";
    s.getCell("J9").value = { formula: "SUM(J8:J8)", result: 20 };
    expect(parse().controles.find((c) => c.celula === "J9")).toMatchObject({ valorFonte: 2000, valorCalculado: 2000, diferenca: 0 });
  });
  it("preserva números de colunas bancárias fora da faixa sem atribuir conta ou somar no cofre", () => {
    const { s, parse } = fixture("GASTOS_BRISA", "Plan1");
    s.getCell("A1").value = 2026; s.getCell("E1").value = 2026;
    s.getCell("E2").value = date("2026-02-08"); s.getCell("F2").value = "Entrada via banco";
    s.getCell("H2").value = 50; s.getCell("I2").value = "PIX";
    const out = parse();
    expect(out.registros).toHaveLength(2);
    expect(out.registros[0]).toMatchObject({ faixa: "ENTRADA_BRISA", valor: null, status: "PENDENTE" });
    expect(out.registros[1]).toMatchObject({ faixa: "VALOR_AVULSO_H", valor: 5000, status: "PENDENTE_AUXILIAR", local: "PIX" });
    expect(out.registros[1].motivos).toContain("VALOR_FORA_FAIXA_TRANSACIONAL");
    expect(JSON.parse(out.registros[1].sourceJSON).celulas).toMatchObject({ H2: 50, I2: "PIX" });
  });
  it("não promove número isolado em coluna sem identificação financeira", () => {
    const { s, parse } = fixture("CONTA_ACAMARGO", "JULHO 2026"); s.getCell("B3").value = "SAIDA";
    s.getCell("L36").value = 55;
    expect(parse().registros).toEqual([expect.objectContaining({ faixa: "VALOR_AVULSO_L", valor: 5500, status: "PENDENTE_AUXILIAR", data: null, descricao: null })]);
  });
});
