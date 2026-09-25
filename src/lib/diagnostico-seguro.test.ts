import { describe, expect, it } from "vitest";
import { diagnosticoRequisicao, digestSeguro } from "./diagnostico-seguro";

describe("diagnóstico seguro de falhas", () => {
  it("aceita somente digest numérico limitado", () => {
    expect(digestSeguro("953724750")).toBe("953724750");
    for (const valor of [undefined, null, 953724750, "", "token-privado", "123\n456", "1".repeat(21)]) expect(digestSeguro(valor)).toBeUndefined();
  });

  it("retém código conhecido e rota template sem copiar mensagem, query ou dados privados", () => {
    const erro = Object.assign(new Error("cliente privado token-secreto"), { digest: "953724750", code: "P2028", meta: { segredo: "não registrar" } });
    const request = { method: "GET", path: "/contratos/id-privado?token=segredo", headers: { cookie: "sessao=privada" } };
    const diagnostico = diagnosticoRequisicao(erro, request, { routePath: "/contratos/[id]", routeType: "render" });
    expect(diagnostico).toEqual({ evento: "BRISA_REQUEST_ERROR", rota: "/contratos/[id]", metodo: "GET", tipo: "render", digest: "953724750", codigo: "P2028" });
    expect(JSON.stringify(diagnostico)).not.toMatch(/cliente|privad|segred|cookie|sessao/);
  });

  it("não deixa o segredo de webhook no caminho do diagnóstico", () => {
    const diagnostico = diagnosticoRequisicao({ code: "SQLITE_BUSY" }, { method: "POST" }, { routePath: "/api/integracoes/sicoob/webhook/tokenprivado?token=mais", routeType: "route" });
    expect(diagnostico.rota).toBe("/api/integracoes/sicoob/webhook/[segredo]");
    expect(JSON.stringify(diagnostico)).not.toContain("tokenprivado");
  });

  it("usa defaults seguros para erro/campos desconhecidos e segue causa conhecida", () => {
    expect(diagnosticoRequisicao({ cause: { code: "ENOSPC" } }, { method: "DADOS_PRIVADOS" }, { routePath: "https://site/cliente", routeType: "token" })).toEqual({ evento: "BRISA_REQUEST_ERROR", rota: "/[rota-indisponivel]", metodo: "OUTRO", tipo: "outro", digest: undefined, codigo: "ENOSPC" });
    expect(diagnosticoRequisicao({ code: "QUALQUER_DADO_PRIVADO" }, {}, {}).codigo).toBe("ERRO_INTERNO");
  });

  it("não falha com getter ou cadeia circular de erros", () => {
    const erro = { get code() { throw new Error("não deve escapar"); }, get digest() { throw new Error("não deve escapar"); } };
    expect(diagnosticoRequisicao(erro, {}, {}).codigo).toBe("ERRO_INTERNO");
    const circular: { cause?: unknown } = {}; circular.cause = circular;
    expect(diagnosticoRequisicao(circular, {}, {}).codigo).toBe("ERRO_INTERNO");
  });
});
