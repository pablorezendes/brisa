import { describe, expect, it } from "vitest";
import { chavesConferenciaNaPagina } from "./selecao-conferencia-lote";

describe("seleção de conferência independente da exclusão", () => {
  it("mantém somente chaves válidas e únicas do domínio exibido", () => {
    const itens = [
      { chave: "BRISA:RECEBER:a", dominio: "RECEBER" },
      { chave: "WIDESYS:RECEBER:b", dominio: "RECEBER" },
      { chave: "WIDESYS:RECEBER:b", dominio: "RECEBER" },
      { chave: "WIDESYS:PAGAR:c", dominio: "RECEBER" },
      { chave: "WIDESYS:RECEBER:d", dominio: "PAGAR" },
      { chave: "WIDESYS:RECEBER:com espaço", dominio: "RECEBER" },
      { chave: "OUTRA:RECEBER:e", dominio: "RECEBER" },
    ];
    expect(chavesConferenciaNaPagina(itens, "RECEBER")).toEqual(["BRISA:RECEBER:a", "WIDESYS:RECEBER:b"]);
  });
  it("limita a seleção da página a 100 títulos, sem buscar outras páginas", () => {
    const itens = Array.from({ length: 120 }, (_, i) => ({ chave: `WIDESYS:PAGAR:${i}`, dominio: "PAGAR" }));
    expect(chavesConferenciaNaPagina(itens, "PAGAR")).toHaveLength(100);
  });
});
