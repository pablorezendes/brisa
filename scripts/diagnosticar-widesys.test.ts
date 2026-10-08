import { describe, expect, it, vi } from "vitest";
import { diagnosticarWidesys, formularioLoginDiagnostico } from "./diagnosticar-widesys";

const credenciais = { WIDESYS_USUARIO: "usuario-teste", WIDESYS_SENHA: "segredo-teste" };
const login = `<form action="index.php" method="post"><input name="username"><input type="password" name="passwd"><input type="hidden" name="option" value="com_login"><input type="hidden" name="task" value="login"><input type="hidden" name="csrf" value="nao-publicar-token"></form>`;
const lista = `<table><tr><td><input name="cid[]" value="7">Pessoa sigilosa</td></tr></table>`;
const json = (status = 200) => new Response(JSON.stringify({ data: [{ nome: "Pessoa sigilosa" }], meta: { "total-items": 123 } }), { status });

function transport(responses: Response[]) {
  return vi.fn<typeof fetch>(async () => {
    const response = responses.shift();
    if (!response) throw new Error("Requisição adicional não autorizada");
    return response;
  });
}

describe("diagnóstico somente leitura do Widesys", () => {
  it("não acessa rede sem credenciais e não importa dados", async () => {
    const fetcher = transport([]);
    const result = await diagnosticarWidesys({ env: {}, fetcher });
    expect(result.apiCadastros.estado).toBe("CREDENCIAIS_AUSENTES");
    expect(result.importacaoExecutada).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["https://exemplo.com", "http://brisaazul.app2.widesys.com.br", "https://usuario:senha@brisaazul.app2.widesys.com.br"])("recusa origem não autorizada: %s", async (base) => {
    const fetcher = transport([]);
    const result = await diagnosticarWidesys({ env: { ...credenciais, WIDESYS_BASE_URL: base }, fetcher });
    expect(result.apiCadastros.estado).toBe("ROTA_BLOQUEADA");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("limita API e telas, só faz POST no login e elimina dados/segredos da saída", async () => {
    const fetcher = transport([json(), new Response(login), new Response("Painel"), ...Array.from({ length: 4 }, () => new Response(lista))]);
    const result = await diagnosticarWidesys({ env: credenciais, fetcher });
    expect(result.apiCadastros).toEqual({ estado: "OK", http: 200, registrosNaAmostra: 1, totalInformado: 123 });
    expect(Object.values(result.telasFinanceiras)).toHaveLength(4);
    expect(Object.values(result.telasFinanceiras).every((item) => item.estado === "OK")).toBe(true);
    const chamadasPost = fetcher.mock.calls.filter((call) => call[1]?.method === "POST");
    expect(chamadasPost).toHaveLength(1);
    expect(new URLSearchParams(chamadasPost[0][1]?.body as string).get("task")).toBe("login");
    for (const [url, options] of fetcher.mock.calls) {
      expect(options?.redirect).toBe("manual");
      expect(new URL(String(url)).origin).toBe("https://brisaazul.app2.widesys.com.br");
      if (String(url).includes("view=")) expect(new URL(String(url)).searchParams.get("limit")).toBe("1");
    }
    expect(JSON.stringify(result)).not.toMatch(/Pessoa sigilosa|usuario-teste|segredo-teste|nao-publicar-token/);
    expect(result.modoIntegracaoDisponivel).toBe("CAPTURA_MANUAL_EM_LOTES");
  });

  it("não segue redirect da API com Basic Auth", async () => {
    const fetcher = transport([new Response(null, { status: 302, headers: { location: "https://exemplo.com" } }), new Response(login), new Response(login)]);
    const result = await diagnosticarWidesys({ env: credenciais, fetcher });
    expect(result.apiCadastros).toEqual({ estado: "HTTP_ERRO", http: 302 });
    expect(result.acessoAdministrativo.estado).toBe("CREDENCIAIS_RECUSADAS");
    expect(fetcher.mock.calls.every(([url]) => new URL(String(url)).origin.endsWith("widesys.com.br"))).toBe(true);
  });

  it.each(["https://exemplo.com/", "index.php?option=com_widesys&task=finanlancamento.delete", "index.php?option=com_login&task=logout"])("bloqueia destino de login inseguro: %s", async (location) => {
    const fetcher = transport([json(), new Response(login), new Response(null, { status: 302, headers: { location } })]);
    const result = await diagnosticarWidesys({ env: credenciais, fetcher });
    expect(result.acessoAdministrativo.estado).toBe("ROTA_BLOQUEADA");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("não repete credenciais no redirect 307", async () => {
    const fetcher = transport([json(), new Response(login), new Response(null, { status: 307, headers: { location: "index.php" } })]);
    const result = await diagnosticarWidesys({ env: credenciais, fetcher });
    expect(result.acessoAdministrativo.estado).toBe("ROTA_BLOQUEADA");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("recusa POST de formulário que não é autenticação", async () => {
    const fetcher = transport([json(), new Response(login.replace('value="login"', 'value="delete"'))]);
    const result = await diagnosticarWidesys({ env: credenciais, fetcher });
    expect(result.acessoAdministrativo.estado).toBe("RESPOSTA_INESPERADA");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("não imprime erro externo com segredos ou PII", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("segredo-teste usuario-teste Pessoa sigilosa"));
    const result = await diagnosticarWidesys({ env: credenciais, fetcher });
    expect(result.apiCadastros.estado).toBe("FALHA_REDE");
    expect(JSON.stringify(result)).not.toMatch(/segredo-teste|Pessoa sigilosa|usuario-teste/);
  });

  it("resposta excessiva fica limitada e não é persistida", async () => {
    const fetcher = transport([new Response("x".repeat(3 * 1024 * 1024 + 1)), new Response(login), new Response(login)]);
    const result = await diagnosticarWidesys({ env: credenciais, fetcher });
    expect(result.apiCadastros.estado).toBe("RESPOSTA_EXCEDE_LIMITE");
  });

  it("formulário duplicado não permite sobrescrever tarefa", () => {
    expect(() => formularioLoginDiagnostico(login.replace("</form>", '<input name="task" value="save"></form>'))).toThrow("RESPOSTA_INESPERADA");
  });
});
