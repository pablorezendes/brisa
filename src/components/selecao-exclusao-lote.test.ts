import { describe, expect, it } from "vitest";
import { alternarSelecao, chavesExcluiveisNaPagina, selecaoVisivel } from "./selecao-exclusao-lote";

const item = (chave: string, dominio = "RECEBER", autorizado = true) => ({ chave, dominio, exclusao: autorizado ? { href: "revisar" } : null });

describe("seleção financeira restrita à página", () => {
  it("seleciona somente chaves da página com permissão e domínio correto", () => {
    expect(chavesExcluiveisNaPagina([
      item("BRISA:RECEBER:a"), item("WIDESYS:RECEBER:b"), item("WIDESYS:RECEBER:b"),
      item("WIDESYS:RECEBER:c", "RECEBER", false), item("WIDESYS:PAGAR:d", "PAGAR"),
      item("WIDESYS:PAGAR:e"), item("OUTRA:RECEBER:f"), item("BRISA:RECEBER:"),
      item("BRISA:RECEBER:com espaço"),
    ], "RECEBER")).toEqual(["BRISA:RECEBER:a", "WIDESYS:RECEBER:b"]);
  });

  it("contas a pagar só selecionam a origem suportada pelo servidor", () => {
    expect(chavesExcluiveisNaPagina([item("BRISA:PAGAR:a", "PAGAR"), item("WIDESYS:PAGAR:b", "PAGAR")], "PAGAR")).toEqual(["WIDESYS:PAGAR:b"]);
  });

  it("limita selecionar página a 100 e nunca acrescenta dados de outras páginas", () => {
    const itens = Array.from({ length: 130 }, (_, i) => item(`WIDESYS:RECEBER:${i}`));
    const permitidas = chavesExcluiveisNaPagina(itens, "RECEBER");
    expect(permitidas).toHaveLength(100);
    expect(permitidas.at(-1)).toBe("WIDESYS:RECEBER:99");
    expect(selecaoVisivel(["WIDESYS:RECEBER:120", ...permitidas], permitidas)).toEqual(permitidas);
  });

  it("remove seleção antiga quando itens deixam a página após excluir ou filtrar", () => {
    expect(selecaoVisivel(["a", "b", "b", "c"], ["b", "d"])).toEqual(["b"]);
  });

  it("alterna seleção e não permite incluir uma chave fora da página", () => {
    expect(alternarSelecao(["a"], "b", ["a", "b"])).toEqual(["a", "b"]);
    expect(alternarSelecao(["a", "b"], "a", ["a", "b"])).toEqual(["b"]);
    expect(alternarSelecao(["a"], "fora", ["a", "b"])).toEqual(["a"]);
  });

  it("nunca ultrapassa o limite ao marcar individualmente", () => {
    const permitidas = Array.from({ length: 101 }, (_, i) => String(i));
    expect(alternarSelecao(permitidas.slice(0, 100), "100", permitidas)).toHaveLength(100);
  });
});
