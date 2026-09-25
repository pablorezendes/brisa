import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RecuperacaoPagina } from "./recuperacao-pagina";
import ErroGlobal from "../app/global-error";
import CarregandoPagina from "../app/(app)/loading";

describe("feedback e recuperação de página", () => {
  it("exibe código seguro e jamais mensagem interna ou dados privados", () => {
    const error = Object.assign(new Error("token=segredo; cliente=privado"), { digest: "953724750" });
    const retry = vi.fn();
    const html = renderToStaticMarkup(<RecuperacaoPagina error={error} unstable_retry={retry}/>);
    expect(html).toContain("953724750");
    expect(html).toContain("Copiar código");
    expect(html).toContain("Tentar carregar novamente");
    expect(html).toMatch(/readonly=""/i);
    expect(html).not.toMatch(/token=segredo|cliente=privado/);
    expect(retry).not.toHaveBeenCalled();
  });

  it("não mostra digest arbitrário nem aciona recuperação automática", () => {
    const retry = vi.fn();
    const html = renderToStaticMarkup(<RecuperacaoPagina error={Object.assign(new Error("falha privada"), { digest: "privado-token" })} unstable_retry={retry}/>);
    expect(html).not.toContain("privado-token");
    expect(html).not.toContain("Copiar código");
    expect(html).toContain("informe ao suporte");
    expect(retry).not.toHaveBeenCalled();
  });

  it("fallback global funciona sem layout, fontes ou CSS do sistema", () => {
    const html = renderToStaticMarkup(<ErroGlobal error={new Error("falha privada")} unstable_retry={vi.fn()}/>);
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toContain("<body");
    expect(html).toContain('href="/login"');
    expect(html).not.toMatch(/stylesheet|fonts\.google|falha privada/);
  });

  it("loading anuncia espera sem simular valores financeiros e respeita movimento reduzido", () => {
    const html = renderToStaticMarkup(<CarregandoPagina/>);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("motion-safe:animate-pulse");
    expect(html).not.toContain("R$");
  });
});
