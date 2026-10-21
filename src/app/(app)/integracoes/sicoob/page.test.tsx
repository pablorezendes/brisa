import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EstadoConfiguracaoSicoob } from "@/lib/integracoes/sicoob";

const mocks = vi.hoisted(() => ({
  pagina: vi.fn(), permissao: vi.fn(), configuracao: vi.fn(), contas: vi.fn(),
  autenticar: vi.fn(), diagnosticar: vi.fn(), cliente: vi.fn(), fetch: vi.fn(),
  ordem: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/acesso/servidor", () => ({
  exigirPaginaAcesso: mocks.pagina,
  exigirPermissaoAcesso: mocks.permissao,
}));
vi.mock("@/lib/integracoes/sicoob", () => ({
  obterEstadoConfiguracaoSicoob: mocks.configuracao,
  diagnosticarAutenticacaoSicoob: mocks.diagnosticar,
  criarClienteSicoob: mocks.cliente,
}));
// O painel de contas tem consultas próprias; esta unidade testa a página sem
// abrir Prisma. O formulário de autenticação é renderizado de verdade abaixo.
vi.mock("@/components/painel-contas-sicoob", () => ({
  SicoobContas: () => { mocks.contas(); return <div data-testid="contas-ficticias">Contas de teste</div>; },
}));
vi.mock("./actions", () => ({ testarAutenticacaoSicoob: mocks.autenticar }));

import PaginaIntegracaoSicoob from "./page";

function estado(ajustes: Partial<EstadoConfiguracaoSicoob> = {}): EstadoConfiguracaoSicoob {
  return {
    configurado: false, ambiente: "producao",
    baseUrl: "https://api.sicoob.com.br/cobranca-bancaria/v3",
    autenticacao: "oauth_client_credentials", mtlsConfigurado: false,
    escoposWebhookConfigurados: false, pendencias: ["SICOOB_CLIENT_ID", "certificado mTLS (PFX ou CERT + KEY)"],
    ...ajustes,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.ordem.length = 0;
  mocks.pagina.mockImplementation(async () => { mocks.ordem.push("pagina"); });
  mocks.permissao.mockImplementation(async (codigo: string) => { mocks.ordem.push(codigo); });
  mocks.configuracao.mockImplementation(() => { mocks.ordem.push("configuracao-local"); return estado(); });
  mocks.contas.mockImplementation(() => { mocks.ordem.push("painel-contas"); });
  mocks.fetch.mockRejectedValue(new Error("Este teste nunca permite rede"));
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("SICOOB_SYNC_SECRET", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("página de integração Sicoob", () => {
  it("autoriza página e capacidades antes de inspecionar configuração local ou renderizar contas", async () => {
    const pagina = await PaginaIntegracaoSicoob({ searchParams: Promise.resolve({}) });
    expect(mocks.pagina).toHaveBeenCalledExactlyOnceWith("/integracoes/sicoob");
    expect(mocks.permissao).toHaveBeenNthCalledWith(1, "boletos.configurar", { global: true });
    expect(mocks.permissao).toHaveBeenNthCalledWith(2, "contas.editar", { global: true });
    expect(mocks.ordem).toEqual(["pagina", "boletos.configurar", "contas.editar", "configuracao-local"]);
    renderToStaticMarkup(pagina);
    expect(mocks.ordem.at(-1)).toBe("painel-contas");
  });

  it.each(["pagina", "boletos.configurar", "contas.editar"])("nega %s antes de ler configuração ou executar operações", async bloqueio => {
    if (bloqueio === "pagina") mocks.pagina.mockRejectedValue(new Error("Sem permissão"));
    else mocks.permissao.mockImplementation(async (codigo: string) => {
      if (codigo === bloqueio) throw new Error("Sem permissão");
    });
    await expect(PaginaIntegracaoSicoob({ searchParams: Promise.resolve({}) })).rejects.toThrow("Sem permissão");
    expect(mocks.configuracao).not.toHaveBeenCalled();
    expect(mocks.contas).not.toHaveBeenCalled();
    expect(mocks.autenticar).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("renderiza as quatro etapas e o formulário sem chamar autenticação, cliente bancário ou rede", async () => {
    const html = renderToStaticMarkup(await PaginaIntegracaoSicoob({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('aria-label="Etapas da integração Sicoob"');
    for (const id of ["credenciais", "autenticacao", "convenio", "retornos"]) {
      expect(html).toContain(`href="#${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
    for (const href of ["/integracoes", "/financeiro/boletos", "/financeiro/conciliacao", "/financeiro/contas-bancarias"]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain("Testar autenticação sem emitir boleto");
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*required=""[^>]*name="confirmarTeste"/);
    expect(html).toContain("carteira 1 não comprova modalidade 1");
    expect(html).toContain("LIQUI");
    expect(html).toContain("não uma quitação");
    expect(html).not.toContain("Autenticação confirmada");
    expect(mocks.autenticar).not.toHaveBeenCalled();
    expect(mocks.diagnosticar).not.toHaveBeenCalled();
    expect(mocks.cliente).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("mostra somente presença da chave e exemplos, nunca valores de segredos instalados", async () => {
    const segredos = {
      SICOOB_SYNC_SECRET: "a".repeat(64),
      SICOOB_WEBHOOK_SECRET: "b".repeat(64),
      SICOOB_CLIENT_ID: "CLIENTE_PRIVADO_FICTICIO_987",
      SICOOB_CLIENT_SECRET: "SEGREDO_PRIVADO_FICTICIO_654",
      SICOOB_ACCESS_TOKEN: "TOKEN_PRIVADO_FICTICIO_321",
      SICOOB_PFX_PATH: "/pasta-privada-ficticia/certificado-secreto.pfx",
      SICOOB_PFX_PASSPHRASE: "Senha-Ficticia-Que-Nao-Pode-Aparecer",
    };
    for (const [chave, valor] of Object.entries(segredos)) vi.stubEnv(chave, valor);
    mocks.configuracao.mockReturnValue(estado({ configurado: true, mtlsConfigurado: true, pendencias: [] }));
    const html = renderToStaticMarkup(await PaginaIntegracaoSicoob({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Configuração local disponível");
    expect(html).toContain("Chave de retorno instalada");
    expect(html).toContain("SEU_CLIENT_ID");
    expect(html).toContain("SENHA_DIGITADA_SOMENTE_NO_SERVIDOR");
    for (const valor of Object.values(segredos)) expect(html).not.toContain(valor);
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Autenticação confirmada");
    expect(html).toContain("não comprova que o agendador está funcionando");
  });

  it("distingue sandbox e pendências de conexão sem declarar operação pronta", async () => {
    mocks.configuracao.mockReturnValue(estado({ ambiente: "sandbox", pendencias: ["SICOOB_CLIENT_ID"] }));
    const html = renderToStaticMarkup(await PaginaIntegracaoSicoob({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Ambiente de testes");
    expect(html).toContain("Instalação pendente");
    expect(html).toContain("Chave de retorno pendente");
    expect(html).toContain("Layout importado não é conexão homologada");
    expect(html).toContain("ambiente sandbox");
  });
});
