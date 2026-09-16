import { describe, expect, it } from "vitest";

import { conteudoHashManifestoOperacao } from "./manifesto-operacao-widesys";

function manifestoBase() {
  return {
    artifacts: [{ path: "scopes/titulos.json", sha256: "a".repeat(64), bytes: 10 }],
    baseOrigin: "https://brisaazul.app2.widesys.com.br",
    businessDate: "2026-09-16",
    captureId: "captura-1",
    capturedAt: "2026-09-16T15:00:00.000Z",
    complete: true,
    completedAt: "2026-09-16T15:00:00.000Z",
    errors: [],
    files: [{ count: 1, path: "scopes/titulos.json", scope: "contas_receber", sha256: "a".repeat(64) }],
    modules: { "contas-receber": { completed: true, recordsSaved: 1 } },
    options: {
      fromMonth: "2025-07",
      modules: ["contas-receber"],
      titlesTo: "2100-12-31",
      toMonth: "2026-09",
    },
    schemaVersion: 2,
    sourceOrigin: "https://brisaazul.app2.widesys.com.br",
    startedAt: "2026-09-16T14:00:00.000Z",
    timeZone: "America/Sao_Paulo",
    updatedAt: "2026-09-16T15:00:01.000Z",
    version: 2,
  };
}

describe("hash do manifesto operacional", () => {
  it("é canônico e ignora somente o timestamp técnico de atualização", () => {
    const primeiro = manifestoBase();
    const reordenado = JSON.parse(JSON.stringify(primeiro)) as ReturnType<typeof manifestoBase>;
    reordenado.updatedAt = "2026-09-16T16:00:00.000Z";
    reordenado.modules = { "contas-receber": { recordsSaved: 1, completed: true } };

    expect(conteudoHashManifestoOperacao(reordenado)).toBe(
      conteudoHashManifestoOperacao(primeiro),
    );
  });

  it("muda quando período, data civil, origem ou seleção de módulos são adulterados", () => {
    const original = manifestoBase();
    const base = conteudoHashManifestoOperacao(original);
    const alteracoes: Array<(manifesto: ReturnType<typeof manifestoBase>) => void> = [
      (manifesto) => {
        manifesto.businessDate = "2026-09-17";
      },
      (manifesto) => {
        manifesto.options.fromMonth = "2026-01";
      },
      (manifesto) => {
        manifesto.options.modules = ["contas-pagar"];
      },
      (manifesto) => {
        manifesto.sourceOrigin = "https://outro.example";
      },
    ];

    for (const alterar of alteracoes) {
      const copia = JSON.parse(JSON.stringify(original)) as ReturnType<typeof manifestoBase>;
      alterar(copia);
      expect(conteudoHashManifestoOperacao(copia)).not.toBe(base);
    }
  });
});
