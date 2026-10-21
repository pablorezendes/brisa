import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { montarPolitica } from "@/lib/acesso/politica";

const mocks = vi.hoisted(() => ({
  acesso: vi.fn(), pagina: vi.fn(), permissao: vi.fn(), financeira: vi.fn(), contas: vi.fn(),
  servidor: vi.fn(), webhook: vi.fn(), cadastro: vi.fn(), convenio: vi.fn(), politica: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/acesso/servidor", () => ({
  acessoAtual: mocks.acesso, exigirPaginaAcesso: mocks.pagina, exigirPermissaoAcesso: mocks.permissao,
}));
vi.mock("@/lib/autorizacao", () => ({ exigirPermissaoFinanceira: mocks.financeira }));
vi.mock("@/lib/db", () => ({ prisma: { contaBancaria: { findMany: mocks.contas } } }));
vi.mock("@/lib/governanca/filtros", () => ({ filtroGovernanca: vi.fn().mockResolvedValue({ id: { notIn: ["excluida"] } }) }));
vi.mock("@/lib/integracoes/sicoob", () => ({ obterEstadoConfiguracaoSicoob: mocks.servidor }));
vi.mock("@/app/(app)/financeiro/contas-bancarias/actions", () => ({
  atualizarContaBancaria: mocks.convenio, atualizarPoliticaCobrancaSicoob: mocks.politica,
  atualizarCadastroContaBancaria: mocks.cadastro,
}));
vi.mock("@/app/(app)/financeiro/boletos/actions", () => ({ registrarWebhook: mocks.webhook }));
vi.mock("@/components/excluir-registro-link", () => ({ ExcluirRegistroLink: () => null }));

import { SicoobContas } from "./painel-contas-sicoob";
import PaginaContasBancarias from "@/app/(app)/financeiro/contas-bancarias/page";

const conta = {
  id: "conta-exemplo", codigoBanco: "756", nomeBanco: "Banco cooperativo", agencia: "1234", numero: "123-4",
  apelido: "Conta de exemplo", finalidade: "OPERACIONAL", ativa: true, padrao: true,
  integracaoHabilitada: false, boletosHabilitados: false, integracaoStatus: "NAO_CONFIGURADA", ambiente: "PRODUCAO",
  numeroCliente: null, numeroContaCorrenteApi: null, codigoEspecieDocumento: "RC", codigoModalidade: null,
  numeroContratoCobranca: null, webhookId: null, webhookStatus: null, ultimaSincronizacaoEm: null,
  atualizadoEm: new Date("2026-10-20"), atualizadoPor: null, _count: { boletos: 0 },
  configuracaoCobrancaSicoob: null,
};
const acesso = (perfil = "ADMINISTRADOR") => montarPolitica({
  id: "usuario", perfil, ativo: true, acessoGlobal: true, permissoesExtras: "[]", permissoesNegadas: "[]", regrasAcesso: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.acesso.mockResolvedValue(acesso());
  mocks.permissao.mockResolvedValue(undefined);
  mocks.financeira.mockResolvedValue({ perfil: "ADMINISTRADOR" });
  mocks.contas.mockResolvedValue([conta]);
  mocks.servidor.mockReturnValue({
    configurado: false, ambiente: "producao", autenticacao: "oauth_client_credentials",
    mtlsConfigurado: false, escoposWebhookConfigurados: false, pendencias: ["SICOOB_TOKEN_URL"],
  });
});

describe("configuração Sicoob exclusiva de Integrações", () => {
  it("cadastro exibe apenas edição simples e link para a conta na integração", async () => {
    const html = renderToStaticMarkup(await PaginaContasBancarias({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Editar cadastro");
    expect(html).toContain('href="/integracoes/sicoob#conta-conta-exemplo"');
    expect(html).not.toContain('name="numeroCliente"');
    expect(html).not.toContain('name="codigoModalidade"');
    expect(html).not.toContain('name="integracaoHabilitada"');
    expect(html).not.toContain("SICOOB_PFX_PASSPHRASE");
    expect(mocks.servidor).not.toHaveBeenCalled();
  });

  it("consulta financeira não oferece edição ou link administrativo", async () => {
    mocks.acesso.mockResolvedValue(acesso("FINANCEIRO"));
    const html = renderToStaticMarkup(await PaginaContasBancarias({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Conta de exemplo");
    expect(html).not.toContain("Editar cadastro");
    expect(html).not.toContain('href="/integracoes/sicoob');
  });

  it.each(["integracoes.gerenciar", "boletos.configurar"])("sem a capacidade efetiva %s esconde links mas preserva edição simples", async (permissao) => {
    const politica = acesso();
    mocks.acesso.mockResolvedValue({ ...politica, permissoes: politica.permissoes.filter((codigo) => codigo !== permissao) });
    const html = renderToStaticMarkup(await PaginaContasBancarias({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Editar cadastro");
    expect(html).not.toContain('href="/integracoes/sicoob');
  });

  it("painel tem convênio e retornos na mesma rota, sem chamadas bancárias ao abrir", async () => {
    const html = renderToStaticMarkup(await SicoobContas());
    expect(mocks.permissao).toHaveBeenCalledWith("contas.editar", { global: true });
    expect(mocks.permissao).toHaveBeenCalledWith("integracoes.gerenciar", { global: true });
    expect(mocks.permissao).toHaveBeenCalledWith("boletos.configurar", { global: true });
    expect(mocks.financeira).toHaveBeenCalledWith("GERENCIAR_CONTAS");
    expect(html).toContain('id="conta-conta-exemplo"');
    expect(html).toContain('name="numeroCliente"');
    expect(html).toContain('name="retorno" value="/integracoes/sicoob"');
    expect(html).toContain("LIQUI (tipo 5)");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Único segredo");
    expect(mocks.webhook).not.toHaveBeenCalled();
    expect(mocks.convenio).not.toHaveBeenCalled();
  });

  it("guardas interrompem consulta antes de buscar dados bancários", async () => {
    mocks.permissao.mockRejectedValue(new Error("NEGADO"));
    await expect(SicoobContas()).rejects.toThrow("NEGADO");
    expect(mocks.contas).not.toHaveBeenCalled();
    expect(mocks.servidor).not.toHaveBeenCalled();
  });

  it.each(["integracoes.gerenciar", "boletos.configurar"])("painel recusa revogação de %s antes dos dados", async (permissao) => {
    mocks.permissao.mockImplementation(async (codigo) => {
      if (codigo === permissao) throw new Error("NEGADO");
    });
    await expect(SicoobContas()).rejects.toThrow("NEGADO");
    expect(mocks.contas).not.toHaveBeenCalled();
    expect(mocks.servidor).not.toHaveBeenCalled();
  });
});
