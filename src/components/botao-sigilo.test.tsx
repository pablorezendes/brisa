import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BotaoSigilo,
  CHAVE_SIGILO,
  gravarPreferenciaSigilo,
  lerPreferenciaSigilo,
} from "./botao-sigilo";

describe("BotaoSigilo", () => {
  it("renderiza um botão acessível mantendo os dois rótulos para o CSS global", () => {
    const html = renderToStaticMarkup(<BotaoSigilo />);

    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Visualização dos valores"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Ver valores");
    expect(html).toContain("Ocultar valores");
    expect(html).not.toContain('id="ver-valores"');
  });

  it("lê e grava a preferência persistente", () => {
    const memoria = new Map<string, string>();
    const storage = {
      getItem: (chave: string) => memoria.get(chave) ?? null,
      setItem: (chave: string, valor: string) => memoria.set(chave, valor),
    };

    expect(lerPreferenciaSigilo(storage)).toBe(false);
    gravarPreferenciaSigilo(storage, true);
    expect(memoria.get(CHAVE_SIGILO)).toBe("true");
    expect(lerPreferenciaSigilo(storage)).toBe(true);
    gravarPreferenciaSigilo(storage, false);
    expect(lerPreferenciaSigilo(storage)).toBe(false);
  });

  it("mantém o padrão protegido quando o storage não está disponível", () => {
    const bloqueado = {
      getItem: () => {
        throw new Error("storage bloqueado");
      },
      setItem: () => {
        throw new Error("storage bloqueado");
      },
    };

    expect(lerPreferenciaSigilo(null)).toBe(false);
    expect(lerPreferenciaSigilo(bloqueado)).toBe(false);
    expect(() => gravarPreferenciaSigilo(bloqueado, true)).not.toThrow();
  });
});
