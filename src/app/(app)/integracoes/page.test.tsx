import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pagina: vi.fn() }));
vi.mock("@/lib/acesso/servidor", () => ({ exigirPaginaAcesso: mocks.pagina }));

import PaginaIntegracoes from "./page";

beforeEach(() => vi.resetAllMocks());

describe("central de integrações", () => {
  it("organiza destinos sem declarar disponibilidade nem disparar ações", async () => {
    const html = renderToStaticMarkup(await PaginaIntegracoes());
    expect(mocks.pagina).toHaveBeenCalledExactlyOnceWith("/integracoes");
    for (const href of ["/integracoes/sicoob", "/financeiro/migracao-widesys", "/financeiro/automacoes", "/financeiro/notas-fiscais/configuracao", "/financeiro/boletos", "/financeiro/conciliacao", "/financeiro/contas-bancarias"]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain("não são um teste de disponibilidade");
    expect(html).toContain("não busca dados novos");
    expect(html).toContain("configuração e operação");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("API preparada");
    expect(html).not.toContain("Conectado");
  });

  it("interrompe a página quando a guarda do servidor nega o acesso", async () => {
    mocks.pagina.mockRejectedValue(new Error("Acesso negado"));
    await expect(PaginaIntegracoes()).rejects.toThrow("Acesso negado");
  });
});
