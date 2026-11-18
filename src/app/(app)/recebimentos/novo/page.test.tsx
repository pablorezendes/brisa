import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ contratos: vi.fn(), pagina: vi.fn(), permissao: vi.fn(), financeiro: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/acesso/servidor", () => ({
  acessoAtual: async () => ({ ativo: true, perfil: "ADMINISTRADOR", global: true, permissoes: ["caixa.editar"], regras: [] }),
  exigirPaginaAcesso: mocks.pagina, exigirPermissaoAcesso: mocks.permissao,
}));
vi.mock("@/lib/autorizacao", () => ({ exigirPermissaoFinanceira: mocks.financeiro }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/consultas/contratos-para-recebimento", () => ({ listarContratosParaRecebimento: mocks.contratos }));
vi.mock("./actions", () => ({ salvarRecebimentoManual: vi.fn() }));
vi.mock("@/components/formulario-lancamento-manual", () => ({ FormularioLancamentoManual: ({ children }: { children: React.ReactNode }) => <form>{children}</form> }));

import PaginaNovaContaReceber from "./page";

beforeEach(() => { vi.clearAllMocks(); });

describe("nova conta a receber", () => {
  it("permite selecionar o contrato importado sem exigir cadastro de contrato Brisa", async () => {
    mocks.contratos.mockResolvedValue([{ valor: "WIDESYS:contrato-importado", rotulo: "Contrato 42 · Sala 204 · Locatário" }]);
    const html = renderToStaticMarkup(await PaginaNovaContaReceber());
    expect(html).toContain('value="WIDESYS:contrato-importado"');
    expect(html).toContain("Contrato 42 · Sala 204 · Locatário");
    expect(html).toContain('name="vencimento"');
    expect(html).not.toContain("Cadastre um contrato ativo no Brisa");
    expect(mocks.permissao).toHaveBeenCalledWith("recebimentos.editar", { global: true });
  });

  it("explica a ausência de contratos disponíveis sem pedir recriação do contrato", async () => {
    mocks.contratos.mockResolvedValue([]);
    const html = renderToStaticMarkup(await PaginaNovaContaReceber());
    expect(html).toContain("Não há contratos vigentes disponíveis para esta cobrança");
    expect(html).not.toContain('name="contratoId"');
  });
});
