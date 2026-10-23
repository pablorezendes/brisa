import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { lerAnexoDespesa, listarAnexosDespesa, salvarAnexoDespesa, LIMITE_ANEXO_DESPESA } from "@/lib/despesas/anexos";
import { GET, POST } from "./route";

vi.mock("@/lib/acesso/servidor", () => ({ exigirPermissaoAcesso: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/despesas/anexos", () => ({ lerAnexoDespesa: vi.fn(), listarAnexosDespesa: vi.fn(), salvarAnexoDespesa: vi.fn(), LIMITE_ANEXO_DESPESA: 5 * 1024 * 1024 }));
const url = "https://brisa.example.test/financeiro/contas-a-pagar/anexos";
const origem = "https://brisa.example.test";
beforeEach(() => {
  vi.mocked(exigirPermissaoAcesso).mockResolvedValue({ usuarioId: "admin" } as Awaited<ReturnType<typeof exigirPermissaoAcesso>>);
  vi.stubEnv("APP_PUBLIC_URL", "");
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("rota privada dos anexos", () => {
  it("download usa guard global, attachment, no-store e nosniff", async () => {
    vi.mocked(lerAnexoDespesa).mockResolvedValue({ id: "arquivo", mimeType: "application/pdf", nomeOriginal: "nota teste.pdf", tamanho: 5, conteudo: new Uint8Array(Buffer.from("%PDF-")) });
    const resposta = await GET(new Request(`${url}?id=arquivo`));
    expect(exigirPermissaoAcesso).toHaveBeenCalledWith("despesas.ver", { global: true });
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("Content-Disposition")).toContain("attachment;");
    expect(resposta.headers.get("Content-Disposition")).toContain("nota%20teste.pdf");
    expect(resposta.headers.get("Cache-Control")).toContain("no-store");
    expect(resposta.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(resposta.headers.get("Content-Security-Policy")).toContain("sandbox");
  });

  it("erro de acesso não revela existência nem detalhe do documento", async () => {
    vi.mocked(listarAnexosDespesa).mockRejectedValue(new Error("CPF PRIVADO E COMISSAO"));
    const resposta = await GET(new Request(`${url}?despesaId=nota`));
    expect(resposta.status).toBe(404);
    expect(await resposta.text()).not.toContain("CPF PRIVADO");
    expect(resposta.headers.get("Cache-Control")).toContain("no-store");
  });

  it.each([null, "https://ataque.example.test", "https://brisa.example.test.ataque.test"])("POST nega Origin %s antes de anexar", async origin => {
    const resposta = await POST(new Request(url, { method: "POST", headers: origin ? { origin } : {}, body: "arquivo" }));
    expect(resposta.status).toBe(403);
    expect(salvarAnexoDespesa).not.toHaveBeenCalled();
  });

  it("limite do cabeçalho e limite real do stream impedem uploads grandes", async () => {
    const cabeçalho = await POST(new Request(url, { method: "POST", headers: { origin: origem, "Content-Length": String(LIMITE_ANEXO_DESPESA + 65537) }, body: "pequeno" }));
    expect(cabeçalho.status).toBe(413);
    const real = await POST(new Request(url, { method: "POST", headers: { origin: origem, "Content-Length": "1" }, body: new Uint8Array(LIMITE_ANEXO_DESPESA + 65537) }));
    expect(real.status).toBe(413);
    expect(salvarAnexoDespesa).not.toHaveBeenCalled();
  });

  it("aceita upload da origem pública explicitamente configurada", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://publico.example.test");
    const form = new FormData(); form.set("despesaId", "nota"); form.set("arquivo", new File(["%PDF-1.7"], "nota.pdf", { type: "application/pdf" }));
    vi.mocked(salvarAnexoDespesa).mockResolvedValue({ id: "arquivo", nomeOriginal: "nota.pdf", mimeType: "application/pdf", tamanho: 8 });
    const resposta = await POST(new Request(url, { method: "POST", headers: { origin: "https://publico.example.test" }, body: form }));
    expect(resposta.status).toBe(200);
    expect(exigirPermissaoAcesso).toHaveBeenCalledWith("despesas.editar", { global: true });
    expect(salvarAnexoDespesa).toHaveBeenCalledWith({}, "nota", "admin", expect.objectContaining({ nome: "nota.pdf", mimeType: "application/pdf" }));
  });
});
