#!/usr/bin/env tsx

import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  WIDESYS_CATALOG_MANIFEST_SCHEMA,
  widesysCatalogManifestContentHash,
} from "../src/lib/importacao/widesys-catalog-manifest";
import {
  CATALOG_MODULES,
  PAGE_LIMIT,
  assertAdminBase,
  assertAdminIndexUrl,
  assertCatalogDetailUrl,
  assertCatalogListUrl,
  assertSafeAdminRead,
  catalogCountMatches,
  catalogListLimitParameter,
  catalogPageExplicitlyEmpty,
  catalogPageHasEvidence,
  catalogRequiresDetailFetch,
  catalogModule,
  discoverDetailEvidence,
  discoverPageCursors,
  extractCatalogRecord,
  listUrl,
  normalizeText,
  parseAttributes,
  parseReportedTotal,
  publicUrl,
  redactSensitiveText,
  resolveCatalogCount,
  sanitizeCatalogHtml,
  saoPauloCivilYear,
  sha256,
  type CatalogDetailEvidence,
  type CatalogModule,
  type CatalogPageCountEvidence,
  type PageStartParameter,
} from "./widesys-catalogos-core";

const DEFAULT_BASE_URL = "https://brisaazul.app2.widesys.com.br/administrator/index.php?admin";
const AUTHORIZED_BASE_ORIGIN = new URL(DEFAULT_BASE_URL).origin;
const OUTPUT_DIRECTORY = path.resolve(process.cwd(), "data", "legacy-widesys", "catalogos");
const DEFAULT_DELAY_MS = 300;
const DEFAULT_MAX_PAGES = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;
const RESUME_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

type CaptureMode = "new" | "refresh" | "resume";

type CliOptions = {
  baseUrl: URL;
  captureMode: CaptureMode;
  delayMs: number;
  dryRun: boolean;
  maxPages: number;
  modules: CatalogModule[];
  irrfYears: number[];
};

export type Artifact = {
  bytes: number;
  kind: "detail-html" | "detail-json" | "list-html" | "list-json";
  listEvidenceHash?: string;
  module: string;
  path: string;
  sha256: string;
  sourceUrl: string;
};

type ManifestError = {
  at: string;
  code: string;
  message: string;
  module?: string;
  sourceUrl?: string;
};

type ModuleManifest = {
  completed: boolean;
  countSource: "explicit-empty" | "reported" | "singleton" | "terminal-page" | null;
  detailErrors: number;
  explicitlyEmpty: boolean;
  label: string;
  pagesFetched: number;
  recordsDiscovered: number;
  recordsSaved: number;
  recordsSkipped: number;
  reportedTotal: number | null;
  sourceUrl: string;
};

type Manifest = {
  artifacts: Artifact[];
  baseOrigin: string;
  captureId: string;
  completedAt: string | null;
  contentHash: string;
  errors: ManifestError[];
  modules: Record<string, ModuleManifest | undefined>;
  options: {
    captureMode: CaptureMode;
    delayMs: number;
    limit: number;
    maxPages: number;
    modules: string[];
    irrfYears: number[];
  };
  startedAt: string;
  schema: typeof WIDESYS_CATALOG_MANIFEST_SCHEMA;
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
  return `Uso: tsx scripts/capturar-catalogos-widesys.ts [opcoes]

Opcoes:
  --dry-run                 valida whitelist e configuracao sem rede ou arquivos
  --refresh                 recaptura os modulos selecionados (padrao)
  --resume                  retoma captura interrompida com mesmos modulos e SHA-256 valido
  --no-resume               falha se ja existir manifesto
  --modules=a,b             limita a captura aos slugs informados
  --base-url=https://...    URL inicial do administrador Widesys
  --delay-ms=300            intervalo entre leituras GET
  --max-pages=10000         trava de seguranca da paginacao
  --irrf-from-year=2025     primeiro ano civil da tabela IRRF
  --irrf-to-year=2026       ultimo ano civil da tabela IRRF (maximo 50 anos)
  --help                    mostra esta ajuda

Credenciais obrigatoriamente via ambiente:
  WIDESYS_USUARIO
  WIDESYS_SENHA

Modulos permitidos:
${CATALOG_MODULES.map((module) => `  ${module.key.padEnd(48)} ${module.label}`).join("\n")}

A autenticacao usa o POST do formulario Joomla. Depois do login, a coleta e
exclusivamente GET, same-origin e restrita a whitelist acima.`;
}

function parseNonNegativeInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${flag} precisa ser um inteiro nao negativo.`);
  return parsed;
}

function parseIrrfYear(value: string, flag: string): number {
  const year = parseNonNegativeInteger(value, flag);
  if (year < 1900 || year > 2200) throw new Error(`${flag} precisa estar entre 1900 e 2200.`);
  return year;
}

export function assertAuthorizedCatalogOrigin(baseUrl: URL): void {
  if (baseUrl.origin !== AUTHORIZED_BASE_ORIGIN) {
    throw new Error("A origem Widesys nao pertence ao host autorizado desta migracao.");
  }
}

export function parseCatalogArgs(argv: string[], environment = process.env): CliOptions {
  let baseUrl = new URL(environment.WIDESYS_BASE_URL || DEFAULT_BASE_URL);
  let captureMode: CaptureMode = "refresh";
  let delayMs = DEFAULT_DELAY_MS;
  let dryRun = false;
  let maxPages = DEFAULT_MAX_PAGES;
  let modules = [...CATALOG_MODULES] as CatalogModule[];
  const currentYear = saoPauloCivilYear();
  let irrfFromYear = currentYear;
  let irrfToYear = currentYear;
  let irrfRangeConfigured = false;

  for (const argument of argv) {
    if (argument === "--help" || argument === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (argument === "--dry-run") dryRun = true;
    else if (argument === "--refresh") captureMode = "refresh";
    else if (argument === "--resume") captureMode = "resume";
    else if (argument === "--no-resume") captureMode = "new";
    else if (argument.startsWith("--base-url=")) baseUrl = new URL(argument.slice("--base-url=".length));
    else if (argument.startsWith("--delay-ms=")) {
      delayMs = parseNonNegativeInteger(argument.slice("--delay-ms=".length), "--delay-ms");
    } else if (argument.startsWith("--max-pages=")) {
      maxPages = parseNonNegativeInteger(argument.slice("--max-pages=".length), "--max-pages");
      if (maxPages === 0) throw new Error("--max-pages precisa ser maior que zero.");
    } else if (argument.startsWith("--irrf-from-year=")) {
      irrfFromYear = parseIrrfYear(argument.slice("--irrf-from-year=".length), "--irrf-from-year");
      irrfRangeConfigured = true;
    } else if (argument.startsWith("--irrf-to-year=")) {
      irrfToYear = parseIrrfYear(argument.slice("--irrf-to-year=".length), "--irrf-to-year");
      irrfRangeConfigured = true;
    } else if (argument.startsWith("--modules=")) {
      const requested = argument
        .slice("--modules=".length)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const invalid = requested.filter((key) => !catalogModule(key));
      if (invalid.length > 0) throw new Error(`Modulos fora da whitelist: ${invalid.join(", ")}.`);
      modules = [...new Set(requested)].map((key) => catalogModule(key) as CatalogModule);
      if (modules.length === 0) throw new Error("Informe ao menos um modulo em --modules.");
    } else if (argument !== "--dry-run" && argument !== "--refresh" && argument !== "--resume" && argument !== "--no-resume") {
      throw new Error(`Opcao desconhecida: ${argument}`);
    }
  }

  if (irrfFromYear > irrfToYear || irrfToYear - irrfFromYear >= 50) {
    throw new Error("O intervalo IRRF precisa ser crescente e conter no maximo 50 anos.");
  }
  if (irrfRangeConfigured && !modules.some((module) => module.key === "irrf")) {
    throw new Error("As flags de ano IRRF exigem que o modulo irrf esteja selecionado.");
  }
  const irrfYears = Array.from(
    { length: irrfToYear - irrfFromYear + 1 },
    (_, index) => irrfFromYear + index,
  );

  assertAuthorizedCatalogOrigin(baseUrl);
  assertAdminBase(baseUrl);
  baseUrl.hash = "";
  for (const catalog of modules) {
    if (catalog.key === "irrf") {
      for (const year of irrfYears) {
        const period = { ...catalog, list: { ...catalog.list, periodo: String(year) } };
        assertCatalogListUrl(listUrl(period, baseUrl), baseUrl, period);
      }
    } else assertCatalogListUrl(listUrl(catalog, baseUrl), baseUrl, catalog);
  }
  return { baseUrl, captureMode, delayMs, dryRun, irrfYears, maxPages, modules };
}

function splitSetCookie(header: string): string[] {
  return header.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g);
}

type RequestGuard = (candidate: URL, method: "GET" | "POST") => void;

export class SameOriginReadClient {
  private readonly cookies = new Map<string, string>();
  private readonly baseUrl: URL;

  constructor(baseUrl: URL) {
    this.baseUrl = baseUrl;
  }

  async get(url: URL, routeGuard: RequestGuard): Promise<{ html: string; url: URL }> {
    return this.request(url, "GET", undefined, false, routeGuard);
  }

  async authenticate(
    url: URL,
    body: URLSearchParams,
    routeGuard: RequestGuard,
  ): Promise<{ html: string; url: URL }> {
    return this.request(url, "POST", body.toString(), true, routeGuard);
  }

  private async request(
    initialUrl: URL,
    initialMethod: "GET" | "POST",
    initialBody?: string,
    loginPost = false,
    routeGuard?: RequestGuard,
  ): Promise<{ html: string; url: URL }> {
    let url = new URL(initialUrl);
    let method = initialMethod;
    let body = initialBody;

    for (let redirects = 0; redirects <= 10; redirects += 1) {
      if (method === "GET") {
        assertSafeAdminRead(url, this.baseUrl);
      }
      else if (!loginPost) throw new Error("POST fora da autenticacao foi bloqueado.");
      routeGuard?.(url, method);

      const headers: Record<string, string> = {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "BrisaLegacyCatalogReadOnly/1.0",
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
        const redirected = new URL(location, url);
        let redirectedMethod = method;
        if (method === "POST") {
          if (![301, 302, 303].includes(response.status)) {
            throw new Error("Redirecionamento que repetiria o POST de login foi bloqueado.");
          }
          redirectedMethod = "GET";
          body = undefined;
        }
        if (redirectedMethod === "GET") assertSafeAdminRead(redirected, this.baseUrl);
        routeGuard?.(redirected, redirectedMethod);
        url = redirected;
        method = redirectedMethod;
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

  private captureCookies(headers: Headers): void {
    const raw =
      (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ??
      splitSetCookie(headers.get("set-cookie") || "");
    for (const cookie of raw) {
      const first = cookie.split(";", 1)[0]?.trim();
      if (!first) continue;
      const separator = first.indexOf("=");
      if (separator <= 0) continue;
      const name = first.slice(0, separator).trim();
      const value = first.slice(separator + 1).trim();
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
  }
}

function readLoginSubmission(html: string): LoginSubmission {
  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attributes = parseAttributes(match[1] ?? "");
    if ((attributes.method || "get").toLowerCase() !== "post") continue;
    const inputs = [...(match[2] ?? "").matchAll(/<input\b([^>]*)>/gi)].map((input) =>
      parseAttributes(input[1] ?? ""),
    );
    const password = inputs.find((input) => (input.type || "").toLowerCase() === "password");
    const username = inputs.find((input) => /^(?:username|user|login|usuario|j_username)$/i.test(input.name || ""));
    if (!password?.name || !username?.name) continue;
    const fields = new Map<string, string>();
    for (const input of inputs) {
      if (!input.name || Object.hasOwn(input, "disabled")) continue;
      const type = (input.type || "text").toLowerCase();
      if (["button", "file", "image", "reset", "submit"].includes(type)) continue;
      if (["checkbox", "radio"].includes(type) && !Object.hasOwn(input, "checked")) continue;
      fields.set(input.name, input.value || "");
    }
    if (fields.get("option") !== "com_login" || fields.get("task") !== "login") continue;
    return {
      action: attributes.action || "",
      fields,
      passwordField: password.name,
      usernameField: username.name,
    };
  }
  throw new Error("Formulario de login Joomla esperado nao foi encontrado.");
}

function isLoginPage(html: string): boolean {
  return /<input\b[^>]*type\s*=\s*["']password["']/i.test(html) &&
    /name\s*=\s*["'](?:username|passwd|password)["']/i.test(html);
}

export function assertLoginRoute(url: URL, baseUrl: URL, method: "GET" | "POST"): void {
  assertAdminIndexUrl(url, baseUrl);
  const allowed = new Set(method === "POST" ? ["admin", "option", "task"] : ["admin", "option", "view"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) throw new Error(`Parametro inesperado no fluxo de login: ${key}.`);
  }
  const option = url.searchParams.get("option");
  if (method === "POST") {
    if (option && option !== "com_login") throw new Error("POST fora do componente de login bloqueado.");
    const task = url.searchParams.get("task");
    if (task && task !== "login") throw new Error("Task que nao e login foi bloqueada.");
    return;
  }
  if (url.searchParams.has("task")) throw new Error("Task em GET do login foi bloqueada.");
  if (option && !["com_login", "com_cpanel", "com_widesys"].includes(option)) {
    throw new Error("Redirecionamento do login para componente inesperado bloqueado.");
  }
  const view = url.searchParams.get("view");
  if (
    view &&
    !(
      (option === "com_login" && view === "login") ||
      (option === "com_cpanel" && view === "cpanel")
    )
  ) {
    throw new Error("View inesperada no redirecionamento do login.");
  }
}

async function login(
  client: SameOriginReadClient,
  options: CliOptions,
  username: string,
  password: string,
): Promise<void> {
  const loginGuard: RequestGuard = (url, method) => assertLoginRoute(url, options.baseUrl, method);
  const page = await client.get(options.baseUrl, loginGuard);
  const submission = readLoginSubmission(page.html);
  const action = new URL(submission.action, page.url);
  assertLoginRoute(action, options.baseUrl, "POST");
  submission.fields.set(submission.usernameField, username);
  submission.fields.set(submission.passwordField, password);
  const body = new URLSearchParams();
  for (const [name, value] of submission.fields) body.append(name, value);
  const authenticated = await client.authenticate(action, body, loginGuard);
  if (isLoginPage(authenticated.html)) throw new Error("Autenticacao recusada pelo Widesys.");
}

async function delay(milliseconds: number): Promise<void> {
  if (milliseconds > 0) await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { mode: 0o700, recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
}

export async function fileMatchesSha256(filePath: string, expectedSha256: string): Promise<boolean> {
  if (!/^[a-f\d]{64}$/i.test(expectedSha256)) return false;
  try {
    return sha256(await readFile(filePath, "utf8")) === expectedSha256.toLowerCase();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function relativeArtifactPath(filePath: string): string {
  const relative = path.relative(OUTPUT_DIRECTORY, filePath).replace(/\\/g, "/");
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error("Caminho de artefato fora do diretorio protegido.");
  }
  return relative;
}

function artifactFor(
  filePath: string,
  content: string,
  kind: Artifact["kind"],
  module: CatalogModule,
  sourceUrl: URL,
  listEvidenceHash?: string,
): Artifact {
  return {
    bytes: Buffer.byteLength(content),
    kind,
    ...(listEvidenceHash ? { listEvidenceHash } : {}),
    module: module.key,
    path: relativeArtifactPath(filePath),
    sha256: sha256(content),
    sourceUrl: publicUrl(sourceUrl),
  };
}

function updateArtifact(manifest: Manifest, artifact: Artifact): void {
  const index = manifest.artifacts.findIndex((current) => current.path === artifact.path);
  if (index >= 0) manifest.artifacts[index] = artifact;
  else manifest.artifacts.push(artifact);
}

function manifestContentHash(manifest: Manifest): string {
  return widesysCatalogManifestContentHash(manifest as unknown as Record<string, unknown>);
}

function refreshManifestHash(manifest: Manifest): void {
  manifest.updatedAt = new Date().toISOString();
  manifest.contentHash = manifestContentHash(manifest);
}

async function saveManifest(manifest: Manifest): Promise<void> {
  refreshManifestHash(manifest);
  await atomicWrite(path.join(OUTPUT_DIRECTORY, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function assertResumeCompatibility(
  capturedModules: unknown,
  requestedModules: readonly string[],
  completedAt: unknown,
  capturedIrrfYears?: unknown,
  requestedIrrfYears: readonly number[] = [],
): void {
  if (completedAt !== null) {
    throw new Error("Captura ja encerrada nao pode ser retomada; use --refresh para um novo lote coerente.");
  }
  if (
    !Array.isArray(capturedModules) ||
    !capturedModules.every((module): module is string => typeof module === "string") ||
    capturedModules.length !== requestedModules.length ||
    capturedModules.some((module, index) => module !== requestedModules[index])
  ) {
    throw new Error("Os modulos e a ordem de --resume precisam coincidir exatamente com o manifesto.");
  }
  if (
    !Array.isArray(capturedIrrfYears) ||
    capturedIrrfYears.length !== requestedIrrfYears.length ||
    capturedIrrfYears.some((year, index) => year !== requestedIrrfYears[index])
  ) {
    throw new Error("Os anos IRRF de --resume precisam coincidir exatamente com o manifesto.");
  }
}

export function assertResumeFreshness(startedAt: unknown, now = new Date()): void {
  if (typeof startedAt !== "string") throw new Error("Manifesto interrompido nao informa startedAt valido.");
  const started = new Date(startedAt);
  const age = now.getTime() - started.getTime();
  if (
    Number.isNaN(started.getTime()) ||
    started.toISOString() !== startedAt ||
    age < 0 ||
    age > RESUME_MAX_AGE_MS
  ) {
    throw new Error("Captura interrompida expirou; use --refresh para reler todas as evidencias.");
  }
}

export function assertResumeLimits(
  captured: unknown,
  requested: { delayMs: number; maxPages: number },
): void {
  const options =
    captured !== null && typeof captured === "object" && !Array.isArray(captured)
      ? (captured as Record<string, unknown>)
      : null;
  if (
    !options ||
    options.limit !== PAGE_LIMIT ||
    options.delayMs !== requested.delayMs ||
    options.maxPages !== requested.maxPages
  ) {
    throw new Error("Delay, limite e max-pages de --resume precisam coincidir com o manifesto.");
  }
}

function freshManifest(options: CliOptions): Manifest {
  const now = new Date().toISOString();
  return {
    artifacts: [],
    baseOrigin: options.baseUrl.origin,
    captureId: randomUUID(),
    completedAt: null,
    contentHash: "",
    errors: [],
    modules: {},
    options: {
      captureMode: options.captureMode,
      delayMs: options.delayMs,
      limit: PAGE_LIMIT,
      maxPages: options.maxPages,
      modules: options.modules.map((module) => module.key),
      irrfYears: options.irrfYears,
    },
    startedAt: now,
    schema: WIDESYS_CATALOG_MANIFEST_SCHEMA,
    updatedAt: now,
    version: 1,
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function loadManifest(
  options: CliOptions,
  manifestPath = path.join(OUTPUT_DIRECTORY, "manifest.json"),
): Promise<Manifest> {
  const exists = await pathExists(manifestPath);
  if (options.captureMode === "refresh") return freshManifest(options);
  if (options.captureMode === "new") {
    if (exists) throw new Error("Manifesto existente. Use --refresh ou --resume.");
    return freshManifest(options);
  }
  if (!exists) throw new Error("Manifesto ausente. Use --refresh para iniciar uma nova captura.");

  const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  if (
    parsed.version !== 1 ||
    parsed.schema !== WIDESYS_CATALOG_MANIFEST_SCHEMA ||
    !/^[a-f\d-]{36}$/i.test(parsed.captureId || "") ||
    parsed.baseOrigin !== options.baseUrl.origin
  ) {
    throw new Error("Manifesto existente pertence a outra versao ou origem.");
  }
  if (!parsed.contentHash || parsed.contentHash !== manifestContentHash(parsed)) {
    throw new Error("Manifesto existente falhou na verificacao de integridade.");
  }
  const requestedModules = options.modules.map((module) => module.key);
  assertResumeCompatibility(
    parsed.options?.modules,
    requestedModules,
    parsed.completedAt,
    parsed.options?.irrfYears,
    options.irrfYears,
  );
  assertResumeFreshness(parsed.startedAt);
  assertResumeLimits(parsed.options, options);
  return parsed;
}

function addError(manifest: Manifest, error: unknown, code: string, module?: CatalogModule, url?: URL): void {
  const unsafe = error instanceof Error ? error.message : "Erro desconhecido.";
  manifest.errors.push({
    at: new Date().toISOString(),
    code,
    message: redactSensitiveText(unsafe).slice(0, 500),
    module: module?.key,
    sourceUrl: url ? publicUrl(url) : undefined,
  });
}

async function savePage(
  manifest: Manifest,
  module: CatalogModule,
  pageNumber: number,
  sourceUrl: URL,
  html: string,
  details: URL[],
  reportedTotal: number | null,
  evidence: {
    discoveredOnPage: number;
    explicitlyEmpty: boolean;
    terminalWithoutReportedTotal: boolean;
  },
): Promise<void> {
  const safeHtml = sanitizeCatalogHtml(html);
  const basename = `page-${String(pageNumber).padStart(5, "0")}`;
  const directory = path.join(OUTPUT_DIRECTORY, module.key, "pages");
  const htmlPath = path.join(directory, `${basename}.html`);
  const jsonPath = path.join(directory, `${basename}.json`);
  const json = `${JSON.stringify(
    {
      detailUrls: details.map(publicUrl),
      discoveredOnPage: evidence.discoveredOnPage,
      explicitlyEmpty: evidence.explicitlyEmpty,
      fetchedAt: new Date().toISOString(),
      module: module.key,
      raw: extractCatalogRecord(safeHtml),
      reportedTotal,
      sourceUrl: publicUrl(sourceUrl),
      terminalWithoutReportedTotal: evidence.terminalWithoutReportedTotal,
    },
    null,
    2,
  )}\n`;
  await atomicWrite(htmlPath, safeHtml);
  await atomicWrite(jsonPath, json);
  updateArtifact(manifest, artifactFor(htmlPath, safeHtml, "list-html", module, sourceUrl));
  updateArtifact(manifest, artifactFor(jsonPath, json, "list-json", module, sourceUrl));
}

async function saveRecord(
  manifest: Manifest,
  module: CatalogModule,
  sourceUrl: URL,
  html: string,
  id: string,
  listEvidenceHash: string,
): Promise<void> {
  const safeHtml = sanitizeCatalogHtml(html);
  const directory = path.join(OUTPUT_DIRECTORY, module.key, "records");
  const basename = id;
  const htmlPath = path.join(directory, `${basename}.html`);
  const jsonPath = path.join(directory, `${basename}.json`);
  const json = `${JSON.stringify(
    {
      fetchedAt: new Date().toISOString(),
      id,
      listEvidenceHash,
      module: module.key,
      raw: extractCatalogRecord(safeHtml),
      sourceUrl: publicUrl(sourceUrl),
    },
    null,
    2,
  )}\n`;
  await atomicWrite(htmlPath, safeHtml);
  await atomicWrite(jsonPath, json);
  updateArtifact(manifest, artifactFor(htmlPath, safeHtml, "detail-html", module, sourceUrl, listEvidenceHash));
  updateArtifact(manifest, artifactFor(jsonPath, json, "detail-json", module, sourceUrl, listEvidenceHash));
}

function recordPaths(module: CatalogModule, id: string): [string, string] {
  const basename = id;
  const directory = path.join(OUTPUT_DIRECTORY, module.key, "records");
  return [path.join(directory, `${basename}.html`), path.join(directory, `${basename}.json`)];
}

export async function artifactsMatchManifest(
  artifacts: readonly Artifact[],
  moduleKey: string,
  candidates: readonly {
    evidenceHash?: string;
    filePath: string;
    kind: Artifact["kind"];
    manifestPath: string;
    sourceUrl?: string;
  }[],
): Promise<boolean> {
  for (const candidate of candidates) {
    const artifact = artifacts.find(
      (current) =>
        current.path === candidate.manifestPath &&
        current.module === moduleKey &&
        current.kind === candidate.kind &&
        (!candidate.evidenceHash || current.listEvidenceHash === candidate.evidenceHash) &&
        (!candidate.sourceUrl || current.sourceUrl === candidate.sourceUrl),
    );
    if (!artifact || !(await fileMatchesSha256(candidate.filePath, artifact.sha256))) return false;
  }
  return true;
}

async function recordArtifactsAreReusable(
  manifest: Manifest,
  module: CatalogModule,
  htmlPath: string,
  jsonPath: string,
  sourceUrl: URL,
  evidenceHash: string,
): Promise<boolean> {
  const canonicalSourceUrl = publicUrl(sourceUrl);
  return artifactsMatchManifest(manifest.artifacts, module.key, [
    {
      evidenceHash,
      filePath: htmlPath,
      kind: "detail-html",
      manifestPath: relativeArtifactPath(htmlPath),
      sourceUrl: canonicalSourceUrl,
    },
    {
      evidenceHash,
      filePath: jsonPath,
      kind: "detail-json",
      manifestPath: relativeArtifactPath(jsonPath),
      sourceUrl: canonicalSourceUrl,
    },
  ]);
}

function pruneModuleArtifacts(
  manifest: Manifest,
  module: CatalogModule,
  expectedRecordPaths: ReadonlySet<string>,
): void {
  manifest.artifacts = manifest.artifacts.filter((artifact) => {
    if (artifact.module !== module.key) return true;
    if (artifact.kind === "list-html" || artifact.kind === "list-json") return true;
    return expectedRecordPaths.has(artifact.path);
  });
}

function assertCatalogListResponseUrl(url: URL, baseUrl: URL, catalog: CatalogModule): void {
  assertSafeAdminRead(url, baseUrl);
  for (const [key, value] of Object.entries(catalog.list)) {
    if (url.searchParams.get(key) !== value) throw new Error(`Redirecionamento fora da whitelist de ${catalog.key}.`);
  }
  const allowed = new Set([
    ...Object.keys(catalog.list),
    catalogListLimitParameter(catalog),
    "limitstart",
    "list[start]",
  ]);
  if (catalog.list.option === "com_categories") {
    // Algumas versoes do com_categories normalizam list[limit] para limit no redirect.
    allowed.add("limit");
    allowed.add("view");
    allowed.add("layout");
    const view = url.searchParams.get("view");
    const layout = url.searchParams.get("layout");
    if (view && view !== "categories") throw new Error("View de categoria nao autorizada.");
    if (layout && layout !== "default") throw new Error("Layout de categoria nao autorizado.");
  }
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) throw new Error(`Parametro inesperado apos redirecionamento: ${key}.`);
  }
  if (!catalog.singleton) {
    const canonicalLimit = url.searchParams.get(catalogListLimitParameter(catalog));
    const redirectedCategoryLimit =
      catalog.list.option === "com_categories" ? url.searchParams.get("limit") : null;
    if (canonicalLimit !== String(PAGE_LIMIT) && redirectedCategoryLimit !== String(PAGE_LIMIT)) {
      throw new Error("Limite de pagina se perdeu no redirecionamento.");
    }
  }
  const starts = ["limitstart", "list[start]"].filter((key) => url.searchParams.has(key));
  if (starts.length > 1) throw new Error("Redirecionamento retornou paginacao ambigua.");
  for (const key of starts) {
    if (!/^\d+$/.test(url.searchParams.get(key) || "")) throw new Error("Offset redirecionado invalido.");
  }
}

async function scrapeModule(
  client: SameOriginReadClient,
  options: CliOptions,
  manifest: Manifest,
  module: CatalogModule,
): Promise<void> {
  manifest.errors = manifest.errors.filter((error) => error.module !== module.key);
  // As paginas de lista sempre sao recapturadas; remova referencias de uma execucao mais longa anterior.
  manifest.artifacts = manifest.artifacts.filter(
    (artifact) =>
      artifact.module !== module.key ||
      (artifact.kind !== "list-html" && artifact.kind !== "list-json"),
  );
  const periodModules =
    module.key === "irrf"
      ? options.irrfYears.map((year) => ({
          ...module,
          list: { ...module.list, periodo: String(year) },
        }))
      : [module];
  const firstCatalog = periodModules[0] ?? module;
  const firstUrl = listUrl(firstCatalog, options.baseUrl);
  const state: ModuleManifest = {
    completed: false,
    countSource: null,
    detailErrors: 0,
    explicitlyEmpty: false,
    label: module.label,
    pagesFetched: 0,
    recordsDiscovered: 0,
    recordsSaved: 0,
    recordsSkipped: 0,
    reportedTotal: null,
    sourceUrl: publicUrl(firstUrl),
  };
  manifest.modules[module.key] = state;
  await saveManifest(manifest);

  type PendingPage = { catalog: CatalogModule; offset: number; parameter: PageStartParameter };
  const queuedOffsets = new Set([0]);
  const pendingPages: PendingPage[] = periodModules.map((catalog) => ({
    catalog,
    offset: 0,
    parameter: "limitstart",
  }));
  let preferredStartParameter: PageStartParameter | null = null;
  const pageCounts: CatalogPageCountEvidence[] = [];
  const details = new Map<string, CatalogDetailEvidence & { source: URL }>();
  const singletonRecords: Array<{
    evidenceHash: string;
    html: string;
    id: string;
    source: URL;
  }> = [];

  while (pendingPages.length > 0) {
    const page = pendingPages.shift();
    if (!page) break;
    if (state.pagesFetched >= options.maxPages) throw new Error(`${module.key} excedeu --max-pages.`);
    const activeCatalog = page.catalog;
    const url = listUrl(activeCatalog, options.baseUrl, page.offset, page.parameter);
    assertCatalogListUrl(url, options.baseUrl, activeCatalog);
    await delay(options.delayMs);
    const response = await client.get(url, (candidate) =>
      assertCatalogListResponseUrl(candidate, options.baseUrl, activeCatalog),
    );
    if (isLoginPage(response.html)) throw new Error("Sessao Widesys expirou durante a listagem.");

    const pageEvidence = discoverDetailEvidence(response.html, response.url, options.baseUrl, activeCatalog);
    const pageDetails = pageEvidence.map((detail) => detail.url);
    for (const detail of pageEvidence) {
      if (details.has(detail.id)) {
        throw new Error(`A listagem repetiu o ID ${detail.id} em paginas diferentes.`);
      }
      details.set(detail.id, { ...detail, source: response.url });
    }
    const reportedTotal = parseReportedTotal(response.html);
    if (!catalogPageHasEvidence(response.html, pageEvidence.length, reportedTotal, activeCatalog.singleton)) {
      throw new Error(`${module.key} retornou HTML sem evidencia estrutural do catalogo esperado.`);
    }
    const explicitlyEmpty =
      !activeCatalog.singleton &&
      pageEvidence.length === 0 &&
      catalogPageExplicitlyEmpty(response.html);
    const discoveredCursors = discoverPageCursors(response.html);
    if (!activeCatalog.singleton && !preferredStartParameter && discoveredCursors.length > 0) {
      preferredStartParameter = discoveredCursors[0]?.parameter ?? null;
    }
    for (const cursor of activeCatalog.singleton ? [] : discoveredCursors) {
      if (cursor.offset === 0 || queuedOffsets.has(cursor.offset)) continue;
      queuedOffsets.add(cursor.offset);
      pendingPages.push({ ...cursor, catalog: activeCatalog });
    }
    if (!activeCatalog.singleton && reportedTotal !== null) {
      for (let next = PAGE_LIMIT; next < reportedTotal; next += PAGE_LIMIT) {
        if (!queuedOffsets.has(next)) {
          queuedOffsets.add(next);
          pendingPages.push({
            catalog: activeCatalog,
            offset: next,
            parameter: preferredStartParameter ?? "limitstart",
          });
        }
      }
    }

    state.pagesFetched += 1;
    const terminalWithoutReportedTotal =
      !activeCatalog.singleton &&
      reportedTotal === null &&
      pageEvidence.length < PAGE_LIMIT &&
      !discoveredCursors.some((cursor) => cursor.offset > page.offset);
    if (!activeCatalog.singleton) {
      pageCounts.push({
        discovered: pageEvidence.length,
        explicitlyEmpty,
        nextOffsets: discoveredCursors.map((cursor) => cursor.offset),
        offset: page.offset,
        reportedTotal,
      });
    }
    await savePage(
      manifest,
      module,
      state.pagesFetched,
      response.url,
      response.html,
      pageDetails,
      reportedTotal,
      {
        discoveredOnPage: activeCatalog.singleton ? 1 : pageEvidence.length,
        explicitlyEmpty,
        terminalWithoutReportedTotal,
      },
    );
    if (activeCatalog.singleton) {
      const period = activeCatalog.list.periodo;
      const id = module.key === "irrf" && period ? `year-${period}` : "singleton";
      singletonRecords.push({
        evidenceHash: sha256(
          JSON.stringify(extractCatalogRecord(sanitizeCatalogHtml(response.html))),
        ),
        html: response.html,
        id,
        source: response.url,
      });
    }
    state.recordsDiscovered = activeCatalog.singleton ? singletonRecords.length : details.size;
    await saveManifest(manifest);
  }

  if (module.singleton) {
    state.countSource = "singleton";
    state.explicitlyEmpty = false;
    state.reportedTotal = singletonRecords.length;
  } else {
    const count = resolveCatalogCount(pageCounts);
    state.countSource = count.source;
    state.explicitlyEmpty = count.explicitlyEmpty;
    state.reportedTotal = count.total;
  }

  if (module.singleton && singletonRecords.length > 0) {
    const expectedRecordPaths = new Set<string>();
    for (const record of singletonRecords) {
      for (const filePath of recordPaths(module, record.id)) {
        expectedRecordPaths.add(relativeArtifactPath(filePath));
      }
    }
    pruneModuleArtifacts(
      manifest,
      module,
      expectedRecordPaths,
    );
    for (const record of singletonRecords) {
      const [htmlPath, jsonPath] = recordPaths(module, record.id);
      if (
        options.captureMode === "resume" &&
        (await recordArtifactsAreReusable(
          manifest,
          module,
          htmlPath,
          jsonPath,
          record.source,
          record.evidenceHash,
        ))
      ) {
        state.recordsSkipped += 1;
      } else {
        await saveRecord(
          manifest,
          module,
          record.source,
          record.html,
          record.id,
          record.evidenceHash,
        );
        state.recordsSaved += 1;
      }
    }
  } else {
    state.recordsDiscovered = details.size;
    const expectedRecordPaths = new Set<string>();
    for (const detail of details.values()) {
      const id = detail.id;
      for (const filePath of recordPaths(module, id)) {
        expectedRecordPaths.add(relativeArtifactPath(filePath));
      }
    }
    pruneModuleArtifacts(manifest, module, expectedRecordPaths);
    for (const [index, detail] of [...details.values()].entries()) {
      const detailUrl = detail.url;
      const id = detail.id;
      const sourceUrl = module.listOnly ? detail.source : detailUrl;
      const [htmlPath, jsonPath] = recordPaths(module, id);
      if (
        options.captureMode === "resume" &&
        (await recordArtifactsAreReusable(
          manifest,
          module,
          htmlPath,
          jsonPath,
          sourceUrl,
          detail.evidenceHash,
        ))
      ) {
        state.recordsSkipped += 1;
        continue;
      }
      try {
        if (!catalogRequiresDetailFetch(module)) {
          if (!module.listOnly || !detail.listSnapshotHtml) {
            throw new Error("Modulo sem detalhe nao possui linha autoritativa verificavel.");
          }
          await saveRecord(
            manifest,
            module,
            detail.source,
            detail.listSnapshotHtml,
            id,
            detail.evidenceHash,
          );
        } else {
          assertCatalogDetailUrl(detailUrl, options.baseUrl, module, id);
          await delay(options.delayMs);
          const response = await client.get(detailUrl, (candidate) =>
            assertCatalogDetailUrl(candidate, options.baseUrl, module, id),
          );
          assertCatalogDetailUrl(response.url, options.baseUrl, module, id);
          if (isLoginPage(response.html)) throw new Error("Sessao Widesys expirou durante um detalhe.");
          if (!catalogPageHasEvidence(response.html, 0, null, true)) {
            throw new Error("Detalhe retornou HTML sem formulario ou tabela do cadastro esperado.");
          }
          await saveRecord(manifest, module, response.url, response.html, id, detail.evidenceHash);
        }
        state.recordsSaved += 1;
      } catch (error) {
        state.detailErrors += 1;
        addError(manifest, error, "DETAIL_FETCH_FAILED", module, detailUrl);
      }
      if ((index + 1) % 20 === 0 || index + 1 === details.size) await saveManifest(manifest);
    }
  }

  const countMismatch = !catalogCountMatches(
    state.reportedTotal,
    state.recordsDiscovered,
    module.singleton,
    state.explicitlyEmpty,
  );
  if (countMismatch) {
    addError(
      manifest,
      new Error(
        `Listagem reconciliou ${state.reportedTotal}, mas ${state.recordsDiscovered} registros unicos foram descobertos.`,
      ),
      "COUNT_MISMATCH",
      module,
      firstUrl,
    );
  }
  state.completed = state.detailErrors === 0 && !countMismatch;
  await saveManifest(manifest);
}

export function catalogCaptureExitCode(completedModules: number, requestedModules: number): 0 | 2 {
  return requestedModules > 0 && completedModules === requestedModules ? 0 : 2;
}

export async function main(): Promise<void> {
  const options = parseCatalogArgs(process.argv.slice(2));
  console.log(`Origem validada: ${options.baseUrl.origin}`);
  console.log(`Catalogos: ${options.modules.map((module) => module.key).join(", ")}`);
  console.log(`Destino ignorado pelo Git: ${OUTPUT_DIRECTORY}`);
  if (options.dryRun) {
    console.log("Dry-run concluido: nenhuma credencial lida, requisicao feita ou arquivo criado.");
    return;
  }

  const username = (process.env.WIDESYS_USUARIO || "").trim();
  let password = process.env.WIDESYS_SENHA || "";
  if (!username || !password) {
    throw new Error("Defina WIDESYS_USUARIO e WIDESYS_SENHA no ambiente. Entrada interativa nao e aceita.");
  }

  await mkdir(OUTPUT_DIRECTORY, { mode: 0o700, recursive: true });
  const manifest = await loadManifest(options);
  await saveManifest(manifest);
  const client = new SameOriginReadClient(options.baseUrl);
  try {
    await login(client, options, username, password);
  } finally {
    password = "";
  }
  console.log("Autenticacao concluida; cookies e credenciais permanecem somente em memoria.");

  for (const catalog of options.modules) {
    try {
      console.log(`[${catalog.key}] leitura GET iniciada.`);
      await scrapeModule(client, options, manifest, catalog);
      const state = manifest.modules[catalog.key];
      console.log(
        `[${catalog.key}] ${state?.pagesFetched ?? 0} pagina(s), ${state?.recordsSaved ?? 0} salvo(s), ${state?.recordsSkipped ?? 0} retomado(s).`,
      );
    } catch (error) {
      addError(manifest, error, "MODULE_FAILED", catalog, listUrl(catalog, options.baseUrl));
      await saveManifest(manifest);
      console.warn(`[${catalog.key}] falhou de forma isolada; consulte o manifesto.`);
    }
  }

  manifest.completedAt = new Date().toISOString();
  await saveManifest(manifest);
  const completed = options.modules.filter((catalog) => manifest.modules[catalog.key]?.completed).length;
  const available = options.modules.reduce((total, catalog) => {
    const state = manifest.modules[catalog.key];
    return total + (state?.recordsSaved ?? 0) + (state?.recordsSkipped ?? 0);
  }, 0);
  console.log(`Coleta encerrada: ${completed}/${options.modules.length} catalogos completos; ${available} registros.`);
  console.log("Revise data/legacy-widesys/catalogos/manifest.json antes de qualquer importacao.");
  const exitCode = catalogCaptureExitCode(completed, options.modules.length);
  if (exitCode !== 0) {
    console.error("Captura incompleta preservada para auditoria; o processo terminou com codigo 2.");
    process.exitCode = exitCode;
  }
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  main().catch((error) => {
    const message = redactSensitiveText(error instanceof Error ? error.message : "Erro desconhecido.");
    console.error(`Falha segura: ${normalizeText(message).slice(0, 500)}`);
    process.exitCode = 1;
  });
}
