import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildListUrl,
  canonicalOperationalDetailUrl,
  assertCanonicalOperationalDetailUrl,
  assertEquivalentOperationalUrl,
  assertListUrl,
  assertLoginRoute,
  assertParcelaInfoUrl,
  buildCapturedRecord,
  businessDateIso,
  capturedRecordMatchesEvidence,
  contractParties,
  extractLegacyListRows,
  flattenedFields,
  fetchDetails,
  isFatalOperationalError,
  loadManifest,
  mergeOperationalCheckpointArtifacts,
  nextOperationalPageOffset,
  operationalRecordCheckpointHash,
  operationalRecordCheckpointIsValid,
  operationalManifestIsResumable,
  operationalManifestIsRetryable,
  OperationalCaptureError,
  OperationalSession,
  operationalReferencesForRow,
  paymentRows,
  parseArgs,
  parcelaInfoUrlsForRow,
  persistableListRows,
  publicUrl,
  requireReportedTotal,
  runOperationalModules,
  SameOriginClient,
  sanitizeManifestErrorMessage,
  shardScopeRecords,
  verifyGlobalOperationalTotal,
  verifiedOperationalTotal,
} from "./capturar-operacao-widesys";
import { extractRecord, sha256 } from "./widesys-parser";
import { conteudoHashManifestoOperacao } from "../src/lib/importacao/manifesto-operacao-widesys";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("retomada explicita e falhas fatais da captura operacional", () => {
  const now = new Date("2026-10-10T14:00:00.000Z");
  const options = () => parseArgs(["--retry-failed", "--from=2025-01", "--to=2026-10", "--titles-to=2100-12-31", "--delay-ms=0"]);
  const fixture = () => {
    const cli = options();
    const manifest = {
      version: 2, schemaVersion: 2, baseOrigin: cli.baseUrl.origin, sourceOrigin: cli.baseUrl.origin,
      captureId: "2026-10-10T10-00-00-000Z", startedAt: "2026-10-10T10:00:00.000Z",
      completedAt: "2026-10-10T13:00:00.000Z", capturedAt: "2026-10-10T13:00:00.000Z",
      updatedAt: "2026-10-10T13:00:00.000Z", businessDate: "2026-10-10", timeZone: "America/Sao_Paulo",
      complete: false, contentHash: "", files: [], artifacts: [], modules: {},
      errors: [{ at: "2026-10-10T13:00:00.000Z", code: "DETAIL_FETCH_FAILED", message: "HTTP 403", module: "contas-pagar" as const }],
      options: { captureMode: "resume", delayMs: 250, fromMonth: cli.fromMonth, toMonth: cli.toMonth, titlesTo: cli.titlesTo, limit: 200, maxPages: 10000, modules: cli.modules },
    };
    manifest.contentHash = sha256(conteudoHashManifestoOperacao(manifest));
    return manifest;
  };
  async function withCapture(run: (output: string, parent: string) => Promise<void>) {
    const parent = await mkdtemp(path.join(path.resolve(tmpdir()), "widesys-retry-test-"));
    const output = path.join(parent, "operacao");
    await mkdir(output);
    try { await run(output, parent); }
    finally {
      // Somente a pasta temporaria criada por este teste, nunca o workspace.
      if (path.dirname(parent) !== path.resolve(tmpdir()) || !path.basename(parent).startsWith("widesys-retry-test-")) throw new Error("Pasta temporaria inesperada.");
      await rm(parent, { recursive: true, force: true });
    }
  }

  it("mantem captureMode resume compativel e rejeita modos conflitantes", () => {
    expect(options()).toMatchObject({ captureMode: "resume", retryFailed: true });
    expect(parseArgs(["--resume"]).retryFailed).toBe(false);
    for (const flag of ["--resume", "--refresh", "--no-resume"]) {
      expect(() => parseArgs(["--retry-failed", flag])).toThrow(/exclusivos/i);
      expect(() => parseArgs([flag, "--retry-failed"])).toThrow(/exclusivos/i);
    }
  });

  it("so reabre encerramento incompleto genuino, no mesmo dia e dentro de 24h", () => {
    const manifest = fixture();
    expect(operationalManifestIsRetryable(manifest, now)).toBe(true);
    expect(operationalManifestIsResumable(manifest, now)).toBe(false);
    for (const delta of [
      { complete: true }, { errors: [] }, { completedAt: null, capturedAt: null },
      { businessDate: "2026-10-09" }, { startedAt: "2026-10-09T09:00:00.000Z" },
      { startedAt: "2026-10-10T13:30:00.000Z" },
      { completedAt: "2026-10-10T15:00:00.000Z", capturedAt: "2026-10-10T15:00:00.000Z" },
      { capturedAt: "2026-10-10T12:00:00.000Z" },
    ]) expect(operationalManifestIsRetryable({ ...manifest, ...delta }, now)).toBe(false);
  });

  it("arquiva bytes originais fora de operacao sem mudar captureId ou checkpoints", async () => {
    await withCapture(async (output, parent) => {
      const manifest = fixture();
      const raw = `${JSON.stringify(manifest, null, 2)}\n`;
      await writeFile(path.join(output, "manifest.json"), raw);
      const checkpoint = path.join(output, "checkpoint-teste.json");
      await writeFile(checkpoint, "evidencia-original");
      const reopened = await loadManifest(options(), output, now);
      expect(reopened).toMatchObject({ captureId: manifest.captureId, startedAt: manifest.startedAt, businessDate: manifest.businessDate, completedAt: null, capturedAt: null, complete: false, options: { captureMode: "resume" } });
      expect(reopened.errors).toEqual(manifest.errors);
      expect(await readFile(checkpoint, "utf8")).toBe("evidencia-original");
      expect(await readFile(path.join(output, "manifest.json"), "utf8")).toBe(raw);
      const archives = (await readdir(parent)).filter(name => name.startsWith("operacao-tentativa-"));
      expect(archives).toHaveLength(1);
      expect(await readFile(path.join(parent, archives[0], "manifest.json"), "utf8")).toBe(raw);
    });
  });

  it("nao inicia captura nova nem arquiva manifesto completo, adulterado ou de outro escopo", async () => {
    await withCapture(async (output, parent) => {
      await expect(loadManifest(options(), output, now)).rejects.toThrow(/existente/i);
      for (const mutate of [
        (m: ReturnType<typeof fixture>) => { m.complete = true; },
        (m: ReturnType<typeof fixture>) => { m.sourceOrigin = "https://outra-origem.example"; },
        (m: ReturnType<typeof fixture>) => { m.options.fromMonth = "2025-02"; },
        (m: ReturnType<typeof fixture>) => { m.options.modules.reverse(); },
      ]) {
        const manifest = fixture(); mutate(manifest);
        manifest.contentHash = sha256(conteudoHashManifestoOperacao(manifest));
        await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest));
        await expect(loadManifest(options(), output, now)).rejects.toThrow();
      }
      const altered = fixture(); altered.contentHash = "0".repeat(64);
      await writeFile(path.join(output, "manifest.json"), JSON.stringify(altered));
      await expect(loadManifest(options(), output, now)).rejects.toThrow(/hash/i);
      expect(await readdir(parent)).toEqual(["operacao"]);
    });
  });

  it.each([401, 403, 429, 500, 503])("HTTP %s interrompe sem retentar ou fazer POST", async status => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Access denied / WAF", { status }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new SameOriginClient();
    await expect(client.get(options().baseUrl, () => {})).rejects.toMatchObject({ code: `HTTP_${status}` });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  });

  it("falha fatal no detalhe registra uma vez e nao solicita o proximo detalhe", async () => {
    const cli = parseArgs(["--refresh", "--delay-ms=0"]);
    const failure = new OperationalCaptureError("HTTP_403", "Acesso negado.");
    const client = { get: vi.fn().mockRejectedValue(failure) };
    const manifest = { errors: [] } as unknown as Parameters<typeof fetchDetails>[2];
    const state = { detailErrors: 0 } as Parameters<typeof fetchDetails>[4];
    const records = new Map(["7", "8"].map(id => [id, {
      row: { legacyId: id, contentHash: `row-${id}` }, sourceWindow: "todos",
      targets: [{ transport: "locacao.edit", url: canonicalOperationalDetailUrl(`?option=com_widesys&task=locacao.edit&id=${id}`, cli.baseUrl, cli.baseUrl, "contratos", id) }],
    }])) as unknown as Parameters<typeof fetchDetails>[5];
    await expect(fetchDetails(client, cli, manifest, "contratos", state, records)).rejects.toBe(failure);
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(state.detailErrors).toBe(1);
    expect(manifest.errors).toHaveLength(1);
    expect(failure.recordedInManifest).toBe(true);
  });

  it("falha fatal nao segue para outro modulo, mantendo a falha observavel", async () => {
    const error = new OperationalCaptureError("SESSION_EXPIRED", "Sessao expirada.");
    const capture = vi.fn().mockRejectedValue(error);
    const failed = vi.fn().mockResolvedValue(undefined);
    await runOperationalModules(["contratos", "contas-pagar"], capture, failed);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledExactlyOnceWith(error, "contratos");
    expect(isFatalOperationalError(error)).toBe(true);
    expect(isFatalOperationalError(new Error("Registro isolado invalido."))).toBe(false);
  });

  it("redirect de detalhe para login para o lote sem seguir salto, detalhe ou modulo", async () => {
    const cli = parseArgs(["--refresh", "--delay-ms=0"]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "/administrator/index.php?option=com_login&view=login" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new SameOriginClient();
    const manifest = { errors: [] } as unknown as Parameters<typeof fetchDetails>[2];
    const state = { detailErrors: 0 } as Parameters<typeof fetchDetails>[4];
    const records = new Map(["7", "8"].map(id => [id, {
      row: { legacyId: id, contentHash: `row-${id}` }, sourceWindow: "todos",
      targets: [{ transport: "locacao.edit", url: canonicalOperationalDetailUrl(`?option=com_widesys&task=locacao.edit&id=${id}`, cli.baseUrl, cli.baseUrl, "contratos", id) }],
    }])) as unknown as Parameters<typeof fetchDetails>[5];
    const capture = vi.fn().mockImplementation(() => fetchDetails(client, cli, manifest, "contratos", state, records));
    const failure = vi.fn().mockResolvedValue(undefined);
    await runOperationalModules(["contratos", "contas-pagar"], capture, failure);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
    expect(capture).toHaveBeenCalledTimes(1);
    expect(failure.mock.calls[0][0]).toMatchObject({ code: "REDIRECT_BLOCKED", recordedInManifest: true });
    expect(manifest.errors).toHaveLength(1);
  });
});

