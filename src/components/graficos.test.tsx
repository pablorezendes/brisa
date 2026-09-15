import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MapaCalor } from "./graficos";

describe("MapaCalor", () => {
  it("renderiza uma tabela semântica com contexto e valores completos", () => {
    const html = renderToStaticMarkup(
      <MapaCalor
        colunas={["JAN", "FEV"]}
        linhas={[{ rotulo: "Brisa Azul", valores: [123_400, null] }]}
        rotuloLinhas="Empreendimento"
        rotuloAcessivel="Comissão por empreendimento e mês"
      />
    );

    expect(html).toContain("<table");
    expect(html).toContain("<caption class=\"sr-only\"");
    expect(html).toContain("scope=\"row\"");
    expect(html).toContain("Empreendimento");
    expect(html).toContain("Brisa Azul");
    expect(html).toContain("class=\"g-mapa-tooltip\" aria-hidden=\"true\">Brisa Azul · JAN:");
    expect(html).toContain("aria-label=\"R$");
    expect(html).toContain("Sem movimento");
  });

  it("usa os extremos reais na legenda e distingue ajustes negativos", () => {
    const html = renderToStaticMarkup(
      <MapaCalor
        colunas={["JAN", "FEV", "MAR"]}
        linhas={[{ rotulo: "Ajustes", valores: [15_000, 45_000, -2_500] }]}
      />
    );

    expect(html).toContain("aria-label=\"Escala de R$");
    expect(html).not.toContain("0,01");
    expect(html).toContain("g-mapa-celula-negativa");
    expect(html).toContain("(negativo)");
    expect(html).toContain("ajuste negativo");
  });

  it("completa valores ausentes para manter todas as colunas alinhadas", () => {
    const html = renderToStaticMarkup(
      <MapaCalor
        colunas={["JAN", "FEV", "MAR"]}
        linhas={[{ rotulo: "Linha curta", valores: [10_000] }]}
      />
    );

    expect(html.match(/class="g-mapa-celula /g)).toHaveLength(3);
    expect(html.match(/>Sem movimento<\/span>/g)).toHaveLength(2);
  });
});
