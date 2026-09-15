#!/usr/bin/env tsx

import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import {
  extractAnchors,
  extractRecord,
  isJoomlaLoginPage,
  normalizeText,
  parseAttributes,
  parseTotal,
  sanitizeHtml,
  sha256,
} from "./widesys-parser";

const DEFAULT_BASE_URL = "https://brisaazul.app2.widesys.com.br/administrator/index.php?admin";
const OUTPUT_DIRECTORY = path.resolve(process.cwd(), "data", "legacy-widesys");
const PAGE_LIMIT = 200;
const DEFAULT_DELAY_MS = 250;
const DEFAULT_MAX_PAGES = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;

const MODULES = {
  precadastros: ["interessados", "pre-cadastros", "pre cadastros", "precadastros"],
  produtos: ["imoveis", "produtos"],
  empreendimentos: ["empreendimentos", "empreendimento"],
  proprietarios: ["proprietarios e beneficiarios", "proprietarios", "beneficiarios"],
  inquilinos: ["inquilinos", "inquilino"],
  compradors: ["compradores", "comprador"],
  fiadors: ["fiadores e avalistas", "fiadores", "avalistas"],
  corretors: ["corretores e funcionarios", "corretores", "funcionarios"],
  outros: ["fornecedores", "fornecedor", "outros"],
} as const;

type ModuleName = keyof typeof MODULES;

const DETAIL_TASKS: Record<ModuleName, string> = {
  precadastros: "precadastro.edit",
  produtos: "produto.edit",
  empreendimentos: "empreendimento.edit",
  proprietarios: "proprietario.edit",
  inquilinos: "inquilino.edit",
  compradors: "comprador.edit",
  fiadors: "fiador.edit",
  corretors: "corretor.edit",
  outros: "outro.edit",
};

type CliOptions = {
  baseUrl: URL;
  captureMode: "new" | "refresh" | "resume";
  delayMs: number;
  dryRun: boolean;
  maxPages: number;
  modules: ModuleName[];
};

type Artifact = {
  bytes: number;
  kind: "detail-html" | "detail-json" | "list-html" | "list-json";
  module: ModuleName;
  path: string;
  sha256: string;
  sourceUrl: string;
};

type ManifestError = {
  at: string;
  code: string;
  message: string;
  module?: ModuleName;
  sourceUrl?: string;
};

type ModuleManifest = {
  completed: boolean;
  detailErrors: number;
  discoveredUrl: string;
  pagesFetched: number;
  recordsDiscovered: number;
  recordsSaved: number;
  recordsSkipped: number;
  reportedTotal: number | null;
};

type Manifest = {
  artifacts: Artifact[];
  baseOrigin: string;
  completedAt: string | null;
  contentHash: string;
  errors: ManifestError[];
  modules: Partial<Record<ModuleName, ModuleManifest>>;
  options: {
    captureMode: "new" | "refresh" | "resume";
    delayMs: number;
    limit: number;
    maxPages: number;
  };
  startedAt: string;
  updatedAt: string;
  version: 1;
};

type LoginSubmission = {
  action: string;
  fields: Map<string, string>;
  passwordField: string;
  usernameField: string;
};

