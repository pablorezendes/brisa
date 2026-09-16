import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SameOriginReadClient,
  artifactsMatchManifest,
  assertResumeCompatibility,
  assertResumeFreshness,
  assertResumeLimits,
  assertLoginRoute,
  catalogCaptureExitCode,
  fileMatchesSha256,
  loadManifest,
  parseCatalogArgs,
  type Artifact,
} from "./capturar-catalogos-widesys";
import { CATALOG_MODULES, assertCatalogDetailUrl, sha256 } from "./widesys-catalogos-core";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

const baseUrl = new URL("https://legado.example/administrator/index.php?admin");

describe("rotas do login de catalogos", () => {
  const guard = (url: URL, method: "GET" | "POST") => assertLoginRoute(url, baseUrl, method);

  it("aceita apenas o index e os componentes esperados do login", () => {
    expect(() => assertLoginRoute(baseUrl, baseUrl, "GET")).not.toThrow();
    expect(() =>
      assertLoginRoute(
        new URL("https://legado.example/administrator/index.php?option=com_login&task=login"),
        baseUrl,
        "POST",
      ),
    ).not.toThrow();
    expect(() =>
      assertLoginRoute(
        new URL("https://legado.example/administrator/index.php?option=com_cpanel"),
        baseUrl,
        "GET",
      ),
    ).not.toThrow();
    expect(() =>
      assertLoginRoute(
        new URL("https://legado.example/administrator/index.php?option=com_widesys&task=conta.edit&id=18"),
        baseUrl,
        "GET",
      ),
    ).toThrow(/parametro inesperado|task/i);
  });

  it("bloqueia o GET inicial em outro pathname antes da rede", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new SameOriginReadClient(baseUrl);
    await expect(
      client.get(new URL("https://legado.example/administrator/atalho.php?admin"), guard),
    ).rejects.toThrow(/index administrativo/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aplica a whitelist ao salto GET para GET", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        headers: {
          location:
            "https://legado.example/administrator/index.php?option=com_widesys&task=conta.edit&id=18",
        },
        status: 302,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new SameOriginReadClient(baseUrl);
    await expect(client.get(baseUrl, guard)).rejects.toThrow(/parametro inesperado|task/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aplica a whitelist ao salto POST para GET", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        headers: {
          location:
            "https://legado.example/administrator/index.php?option=com_widesys&task=conta.edit&id=18",
        },
        status: 302,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new SameOriginReadClient(baseUrl);
    const action = new URL(
      "https://legado.example/administrator/index.php?option=com_login&task=login",
    );
    await expect(client.authenticate(action, new URLSearchParams(), guard)).rejects.toThrow(
      /parametro inesperado|task/i,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("identidade nos redirects de detalhe", () => {
  it("bloqueia troca do ID legado antes de seguir o salto", async () => {
    const contas = CATALOG_MODULES.find((module) => module.key === "contas");
    if (!contas) throw new Error("fixture sem modulo contas");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        headers: {
          location:
            "https://legado.example/administrator/index.php?option=com_widesys&view=conta&layout=edit&id=18",
        },
        status: 302,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new SameOriginReadClient(baseUrl);
    const detail = new URL(
      "https://legado.example/administrator/index.php?option=com_widesys&view=conta&layout=edit&id=17",
    );
    await expect(
      client.get(detail, (candidate) => assertCatalogDetailUrl(candidate, baseUrl, contas, "17")),
    ).rejects.toThrow(/diverge/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

async function temporaryFile(name: string, content: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "brisa-catalog-resume-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, name);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

function artifact(pathname: string, content: string): Artifact {
  return {
    bytes: Buffer.byteLength(content),
    kind: "detail-json",
    listEvidenceHash: sha256("linha-original"),
    module: "contas",
    path: pathname,
    sha256: sha256(content),
    sourceUrl: "https://legado.example/administrator/index.php?option=com_widesys&view=conta&layout=edit&id=18",
  };
}

describe("retomada integra de catalogos", () => {
  it("refresh ignora manifesto truncado, new olha apenas existencia e resume valida JSON", async () => {
    const manifestPath = await temporaryFile("manifest.json", '{"version":');
    const refresh = parseCatalogArgs(["--dry-run", "--modules=contas", "--refresh"]);
    const novo = parseCatalogArgs(["--dry-run", "--modules=contas", "--no-resume"]);
    const resume = parseCatalogArgs(["--dry-run", "--modules=contas", "--resume"]);

    await expect(loadManifest(refresh, manifestPath)).resolves.toMatchObject({
      artifacts: [],
      modules: {},
      options: { captureMode: "refresh", modules: ["contas"] },
    });
    await expect(loadManifest(novo, manifestPath)).rejects.toThrow(/manifesto existente/i);
    await expect(loadManifest(resume, manifestPath)).rejects.toThrow();
    await expect(loadManifest(resume, `${manifestPath}.ausente`)).rejects.toThrow(/manifesto ausente/i);
  });

  it("exige a mesma lista e ordem de modulos de uma captura ainda interrompida", () => {
    expect(() =>
      assertResumeCompatibility(
        ["contas", "plano-contas"],
        ["contas", "plano-contas"],
        null,
        [2025, 2026],
        [2025, 2026],
      ),
    ).not.toThrow();
    expect(() =>
      assertResumeCompatibility(["contas", "plano-contas"], ["contas"], null, [2026], [2026]),
    ).toThrow(/coincidir exatamente/i);
    expect(() =>
      assertResumeCompatibility(
        ["contas", "plano-contas"],
        ["plano-contas", "contas"],
        null,
        [2026],
        [2026],
      ),
    ).toThrow(/coincidir exatamente/i);
    expect(() =>
      assertResumeCompatibility(
        ["contas", "plano-contas"],
        ["contas", "plano-contas"],
        "2026-09-16T10:00:00.000Z",
        [2026],
        [2026],
      ),
    ).toThrow(/ja encerrada/i);
    expect(() =>
      assertResumeCompatibility(["irrf"], ["irrf"], null, [2025], [2025, 2026]),
    ).toThrow(/anos IRRF/i);
  });

  it("aceita intervalo historico IRRF conservador e o preserva em ordem", () => {
    const options = parseCatalogArgs([
      "--dry-run",
      "--modules=irrf",
      "--irrf-from-year=2024",
      "--irrf-to-year=2026",
    ]);
    expect(options.irrfYears).toEqual([2024, 2025, 2026]);
    expect(() =>
      parseCatalogArgs(["--dry-run", "--modules=contas", "--irrf-from-year=2025"]),
    ).toThrow(/modulo irrf/i);
    expect(() =>
      parseCatalogArgs([
        "--dry-run",
        "--base-url=https://phishing.example/administrator/index.php?admin",
      ]),
    ).toThrow(/host autorizado/i);
  });

  it("recusa retomada de captura interrompida com mais de 24 horas", () => {
    expect(() =>
      assertResumeFreshness("2026-09-16T10:00:00.000Z", new Date("2026-09-17T09:59:59.000Z")),
    ).not.toThrow();
    expect(() =>
      assertResumeFreshness("2026-09-16T10:00:00.000Z", new Date("2026-09-17T10:00:01.000Z")),
    ).toThrow(/expirou/i);
  });

  it("mantem os limites operacionais imutaveis na retomada", () => {
    expect(() =>
      assertResumeLimits(
        { delayMs: 300, limit: 200, maxPages: 10_000 },
        { delayMs: 300, maxPages: 10_000 },
      ),
    ).not.toThrow();
    expect(() =>
      assertResumeLimits(
        { delayMs: 300, limit: 200, maxPages: 10_000 },
        { delayMs: 0, maxPages: 10_000 },
      ),
    ).toThrow(/coincidir/i);
  });

  it("aceita somente arquivo cujo SHA-256 coincide com o esperado", async () => {
    const filePath = await temporaryFile("18.json", "conteudo-original");
    const expected = sha256("conteudo-original");
    expect(await fileMatchesSha256(filePath, expected)).toBe(true);

    await writeFile(filePath, "conteudo-adulterado", "utf8");
    expect(await fileMatchesSha256(filePath, expected)).toBe(false);
    expect(await fileMatchesSha256(`${filePath}.ausente`, expected)).toBe(false);
  });

  it("nao reutiliza artefato sem entrada correspondente no manifesto ou com hash divergente", async () => {
    const content = '{"id":"18"}\n';
    const filePath = await temporaryFile("18.json", content);
    const manifestPath = "contas/records/18.json";
    const expected = artifact(manifestPath, content);
    const candidate = {
      evidenceHash: expected.listEvidenceHash,
      filePath,
      kind: "detail-json" as const,
      manifestPath,
      sourceUrl: expected.sourceUrl,
    };

    expect(await artifactsMatchManifest([expected], "contas", [candidate])).toBe(true);
    expect(await artifactsMatchManifest([], "contas", [candidate])).toBe(false);
    expect(
      await artifactsMatchManifest(
        [{ ...expected, sha256: sha256("outro-conteudo") }],
        "contas",
        [candidate],
      ),
    ).toBe(false);
    expect(
      await artifactsMatchManifest([expected], "contas", [
        { ...candidate, evidenceHash: sha256("linha-alterada") },
      ]),
    ).toBe(false);
    expect(
      await artifactsMatchManifest([expected], "contas", [
        {
          ...candidate,
          sourceUrl:
            "https://legado.example/administrator/index.php?option=com_widesys&view=conta&layout=edit&id=19",
        },
      ]),
    ).toBe(false);
  });
});

describe("codigo de saida da captura", () => {
  it("retorna 2 para lote incompleto e 0 somente para lote completo", () => {
    expect(catalogCaptureExitCode(35, 35)).toBe(0);
    expect(catalogCaptureExitCode(34, 35)).toBe(2);
    expect(catalogCaptureExitCode(0, 0)).toBe(2);
  });
});
