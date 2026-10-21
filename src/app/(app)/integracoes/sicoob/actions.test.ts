import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ acesso: vi.fn(), perfil: vi.fn(), diagnostico: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/acesso/servidor", () => ({ exigirPermissaoAcesso: mocks.acesso }));
vi.mock("@/lib/autorizacao", () => ({ exigirPermissaoFinanceira: mocks.perfil }));
vi.mock("@/lib/integracoes/sicoob/diagnostico", () => ({ diagnosticarAutenticacaoSicoob: mocks.diagnostico }));
import { testarAutenticacaoSicoob } from "./actions";

let sequencia = 0;
const RESULTADO = {
  status: "AUTENTICADO", ambiente: "producao", verificadoEm: "2026-10-21T15:00:00.000Z",
  configuracaoLocalValida: true, autenticacaoValidada: true, convenioValidado: false,
  mensagem: "Autenticação confirmada; convênio não homologado.", pendencias: [],
};
function formulario(confirmado = true) {
  const form = new FormData();
  if (confirmado) form.set("confirmarTeste", "on");
  return form;
}

describe("diagnóstico administrativo Sicoob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acesso.mockResolvedValue({ perfil: "ADMINISTRADOR" });
    mocks.perfil.mockResolvedValue({ sub: `admin-teste-${++sequencia}`, perfil: "ADMINISTRADOR" });
    mocks.diagnostico.mockResolvedValue(RESULTADO);
  });
  it("nega antes de ler formulário ou testar conexão", async () => {
    mocks.acesso.mockRejectedValue(new Error("negado"));
    const form = formulario();
    const leitura = vi.spyOn(form, "get");
    await expect(testarAutenticacaoSicoob({}, form)).rejects.toThrow("negado");
    expect(mocks.acesso).toHaveBeenCalledWith("integracoes.gerenciar", { global: true });
    expect(leitura).not.toHaveBeenCalled();
    expect(mocks.diagnostico).not.toHaveBeenCalled();
  });
  it("exige autorização explícita e todas as permissões administrativas", async () => {
    expect((await testarAutenticacaoSicoob({}, formulario(false))).erro).toContain("Confirme");
    expect(mocks.acesso).toHaveBeenCalledWith("boletos.configurar", { global: true });
    expect(mocks.perfil).toHaveBeenCalledWith("GERENCIAR_CONTAS");
    expect(mocks.diagnostico).not.toHaveBeenCalled();
  });
  it("não aceita ambiente, host ou segredos vindos do formulário", async () => {
    const form = formulario();
    form.set("SICOOB_TOKEN_URL", "https://host-nao-autorizado.invalid/token");
    form.set("clientId", "segredo-nao-aceito");
    const estado = await testarAutenticacaoSicoob({}, form);
    expect(mocks.diagnostico).toHaveBeenCalledExactlyOnceWith();
    expect(estado).toEqual({ resultado: RESULTADO });
    expect(JSON.stringify(estado)).not.toContain("segredo-nao-aceito");
  });
  it("limita cliques repetidos sem refazer a conexão", async () => {
    await testarAutenticacaoSicoob({}, formulario());
    expect((await testarAutenticacaoSicoob({}, formulario())).erro).toContain("um minuto");
    expect(mocks.diagnostico).toHaveBeenCalledOnce();
  });
  it("não revela detalhes de erro inesperado", async () => {
    mocks.diagnostico.mockRejectedValue(new Error("token-privado /caminho/privado client-secret"));
    const estado = await testarAutenticacaoSicoob({}, formulario());
    expect(estado.erro).toContain("diagnóstico");
    expect(JSON.stringify(estado)).not.toMatch(/token-privado|caminho\/privado|client-secret/);
  });
});