function usage(): string {
  return `Uso: npm run legacy:scrape -- [opções]

Opções:
  --dry-run                 valida a configuração sem acessar o legado
  --refresh                 refaz toda a captura com dados atuais (padrão)
  --resume                  retoma somente uma captura interrompida
  --no-resume               inicia apenas se ainda não existir manifesto
  --modules=a,b             módulos: ${Object.keys(MODULES).join(", ")}
  --base-url=https://...    URL inicial do administrador Widesys
  --delay-ms=250            intervalo entre requisições
  --max-pages=10000         trava de segurança para paginação
  --help                    mostra esta ajuda

Credenciais:
  WIDESYS_USUARIO           usuário; se ausente, será solicitado
  WIDESYS_SENHA             senha; se ausente, será solicitada sem eco

URLs de módulos podem ser informadas por WIDESYS_MODULE_<MODULO>_URL.
Nenhuma senha, cookie ou token é gravado nos artefatos.`;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${flag} precisa ser um inteiro não negativo.`);
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  let baseUrl = new URL(process.env.WIDESYS_BASE_URL || DEFAULT_BASE_URL);
  let delayMs = DEFAULT_DELAY_MS;
  let dryRun = false;
  let maxPages = DEFAULT_MAX_PAGES;
  let modules = Object.keys(MODULES) as ModuleName[];
  let captureMode: CliOptions["captureMode"] = "refresh";

  for (const argument of argv) {
    if (argument === "--help" || argument === "-h") {
      console.log(usage());
      process.exit(0);
    } else if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--refresh") {
      captureMode = "refresh";
    } else if (argument === "--resume") {
      captureMode = "resume";
    } else if (argument === "--no-resume") {
      captureMode = "new";
    } else if (argument.startsWith("--base-url=")) {
      baseUrl = new URL(argument.slice("--base-url=".length));
    } else if (argument.startsWith("--delay-ms=")) {
      delayMs = parsePositiveInteger(argument.slice("--delay-ms=".length), "--delay-ms");
    } else if (argument.startsWith("--max-pages=")) {
      maxPages = parsePositiveInteger(argument.slice("--max-pages=".length), "--max-pages");
      if (maxPages === 0) throw new Error("--max-pages precisa ser maior que zero.");
    } else if (argument.startsWith("--modules=")) {
      const requested = argument
        .slice("--modules=".length)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const invalid = requested.filter((item) => !(item in MODULES));
      if (invalid.length > 0) throw new Error(`Módulos desconhecidos: ${invalid.join(", ")}.`);
      modules = [...new Set(requested)] as ModuleName[];
      if (modules.length === 0) throw new Error("Informe ao menos um módulo em --modules.");
    } else {
      throw new Error(`Opção desconhecida: ${argument}`);
    }
  }

  if (baseUrl.protocol !== "https:") throw new Error("A URL do Widesys precisa usar HTTPS.");
  if (!baseUrl.pathname.startsWith("/administrator/")) {
    throw new Error("A URL inicial precisa estar dentro de /administrator/.");
  }
  baseUrl.hash = "";
  return { baseUrl, captureMode, delayMs, dryRun, maxPages, modules };
}

function splitSetCookie(header: string): string[] {
  return header.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g);
}

class SameOriginClient {
  private readonly cookies = new Map<string, string>();
  private readonly origin: string;

  constructor(origin: string) {
    this.origin = origin;
  }

  async get(url: URL): Promise<{ html: string; url: URL }> {
    return this.request(url, "GET");
  }

  async postForm(url: URL, form: URLSearchParams): Promise<{ html: string; url: URL }> {
    return this.request(url, "POST", form.toString());
  }

  private async request(
    initialUrl: URL,
    initialMethod: "GET" | "POST",
    initialBody?: string,
  ): Promise<{ html: string; url: URL }> {
    let url = new URL(initialUrl);
    let method = initialMethod;
    let body = initialBody;

    for (let redirects = 0; redirects <= 10; redirects += 1) {
      this.assertSameOrigin(url);
      const headers: Record<string, string> = {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "BrisaLegacyReadOnlyImporter/1.0",
      };
      if (this.cookies.size > 0) {
        headers.Cookie = [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
      }
      if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(url, {
          body: method === "POST" ? body : undefined,
          headers,
          method,
          redirect: "manual",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      this.captureCookies(response.headers);

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error(`Redirecionamento ${response.status} sem destino.`);
        url = new URL(location, url);
        this.assertSameOrigin(url);
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
          method = "GET";
          body = undefined;
        }
        continue;
      }

      if (!response.ok) throw new Error(`O legado respondeu HTTP ${response.status}.`);
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("text/html")) {
        throw new Error(`Resposta inesperada do legado (${contentType || "sem Content-Type"}).`);
      }
      return { html: await response.text(), url };
    }
    throw new Error("O legado excedeu o limite de redirecionamentos.");
  }

  private assertSameOrigin(url: URL): void {
    if (url.origin !== this.origin) throw new Error("Redirecionamento externo bloqueado.");
    if (!url.pathname.startsWith("/administrator/")) {
      throw new Error("Navegação fora do administrador bloqueada.");
    }
  }

  private captureCookies(headers: Headers): void {
    const cookieHeaders =
      (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ??
      splitSetCookie(headers.get("set-cookie") || "");
    for (const rawCookie of cookieHeaders) {
      const firstPart = rawCookie.split(";", 1)[0]?.trim();
      if (!firstPart) continue;
      const separator = firstPart.indexOf("=");
      if (separator <= 0) continue;
      const name = firstPart.slice(0, separator).trim();
      const value = firstPart.slice(separator + 1).trim();
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
  }
}

function readLoginSubmission(html: string): LoginSubmission {
  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const body = match[2] ?? "";
    const rawInputs = [...body.matchAll(/<input\b([^>]*)>/gi)].map((input) =>
      parseAttributes(input[1] ?? ""),
    );
    const passwordInput = rawInputs.find(
      (input) => input.type?.toLowerCase() === "password" || /^(?:passw|passwd|password|senha)$/i.test(input.name || ""),
    );
    if (!passwordInput?.name) continue;
    const usernameInput = rawInputs.find((input) =>
      /^(?:username|user|login|usuario|j_username)$/i.test(input.name || ""),
    );
    if (!usernameInput?.name) continue;
    const formAttributes = parseAttributes(match[1] ?? "");
    if ((formAttributes.method || "get").toLowerCase() !== "post") continue;
    const fields = new Map<string, string>();
    for (const input of rawInputs) {
      if (!input.name || "disabled" in input) continue;
      const type = (input.type || "text").toLowerCase();
      if (["button", "file", "image", "reset", "submit"].includes(type)) continue;
      if (["checkbox", "radio"].includes(type) && !("checked" in input)) continue;
      fields.set(input.name, input.value ?? "");
    }
    if (fields.get("option") !== "com_login" || fields.get("task") !== "login") continue;
    return {
      action: formAttributes.action || "",
      fields,
      passwordField: passwordInput.name,
      usernameField: usernameInput.name,
    };
  }
  throw new Error("Formulário de login do Widesys não encontrado.");
}

async function promptSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error("Defina WIDESYS_SENHA em ambientes sem terminal interativo.");
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  let secret = "";
  try {
    return await new Promise<string>((resolve, reject) => {
      const onData = (chunk: string) => {
        for (const character of chunk) {
          if (character === "\u0003") {
            cleanup();
            reject(new Error("Operação cancelada."));
            return;
          }
          if (character === "\r" || character === "\n") {
            cleanup();
            resolve(secret);
            return;
          }
          if (character === "\u007f" || character === "\b") secret = secret.slice(0, -1);
          else if (character >= " ") secret += character;
        }
      };
      const cleanup = () => {
        process.stdin.off("data", onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write("\n");
      };
      process.stdin.on("data", onData);
    });
  } finally {
    if (process.stdin.isRaw) process.stdin.setRawMode(false);
  }
}

async function promptVisible(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Defina WIDESYS_USUARIO em ambientes sem terminal interativo.");
  }
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await reader.question(prompt)).trim();
  } finally {
    reader.close();
  }
}

function publicUrl(input: URL): string {
  const url = new URL(input);
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:token|csrf|secret|password|passwd|senha|return)$/i.test(key) || /^[a-f\d]{24,128}$/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  url.hash = "";
  return url.toString();
}

function adminPathPrefix(baseUrl: URL): string {
  return baseUrl.pathname.slice(0, baseUrl.pathname.lastIndexOf("/") + 1);
}

function assertAdminUrl(url: URL, baseUrl: URL): void {
  if (url.origin !== baseUrl.origin) throw new Error("URL externa bloqueada.");
  if (!url.pathname.startsWith(adminPathPrefix(baseUrl))) throw new Error("URL fora do administrador bloqueada.");
  if (url.username || url.password) throw new Error("URL com credenciais embutidas bloqueada.");
  if (url.protocol !== "https:") throw new Error("URL sem HTTPS bloqueada.");
}

function assertListUrl(url: URL, baseUrl: URL): void {
  assertAdminUrl(url, baseUrl);
  if (url.searchParams.get("option") !== "com_widesys") {
    throw new Error("Listagem fora do componente com_widesys bloqueada.");
  }
  if (url.searchParams.get("layout")?.toLowerCase() === "edit") {
    throw new Error("URL de detalhe usada como listagem.");
  }
  const task = (url.searchParams.get("task") || "").toLowerCase();
  if (task && task !== "display" && !task.endsWith(".display")) {
    throw new Error("URL de listagem com task não permitida.");
  }
}

function assertDetailUrl(url: URL, baseUrl: URL, module: ModuleName): void {
  assertAdminUrl(url, baseUrl);
  if (url.searchParams.get("option") !== "com_widesys") throw new Error("Detalhe fora do com_widesys.");
  if ((url.searchParams.get("task") || "").toLowerCase() !== DETAIL_TASKS[module]) {
    throw new Error(`Task de detalhe não autorizada para ${module}.`);
  }
  const ids = url.searchParams.getAll("id");
  if (ids.length !== 1 || !/^\d+$/.test(ids[0] || "")) {
    throw new Error("Detalhe sem id numérico único foi bloqueado.");
  }
  const allowedParameters = new Set(["option", "task", "id"]);
  if (module === "produtos" && url.searchParams.get("jatoggler_noupd") === "0") {
    allowedParameters.add("jatoggler_noupd");
  }
  for (const key of url.searchParams.keys()) {
    if (!allowedParameters.has(key)) throw new Error("Parâmetro inesperado em URL de detalhe.");
  }
}

function withPageLimit(input: URL): URL {
  const url = new URL(input);
  url.searchParams.set("limit", String(PAGE_LIMIT));
  return url;
}

function resolveLink(href: string, current: URL): URL | null {
  if (!href || /^(?:javascript:|mailto:|tel:|#)/i.test(href.trim())) return null;
  try {
    return new URL(href, current);
  } catch {
    return null;
  }
}

function moduleEnvironmentKey(module: ModuleName): string {
  return `WIDESYS_MODULE_${module.toUpperCase()}_URL`;
}

function discoverModuleUrls(html: string, current: URL, options: CliOptions): Map<ModuleName, URL> {
  const anchors = extractAnchors(html);
  const result = new Map<ModuleName, URL>();
  for (const moduleName of options.modules) {
    const override = process.env[moduleEnvironmentKey(moduleName)];
    if (override) {
      const url = withPageLimit(new URL(override, options.baseUrl));
      assertListUrl(url, options.baseUrl);
      result.set(moduleName, url);
      continue;
    }
    const candidates = anchors
      .map((anchor) => {
        const text = normalizeText(anchor.text);
        const aliasScores = MODULES[moduleName].map((alias) => {
          const normalizedAlias = normalizeText(alias);
          if (text === normalizedAlias) return 100 + normalizedAlias.length;
          if (text.includes(normalizedAlias)) return 50 + normalizedAlias.length;
          return 0;
        });
        return { anchor, score: Math.max(...aliasScores) };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score);
    for (const candidate of candidates) {
      const url = resolveLink(candidate.anchor.href, current);
      if (!url) continue;
      try {
        assertListUrl(url, options.baseUrl);
        result.set(moduleName, withPageLimit(url));
        break;
      } catch {
        // Um rótulo semelhante não autoriza navegar em URL fora do contrato de leitura.
      }
    }
  }
  return result;
}

function isPaginationLink(url: URL, anchorRel: string, anchorText: string): boolean {
  if (/\bnext\b/i.test(anchorRel) || /^(?:proximo|próximo|seguinte|›|»|>)$/i.test(anchorText.trim())) return true;
  return ["limitstart", "start", "page", "pagina"].some((key) => url.searchParams.has(key));
}

function sameListIdentity(left: URL, right: URL): boolean {
  return (
    left.searchParams.get("option") === right.searchParams.get("option") &&
    left.searchParams.get("view") === right.searchParams.get("view")
  );
}

function detailId(url: URL): string {
  const value =
    url.searchParams.get("id") ||
    url.searchParams.get("cid[]") ||
    url.searchParams.get("cid") ||
    sha256(url.toString()).slice(0, 16);
  return value.replace(/[^a-z\d_-]+/gi, "-").replace(/^-+|-+$/g, "") || sha256(url.toString()).slice(0, 16);
}

async function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { mode: 0o700, recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
}

function relativeArtifactPath(filePath: string): string {
  const relative = path.relative(OUTPUT_DIRECTORY, filePath).replace(/\\/g, "/");
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error("Caminho de artefato fora do diretório permitido.");
  }
  return relative;
}

function artifactFor(
  filePath: string,
  content: string,
  kind: Artifact["kind"],
  module: ModuleName,
  sourceUrl: URL,
): Artifact {
  return {
    bytes: Buffer.byteLength(content),
    kind,
    module,
    path: relativeArtifactPath(filePath),
    sha256: sha256(content),
    sourceUrl: publicUrl(sourceUrl),
  };
}

function updateArtifact(manifest: Manifest, artifact: Artifact): void {
  const index = manifest.artifacts.findIndex((existing) => existing.path === artifact.path);
  if (index >= 0) manifest.artifacts[index] = artifact;
  else manifest.artifacts.push(artifact);
}

function refreshManifestHash(manifest: Manifest): void {
  manifest.updatedAt = new Date().toISOString();
  manifest.contentHash = sha256(
    JSON.stringify({
      artifacts: manifest.artifacts
        .map(({ path: artifactPath, sha256: hash }) => ({ path: artifactPath, sha256: hash }))
        .sort((left, right) => left.path.localeCompare(right.path)),
      errors: manifest.errors,
      modules: manifest.modules,
    }),
  );
}

async function saveManifest(manifest: Manifest): Promise<void> {
  refreshManifestHash(manifest);
  await atomicWrite(path.join(OUTPUT_DIRECTORY, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function loadManifest(options: CliOptions): Promise<Manifest> {
  const manifestPath = path.join(OUTPUT_DIRECTORY, "manifest.json");
  try {
    const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
    if (parsed.version !== 1 || parsed.baseOrigin !== options.baseUrl.origin) {
      throw new Error("O manifesto existente pertence a outra versão ou origem.");
    }
    if (options.captureMode === "new") {
      throw new Error("Já existe um manifesto. Use --refresh para uma captura atual ou --resume para retomar uma interrupção.");
    }
    if (options.captureMode === "resume") {
      parsed.completedAt = null;
      parsed.options = {
        captureMode: "resume",
        delayMs: options.delayMs,
        limit: PAGE_LIMIT,
        maxPages: options.maxPages,
      };
      return parsed;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const now = new Date().toISOString();
  return {
    artifacts: [],
    baseOrigin: options.baseUrl.origin,
    completedAt: null,
    contentHash: "",
    errors: [],
    modules: {},
    options: {
      captureMode: options.captureMode,
      delayMs: options.delayMs,
      limit: PAGE_LIMIT,
      maxPages: options.maxPages,
    },
    startedAt: now,
    updatedAt: now,
    version: 1,
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function addManifestError(
  manifest: Manifest,
  error: unknown,
  code: string,
  module?: ModuleName,
  sourceUrl?: URL,
): void {
  const message = error instanceof Error ? error.message : "Erro desconhecido.";
  manifest.errors.push({
    at: new Date().toISOString(),
    code,
    message: message.slice(0, 500),
    module,
    sourceUrl: sourceUrl ? publicUrl(sourceUrl) : undefined,
  });
}

async function saveListArtifacts(
  manifest: Manifest,
  module: ModuleName,
  pageNumber: number,
  sourceUrl: URL,
  html: string,
  detailUrls: URL[],
  paginationUrls: URL[],
  reportedTotal: number | null,
): Promise<void> {
  const pageDirectory = path.join(OUTPUT_DIRECTORY, module, "pages");
  const basename = `page-${String(pageNumber).padStart(5, "0")}`;
  const safeHtml = sanitizeHtml(html);
  const json = `${JSON.stringify(
    {
      detailUrls: detailUrls.map(publicUrl),
      fetchedAt: new Date().toISOString(),
      module,
      paginationUrls: paginationUrls.map(publicUrl),
      reportedTotal,
      sourceUrl: publicUrl(sourceUrl),
      tables: extractRecord(safeHtml).tables,
    },
    null,
    2,
  )}\n`;
  const htmlPath = path.join(pageDirectory, `${basename}.html`);
  const jsonPath = path.join(pageDirectory, `${basename}.json`);
  await atomicWrite(htmlPath, safeHtml);
  await atomicWrite(jsonPath, json);
  updateArtifact(manifest, artifactFor(htmlPath, safeHtml, "list-html", module, sourceUrl));
  updateArtifact(manifest, artifactFor(jsonPath, json, "list-json", module, sourceUrl));
}

async function scrapeModule(
  client: SameOriginClient,
  options: CliOptions,
  manifest: Manifest,
  module: ModuleName,
  firstListUrl: URL,
): Promise<void> {
  manifest.errors = manifest.errors.filter((error) => error.module !== module);
  const moduleState: ModuleManifest = {
    completed: false,
    detailErrors: 0,
    discoveredUrl: publicUrl(firstListUrl),
    pagesFetched: 0,
    recordsDiscovered: 0,
    recordsSaved: 0,
    recordsSkipped: 0,
    reportedTotal: null,
  };
  manifest.modules[module] = moduleState;
  await saveManifest(manifest);

  const queue: URL[] = [withPageLimit(firstListUrl)];
  const enqueuedPages = new Set(queue.map((url) => url.toString()));
  const visitedPages = new Set<string>();
  const details = new Map<string, URL>();

  while (queue.length > 0) {
    const listUrl = queue.shift();
    if (!listUrl) break;
    assertListUrl(listUrl, options.baseUrl);
    const pageKey = listUrl.toString();
    if (visitedPages.has(pageKey)) continue;
    if (visitedPages.size >= options.maxPages) throw new Error(`Módulo ${module} excedeu --max-pages.`);
    visitedPages.add(pageKey);
    await delay(options.delayMs);
    const response = await client.get(listUrl);
    if (isJoomlaLoginPage(response.html)) throw new Error("Sessão do Widesys expirou durante a listagem.");

    const detailUrls: URL[] = [];
    const paginationUrls: URL[] = [];
    for (const anchor of extractAnchors(response.html)) {
      const linked = resolveLink(anchor.href, response.url);
      if (!linked) continue;
      try {
        assertDetailUrl(linked, options.baseUrl, module);
        details.set(linked.toString(), linked);
        detailUrls.push(linked);
        continue;
      } catch {
        // Não é uma URL de detalhe segura; pode ainda ser paginação.
      }
      if (!isPaginationLink(linked, anchor.rel, normalizeText(anchor.text))) continue;
      try {
        assertListUrl(linked, options.baseUrl);
        if (!sameListIdentity(firstListUrl, linked)) continue;
        const limited = withPageLimit(linked);
        paginationUrls.push(limited);
        if (!enqueuedPages.has(limited.toString())) {
          queue.push(limited);
          enqueuedPages.add(limited.toString());
        }
      } catch {
        // Links de ação, externos ou de outro módulo nunca entram na fila.
      }
    }

    const reportedTotal = parseTotal(response.html);
    if (reportedTotal !== null) {
      moduleState.reportedTotal = Math.max(moduleState.reportedTotal ?? 0, reportedTotal);
      for (let offset = PAGE_LIMIT; offset < reportedTotal; offset += PAGE_LIMIT) {
        const generated = withPageLimit(firstListUrl);
        generated.searchParams.set("limitstart", String(offset));
        if (!enqueuedPages.has(generated.toString())) {
          queue.push(generated);
          enqueuedPages.add(generated.toString());
        }
      }
    }

    moduleState.pagesFetched += 1;
    moduleState.recordsDiscovered = details.size;
    await saveListArtifacts(
      manifest,
      module,
      moduleState.pagesFetched,
      response.url,
      response.html,
      detailUrls,
      paginationUrls,
      reportedTotal,
    );
    await saveManifest(manifest);
    console.log(`[${module}] página ${moduleState.pagesFetched}; ${details.size} detalhes descobertos.`);
  }

  moduleState.recordsDiscovered = details.size;
  let recordNumber = 0;
  for (const detailUrl of details.values()) {
    recordNumber += 1;
    const id = detailId(detailUrl);
    const basename = `${id}-${sha256(detailUrl.toString()).slice(0, 10)}`;
    const recordDirectory = path.join(OUTPUT_DIRECTORY, module, "records");
    const htmlPath = path.join(recordDirectory, `${basename}.html`);
    const jsonPath = path.join(recordDirectory, `${basename}.json`);
    if (options.captureMode === "resume" && (await fileExists(htmlPath)) && (await fileExists(jsonPath))) {
      moduleState.recordsSkipped += 1;
      continue;
    }

    try {
      assertDetailUrl(detailUrl, options.baseUrl, module);
      await delay(options.delayMs);
      const response = await client.get(detailUrl);
      if (isJoomlaLoginPage(response.html)) throw new Error("Sessão do Widesys expirou durante um detalhe.");
      const safeHtml = sanitizeHtml(response.html);
      const parsed = extractRecord(safeHtml);
      const json = `${JSON.stringify(
        {
          fetchedAt: new Date().toISOString(),
          id,
          module,
          raw: parsed,
          sourceUrl: publicUrl(response.url),
        },
        null,
        2,
      )}\n`;
      await atomicWrite(htmlPath, safeHtml);
      await atomicWrite(jsonPath, json);
      updateArtifact(manifest, artifactFor(htmlPath, safeHtml, "detail-html", module, response.url));
      updateArtifact(manifest, artifactFor(jsonPath, json, "detail-json", module, response.url));
      moduleState.recordsSaved += 1;
    } catch (error) {
      moduleState.detailErrors += 1;
      addManifestError(manifest, error, "DETAIL_FETCH_FAILED", module, detailUrl);
    }
    if (recordNumber % 20 === 0 || recordNumber === details.size) {
      await saveManifest(manifest);
      console.log(`[${module}] ${recordNumber}/${details.size} detalhes processados.`);
    }
  }

  const countMismatch = moduleState.reportedTotal !== null && details.size < moduleState.reportedTotal;
  if (countMismatch) {
    addManifestError(
      manifest,
      new Error(
        `A listagem informou ${moduleState.reportedTotal}, mas somente ${details.size} URLs ${DETAIL_TASKS[module]} foram encontradas.`,
      ),
      "COUNT_MISMATCH",
      module,
      firstListUrl,
    );
  }
  moduleState.completed = moduleState.detailErrors === 0 && !countMismatch;
  await saveManifest(manifest);
}

async function login(client: SameOriginClient, options: CliOptions, username: string, password: string) {
  const loginPage = await client.get(options.baseUrl);
  const submission = readLoginSubmission(loginPage.html);
  const action = new URL(submission.action, loginPage.url);
  assertAdminUrl(action, options.baseUrl);
  const option = submission.fields.get("option");
  const task = submission.fields.get("task");
  if (option && option !== "com_login") throw new Error("Formulário de login inesperado.");
  if (task && task !== "login") throw new Error("Task de login inesperada.");
  submission.fields.set(submission.usernameField, username);
  submission.fields.set(submission.passwordField, password);
  const form = new URLSearchParams();
  for (const [name, value] of submission.fields) form.append(name, value);
  const authenticated = await client.postForm(action, form);
  if (isJoomlaLoginPage(authenticated.html)) throw new Error("Autenticação recusada pelo Widesys.");
  return authenticated;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  console.log(`Origem validada: ${options.baseUrl.origin}`);
  console.log(`Módulos: ${options.modules.join(", ")}`);
  console.log(`Destino protegido pelo .gitignore: ${OUTPUT_DIRECTORY}`);
  if (options.dryRun) {
    console.log("Dry-run concluído: nenhuma credencial solicitada, requisição feita ou arquivo criado.");
    return;
  }

  await mkdir(OUTPUT_DIRECTORY, { mode: 0o700, recursive: true });
  const manifest = await loadManifest(options);
  await saveManifest(manifest);
  const username = (
    process.env.WIDESYS_USUARIO ||
    process.env.WIDESYS_USERNAME ||
    (await promptVisible("Usuário Widesys: "))
  ).trim();
  if (!username) throw new Error("Usuário Widesys vazio.");
  let password = process.env.WIDESYS_SENHA || process.env.WIDESYS_PASSWORD || "";
  if (!password) password = await promptSecret("Senha Widesys (entrada oculta): ");
  if (!password) throw new Error("Senha Widesys vazia.");

  const client = new SameOriginClient(options.baseUrl.origin);
  let dashboard: { html: string; url: URL };
  try {
    dashboard = await login(client, options, username, password);
  } finally {
    password = "";
  }
  console.log("Autenticação concluída; sessão mantida somente em memória.");

  const moduleUrls = discoverModuleUrls(dashboard.html, dashboard.url, options);
  for (const moduleName of options.modules) {
    const moduleUrl = moduleUrls.get(moduleName);
    if (!moduleUrl) {
      addManifestError(
        manifest,
        new Error(`Link do módulo não encontrado. Defina ${moduleEnvironmentKey(moduleName)} se necessário.`),
        "MODULE_NOT_FOUND",
        moduleName,
      );
      await saveManifest(manifest);
      console.warn(`[${moduleName}] link de listagem não encontrado; módulo ignorado.`);
      continue;
    }
    try {
      console.log(`[${moduleName}] iniciando leitura serial e somente GET.`);
      await scrapeModule(client, options, manifest, moduleName, moduleUrl);
    } catch (error) {
      addManifestError(manifest, error, "MODULE_FAILED", moduleName, moduleUrl);
      await saveManifest(manifest);
      console.warn(`[${moduleName}] falhou; consulte o manifesto sem compartilhar credenciais.`);
    }
  }

  manifest.completedAt = new Date().toISOString();
  await saveManifest(manifest);
  const completed = options.modules.filter((moduleName) => manifest.modules[moduleName]?.completed).length;
  const records = options.modules.reduce(
    (sum, moduleName) => {
      const moduleState = manifest.modules[moduleName];
      return sum + (moduleState?.recordsSaved ?? 0) + (moduleState?.recordsSkipped ?? 0);
    },
    0,
  );
  console.log(`Coleta encerrada: ${completed}/${options.modules.length} módulos completos; ${records} registros disponíveis.`);
  console.log("Revise data/legacy-widesys/manifest.json antes de qualquer etapa de importação.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Erro desconhecido.";
  console.error(`Falha segura: ${message.slice(0, 500)}`);
  process.exitCode = 1;
});