describe("repeticao limitada de transporte no GET", () => {
  const target = new URL("https://legado.example/administrator/index.php?option=com_widesys&task=locacao.edit&id=7");
  const failure = (code?: string) => new TypeError("mensagem privada https://segredo.example/token", { cause: code ? Object.assign(new Error("detalhe privado"), { code }) : undefined });

  it.each(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"])("repete somente o mesmo GET com %s em 1s e 3s", async code => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValueOnce(failure(code)).mockRejectedValueOnce(failure(code)).mockResolvedValue(new Response("concluido"));
    vi.stubGlobal("fetch", fetchMock);
    const guard = vi.fn();
    const pending = new SameOriginClient().get(target, guard);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ html: "concluido" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(guard).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([url, init]) => [url.toString(), init.method])).toEqual(Array.from({ length: 3 }, () => [target.toString(), "GET"]));
  });

  it("para na terceira tentativa e conserva apenas o codigo permitido", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(failure("ECONNRESET"));
    vi.stubGlobal("fetch", fetchMock);
    const pending = new SameOriginClient().get(target, () => {}).catch(error => error);
    await vi.runAllTimersAsync();
    const error = await pending;
    expect(error).toMatchObject({ code: "REQUEST_FAILED_ECONNRESET", message: "Falha de transporte ao ler o legado." });
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toMatch(/privad|segredo|token/);
    expect(isFatalOperationalError(error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([undefined, "ECONNREFUSED", "CERT_HAS_EXPIRED", "HTTP_403"])("nao repete TypeError sem codigo permitido (%s)", async code => {
    const fetchMock = vi.fn().mockRejectedValue(failure(code));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new SameOriginClient().get(target, () => {})).rejects.toMatchObject({ code: "REQUEST_FAILED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("repete leitura de corpo bem-sucedido interrompida por transporte", async () => {
    vi.useFakeTimers();
    const first = new Response("parcial");
    vi.spyOn(first, "text").mockRejectedValue(failure("UND_ERR_SOCKET"));
    const fetchMock = vi.fn().mockResolvedValueOnce(first).mockResolvedValue(new Response("completo"));
    vi.stubGlobal("fetch", fetchMock);
    const pending = new SameOriginClient().get(target, () => {});
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ html: "completo" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])("nao repete corpo de HTTP %s nem tenta login", async status => {
    const response = new Response("negado", { status });
    vi.spyOn(response, "text").mockRejectedValue(failure("ECONNRESET"));
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    await expect(new SameOriginClient().get(target, () => {})).rejects.toMatchObject({ code: "REQUEST_FAILED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  });

  it("nunca repete POST de login por falha permitida de transporte", async () => {
    const fetchMock = vi.fn().mockRejectedValue(failure("ECONNRESET"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new SameOriginClient().postLogin(target, new URLSearchParams(), () => {})).rejects.toMatchObject({ code: "REQUEST_FAILED_ECONNRESET" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("falha de rede esgotada na sessao nao solicita senha nem login", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(failure("ETIMEDOUT"));
    vi.stubGlobal("fetch", fetchMock);
    const passwordProvider = vi.fn();
    const session = new OperationalSession({ client: new SameOriginClient(), options: parseArgs([]), username: "mesma-conta", passwordProvider });
    const pending = session.get(target, () => {}).catch(error => error);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ code: "REQUEST_FAILED_ETIMEDOUT" });
    expect(passwordProvider).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.map(([url, init]) => [url.toString(), init.method])).toEqual(Array.from({ length: 3 }, () => [target.toString(), "GET"]));
  });
});

describe("sessao operacional com recuperacao limitada", () => {
  const interval = 5 * 60 * 1000;
  const dashboardHtml = '<html><title>Painel de controle</title><a href="/administrator/index.php?option=com_login&amp;task=logout">Sair</a></html>';
  const detailHtml = "<html><h1>Contrato de teste</h1></html>";
  const loginHtml = (action = "/administrator/index.php") => `<html><form method="post" action="${action}">
    <input name="username" value="usuario-do-formulario">
    <input type="password" name="passwd">
    <input type="hidden" name="option" value="com_login">
    <input type="hidden" name="task" value="login">
    <input type="hidden" name="0123456789abcdef0123456789abcdef" value="1">
  </form></html>`;
  const htmlResponse = (html: string, status = 200) => new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });

  function setup(respond: (url: URL, init: RequestInit) => Response | Promise<Response>) {
    const options = parseArgs(["--refresh", "--delay-ms=0"]);
    const target = canonicalOperationalDetailUrl("?option=com_widesys&task=locacao.edit&id=7", options.baseUrl, options.baseUrl, "contratos", "7") as URL;
    let clock = new Date("2026-10-10T14:00:00.000Z").getTime();
    const calls: Array<{ url: string; method: string; body: string | undefined }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      calls.push({ url: url.toString(), method: init.method ?? "GET", body: init.body?.toString() });
      return respond(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const passwordProvider = vi.fn().mockResolvedValue("senha-sintetica-sem-acesso-real");
    const session = new OperationalSession({ client: new SameOriginClient(), options, username: "mesma-conta-inicial", passwordProvider, now: () => clock });
    const guard = (url: URL, method: "GET" | "POST") => {
      expect(method).toBe("GET");
      assertEquivalentOperationalUrl(url, target);
    };
    return { session, target, guard, calls, fetchMock, passwordProvider, options, advance: (ms: number) => { clock += ms; } };
  }

  it("faz keepalive GET a cada cinco minutos sem solicitar senha nem fazer POST", async () => {
    const test = setup(url => htmlResponse(url.searchParams.has("admin") ? dashboardHtml : detailHtml));
    await test.session.get(test.target, test.guard);
    test.advance(interval - 1);
    await test.session.get(test.target, test.guard);
    test.advance(1);
    await test.session.get(test.target, test.guard);
    expect(test.calls.map(call => [call.method, call.url])).toEqual([
      ["GET", test.target.toString()],
      ["GET", test.target.toString()],
      ["GET", test.options.baseUrl.toString()],
      ["GET", test.target.toString()],
    ]);
    expect(test.passwordProvider).not.toHaveBeenCalled();
  });

  it.each([401, 403, 200])("confirma formulario real apos HTTP %s e repete o GET exato com a mesma conta", async status => {
    let operationalGets = 0;
    const test = setup((url, init) => {
      if (init.method === "POST") return htmlResponse(dashboardHtml);
      if (url.searchParams.has("admin")) return htmlResponse(loginHtml());
      operationalGets += 1;
      return operationalGets === 1 ? htmlResponse(status === 200 ? loginHtml() : "Acesso negado", status) : htmlResponse(detailHtml);
    });
    expect((await test.session.get(test.target, test.guard)).html).toBe(detailHtml);
    expect(test.calls.map(call => call.method)).toEqual(["GET", "GET", "POST", "GET"]);
    expect(test.calls.filter(call => call.url === test.target.toString())).toHaveLength(2);
    expect(test.calls[1].url).toBe(test.options.baseUrl.toString());
    const form = new URLSearchParams(test.calls[2].body);
    expect(form.get("username")).toBe("mesma-conta-inicial");
    expect(form.get("passwd")).toBe("senha-sintetica-sem-acesso-real");
    expect(form.get("option")).toBe("com_login");
    expect(form.get("task")).toBe("login");
    expect(form.get("0123456789abcdef0123456789abcdef")).toBe("1");
    expect(test.passwordProvider).toHaveBeenCalledTimes(1);
  });

  it("nao interpreta 403 como expiracao quando o landing continua autenticado", async () => {
    const test = setup(url => url.searchParams.has("admin") ? htmlResponse(dashboardHtml) : htmlResponse("Acesso negado", 403));
    await expect(test.session.get(test.target, test.guard)).rejects.toBeInstanceOf(OperationalCaptureError);
    expect(test.calls.map(call => call.method)).toEqual(["GET", "GET"]);
    expect(test.passwordProvider).not.toHaveBeenCalled();
  });

  it.each([
    '<html><div id="cf-chl-widget">Verificacao</div></html>',
    '<html><title>Forbidden</title><form>captcha</form></html>',
  ])("interrompe desafio WAF sem pedir credencial ou fazer POST: %s", async html => {
    const test = setup(() => htmlResponse(html));
    await expect(test.session.get(test.target, test.guard)).rejects.toBeInstanceOf(OperationalCaptureError);
    expect(test.calls.map(call => call.method)).toEqual(["GET"]);
    expect(test.passwordProvider).not.toHaveBeenCalled();
  });

  it("um replay ainda negado encerra sem outro login ou terceiro GET operacional", async () => {
    const test = setup((url, init) => {
      if (init.method === "POST") return htmlResponse(dashboardHtml);
      return url.searchParams.has("admin") ? htmlResponse(loginHtml()) : htmlResponse("Acesso negado", 403);
    });
    await expect(test.session.get(test.target, test.guard)).rejects.toBeInstanceOf(OperationalCaptureError);
    expect(test.calls.map(call => call.method)).toEqual(["GET", "GET", "POST", "GET"]);
    expect(test.passwordProvider).toHaveBeenCalledTimes(1);
  });

  it("HTTP 403 com desafio WAF explicito para antes de consultar landing", async () => {
    const test = setup(() => htmlResponse('<html><div id="cf-chl-widget">Verificacao</div></html>', 403));
    await expect(test.session.get(test.target, test.guard)).rejects.toMatchObject({ code: "ACCESS_CHALLENGE" });
    expect(test.calls.map(call => call.method)).toEqual(["GET"]);
    expect(test.passwordProvider).not.toHaveBeenCalled();
  });

  it("bloqueia uma segunda reautenticacao imediata mesmo diante de formulario real", async () => {
    let expired = true;
    const test = setup((url, init) => {
      if (init.method === "POST") { expired = false; return htmlResponse(dashboardHtml); }
      if (url.searchParams.has("admin")) return htmlResponse(expired ? loginHtml() : dashboardHtml);
      return expired ? htmlResponse("Acesso negado", 401) : htmlResponse(detailHtml);
    });
    await test.session.get(test.target, test.guard);
    expired = true;
    await expect(test.session.get(test.target, test.guard)).rejects.toBeInstanceOf(OperationalCaptureError);
    expect(test.calls.filter(call => call.method === "POST")).toHaveLength(1);
    expect(test.passwordProvider).toHaveBeenCalledTimes(1);
    expect(test.calls.filter(call => call.url === test.target.toString())).toHaveLength(3);
  });

  it("permite nova expiracao legitima depois do intervalo mantendo a conta inicial", async () => {
    let expired = true;
    const test = setup((url, init) => {
      if (init.method === "POST") { expired = false; return htmlResponse(dashboardHtml); }
      if (url.searchParams.has("admin")) return htmlResponse(expired ? loginHtml() : dashboardHtml);
      return expired ? htmlResponse("Acesso negado", 401) : htmlResponse(detailHtml);
    });
    await test.session.get(test.target, test.guard);
    expired = true;
    test.advance(interval);
    expect((await test.session.get(test.target, test.guard)).html).toBe(detailHtml);
    const posts = test.calls.filter(call => call.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts.map(call => new URLSearchParams(call.body).get("username"))).toEqual(["mesma-conta-inicial", "mesma-conta-inicial"]);
    expect(test.passwordProvider).toHaveBeenCalledTimes(2);
  });

  it("redirect externo permanece bloqueado sem consulta de landing ou credencial", async () => {
    const test = setup(() => new Response(null, { status: 302, headers: { location: "https://externo.example/administrator/index.php?option=com_login&view=login" } }));
    await expect(test.session.get(test.target, test.guard)).rejects.toMatchObject({ code: "REDIRECT_BLOCKED" });
    expect(test.calls.map(call => call.method)).toEqual(["GET"]);
    expect(test.passwordProvider).not.toHaveBeenCalled();
  });

  it("redirect legitimo de login consulta o landing fixo sem seguir Location operacional", async () => {
    let operationalGets = 0;
    const test = setup((url, init) => {
      if (init.method === "POST") return htmlResponse(dashboardHtml);
      if (url.searchParams.has("admin")) return htmlResponse(loginHtml());
      operationalGets += 1;
      return operationalGets === 1
        ? new Response(null, { status: 302, headers: { location: "/administrator/index.php?option=com_login&view=login" } })
        : htmlResponse(detailHtml);
    });
    expect((await test.session.get(test.target, test.guard)).html).toBe(detailHtml);
    expect(test.calls.map(call => call.method)).toEqual(["GET", "GET", "POST", "GET"]);
    expect(test.calls[1].url).toBe(test.options.baseUrl.toString());
    expect(test.calls.every(call => !call.url.includes("view=login"))).toBe(true);
  });

  it.each([
    '<html><form method="post"><input name="username"><input type="password" name="passwd"></form></html>',
    loginHtml("https://externo.example/roubar"),
    loginHtml("/administrator/index.php?option=com_widesys&task=save"),
  ])("nao envia senha quando o landing tem formulario falso ou action nao autorizada: %s", async html => {
    const test = setup(url => url.searchParams.has("admin") ? htmlResponse(html) : htmlResponse("Acesso negado", 403));
    await expect(test.session.get(test.target, test.guard)).rejects.toBeInstanceOf(OperationalCaptureError);
    expect(test.calls.map(call => call.method)).toEqual(["GET", "GET"]);
    expect(test.passwordProvider).not.toHaveBeenCalled();
  });

  it("mantem timeout de 30s durante a leitura do corpo HTTP", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      const response = htmlResponse("corpo ainda nao recebido");
      vi.spyOn(response, "text").mockImplementation(() => new Promise<string>((_resolve, reject) => {
        const abort = () => reject(new DOMException("Requisicao abortada", "AbortError"));
        if (init.signal?.aborted) abort();
        else init.signal?.addEventListener("abort", abort, { once: true });
      }));
      return response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new SameOriginClient();
    const assertion = expect(client.get(parseArgs([]).baseUrl, () => {})).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("captura operacional Widesys", () => {
  it("exige que a contagem global independente feche com as janelas", () => {
    expect(verifyGlobalOperationalTotal(1_153, 1_153)).toBe(true);
    expect(verifyGlobalOperationalTotal(1_152, 1_153)).toBe(false);
    expect(verifyGlobalOperationalTotal(0, null)).toBe(false);
  });

  it("divide escopos grandes em partes limitadas e representa escopo vazio", () => {
    expect(shardScopeRecords([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(shardScopeRecords([], 2)).toEqual([[]]);
    expect(() => shardScopeRecords([1], 0)).toThrow(/shard/i);
  });

  it("assina checkpoints incrementais e detecta artefato adulterado antes do resume", () => {
    const unsigned = {
      artifacts: [
        {
          bytes: 18,
          kind: "detail-html",
          module: "contas-receber",
          path: "contas-receber/records/77-a1b2c3d4e5.html",
          sha256: "a".repeat(64),
          sourceUrl: "https://brisaazul.app2.widesys.com.br/administrator/index.php?id=77",
          window: "2026-09",
        },
        {
          bytes: 42,
          kind: "detail-json",
          module: "contas-receber",
          path: "contas-receber/records/77.json",
          sha256: "b".repeat(64),
          sourceUrl: "https://brisaazul.app2.widesys.com.br/administrator/index.php?id=77",
          window: "2026-09",
        },
      ],
      captureId: "2026-09-16T14-30-00-000Z",
      evidence: {
        legacyId: "77",
        rowContentHash: "c".repeat(64),
        sourceWindow: "2026-09",
        targets: [
          {
            sourceUrl: "https://brisaazul.app2.widesys.com.br/administrator/index.php?id=77",
            transport: "ajax.getParcelaInfo",
          },
        ],
      },
      legacyId: "77",
      module: "contas-receber",
      version: 1,
    };
    const checkpoint = { ...unsigned, contentHash: operationalRecordCheckpointHash(unsigned) };

    expect(operationalRecordCheckpointIsValid(checkpoint)).toBe(true);
    expect(
      operationalRecordCheckpointIsValid({
        ...checkpoint,
        captureId: "2026-09-16T15-00-00-000Z",
      }),
    ).toBe(false);
    expect(
      operationalRecordCheckpointIsValid({
        ...checkpoint,
        artifacts: checkpoint.artifacts.map((artifact, index) =>
          index === 0 ? { ...artifact, bytes: artifact.bytes + 1 } : artifact,
        ),
      }),
    ).toBe(false);
  });

  it("consolida checkpoints no manifesto sem manter artefatos antigos nem apagar listagens", () => {
    type ArtifactFixture = Parameters<typeof mergeOperationalCheckpointArtifacts>[0][number];
    const fixture = (path: string, module: ArtifactFixture["module"], kind: ArtifactFixture["kind"]): ArtifactFixture => ({
      bytes: 1,
      kind,
      module,
      path,
      sha256: "d".repeat(64),
      sourceUrl: "https://brisaazul.app2.widesys.com.br/administrator/index.php",
      window: kind.startsWith("list") ? "2026-09" : "scope",
    });
    const generated = [
      fixture("contas-receber/records/77.json", "contas-receber", "detail-json"),
      fixture("scopes/contas_receber-part-00001.json", "contas-receber", "detail-json"),
    ];
    const merged = mergeOperationalCheckpointArtifacts(
      [
        fixture("contas-receber/windows/2026-09/page-00001.json", "contas-receber", "list-json"),
        fixture("contas-receber/records/antigo.json", "contas-receber", "detail-json"),
        fixture("scopes/contas_receber-part-00009.json", "contas-receber", "detail-json"),
        fixture("contratos/records/1.json", "contratos", "detail-json"),
      ],
      "contas-receber",
      "contas_receber",
      generated,
    );

    expect(merged.map((artifact) => artifact.path)).toEqual([
      "contas-receber/windows/2026-09/page-00001.json",
      "contratos/records/1.json",
      "contas-receber/records/77.json",
      "scopes/contas_receber-part-00001.json",
    ]);
    expect(() =>
      mergeOperationalCheckpointArtifacts(merged, "contas-receber", "contas_receber", [
        fixture("contratos/records/1.json", "contas-receber", "detail-json"),
      ]),
    ).toThrow(/duplicado/i);
  });

  it("restringe URL inicial e redirects de login ao index/dashboard conhecidos", () => {
    expect(() =>
      parseArgs([
        "--dry-run",
        "--base-url=https://brisaazul.app2.widesys.com.br/administrator/qualquer.php?admin",
      ]),
    ).toThrow(/index\.php/i);
    expect(() =>
      parseArgs([
        "--dry-run",
        "--base-url=https://brisaazul.app2.widesys.com.br/administrator/index.php?option=com_widesys&view=locacao",
      ]),
    ).toThrow(/parâmetro/i);
    const base = new URL(
      "https://brisaazul.app2.widesys.com.br/administrator/index.php?admin",
    );
    expect(() =>
      assertLoginRoute(
        new URL(
          "https://brisaazul.app2.widesys.com.br/administrator/index.php?option=com_widesys&view=locacao",
        ),
        base,
        "GET",
      ),
    ).toThrow(/view/i);
    expect(() =>
      assertLoginRoute(
        new URL("https://brisaazul.app2.widesys.com.br/administrator/index.php?admin"),
        base,
        "GET",
      ),
    ).not.toThrow();
  });

  it("rejeita parâmetros duplicados em login, lista, detalhe e AJAX", () => {
    const base = new URL("https://legado.example/administrator/index.php?admin");
    const login = new URL(
      "https://legado.example/administrator/index.php?option=com_login&option=com_widesys&task=login",
    );
    expect(() => assertLoginRoute(login, base, "POST")).toThrow(/duplicado/i);

    const list = buildListUrl(
      base,
      "contas-receber",
      { end: "30-09-2026", key: "2026-09", start: "01-09-2026" },
      0,
    );
    list.searchParams.append("limit", "1");
    expect(() => assertListUrl(list, base, "contas-receber")).toThrow(/duplicado/i);

    const detail = new URL(
      "https://legado.example/administrator/index.php?option=com_widesys&view=locacao&layout=edit&id=63&id=999",
    );
    expect(() => assertCanonicalOperationalDetailUrl(detail, base, "contratos", "63")).toThrow(
      /duplicado/i,
    );

    const ajax = new URL(
      "https://legado.example/administrator/index.php?option=com_widesys&view=ajax&format=raw&task=ajax.getParcelaInfo&task=ajax.getDetalhesRecebimento&parcela_id=321",
    );
    expect(() =>
      assertParcelaInfoUrl(ajax, base, "contas-receber", "321", {
        contaReceberId: "88",
        numeroParcela: "2",
        parcelaId: "321",
      }),
    ).toThrow(/duplicado/i);
  });

  it("aceita query reordenada, mas rejeita qualquer alteração na URL operacional solicitada", () => {
    const base = new URL("https://legado.example/administrator/index.php?admin");
    const expected = buildListUrl(
      base,
      "contas-receber",
      { end: "30-09-2026", key: "2026-09", start: "01-09-2026" },
      200,
    );
    const reordered = new URL(expected.origin + expected.pathname);
    for (const [key, value] of [...expected.searchParams.entries()].reverse()) {
      reordered.searchParams.append(key, value);
    }
    expect(() => assertEquivalentOperationalUrl(reordered, expected)).not.toThrow();

    for (const [key, value] of [
      ["limitstart", "999999"],
      ["filter[planoparcelas.situacao]", "PENDENTE"],
      ["filter[planoparcelas.data_vencimento_startreport]", "30-09-2026"],
      ["filter[planoparcelas.data_vencimento_endreport]", "01-09-2026"],
    ] as const) {
      const changed = new URL(expected);
      changed.searchParams.set(key, value);
      expect(() => assertEquivalentOperationalUrl(changed, expected)).toThrow(/alterou/i);
    }
    const extra = new URL(expected);
    extra.searchParams.set("return", "segredo");
    expect(() => assertEquivalentOperationalUrl(extra, expected)).toThrow(/alterou/i);
  });

  it("não aceita listagem sem total verificável e não persiste candidatos crus", () => {
    expect(() => requireReportedTotal(null)).toThrow(/contagem total/i);
    expect(requireReportedTotal(0)).toBe(0);
    const rows = extractLegacyListRows(`
      <table><tr><td><input name="cid[]" value="7"></td>
      <td data-querystring="view=ajax&amp;token=SEGREDO&amp;parcela_id=7">Registro</td></tr></table>`);
    const persisted = JSON.stringify(persistableListRows(rows));
    expect(persisted).not.toContain("SEGREDO");
    expect(persisted).not.toContain("navigationCandidates");
    expect(persisted).not.toContain("parcelaInfoCandidates");
  });

  it("aceita zero apenas quando a própria grade operacional prova que está vazia", () => {
    const gradeVazia = `
      <form><select id="list_limit"><option value="200" selected>200</option></select>
      <table><thead><tr><th>Documento</th></tr></thead><tbody></tbody></table></form>`;
    expect(verifiedOperationalTotal(gradeVazia, [])).toBe(0);
    expect(() => verifiedOperationalTotal("<html><body>Dashboard</body></html>", [])).toThrow(
      /contagem total/i,
    );
  });

  it("permite resume apenas para uma captura realmente interrompida", () => {
    const now = new Date("2026-09-16T15:00:00.000Z");
    expect(
      operationalManifestIsResumable(
        {
          businessDate: "2026-09-16",
          capturedAt: null,
          complete: false,
          completedAt: null,
          startedAt: "2026-09-16T14:00:00.000Z",
        },
        now,
      ),
    ).toBe(true);
    expect(
      operationalManifestIsResumable(
        {
          businessDate: "2026-09-16",
          capturedAt: "2026-09-16T12:00:00.000Z",
          complete: true,
          completedAt: "2026-09-16T12:00:00.000Z",
          startedAt: "2026-09-16T11:00:00.000Z",
        },
        now,
      ),
    ).toBe(false);
    expect(
      operationalManifestIsResumable(
        {
          businessDate: "2026-09-16",
          capturedAt: null,
          complete: false,
          completedAt: "2026-09-16T12:00:00.000Z",
          startedAt: "2026-09-16T11:00:00.000Z",
        },
        now,
      ),
    ).toBe(false);
    expect(
      operationalManifestIsResumable(
        {
          businessDate: "2026-09-15",
          capturedAt: null,
          complete: false,
          completedAt: null,
          startedAt: "2026-09-15T14:00:00.000Z",
        },
        now,
      ),
    ).toBe(false);
  });

  it("nao persiste URL, credenciais, tokens, cookies ou certificados em erros", () => {
    const safe = sanitizeManifestErrorMessage(
      new Error(
        "Falha GET https://usuario_demo:senha_demo@legado.example/rota?client_secret=SUPERSECRET " +
          "Authorization: Bearer TOKEN_BRUTO\nCookie: session=COOKIE_BRUTO " +
          "senha=MINHA_SENHA certificado=C:/segredos/cliente.pfx " +
          "detalhe /administrator/index.php?token=OUTRO_TOKEN " +
          "config {&quot;client_secret&quot;:&quot;JSON_SECRET&quot;}",
      ),
    );

    for (const secret of [
      "https://",
      "usuario_demo",
      "senha_demo",
      "SUPERSECRET",
      "TOKEN_BRUTO",
      "COOKIE_BRUTO",
      "MINHA_SENHA",
      "cliente.pfx",
      "/administrator/",
      "OUTRO_TOKEN",
      "JSON_SECRET",
    ]) {
      expect(safe).not.toContain(secret);
    }
    expect(safe).toContain("[URL REDACTED]");
    expect(safe).toContain("[REDACTED]");
  });

  it("remove access e refresh tokens da URL publica do manifesto", () => {
    expect(
      publicUrl(
        new URL(
          "https://usuario_demo:senha_demo@legado.example/administrator/index.php?option=com_widesys&access_token=ACCESSLEAK&refresh_token=REFRESHLEAK&id=7#privado",
        ),
      ),
    ).toBe("https://legado.example/administrator/index.php?option=com_widesys&id=7");
  });

  it("usa a data civil de São Paulo mesmo quando o processo roda em UTC", () => {
    expect(businessDateIso(new Date("2026-09-17T00:59:00.000Z"))).toBe("2026-09-16");
    expect(businessDateIso(new Date("2026-09-17T03:01:00.000Z"))).toBe("2026-09-17");
    expect(businessDateIso(new Date("2026-10-01T00:01:00.000Z"))).toBe("2026-09-30");
  });

  it("aceita a última página exatamente no limite e bloqueia somente continuação excedente", () => {
    expect(nextOperationalPageOffset(0, 51, 51, 1, 1)).toBeNull();
    expect(nextOperationalPageOffset(0, null, 51, 1, 1)).toBeNull();
    expect(() => nextOperationalPageOffset(0, 201, 200, 1, 1)).toThrow(/max-pages/i);
    expect(nextOperationalPageOffset(0, 201, 200, 1, 2)).toBe(200);
  });

  it("força todos os status financeiros usando o nome real do filtro Joomla", () => {
    const url = buildListUrl(
      new URL("https://legado.example/administrator/index.php?admin"),
      "contas-receber",
      { end: "30-09-2026", key: "2026-09", start: "01-09-2026" },
      0,
    );

    expect(url.searchParams.has("filter[planoparcelas.situacao]")).toBe(true);
    expect(url.searchParams.get("filter[planoparcelas.situacao]")).toBe("");
    expect(url.searchParams.has("situacao")).toBe(false);
    expect(url.searchParams.get("limit")).toBe("200");
    expect(url.searchParams.get("limitstart")).toBe("0");
    expect(url.searchParams.has("list[limit]")).toBe(false);
    expect(() =>
      assertListUrl(
        url,
        new URL("https://legado.example/administrator/index.php?admin"),
        "contas-receber",
      ),
    ).not.toThrow();
    const unsupportedJoomlaLimit = new URL(url);
    unsupportedJoomlaLimit.searchParams.set("list[limit]", "200");
    expect(() =>
      assertListUrl(
        unsupportedJoomlaLimit,
        new URL("https://legado.example/administrator/index.php?admin"),
        "contas-receber",
      ),
    ).toThrow(/não autorizado/i);
    expect(url.searchParams.get("filter[planoparcelas.data_vencimento_startreport]")).toBe(
      "01-09-2026",
    );
    expect(url.searchParams.get("filter[planoparcelas.data_vencimento_endreport]")).toBe(
      "30-09-2026",
    );
    expect(url.searchParams.has("planoparcelas.data_vencimento_startreport")).toBe(false);
  });

  it("zera explicitamente a paginação ao trocar de janela mensal", () => {
    const base = new URL("https://legado.example/administrator/index.php?admin");
    const julho = { end: "31-07-2026", key: "2026-07", start: "01-07-2026" };
    const agosto = { end: "31-08-2026", key: "2026-08", start: "01-08-2026" };

    expect(buildListUrl(base, "movimentacoes", julho, 200).searchParams.get("limitstart")).toBe("200");
    expect(buildListUrl(base, "movimentacoes", agosto, 0).searchParams.get("limitstart")).toBe("0");

    const semReset = buildListUrl(base, "movimentacoes", agosto, 0);
    semReset.searchParams.delete("limitstart");
    expect(() => assertListUrl(semReset, base, "movimentacoes")).toThrow(/offset/i);
  });

  it("preserva o ID, colunas e todos os endpoints auxiliares da parcela", () => {
    const html = `
      <table><tbody><tr>
        <td><input name="cid[]" value="321"></td>
        <td><input type="hidden" name="parcela_id" value="321"></td>
        <td><input type="hidden" name="conta_receber_id" value="88"></td>
        <td><input type="hidden" name="numero_parcela" value="2"></td>
        <td>* pgto parcial</td><td>715,68</td><td>650,00</td>
        <td><span data-tipped="index.php?option=com_widesys"
          data-querystring="view=ajax&amp;format=raw&amp;task=ajax.getParcelaInfo&amp;parcela_id=321"></span></td>
        <td><span data-tipped="index.php?option=com_widesys"
          data-querystring="view=ajax&amp;format=raw&amp;task=ajax.getDetalhesRecebimento&amp;conta_receber_id=88&amp;numero_parcela=2"></span></td>
      </tr></tbody></table>`;

    const rows = extractLegacyListRows(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      legacyId: "321",
      parcelaIdentity: {
        contaReceberId: "88",
        numeroParcela: "2",
        parcelaId: "321",
      },
      parcelaInfoCandidates: [
        expect.objectContaining({ query: expect.stringContaining("ajax.getParcelaInfo") }),
        expect.objectContaining({ query: expect.stringContaining("ajax.getDetalhesRecebimento") }),
      ],
    });
    expect(rows[0].cells).toContain("* pgto parcial");
    expect(rows[0].cells).toContain("715,68");
    expect(rows[0].cells).toContain("650,00");
    expect(rows[0].contentHash).toMatch(/^[a-f\d]{64}$/);
    expect(
      parcelaInfoUrlsForRow(
        rows[0],
        new URL("https://legado.example/administrator/index.php?option=com_widesys&view=financontasrecebers"),
        new URL("https://legado.example/administrator/index.php?admin"),
        "contas-receber",
      ).map((target) => target.transport),
    ).toEqual(["ajax.getParcelaInfo", "ajax.getDetalhesRecebimento"]);
  });

  it("rejeita endpoint auxiliar cuja conta ou parcela não pertence à linha", () => {
    const html = (accountId: string, number: string, duplicateHidden = false) => `
      <table><tbody><tr>
        <td><input name="cid[]" value="321"></td>
        <td><input type="hidden" name="parcela_id" value="321"></td>
        <td><input type="hidden" name="conta_receber_id" value="88"></td>
        ${duplicateHidden ? '<td><input type="hidden" name="conta_receber_id" value="89"></td>' : ""}
        <td><input type="hidden" name="numero_parcela" value="2"></td>
        <td><span data-tipped="index.php?option=com_widesys"
          data-querystring="view=ajax&amp;format=raw&amp;task=ajax.getParcelaInfo&amp;parcela_id=321"></span></td>
        <td><span data-tipped="index.php?option=com_widesys"
          data-querystring="view=ajax&amp;format=raw&amp;task=ajax.getDetalhesRecebimento&amp;conta_receber_id=${accountId}&amp;numero_parcela=${number}"></span></td>
      </tr></tbody></table>`;
    const current = new URL(
      "https://legado.example/administrator/index.php?option=com_widesys&view=financontasrecebers",
    );
    const base = new URL("https://legado.example/administrator/index.php?admin");

    expect(() => parcelaInfoUrlsForRow(extractLegacyListRows(html("89", "2"))[0], current, base, "contas-receber"))
      .toThrow(/conta_receber_id/i);
    expect(() => parcelaInfoUrlsForRow(extractLegacyListRows(html("88", "3"))[0], current, base, "contas-receber"))
      .toThrow(/numero_parcela/i);
    expect(() => parcelaInfoUrlsForRow(extractLegacyListRows(html("88", "2", true))[0], current, base, "contas-receber"))
      .toThrow(/identidade canônica/i);

    const pagar = new URL(
      "https://legado.example/administrator/index.php?option=com_widesys&view=ajax&format=raw&task=ajax.getDetalhesPagamento&conta_pagar_id=227&numero_parcela=1",
    );
    expect(() =>
      assertParcelaInfoUrl(pagar, base, "contas-pagar", "3983", {
        contaPagarId: "227",
        numeroParcela: "1",
        parcelaId: "3983",
      }),
    ).not.toThrow();
    pagar.searchParams.set("conta_pagar_id", "228");
    expect(() =>
      assertParcelaInfoUrl(pagar, base, "contas-pagar", "3983", {
        contaPagarId: "227",
        numeroParcela: "1",
        parcelaId: "3983",
      }),
    ).toThrow(/conta_pagar_id/i);
  });

  it("preserva referências tipadas allowlisted das linhas de AR e AP", () => {
    const current = new URL(
      "https://legado.example/administrator/index.php?option=com_widesys&view=financontasrecebers",
    );
    const base = new URL("https://legado.example/administrator/index.php?admin");
    const [receber] = extractLegacyListRows(`
      <table><tr>
        <td><input name="cid[]" value="321"></td>
        <td><a href="index.php?option=com_widesys&amp;view=locacao&amp;task=locacao.edit&amp;id=63">Locação</a></td>
        <td><a href="index.php?option=com_widesys&amp;task=inquilino.edit&amp;id=302&amp;jatoggler_noupd=1">Inquilino</a></td>
        <td><a href="index.php?option=com_widesys&amp;task=outro.edit&amp;id=901">Outro</a></td>
        <td><a href="index.php?option=com_widesys&amp;task=inquilino.edit&amp;id=303&amp;jatoggler_noupd=0">Toggler inválido</a></td>
        <td><a href="index.php?option=com_widesys&amp;view=locacao&amp;task=locacao.edit&amp;id=64&amp;jatoggler_noupd=1">Toggler em locação</a></td>
        <td><a href="index.php?option=com_widesys&amp;task=financontasreceber.edit&amp;id=321">Título</a></td>
        <td><a href="index.php?option=com_widesys&amp;view=financontaspagars&amp;id=77">Cross-view</a></td>
        <td><a href="https://evil.example/administrator/index.php?option=com_widesys&amp;task=inquilino.edit&amp;id=666">Externo</a></td>
        <td><a href="index.php?option=com_widesys&amp;task=usuario.edit&amp;id=5">Não permitido</a></td>
      </tr></table>
    `);
    receber.references = operationalReferencesForRow(receber, current, base, "contas-receber");

    expect(receber.references).toEqual([
      { entidade: "CONTRATO", legadoId: "63", papelOrigem: "LOCACAO" },
      { entidade: "PESSOA", legadoId: "302", papelOrigem: "INQUILINO" },
      { entidade: "PESSOA", legadoId: "901", papelOrigem: "OUTRO" },
    ]);
    const persistida = JSON.stringify(persistableListRows([receber]));
    expect(persistida).toContain('"references"');
    expect(persistida).not.toContain("evil.example");
    expect(persistida).not.toContain("navigationCandidates");

    const [pagar] = extractLegacyListRows(`
      <table><tr>
        <td><input name="cid[]" value="88"></td>
        <td><a href="index.php?option=com_widesys&amp;task=proprietario.edit&amp;id=169&amp;jatoggler_noupd=1">Proprietário</a></td>
        <td><a href="index.php?option=com_widesys&amp;task=outro.edit&amp;id=777">Outro</a></td>
        <td><a href="index.php?option=com_widesys&amp;task=inquilino.edit&amp;id=302&amp;return=segredo">Parâmetro extra</a></td>
      </tr></table>
    `);
    expect(operationalReferencesForRow(pagar, current, base, "contas-pagar")).toEqual([
      { entidade: "PESSOA", legadoId: "169", papelOrigem: "PROPRIETARIO" },
      { entidade: "PESSOA", legadoId: "777", papelOrigem: "OUTRO" },
    ]);
  });

  it("normaliza forma, lançamento, responsável e timestamp de cada baixa", () => {
    const details = [
      {
        contentHash: "hash",
        sourceUrl: "https://legado.example/administrator/index.php?option=com_widesys&view=ajax",
        transport: "ajax.getDetalhesRecebimento",
        raw: {
          fields: [],
          tables: [
            {
              headers: [
                "Valor",
                "Data Pagamento",
                "Tipo Recebimento",
                "N° do Cheque / Cartão",
                "Conta/Pix",
                "Nº Lanç.",
              ],
              rows: [
                [
                  "R$ 913,60",
                  "08-01-2026",
                  "Cobrança Bancária",
                  "-",
                  "Paolla [BRISA AZUL]",
                  "447 Criado por: Paolla [Baixa Manual] 05-02-2026 10:44:33",
                ],
              ],
            },
          ],
          text: "",
          title: "",
        },
      },
    ] as Parameters<typeof paymentRows>[0];

    expect(paymentRows(details)).toEqual([
      expect.objectContaining({
        conta_rotulo: "Paolla [BRISA AZUL]",
        dataPagamento: "08-01-2026",
        documento: "-",
        forma: "Cobrança Bancária",
        numeroLancamento: "447",
        responsavel: "Paolla",
        status: "Baixa Manual",
        timestamp: "05-02-2026 10:44:33",
        valor: "R$ 913,60",
      }),
    ]);
  });

  it("ignora tabelas auxiliares e linhas de cabeçalho nos detalhes da baixa", () => {
    const details = [
      {
        contentHash: "hash",
        sourceUrl: "https://legado.example/administrator/index.php?option=com_widesys&view=ajax",
        transport: "ajax.getDetalhesPagamento",
        raw: {
          fields: [],
          tables: [
            { headers: ["Data", "Valor"], rows: [["08-01-2026", "913,60"]] },
            {
              headers: ["Valor", "Data Pagamento", "Nº Lanç."],
              rows: [
                ["Valor", "Data Pagamento", "Nº Lanç."],
                ["", "", ""],
                ["913,60", "08-01-2026", "447"],
              ],
            },
          ],
          text: "",
          title: "",
        },
      },
    ] as Parameters<typeof paymentRows>[0];

    expect(paymentRows(details)).toEqual([
      expect.objectContaining({ dataPagamento: "08-01-2026", numeroLancamento: "447", valor: "913,60" }),
    ]);
  });

  it("separa pessoa e vínculo em linhas jform aninhadas sem criar partes fantasmas", () => {
    const raw = extractRecord(`
      <form>
        <input name="jform[id]" type="hidden" value="63">
        <input name="jform[locacaoinquilinos][locacaoinquilinos3][id]" type="hidden" value="701">
        <select name="jform[locacaoinquilinos][locacaoinquilinos3][inquilino_id]">
          <option value="302" selected>Inquilino</option>
        </select>
        <input name="jform[locacaoinquilinos][locacaoinquilinos3][principal]" type="hidden" value="0">
        <input name="jform[locacaoinquilinos][locacaoinquilinos3][principal]" type="checkbox" value="1" checked>

        <input name="jform[locacaoproprietarios][locacaoproprietarios0][id]" type="hidden" value="50">
        <select name="jform[locacaoproprietarios][locacaoproprietarios0][proprietario_id]">
          <option value="169" selected>Proprietário</option>
        </select>
        <input name="jform[locacaoproprietarios][locacaoproprietarios0][percentual]" value="75,5">
        <input name="jform[locacaoproprietarios][locacaoproprietarios0][ordem]" value="7">
        <input name="jform[locacaoproprietarios][locacaoproprietarios0][responsavel_repasse]" type="hidden" value="0">
        <input name="jform[locacaoproprietarios][locacaoproprietarios0][responsavel_repasse]" type="checkbox" value="1">

        <!-- Um vínculo sem campo semântico de pessoa não pode virar participante. -->
        <input name="jform[locacaofiadores][locacaofiadores0][id]" type="hidden" value="88">
      </form>
    `);
    const details = [
      {
        contentHash: "hash",
        sourceUrl: "https://legado.example/administrator/index.php?option=com_widesys&view=locacao&id=63",
        transport: "locacao.edit",
        raw,
      },
    ] as Parameters<typeof contractParties>[0];

    expect(contractParties(details)).toEqual([
      {
        flags: { principal: "1" },
        ordem: 3,
        papel: "INQUILINO",
        pessoaLegadoId: "302",
        vinculoId: "701",
      },
      {
        flags: { responsavel_repasse: "0" },
        ordem: 7,
        papel: "PROPRIETARIO",
        percentual: "75,5",
        pessoaLegadoId: "169",
        vinculoId: "50",
      },
    ]);
    expect(contractParties(details).some((part) => part.pessoaLegadoId === "50")).toBe(false);
    expect(contractParties(details).some((part) => part.pessoaLegadoId === "88")).toBe(false);
    expect(contractParties(details).some((part) => part.pessoaLegadoId === "63")).toBe(false);
  });

  it("ignora opções radio não selecionadas ao extrair participantes", () => {
    const details = [
      {
        contentHash: "hash",
        sourceUrl: "https://legado.example/administrator/index.php",
        transport: "locacao.edit",
        raw: {
          fields: [
            {
              checked: false,
              name: "jform[locacaoproprietarios][locacaoproprietarios0][proprietario_id]",
              type: "radio",
              value: "169",
            },
            {
              checked: true,
              name: "jform[locacaoproprietarios][locacaoproprietarios0][proprietario_id]",
              type: "radio",
              value: "302",
            },
          ],
          tables: [],
          text: "",
          title: "",
        },
      },
    ] as Parameters<typeof contractParties>[0];

    expect(contractParties(details)).toEqual([
      expect.objectContaining({ papel: "PROPRIETARIO", pessoaLegadoId: "302" }),
    ]);
  });

  it("descobre detalhe de contrato guardado em onclick", () => {
    const html = `
      <tr onclick="window.location.href='index.php?option=com_widesys&amp;view=locacao&amp;task=locacao.edit&amp;id=63'">
        <td><input name="cid[]" value="63"></td><td>51.302.2</td>
      </tr>`;

    expect(extractLegacyListRows(html)[0].navigationCandidates).toContain(
      "index.php?option=com_widesys&view=locacao&task=locacao.edit&id=63",
    );

    const canonical = canonicalOperationalDetailUrl(
      extractLegacyListRows(html)[0].navigationCandidates[0],
      new URL("https://legado.example/administrator/index.php?option=com_widesys&view=locacaos"),
      new URL("https://legado.example/administrator/index.php?admin"),
      "contratos",
      "63",
    );
    expect(canonical?.searchParams.get("view")).toBe("locacao");
    expect(canonical?.searchParams.get("layout")).toBe("edit");
    expect(canonical?.searchParams.get("id")).toBe("63");
    expect(canonical?.searchParams.has("task")).toBe(false);
    expect(() =>
      assertCanonicalOperationalDetailUrl(
        canonical as URL,
        new URL("https://legado.example/administrator/index.php?admin"),
        "contratos",
        "63",
      ),
    ).not.toThrow();
    expect(() =>
      assertCanonicalOperationalDetailUrl(
        new URL("https://legado.example/administrator/index.php?option=com_widesys&task=locacao.edit&id=63"),
        new URL("https://legado.example/administrator/index.php?admin"),
        "contratos",
        "63",
      ),
    ).toThrow(/task|checkout|lock/i);
    const redirectedWithExtra = new URL(canonical as URL);
    redirectedWithExtra.searchParams.set("return", "token");
    expect(() =>
      assertCanonicalOperationalDetailUrl(
        redirectedWithExtra,
        new URL("https://legado.example/administrator/index.php?admin"),
        "contratos",
        "63",
      ),
    ).toThrow(/parâmetro/i);
    const outroPath = new URL(canonical as URL);
    outroPath.pathname = "/administrator/endpoint-mutavel";
    expect(() =>
      assertCanonicalOperationalDetailUrl(
        outroPath,
        new URL("https://legado.example/administrator/index.php?admin"),
        "contratos",
        "63",
      ),
    ).toThrow(/path|index administrativo/i);
  });

  it("preserva select e resolve checkbox contra o hidden fallback do Joomla", () => {
    const raw = extractRecord(`
      <input type="hidden" name="jform[conciliado]" value="0">
      <input type="checkbox" name="jform[conciliado]" value="1" checked>
      <input type="hidden" name="jform[ativo]" value="0">
      <input type="checkbox" name="jform[ativo]" value="1">
      <label for="situacao">Situação</label>
      <select id="situacao" name="jform[situacao]">
        <option value="1">Pendente</option><option value="2" selected>Pago</option>
      </select>`);
    const details = [
      {
        contentHash: "hash",
        raw,
        sourceUrl: "https://legado.example/administrator/index.php?option=com_widesys&view=ajax",
        transport: "fixture",
      },
    ] as Parameters<typeof flattenedFields>[1];
    const row = {
      cells: [],
      contentHash: "hash",
      headers: [],
      legacyId: "1",
      navigationCandidates: [],
      parcelaInfoCandidates: [],
    };

    const fields = flattenedFields(row, details);
    expect(fields["jform[situacao]"]).toBe("2");
    expect(fields["jform[situacao]_rotulo"]).toBe("Pago");
    expect(JSON.stringify(fields)).not.toContain("Situação");
    expect(fields["jform[conciliado]"]).toBe("1");
    expect(fields["jform[ativo]"]).toBe("0");
  });

  it("não trata baixas vazias como prova sem o transporte de detalhes", () => {
    const row = {
      cells: ["Pendente", "R$ 100,00"],
      contentHash: "hash",
      headers: ["Situação", "Valor devido"],
      legacyId: "77",
      navigationCandidates: [],
      parcelaInfoCandidates: [],
    };
    const details = [
      {
        contentHash: "hash-detail",
        raw: { fields: [], tables: [], text: "Pendente", title: "" },
        sourceUrl: "https://legado.example/administrator/index.php?option=com_widesys&view=ajax",
        transport: "ajax.getParcelaInfo",
      },
    ] as Parameters<typeof buildCapturedRecord>[4];

    expect(buildCapturedRecord("contas-receber", "77", row, "2026-09", details)).toMatchObject({
      baixas: [],
      baixaEvidence: {
        expectedTransport: "ajax.getDetalhesRecebimento",
        transportObserved: false,
      },
    });
  });

  it("registra a presença do transporte que enumera as baixas", () => {
    const row = {
      cells: ["Pago", "R$ 100,00"],
      contentHash: "hash",
      headers: ["Situação", "Valor pago"],
      legacyId: "77",
      navigationCandidates: [],
      parcelaInfoCandidates: [],
    };
    const details = [
      {
        contentHash: "hash-detail",
        raw: { fields: [], tables: [], text: "", title: "" },
        sourceUrl: "https://legado.example/administrator/index.php?option=com_widesys&view=ajax",
        transport: "ajax.getDetalhesRecebimento",
      },
    ] as Parameters<typeof buildCapturedRecord>[4];

    expect(
      buildCapturedRecord("contas-receber", "77", row, "2026-09", details)
        .baixaEvidence,
    ).toEqual({
      expectedTransport: "ajax.getDetalhesRecebimento",
      transportObserved: true,
    });
  });

  it("só reutiliza detalhe de resume quando linha, janela e endpoints continuam iguais", () => {
    const row = {
      cells: ["Pendente", "R$ 100,00"],
      contentHash: "linha-v1",
      headers: ["Situação", "Valor devido"],
      legacyId: "77",
      navigationCandidates: [],
      parcelaInfoCandidates: [],
    };
    const details = [
      {
        contentHash: "detail-v1",
        raw: { fields: [], tables: [], text: "Pendente", title: "" },
        sourceUrl:
          "https://legado.example/administrator/index.php?option=com_widesys&view=ajax&format=raw&task=ajax.getParcelaInfo&parcela_id=77",
        transport: "ajax.getParcelaInfo",
      },
    ] as Parameters<typeof buildCapturedRecord>[4];
    const captured = buildCapturedRecord("contas-receber", "77", row, "2026-09", details);
    const evidence = {
      legacyId: "77",
      rowContentHash: "linha-v1",
      sourceWindow: "2026-09",
      targets: details.map((detail) => ({
        sourceUrl: detail.sourceUrl,
        transport: detail.transport,
      })),
    };

    expect(capturedRecordMatchesEvidence(captured, evidence)).toBe(true);
    expect(
      capturedRecordMatchesEvidence(captured, { ...evidence, rowContentHash: "linha-v2" }),
    ).toBe(false);
    expect(
      capturedRecordMatchesEvidence(captured, {
        ...evidence,
        targets: [{ ...evidence.targets[0], transport: "ajax.getDetalhesRecebimento" }],
      }),
    ).toBe(false);
  });

  it("ignora linhas sem cid numérico estável", () => {
    const html = `<tr><td><input name="cid[]" value="todos"></td><td>Cabeçalho</td></tr>`;
    expect(extractLegacyListRows(html)).toEqual([]);
  });
});
