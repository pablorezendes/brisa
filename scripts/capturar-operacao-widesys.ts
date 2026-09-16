#!/usr/bin/env tsx

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { conteudoHashManifestoOperacao } from "../src/lib/importacao/manifesto-operacao-widesys";
import {
  extrairPartesContratoWidesys,
  type ParteContratoWidesys,
} from "../src/lib/importacao/partes-contrato-widesys";
import {
  decodeHtml,
  extractAnchors,
  extractOnclickUrls,
  extractRecord,
  isJoomlaLoginPage,
  parseAttributes,
  parseTotal,
  sanitizeHtml,
  sha256,
  stripTags,
} from "./widesys-parser";

const DEFAULT_BASE_URL = "https://brisaazul.app2.widesys.com.br/administrator/index.php?admin";
const OUTPUT_DIRECTORY = path.resolve(process.cwd(), "data", "legacy-widesys", "operacao");
const PAGE_LIMIT = 200;
const DEFAULT_DELAY_MS = 250;
const DEFAULT_MAX_PAGES = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;
const BUSINESS_TIME_ZONE = "America/Sao_Paulo";
const SCOPE_SHARD_SIZE = 100;

const MODULES = {
  contratos: {
    detailTask: "locacao.edit",
    detailView: "locacao",
    listView: "locacaos",
    mode: "detail",
  },
  "contas-receber": {
    dateField: "planoparcelas.data_vencimento",
    defaultFrom: "2025-07",
    listView: "financontasrecebers",
    mode: "parcela-ajax",
  },
  "contas-pagar": {
    dateField: "planoparcelas.data_vencimento",
    defaultFrom: "2025-11",
    listView: "financontaspagars",
    mode: "parcela-ajax",
  },
  movimentacoes: {
    dateField: "lancamento.data_lancamento",
    defaultFrom: "2025-12",
    detailTask: "finanlancamento.edit",
    detailView: "finanlancamento",
    listView: "finanlancamentos",
    mode: "detail",
  },
} as const;

type ModuleName = keyof typeof MODULES;
type CaptureMode = "new" | "refresh" | "resume";

type CliOptions = {
  baseUrl: URL;
  captureMode: CaptureMode;
  delayMs: number;
  dryRun: boolean;
  fromMonth: string | null;
  maxPages: number;
  modules: ModuleName[];
  titlesTo: string;
  toMonth: string;
};

type ArtifactKind = "detail-html" | "detail-json" | "list-html" | "list-json";

type Artifact = {
  bytes: number;
  kind: ArtifactKind;
  module: ModuleName;
  path: string;
  sha256: string;
  sourceUrl: string;
  window: string;
};

type ManifestError = {
  at: string;
  code: string;
  legacyId?: string;
  message: string;
  module?: ModuleName;
  sourceUrl?: string;
  window?: string;
};

type WindowManifest = {
  completed: boolean;
  duplicateIds: number;
  pagesFetched: number;
  recordsDiscovered: number;
  reportedTotal: number | null;
};

type ModuleManifest = {
  completed: boolean;
  detailErrors: number;
  duplicateIds: number;
  globalCountVerified: boolean;
  globalReportedTotal: number | null;
  listView: string;
  recordsDiscovered: number;
  recordsSaved: number;
  recordsSkipped: number;
  windows: Record<string, WindowManifest>;
};

export function verifyGlobalOperationalTotal(
  recordsDiscovered: number,
  globalReportedTotal: number | null,
): boolean {
  return (
    Number.isSafeInteger(recordsDiscovered) &&
    recordsDiscovered >= 0 &&
    globalReportedTotal !== null &&
    Number.isSafeInteger(globalReportedTotal) &&
    globalReportedTotal >= 0 &&
    recordsDiscovered === globalReportedTotal
  );
}

type Manifest = {
  artifacts: Artifact[];
  baseOrigin: string;
  businessDate: string;
  captureId: string;
  capturedAt: string | null;
  complete: boolean;
  completedAt: string | null;
  contentHash: string;
  errors: ManifestError[];
  files: Array<{ count: number; path: string; scope: ScopeName; sha256: string }>;
  modules: Partial<Record<ModuleName, ModuleManifest>>;
  options: {
    captureMode: CaptureMode;
    delayMs: number;
    fromMonth: string | null;
    limit: number;
    maxPages: number;
    modules: ModuleName[];
    titlesTo: string;
    toMonth: string;
  };
  startedAt: string;
  updatedAt: string;
  version: 2;
  schemaVersion: 2;
  sourceOrigin: string;
  timeZone: typeof BUSINESS_TIME_ZONE;
};

type LoginSubmission = {
  action: string;
  fields: Map<string, string>;
  passwordField: string;
  usernameField: string;
};

export type LegacyListRow = {
  cells: string[];
  contentHash: string;
  headers: string[];
  legacyId: string;
  navigationCandidates: string[];
  parcelaIdentity?: {
    contaPagarId?: string;
    contaReceberId?: string;
    numeroParcela: string;
    parcelaId: string;
  };
  parcelaInfoCandidates: Array<{ endpoint: string; query: string }>;
  references?: LegacyListReference[];
};

export type LegacyListReference = {
  entidade: "CONTRATO" | "PESSOA";
  legadoId: string;
  papelOrigem: "INQUILINO" | "LOCACAO" | "OUTRO" | "PROPRIETARIO";
};

export function persistableListRows(rows: LegacyListRow[]) {
  return rows.map(({ cells, contentHash, headers, legacyId, references }) => ({
    cells,
    contentHash,
    headers,
    legacyId,
    ...(references && references.length > 0 ? { references } : {}),
  }));
}

export function requireReportedTotal(total: number | null): number {
  if (total === null) {
    throw new Error("A listagem não expôs uma contagem total verificável.");
  }
  return total;
}

export function verifiedOperationalTotal(html: string, rows: LegacyListRow[]): number {
  const reported = parseTotal(html);
  if (reported !== null) return requireReportedTotal(reported);
  const hasAuthoritativeEmptyList =
    rows.length === 0 &&
    /<table\b/i.test(html) &&
    /<th\b/i.test(html) &&
    /<select\b[^>]*(?:id|name)=["'](?:list_limit|list\[limit\]|limit)["']/i.test(html);
  if (hasAuthoritativeEmptyList) return 0;
  return requireReportedTotal(null);
}

type CaptureWindow = { end: string; key: string; start: string };
type ScopeName = "contas_pagar" | "contas_receber" | "contratos" | "movimentos";
type DetailTarget = { transport: string; url: URL };
type PendingRecord = {
  row: LegacyListRow;
  sourceWindow: string;
  targets: DetailTarget[];
};
type CapturedRecord = {
  baixas: Array<Record<string, string>>;
  capturedAt: string;
  details: Array<{
    contentHash: string;
    raw: ReturnType<typeof extractRecord>;
    sourceUrl: string;
    transport: string;
  }>;
  fields: Record<string, string | string[]>;
  list: {
    cells: string[];
    contentHash: string;
    headers: string[];
    references?: LegacyListReference[];
    sourceWindow: string;
  };
  raw: {
    fields: ReturnType<typeof extractRecord>["fields"];
    tables: ReturnType<typeof extractRecord>["tables"];
    text: string;
    title: string;
  };
  legacyId: string;
  partes?: ParteContratoWidesys[];
  sourceUrl: string;
};

type RecordCheckpointEvidence = {
  legacyId: string;
  rowContentHash: string;
  sourceWindow: string;
  targets: Array<{ sourceUrl: string; transport: string }>;
};

type RecordCheckpoint = {
  artifacts: Artifact[];
  captureId: string;
  contentHash: string;
  evidence: RecordCheckpointEvidence;
  legacyId: string;
  module: ModuleName;
  version: 1;
};

const SCOPES: Record<ModuleName, ScopeName> = {
  contratos: "contratos",
  "contas-receber": "contas_receber",
  "contas-pagar": "contas_pagar",
  movimentacoes: "movimentos",
};

export function businessDateIso(
  instant = new Date(),
  timeZone = BUSINESS_TIME_ZONE,
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day) throw new Error(`Não foi possível calcular a data civil em ${timeZone}.`);
  return `${year}-${month}-${day}`;
}

function currentMonth(): string {
  return businessDateIso().slice(0, 7);
}

function usage(): string {
  return `Uso: npm run legacy:capture-operation -- [opções]

Captura operacional SOMENTE LEITURA (GET após o login):
  contratos, contas-receber, contas-pagar e movimentacoes

Opções:
  --dry-run                 valida rotas, período e destino sem acessar o legado
  --refresh                 refaz a captura e o manifesto atual (padrão)
  --resume                  retoma detalhes ausentes de uma captura interrompida
  --no-resume               falha se já existir manifesto
  --modules=a,b             módulos: ${Object.keys(MODULES).join(", ")}
  --from=AAAA-MM            substitui o início conhecido de todos os módulos mensais
  --to=AAAA-MM              último mês, inclusivo (padrão: ${currentMonth()})
  --titles-to=AAAA-MM-DD    horizonte futuro de receber/pagar (padrão: 2100-12-31)
  --base-url=https://...    URL inicial do administrador Widesys
  --delay-ms=250            intervalo entre requisições
  --max-pages=10000         trava de segurança para paginação
  --help                    mostra esta ajuda

Inícios conhecidos sem --from: receber 2025-07, pagar 2025-11 e movimentos 2025-12.
Receber/pagar são mensais até --to e usam uma janela futura adicional até
--titles-to, para não perder parcelas vincendas. Movimentos terminam em --to.
Contas a receber/pagar usam o endpoint GET ajax.getParcelaInfo; tarefas de editar,
liquidar, gerar cobrança, boleto ou retorno bancário não são acessadas.

Credenciais temporárias:
  WIDESYS_USUARIO           usuário; se ausente, será solicitado
  WIDESYS_SENHA             senha; se ausente, será solicitada sem eco

Nenhuma senha, cookie ou token é gravado. Os artefatos pessoais ficam sob
data/legacy-widesys/operacao/, diretório ignorado pelo Git.`;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} precisa ser um inteiro não negativo.`);
  }
  return parsed;
}

function assertMonth(value: string, flag: string): string {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) throw new Error(`${flag} precisa usar AAAA-MM.`);
  return value;
}

function assertIsoDate(value: string, flag: string): string {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value)) {
    throw new Error(`${flag} precisa usar AAAA-MM-DD.`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) {
    throw new Error(`${flag} contém uma data inválida.`);
  }
  return value;
}

export function parseArgs(argv: string[]): CliOptions {
  let baseUrl = new URL(process.env.WIDESYS_BASE_URL || DEFAULT_BASE_URL);
  let captureMode: CaptureMode = "refresh";
  let delayMs = DEFAULT_DELAY_MS;
  let dryRun = false;
  let fromMonth: string | null = null;
  let maxPages = DEFAULT_MAX_PAGES;
  let modules = Object.keys(MODULES) as ModuleName[];
  let titlesTo = "2100-12-31";
  let toMonth = currentMonth();

  for (const argument of argv) {
    if (argument === "--help" || argument === "-h") {
      console.log(usage());
      process.exit(0);
    } else if (argument === "--dry-run") dryRun = true;
    else if (argument === "--refresh") captureMode = "refresh";
    else if (argument === "--resume") captureMode = "resume";
    else if (argument === "--no-resume") captureMode = "new";
    else if (argument.startsWith("--base-url=")) baseUrl = new URL(argument.slice("--base-url=".length));
    else if (argument.startsWith("--delay-ms=")) {
      delayMs = parsePositiveInteger(argument.slice("--delay-ms=".length), "--delay-ms");
    } else if (argument.startsWith("--max-pages=")) {
      maxPages = parsePositiveInteger(argument.slice("--max-pages=".length), "--max-pages");
      if (maxPages === 0) throw new Error("--max-pages precisa ser maior que zero.");
    } else if (argument.startsWith("--from=")) {
      fromMonth = assertMonth(argument.slice("--from=".length), "--from");
    } else if (argument.startsWith("--to=")) {
      toMonth = assertMonth(argument.slice("--to=".length), "--to");
    } else if (argument.startsWith("--titles-to=")) {
      titlesTo = assertIsoDate(argument.slice("--titles-to=".length), "--titles-to");
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
    } else throw new Error(`Opção desconhecida: ${argument}`);
  }

  if (fromMonth && fromMonth > toMonth) throw new Error("--from não pode ser posterior a --to.");
  if (titlesTo.slice(0, 7) < toMonth) throw new Error("--titles-to não pode ser anterior ao mês de --to.");
  if (baseUrl.protocol !== "https:") throw new Error("A URL do Widesys precisa usar HTTPS.");
  if (baseUrl.origin !== new URL(DEFAULT_BASE_URL).origin) {
    throw new Error("A URL inicial precisa usar a origem Widesys autorizada.");
  }
  if (baseUrl.pathname !== "/administrator/index.php") {
    throw new Error("A URL inicial precisa ser exatamente /administrator/index.php.");
  }
  assertUniqueSearchParams(baseUrl);
  for (const key of baseUrl.searchParams.keys()) {
    if (key !== "admin") throw new Error(`Parâmetro não autorizado na URL inicial: ${key}.`);
  }
  baseUrl.hash = "";
  return { baseUrl, captureMode, delayMs, dryRun, fromMonth, maxPages, modules, titlesTo, toMonth };
}

function monthSequence(from: string, to: string): string[] {
  if (from > to) return [];
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  const result: string[] = [];
  let year = fromYear;
  let month = fromMonth;
  while (year < toYear || (year === toYear && month <= toMonth)) {
    result.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      year += 1;
      month = 1;
    }
  }
  return result;
}

function legacyMonthBounds(month: string): { end: string; start: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    end: `${String(lastDay).padStart(2, "0")}-${String(monthNumber).padStart(2, "0")}-${year}`,
    start: `01-${String(monthNumber).padStart(2, "0")}-${year}`,
  };
}

function toLegacyDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}-${month}-${year}`;
}

function nextMonthStart(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const next = monthNumber === 12 ? [year + 1, 1] : [year, monthNumber + 1];
  return `${next[0]}-${String(next[1]).padStart(2, "0")}-01`;
}

function todayIso(): string {
  return businessDateIso();
}

function moduleWindows(module: ModuleName, options: CliOptions): CaptureWindow[] {
  const definition = MODULES[module];
  if (!("dateField" in definition)) return [{ end: "", key: "todos", start: "" }];
  const months = monthSequence(options.fromMonth || definition.defaultFrom, options.toMonth);
  const windows = months.map((month) => {
    const bounds = legacyMonthBounds(month);
    if (module === "movimentacoes" && month === currentMonth() && options.toMonth === currentMonth()) {
      bounds.end = toLegacyDate(todayIso());
    }
    return { ...bounds, key: month };
  });
  if (module === "contas-receber" || module === "contas-pagar") {
    const futureStart = nextMonthStart(options.toMonth);
    if (futureStart <= options.titlesTo) {
      windows.push({
        end: toLegacyDate(options.titlesTo),
        key: `futuro-${futureStart}--${options.titlesTo}`,
        start: toLegacyDate(futureStart),
      });
    }
  }
  return windows;
}

function splitSetCookie(header: string): string[] {
  return header.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g);
}

type RequestGuard = (url: URL, method: "GET" | "POST") => void;

class SameOriginClient {
  private readonly cookies = new Map<string, string>();

  async get(url: URL, guard: RequestGuard): Promise<{ html: string; url: URL }> {
    return this.request(url, "GET", guard);
  }

  async postLogin(url: URL, form: URLSearchParams, guard: RequestGuard): Promise<{ html: string; url: URL }> {
    return this.request(url, "POST", guard, form.toString());
  }

  private async request(
    initialUrl: URL,
    initialMethod: "GET" | "POST",
    guard: RequestGuard,
    initialBody?: string,
  ): Promise<{ html: string; url: URL }> {
    let url = new URL(initialUrl);
    let method = initialMethod;
    let body = initialBody;
    for (let redirects = 0; redirects <= 10; redirects += 1) {
      guard(url, method);
      const headers: Record<string, string> = {
        Accept: "text/html,application/xhtml+xml,text/plain",
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
        const redirected = new URL(location, url);
        let redirectedMethod = method;
        if (method === "POST") {
          if (![301, 302, 303].includes(response.status)) {
            throw new Error("Redirecionamento de login que repetiria POST foi bloqueado.");
          }
          redirectedMethod = "GET";
          body = undefined;
        }
        // O mesmo contrato de rota vale para cada salto. Um Location apenas
        // same-origin não basta: ele poderia apontar para save/checkout/logout.
        guard(redirected, redirectedMethod);
        url = redirected;
        method = redirectedMethod;
        continue;
      }

      if (!response.ok) throw new Error(`O legado respondeu HTTP ${response.status}.`);
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (contentType && !/(?:text\/html|application\/xhtml\+xml|text\/plain)/.test(contentType)) {
        throw new Error(`Resposta inesperada do legado (${contentType}).`);
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
      const firstPart = cookie.split(";", 1)[0]?.trim();
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

function assertUniqueSearchParams(url: URL): void {
  const names = new Set(url.searchParams.keys());
  for (const name of names) {
    if (url.searchParams.getAll(name).length !== 1) {
      throw new Error(`Parâmetro duplicado bloqueado: ${name}.`);
    }
  }
}

function sortedSearchParams(url: URL): Array<[string, string]> {
  return [...url.searchParams.entries()].sort(([leftName, leftValue], [rightName, rightValue]) =>
    leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue),
  );
}

export function assertEquivalentOperationalUrl(actual: URL, expected: URL): void {
  assertUniqueSearchParams(actual);
  assertUniqueSearchParams(expected);
  if (
    actual.protocol !== expected.protocol ||
    actual.origin !== expected.origin ||
    actual.pathname !== expected.pathname ||
    actual.username !== expected.username ||
    actual.password !== expected.password ||
    actual.hash !== expected.hash ||
    JSON.stringify(sortedSearchParams(actual)) !== JSON.stringify(sortedSearchParams(expected))
  ) {
    throw new Error("Redirect/resposta alterou a URL operacional solicitada.");
  }
}

function assertAdminUrl(url: URL, baseUrl: URL): void {
  assertUniqueSearchParams(url);
  if (url.origin !== baseUrl.origin) throw new Error("URL externa bloqueada.");
  if (url.pathname !== baseUrl.pathname) throw new Error("Path fora do index administrativo bloqueado.");
  if (url.username || url.password) throw new Error("URL com credenciais embutidas bloqueada.");
  if (url.protocol !== "https:") throw new Error("URL sem HTTPS bloqueada.");
}

export function assertLoginRoute(url: URL, baseUrl: URL, method: "GET" | "POST"): void {
  assertAdminUrl(url, baseUrl);
  if (url.pathname !== baseUrl.pathname) throw new Error("Rota de login fora do index administrativo bloqueada.");
  const allowed = new Set(method === "POST" ? ["admin", "option", "task"] : ["admin", "option", "view"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) throw new Error(`Parâmetro inesperado no fluxo de login: ${key}.`);
  }
  const option = url.searchParams.get("option");
  if (method === "POST") {
    if (option && option !== "com_login") throw new Error("POST fora do componente de login bloqueado.");
    const task = url.searchParams.get("task");
    if (task && task !== "login") throw new Error("Task que não é login foi bloqueada.");
  } else {
    if (option && !["com_login", "com_cpanel", "com_widesys"].includes(option)) {
      throw new Error("Redirecionamento do login para componente inesperado bloqueado.");
    }
    const view = url.searchParams.get("view");
    const allowedView =
      !view ||
      (option === "com_login" && view === "login") ||
      (option === "com_cpanel" && view === "cpanel") ||
      (option === "com_widesys" && view === "dashboard");
    if (!allowedView) throw new Error("View inesperada no fluxo de login bloqueada.");
  }
}

export function assertListUrl(url: URL, baseUrl: URL, module: ModuleName): void {
  assertAdminUrl(url, baseUrl);
  const definition = MODULES[module];
  if (url.searchParams.get("option") !== "com_widesys" || url.searchParams.get("view") !== definition.listView) {
    throw new Error(`Listagem fora de ${definition.listView} bloqueada.`);
  }
  if (url.searchParams.get("limit") !== String(PAGE_LIMIT)) {
    throw new Error("Listagem sem limit=200 bloqueada.");
  }
  const allowed = new Set(["option", "view", "limit", "limitstart"]);
  if (module === "contratos") allowed.add("filter[locacao.situacao_contrato_catid]");
  if ("dateField" in definition) {
    allowed.add(`filter[${definition.dateField}_startreport]`);
    allowed.add(`filter[${definition.dateField}_endreport]`);
    if (module === "contas-receber" || module === "contas-pagar") {
      allowed.add("filter[planoparcelas.situacao]");
    }
  }
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) throw new Error(`Parâmetro de listagem não autorizado: ${key}.`);
  }
  const offset = url.searchParams.get("limitstart");
  if (offset === null || !/^\d+$/.test(offset)) {
    throw new Error("Listagem sem offset explícito ou com offset inválido.");
  }
}

export function assertCanonicalOperationalDetailUrl(
  url: URL,
  baseUrl: URL,
  module: ModuleName,
  expectedId: string,
): void {
  assertAdminUrl(url, baseUrl);
  const definition = MODULES[module];
  if (definition.mode !== "detail") throw new Error("Este módulo não autoriza telas de edição.");
  if (url.searchParams.get("option") !== "com_widesys") throw new Error("Detalhe fora do com_widesys.");
  if (url.searchParams.has("task")) throw new Error("GET com task foi bloqueado para evitar checkout/lock.");
  if (url.searchParams.get("view") !== definition.detailView || url.searchParams.get("layout") !== "edit") {
    throw new Error("View/layout de detalhe não autorizados.");
  }
  if (url.searchParams.get("id") !== expectedId || !/^\d+$/.test(expectedId)) {
    throw new Error("ID do detalhe não confere com a linha de origem.");
  }
  const allowed = new Set(["option", "view", "layout", "id"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) throw new Error(`Parâmetro de detalhe não autorizado: ${key}.`);
  }
}

function assertDetailResponseUrl(url: URL, baseUrl: URL, module: ModuleName, expectedId: string): void {
  assertCanonicalOperationalDetailUrl(url, baseUrl, module, expectedId);
}

export function assertParcelaInfoUrl(
  url: URL,
  baseUrl: URL,
  module: ModuleName,
  expectedId: string,
  identity?: LegacyListRow["parcelaIdentity"],
): string {
  assertAdminUrl(url, baseUrl);
  if (url.searchParams.get("option") !== "com_widesys" || url.searchParams.get("view") !== "ajax") {
    throw new Error("Endpoint AJAX fora do com_widesys/ajax.");
  }
  if (url.searchParams.get("format") !== "raw") throw new Error("Endpoint AJAX sem format=raw.");
  const task = url.searchParams.get("task") || "";
  const allowed = new Set(["option", "view", "format", "task"]);
  if (module === "contas-receber" && task === "ajax.getParcelaInfo") {
    if (url.searchParams.get("parcela_id") !== expectedId) throw new Error("parcela_id de recebimento divergente.");
    allowed.add("parcela_id");
  } else if (module === "contas-pagar" && task === "ajax.getParcelaInfoPagar") {
    if (url.searchParams.get("parcela_id") !== expectedId) throw new Error("parcela_id de pagamento divergente.");
    allowed.add("parcela_id");
  } else if (module === "contas-receber" && task === "ajax.getDetalhesRecebimento") {
    if (
      !identity ||
      identity.parcelaId !== expectedId ||
      !identity.contaReceberId ||
      url.searchParams.get("conta_receber_id") !== identity.contaReceberId
    ) {
      throw new Error("conta_receber_id não pertence ao título esperado.");
    }
    if (url.searchParams.get("numero_parcela") !== identity.numeroParcela) {
      throw new Error("numero_parcela de recebimento divergente.");
    }
    allowed.add("conta_receber_id");
    allowed.add("numero_parcela");
  } else if (module === "contas-pagar" && task === "ajax.getDetalhesPagamento") {
    if (
      !identity ||
      identity.parcelaId !== expectedId ||
      !identity.contaPagarId ||
      url.searchParams.get("conta_pagar_id") !== identity.contaPagarId
    ) {
      throw new Error("conta_pagar_id não pertence ao título esperado.");
    }
    if (url.searchParams.get("numero_parcela") !== identity.numeroParcela) {
      throw new Error("numero_parcela de pagamento divergente.");
    }
    allowed.add("conta_pagar_id");
    allowed.add("numero_parcela");
  } else throw new Error(`Task AJAX não autorizada para ${module}.`);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) throw new Error(`Parâmetro AJAX não autorizado: ${key}.`);
  }
  return task;
}

export function publicUrl(input: URL): string {
  const url = new URL(input);
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) {
    if (
      /(?:^|[_-])(?:token|csrf|secret|password|passwd|senha|return|authorization|cookie|api[_-]?key|client[_-]?secret)(?:$|[_-])/i.test(
        key,
      ) || /^[a-f\d]{24,128}$/i.test(key)
    ) {
      url.searchParams.delete(key);
    }
  }
  url.hash = "";
  return url.toString();
}

export function buildListUrl(baseUrl: URL, module: ModuleName, window: CaptureWindow, offset: number): URL {
  const definition = MODULES[module];
  const url = new URL(baseUrl.pathname, baseUrl.origin);
  url.searchParams.set("option", "com_widesys");
  url.searchParams.set("view", definition.listView);
  url.searchParams.set("limit", String(PAGE_LIMIT));
  // Joomla persiste `limitstart` na sessão. Enviar zero é obrigatório para que
  // uma nova janela mensal não herde a última página da janela anterior.
  url.searchParams.set("limitstart", String(offset));
  if ("dateField" in definition) {
    url.searchParams.set(`filter[${definition.dateField}_startreport]`, window.start);
    url.searchParams.set(`filter[${definition.dateField}_endreport]`, window.end);
    if (module === "contas-receber" || module === "contas-pagar") {
      // A tela Joomla assume "Pendente" quando esse filtro não é enviado com
      // o nome completo. O parâmetro curto `situacao` é ignorado silenciosamente.
      url.searchParams.set("filter[planoparcelas.situacao]", "");
    }
  }
  if (module === "contratos") url.searchParams.set("filter[locacao.situacao_contrato_catid]", "");
  assertListUrl(url, baseUrl, module);
  return url;
}

function resolveCandidate(candidate: string, current: URL): URL | null {
  if (!candidate || /^(?:javascript:|mailto:|tel:|#)/i.test(candidate.trim())) return null;
  try {
    return new URL(candidate, current);
  } catch {
    return null;
  }
}

function effectiveListLimit(html: string): number | null {
  for (const match of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const attributes = parseAttributes(match[1] ?? "");
    if (attributes.id !== "list_limit" && attributes.name !== "list[limit]" && attributes.name !== "limit") continue;
    const selected = [...(match[2] ?? "").matchAll(/<option\b([^>]*)>/gi)]
      .map((option) => parseAttributes(option[1] ?? ""))
      .find((option) => "selected" in option);
    const fallback = parseAttributes((match[2] ?? "").match(/<option\b([^>]*)>/i)?.[1] ?? "");
    const value = selected?.value || fallback.value;
    return /^\d+$/.test(value || "") ? Number.parseInt(value, 10) : null;
  }
  return null;
}

export function nextOperationalPageOffset(
  currentOffset: number,
  reportedTotal: number | null,
  rowsOnPage: number,
  pagesFetched: number,
  maxPages: number,
): number | null {
  const hasNext =
    reportedTotal !== null
      ? currentOffset + PAGE_LIMIT < reportedTotal
      : rowsOnPage >= PAGE_LIMIT;
  if (!hasNext) return null;
  if (pagesFetched >= maxPages) throw new Error("A listagem excedeu --max-pages antes de chegar à última página.");
  return currentOffset + PAGE_LIMIT;
}

export function extractLegacyListRows(html: string): LegacyListRow[] {
  const rows: LegacyListRow[] = [];
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  const containers = tables.length > 0 ? tables.map((match) => match[0]) : [html];
  for (const container of containers) {
    const headers = [...container.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((header) =>
      stripTags(header[1] ?? ""),
    );
    for (const match of container.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = match[0];
    const inputs = [...rowHtml.matchAll(/<input\b([^>]*)>/gi)].map((input) =>
      parseAttributes(input[1] ?? ""),
    );
    const idInput = inputs
      .find((attributes) => attributes.name === "cid[]" && /^\d+$/.test(attributes.value || ""));
    const legacyId = idInput?.value;
    if (!legacyId) continue;
    const uniqueNumericInput = (name: string): string | undefined => {
      const matches = inputs.filter((attributes) => attributes.name === name);
      if (matches.length !== 1 || !/^\d+$/.test(matches[0]?.value || "")) return undefined;
      return matches[0].value;
    };
    const parcelaId = uniqueNumericInput("parcela_id");
    const numeroParcela = uniqueNumericInput("numero_parcela");
    const contaReceberId = uniqueNumericInput("conta_receber_id");
    const contaPagarId = uniqueNumericInput("conta_pagar_id");
    const parcelaIdentity =
      parcelaId && numeroParcela
        ? {
            ...(contaPagarId ? { contaPagarId } : {}),
            ...(contaReceberId ? { contaReceberId } : {}),
            numeroParcela,
            parcelaId,
          }
        : undefined;
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) =>
      stripTags(cell[1] ?? ""),
    );
    const navigationCandidates = [
      ...extractAnchors(rowHtml).map((anchor) => anchor.href),
      ...extractOnclickUrls(rowHtml),
    ];
    const parcelaInfoCandidates: LegacyListRow["parcelaInfoCandidates"] = [];
    for (const tag of rowHtml.matchAll(/<[a-z][^>]*>/gi)) {
      const attributes = parseAttributes(tag[0]);
      if (attributes["data-tipped"] && attributes["data-querystring"]) {
        parcelaInfoCandidates.push({
          endpoint: attributes["data-tipped"],
          query: attributes["data-querystring"],
        });
      }
    }
    rows.push({
      cells,
      contentHash: sha256(JSON.stringify({ cells, headers, legacyId, parcelaIdentity })),
      headers,
      legacyId,
      navigationCandidates: [...new Set(navigationCandidates)],
      ...(parcelaIdentity ? { parcelaIdentity } : {}),
      parcelaInfoCandidates,
    });
    }
  }
  return rows;
}

export function operationalReferencesForRow(
  row: LegacyListRow,
  current: URL,
  baseUrl: URL,
  module: ModuleName,
): LegacyListReference[] {
  if (module !== "contas-receber" && module !== "contas-pagar") return [];
  const references = new Map<string, LegacyListReference>();
  const tarefas = {
    "inquilino.edit": { entidade: "PESSOA", papelOrigem: "INQUILINO" },
    "locacao.edit": { entidade: "CONTRATO", papelOrigem: "LOCACAO" },
    "outro.edit": { entidade: "PESSOA", papelOrigem: "OUTRO" },
    "proprietario.edit": { entidade: "PESSOA", papelOrigem: "PROPRIETARIO" },
  } as const;

  for (const candidate of row.navigationCandidates) {
    const url = resolveCandidate(candidate, current);
    if (!url) continue;
    try {
      assertAdminUrl(url, baseUrl);
      if (url.searchParams.get("option") !== "com_widesys") continue;
      const task = url.searchParams.get("task") as keyof typeof tarefas | null;
      const definition = task ? tarefas[task] : undefined;
      const legadoId = url.searchParams.get("id");
      if (!definition || !legadoId || !/^\d+$/.test(legadoId)) continue;
      const tarefaPessoa = task !== "locacao.edit";
      const permitidos = new Set(
        tarefaPessoa
          ? ["option", "task", "id", "jatoggler_noupd"]
          : ["option", "view", "task", "id"],
      );
      if ([...url.searchParams.keys()].some((key) => !permitidos.has(key))) continue;
      if (
        url.searchParams.has("jatoggler_noupd") &&
        (url.searchParams.getAll("jatoggler_noupd").length !== 1 ||
          url.searchParams.get("jatoggler_noupd") !== "1")
      ) {
        continue;
      }
      if (task === "locacao.edit") {
        if (url.searchParams.get("view") !== "locacao") continue;
      } else if (url.searchParams.has("view")) {
        continue;
      }
      const reference: LegacyListReference = { ...definition, legadoId };
      references.set(`${reference.entidade}\u0000${reference.papelOrigem}\u0000${legadoId}`, reference);
    } catch {
      // Links externos ou de outras áreas nunca são convertidos em referência.
    }
  }
  return [...references.values()];
}

export function canonicalOperationalDetailUrl(
  candidate: string,
  current: URL,
  baseUrl: URL,
  module: ModuleName,
  expectedId: string,
): URL | null {
  const definition = MODULES[module];
  if (definition.mode !== "detail") return null;
  const input = resolveCandidate(candidate, current);
  if (!input) return null;
  try {
    assertAdminUrl(input, baseUrl);
    if (input.searchParams.get("option") !== "com_widesys") return null;
    if (input.searchParams.get("id") !== expectedId || !/^\d+$/.test(expectedId)) return null;
    const taskAllowed = input.searchParams.get("task") === definition.detailTask;
    const layoutAllowed =
      input.searchParams.get("view") === definition.detailView && input.searchParams.get("layout") === "edit";
    if (!taskAllowed && !layoutAllowed) return null;
    if (input.searchParams.has("view") && input.searchParams.get("view") !== definition.detailView) return null;

    // A task *.edit serve apenas como evidência descoberta na listagem. Nunca
    // a acessamos: Joomla pode fazer checkout/lock ao despachar essa task.
    const canonical = new URL(baseUrl.pathname, baseUrl.origin);
    canonical.searchParams.set("option", "com_widesys");
    canonical.searchParams.set("view", definition.detailView);
    canonical.searchParams.set("layout", "edit");
    canonical.searchParams.set("id", expectedId);
    assertCanonicalOperationalDetailUrl(canonical, baseUrl, module, expectedId);
    return canonical;
  } catch {
    return null;
  }
}

function detailUrlForRow(row: LegacyListRow, current: URL, baseUrl: URL, module: ModuleName): URL | null {
  for (const candidate of row.navigationCandidates) {
    const canonical = canonicalOperationalDetailUrl(candidate, current, baseUrl, module, row.legacyId);
    if (canonical) return canonical;
  }
  return null;
}

export function parcelaInfoUrlsForRow(
  row: LegacyListRow,
  current: URL,
  baseUrl: URL,
  module: ModuleName,
): DetailTarget[] {
  const identity = row.parcelaIdentity;
  const expectedAccountId =
    module === "contas-receber" ? identity?.contaReceberId : identity?.contaPagarId;
  if (!identity || identity.parcelaId !== row.legacyId || !expectedAccountId) {
    throw new Error(`Linha ${row.legacyId} sem identidade canônica de conta/parcela.`);
  }
  const targets: DetailTarget[] = [];
  for (const candidate of row.parcelaInfoCandidates) {
    const url = resolveCandidate(candidate.endpoint, current);
    if (!url) continue;
    const query = new URLSearchParams(candidate.query.replace(/^\?/, ""));
    assertUniqueSearchParams(url);
    for (const key of new Set(query.keys())) {
      if (query.getAll(key).length !== 1 || url.searchParams.has(key)) {
        throw new Error(`Parâmetro AJAX duplicado bloqueado: ${key}.`);
      }
    }
    for (const [key, value] of query) url.searchParams.set(key, value);
    try {
      const task = assertParcelaInfoUrl(url, baseUrl, module, row.legacyId, identity);
      if (!targets.some((target) => target.url.toString() === url.toString())) targets.push({ transport: task, url });
    } catch (error) {
      const task = url.searchParams.get("task") ?? "";
      if (/^ajax\.(?:getParcelaInfo(?:Pagar)?|getDetalhes(?:Recebimento|Pagamento))$/.test(task)) {
        throw error;
      }
      // Atributos de outros tooltips não autorizam requisições.
    }
  }
  const requiredTask = module === "contas-receber" ? "ajax.getParcelaInfo" : "ajax.getParcelaInfoPagar";
  const detailTask = module === "contas-receber" ? "ajax.getDetalhesRecebimento" : "ajax.getDetalhesPagamento";
  if (targets.filter((target) => target.transport === requiredTask).length !== 1) {
    throw new Error(`Linha ${row.legacyId} sem endpoint principal único.`);
  }
  if (targets.filter((target) => target.transport === detailTask).length > 1) {
    throw new Error(`Linha ${row.legacyId} possui mais de um endpoint auxiliar.`);
  }
  return targets;
}

function readLoginSubmission(html: string): LoginSubmission {
  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const body = match[2] ?? "";
    const rawInputs = [...body.matchAll(/<input\b([^>]*)>/gi)].map((input) => parseAttributes(input[1] ?? ""));
    const passwordInput = rawInputs.find(
      (input) => input.type?.toLowerCase() === "password" || /^(?:passw|passwd|password|senha)$/i.test(input.name || ""),
    );
    const usernameInput = rawInputs.find((input) => /^(?:username|user|login|usuario|j_username)$/i.test(input.name || ""));
    if (!passwordInput?.name || !usernameInput?.name) continue;
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

async function login(client: SameOriginClient, options: CliOptions, username: string, password: string) {
  const loginGuard: RequestGuard = (url, method) => assertLoginRoute(url, options.baseUrl, method);
  const page = await client.get(options.baseUrl, loginGuard);
  const submission = readLoginSubmission(page.html);
  const action = new URL(submission.action, page.url);
  assertAdminUrl(action, options.baseUrl);
  if (submission.fields.get("option") !== "com_login" || submission.fields.get("task") !== "login") {
    throw new Error("Formulário de login inesperado.");
  }
  submission.fields.set(submission.usernameField, username);
  submission.fields.set(submission.passwordField, password);
  const form = new URLSearchParams();
  for (const [name, value] of submission.fields) form.append(name, value);
  const authenticated = await client.postLogin(action, form, loginGuard);
  if (isJoomlaLoginPage(authenticated.html)) throw new Error("Autenticação recusada pelo Widesys.");
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
      const cleanup = () => {
        process.stdin.off("data", onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write("\n");
      };
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

async function delay(milliseconds: number): Promise<void> {
  if (milliseconds > 0) await new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  kind: ArtifactKind,
  module: ModuleName,
  window: string,
  sourceUrl: URL,
): Artifact {
  return {
    bytes: Buffer.byteLength(content),
    kind,
    module,
    path: relativeArtifactPath(filePath),
    sha256: sha256(content),
    sourceUrl: publicUrl(sourceUrl),
    window,
  };
}

function checkpointPayload(checkpoint: Omit<RecordCheckpoint, "contentHash">): Omit<RecordCheckpoint, "contentHash"> {
  return {
    artifacts: checkpoint.artifacts,
    captureId: checkpoint.captureId,
    evidence: checkpoint.evidence,
    legacyId: checkpoint.legacyId,
    module: checkpoint.module,
    version: 1,
  };
}

export function operationalRecordCheckpointHash(checkpoint: unknown): string {
  const candidate = checkpoint as Partial<RecordCheckpoint>;
  return sha256(
    JSON.stringify(
      checkpointPayload({
        artifacts: Array.isArray(candidate.artifacts) ? candidate.artifacts : [],
        captureId: String(candidate.captureId ?? ""),
        evidence: candidate.evidence as RecordCheckpointEvidence,
        legacyId: String(candidate.legacyId ?? ""),
        module: candidate.module as ModuleName,
        version: 1,
      }),
    ),
  );
}

export function operationalRecordCheckpointIsValid(checkpoint: unknown): checkpoint is RecordCheckpoint {
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) return false;
  const candidate = checkpoint as Partial<RecordCheckpoint>;
  if (
    candidate.version !== 1 ||
    !candidate.captureId ||
    !/^\d{4}-\d{2}-\d{2}T[\d-]+Z$/.test(candidate.captureId) ||
    !candidate.module ||
    !(candidate.module in MODULES) ||
    !candidate.legacyId ||
    !/^\d+$/.test(candidate.legacyId) ||
    !candidate.evidence ||
    candidate.evidence.legacyId !== candidate.legacyId ||
    !candidate.evidence.rowContentHash ||
    !candidate.evidence.sourceWindow ||
    !Array.isArray(candidate.evidence.targets) ||
    !Array.isArray(candidate.artifacts) ||
    typeof candidate.contentHash !== "string" ||
    !/^[a-f\d]{64}$/.test(candidate.contentHash)
  ) {
    return false;
  }
  if (
    candidate.evidence.targets.some(
      (target) =>
        !target ||
        typeof target.sourceUrl !== "string" ||
        !target.sourceUrl.startsWith("https://") ||
        typeof target.transport !== "string" ||
        !target.transport,
    )
  ) {
    return false;
  }
  if (candidate.artifacts.length !== candidate.evidence.targets.length + 1) return false;
  const paths = new Set<string>();
  let jsonArtifacts = 0;
  for (const artifact of candidate.artifacts) {
    if (
      !artifact ||
      artifact.module !== candidate.module ||
      artifact.window !== candidate.evidence.sourceWindow ||
      !["detail-html", "detail-json"].includes(artifact.kind) ||
      !artifact.path ||
      paths.has(artifact.path) ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes < 0 ||
      !/^[a-f\d]{64}$/.test(artifact.sha256) ||
      typeof artifact.sourceUrl !== "string" ||
      !artifact.sourceUrl.startsWith("https://")
    ) {
      return false;
    }
    paths.add(artifact.path);
    if (artifact.kind === "detail-json") jsonArtifacts += 1;
  }
  return jsonArtifacts === 1 && candidate.contentHash === operationalRecordCheckpointHash(candidate);
}

function buildRecordCheckpoint(
  captureId: string,
  module: ModuleName,
  legacyId: string,
  evidence: RecordCheckpointEvidence,
  artifacts: Artifact[],
): RecordCheckpoint {
  const payload = checkpointPayload({ artifacts, captureId, evidence, legacyId, module, version: 1 });
  return { ...payload, contentHash: operationalRecordCheckpointHash(payload) };
}

export function mergeOperationalCheckpointArtifacts(
  current: Artifact[],
  module: ModuleName,
  scope: ScopeName,
  generated: Artifact[],
): Artifact[] {
  const scopePattern = new RegExp(`^scopes/${scope}(?:-part-\\d{5})?\\.json$`);
  const preserved = current.filter(
    (artifact) =>
      !(
        artifact.module === module &&
        (artifact.path.startsWith(`${module}/records/`) || scopePattern.test(artifact.path.replace(/\\/g, "/")))
      ),
  );
  const paths = new Set(preserved.map((artifact) => artifact.path));
  for (const artifact of generated) {
    if (paths.has(artifact.path)) throw new Error(`Artefato operacional duplicado: ${artifact.path}.`);
    paths.add(artifact.path);
  }
  return [...preserved, ...generated];
}

function updateArtifact(manifest: Manifest, artifact: Artifact): void {
  const index = manifest.artifacts.findIndex((existing) => existing.path === artifact.path);
  if (index >= 0) manifest.artifacts[index] = artifact;
  else manifest.artifacts.push(artifact);
}

function refreshManifestHash(manifest: Manifest): void {
  manifest.updatedAt = new Date().toISOString();
  manifest.contentHash = sha256(conteudoHashManifestoOperacao(manifest));
}

async function saveManifest(manifest: Manifest): Promise<void> {
  refreshManifestHash(manifest);
  await atomicWrite(path.join(OUTPUT_DIRECTORY, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function operationalManifestIsResumable(
  manifest: Pick<Manifest, "businessDate" | "capturedAt" | "complete" | "completedAt" | "startedAt">,
  now = new Date(),
): boolean {
  const startedAt = new Date(manifest.startedAt).getTime();
  const ageMs = now.getTime() - startedAt;
  return (
    manifest.complete !== true &&
    manifest.completedAt === null &&
    manifest.capturedAt === null &&
    Number.isFinite(startedAt) &&
    ageMs >= 0 &&
    ageMs <= 24 * 60 * 60 * 1_000 &&
    manifest.businessDate === businessDateIso(now)
  );
}

function newManifest(options: CliOptions): Manifest {
  const now = new Date().toISOString();
  return {
    artifacts: [],
    baseOrigin: options.baseUrl.origin,
    businessDate: businessDateIso(new Date(now)),
    captureId: now.replace(/[:.]/g, "-").replace(/Z$/, "Z"),
    capturedAt: null,
    complete: false,
    completedAt: null,
    contentHash: "",
    errors: [],
    files: [],
    modules: {},
    options: {
      captureMode: options.captureMode,
      delayMs: options.delayMs,
      fromMonth: options.fromMonth,
      limit: PAGE_LIMIT,
      maxPages: options.maxPages,
      modules: options.modules,
      titlesTo: options.titlesTo,
      toMonth: options.toMonth,
    },
    startedAt: now,
    updatedAt: now,
    version: 2,
    schemaVersion: 2,
    sourceOrigin: options.baseUrl.origin,
    timeZone: BUSINESS_TIME_ZONE,
  };
}

async function loadManifest(options: CliOptions): Promise<Manifest> {
  const manifestPath = path.join(OUTPUT_DIRECTORY, "manifest.json");
  try {
    const raw = await readFile(manifestPath, "utf8");
    if (options.captureMode === "refresh") return newManifest(options);
    if (options.captureMode === "new") {
      throw new Error("Já existe manifesto operacional. Use --refresh ou --resume.");
    }
    const parsed = JSON.parse(raw) as Manifest;
    if (
      parsed.version !== 2 ||
      parsed.schemaVersion !== 2 ||
      parsed.baseOrigin !== options.baseUrl.origin
    ) {
      throw new Error("O manifesto existente pertence a outra versão ou origem.");
    }
    if (parsed.contentHash !== sha256(conteudoHashManifestoOperacao(parsed))) {
      throw new Error("O hash do manifesto operacional existente diverge; use --refresh para nova captura.");
    }
    parsed.timeZone = BUSINESS_TIME_ZONE;
    parsed.businessDate ||= businessDateIso(new Date(parsed.startedAt));
    if (options.captureMode === "resume") {
      if (!operationalManifestIsResumable(parsed)) {
        throw new Error("--resume aceita apenas captura interrompida; use --refresh após uma captura encerrada.");
      }
      if (
        parsed.options.fromMonth !== options.fromMonth ||
        parsed.options.toMonth !== options.toMonth ||
        parsed.options.titlesTo !== options.titlesTo ||
        JSON.stringify(parsed.options.modules) !== JSON.stringify(options.modules)
      ) {
        throw new Error("--resume exige o mesmo período e a mesma ordem de módulos da captura original.");
      }
      parsed.completedAt = null;
      parsed.capturedAt = null;
      parsed.complete = false;
      parsed.options.captureMode = "resume";
      parsed.options.delayMs = options.delayMs;
      parsed.options.maxPages = options.maxPages;
      return parsed;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return newManifest(options);
}

function addManifestError(
  manifest: Manifest,
  error: unknown,
  code: string,
  module?: ModuleName,
  window?: string,
  sourceUrl?: URL,
  legacyId?: string,
): void {
  manifest.errors.push({
    at: new Date().toISOString(),
    code,
    legacyId,
    message: sanitizeManifestErrorMessage(error),
    module,
    sourceUrl: sourceUrl ? publicUrl(sourceUrl) : undefined,
    window,
  });
}

/**
 * Mantem o diagnostico util sem gravar no manifesto URLs, cabecalhos de
 * autenticacao, cookies, credenciais ou material de certificado devolvidos
 * por fetch/undici/Joomla em uma mensagem de erro.
 */
export function sanitizeManifestErrorMessage(error: unknown): string {
  const raw = decodeHtml(error instanceof Error ? error.message : "Erro desconhecido.");
  return raw
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gi, "[CERTIFICATE REDACTED]")
    .replace(/\b(?:https?|ftp):\/\/[^\s<>"']+/gi, "[URL REDACTED]")
    .replace(/(?:^|\s)(?:\.\.\/|\.\/|\/)[^\s<>"']+/g, (value) =>
      value.startsWith(" ") ? " [URL REDACTED]" : "[URL REDACTED]",
    )
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]*/gi, (value) => {
      const name = value.slice(0, value.indexOf(":"));
      return `${name}: [REDACTED]`;
    })
    .replace(/\b(?:bearer|basic)\s+[a-z\d._~+/=-]+/gi, "[AUTH REDACTED]")
    .replace(
      /(?:["'])?\b(passw|passwd|password|senha|secret|(?:access|refresh|auth|id)[_-]?token|token|csrf|authorization|cookie|api[_-]?key|client[_-]?secret|certificad(?:o|a)?(?:[_-]?password)?|certificate(?:[_-]?password)?|private[_-]?key)\b(?:["'])?\s*(?:(?::|=)\s*|\s+)(?:"[^"]*"|'[^']*'|[^\s,;<>]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(/\b[^\s"'<>]*\.(?:p12|pfx|pem|key|crt|cer)(?:[?#][^\s"'<>]*)?/gi, "[CERTIFICATE REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 500);
}

async function saveListArtifacts(
  manifest: Manifest,
  module: ModuleName,
  window: string,
  pageNumber: number,
  responseUrl: URL,
  html: string,
  rows: LegacyListRow[],
  reportedTotal: number | null,
): Promise<void> {
  const directory = path.join(OUTPUT_DIRECTORY, module, "windows", window);
  const basename = `page-${String(pageNumber).padStart(5, "0")}`;
  const safeHtml = sanitizeHtml(html);
  const json = `${JSON.stringify(
    {
      fetchedAt: new Date().toISOString(),
      module,
      reportedTotal,
      rows: persistableListRows(rows),
      sourceUrl: publicUrl(responseUrl),
      window,
    },
    null,
    2,
  )}\n`;
  const htmlPath = path.join(directory, `${basename}.html`);
  const jsonPath = path.join(directory, `${basename}.json`);
  await atomicWrite(htmlPath, safeHtml);
  await atomicWrite(jsonPath, json);
  updateArtifact(manifest, artifactFor(htmlPath, safeHtml, "list-html", module, window, responseUrl));
  updateArtifact(manifest, artifactFor(jsonPath, json, "list-json", module, window, responseUrl));
}

async function fetchGlobalReportedTotal(
  client: SameOriginClient,
  options: CliOptions,
  manifest: Manifest,
  module: ModuleName,
): Promise<number> {
  const window = { end: "", key: "__global__", start: "" };
  const listUrl = buildListUrl(options.baseUrl, module, window, 0);
  await delay(options.delayMs);
  const response = await client.get(listUrl, (url, method) => {
    if (method !== "GET") throw new Error("Método não GET bloqueado na contagem global.");
    assertListUrl(url, options.baseUrl, module);
    assertEquivalentOperationalUrl(url, listUrl);
  });
  assertListUrl(response.url, options.baseUrl, module);
  assertEquivalentOperationalUrl(response.url, listUrl);
  if (isJoomlaLoginPage(response.html)) {
    throw new Error("Sessão do Widesys expirou durante a contagem global.");
  }
  const rows = extractLegacyListRows(response.html);
  const total = verifiedOperationalTotal(response.html, rows);
  await saveListArtifacts(manifest, module, window.key, 0, response.url, response.html, rows, total);
  return total;
}

async function fetchModuleLists(
  client: SameOriginClient,
  options: CliOptions,
  manifest: Manifest,
  module: ModuleName,
  state: ModuleManifest,
): Promise<Map<string, PendingRecord>> {
  const records = new Map<string, PendingRecord>();
  // Esta consulta sem recorte temporal é independente da soma das janelas e
  // detecta registros com data nula ou fora do período solicitado.
  state.globalReportedTotal = await fetchGlobalReportedTotal(client, options, manifest, module);
  for (const window of moduleWindows(module, options)) {
    const windowState: WindowManifest = {
      completed: false,
      duplicateIds: 0,
      pagesFetched: 0,
      recordsDiscovered: 0,
      reportedTotal: null,
    };
    state.windows[window.key] = windowState;
    const windowIds = new Set<string>();
    let offset = 0;
    let pageNumber = 0;

    while (true) {
      const listUrl = buildListUrl(options.baseUrl, module, window, offset);
      await delay(options.delayMs);
      const response = await client.get(listUrl, (url, method) => {
        if (method !== "GET") throw new Error("Método não GET bloqueado na listagem.");
        assertListUrl(url, options.baseUrl, module);
        assertEquivalentOperationalUrl(url, listUrl);
      });
      assertListUrl(response.url, options.baseUrl, module);
      assertEquivalentOperationalUrl(response.url, listUrl);
      if (isJoomlaLoginPage(response.html)) throw new Error("Sessão do Widesys expirou durante a listagem.");
      const rows = extractLegacyListRows(response.html);
      const reportedTotal = verifiedOperationalTotal(response.html, rows);
      const appliedLimit = effectiveListLimit(response.html);
      if (
        appliedLimit !== PAGE_LIMIT &&
        rows.length !== PAGE_LIMIT &&
        rows.length !== reportedTotal
      ) {
        throw new Error(
          `O Widesys não confirmou limit=${PAGE_LIMIT} e devolveu somente ${rows.length} de ${reportedTotal} registros.`,
        );
      }
      windowState.reportedTotal = reportedTotal;
      pageNumber += 1;
      windowState.pagesFetched = pageNumber;

      for (const row of rows) {
        row.references = operationalReferencesForRow(row, response.url, options.baseUrl, module);
        row.contentHash = sha256(
          JSON.stringify({
            cells: row.cells,
            headers: row.headers,
            legacyId: row.legacyId,
            parcelaIdentity: row.parcelaIdentity,
            references: row.references,
          }),
        );
        if (windowIds.has(row.legacyId)) windowState.duplicateIds += 1;
        windowIds.add(row.legacyId);
        let targets: DetailTarget[] = [];
        if (MODULES[module].mode === "parcela-ajax") {
          targets = parcelaInfoUrlsForRow(row, response.url, options.baseUrl, module);
          const requiredTask = module === "contas-receber" ? "ajax.getParcelaInfo" : "ajax.getParcelaInfoPagar";
          if (!targets.some((target) => target.transport === requiredTask)) targets = [];
        } else {
          const detail = detailUrlForRow(row, response.url, options.baseUrl, module);
          if (detail) targets = [{ transport: MODULES[module].detailTask, url: detail }];
        }
        if (targets.length === 0) {
          addManifestError(
            manifest,
            new Error("Linha sem endpoint GET de detalhe permitido."),
            "DETAIL_URL_NOT_FOUND",
            module,
            window.key,
            response.url,
            row.legacyId,
          );
          state.detailErrors += 1;
          continue;
        }
        const previous = records.get(row.legacyId);
        if (previous && previous.sourceWindow !== window.key) state.duplicateIds += 1;
        const mergedTargets = previous ? [...previous.targets] : [];
        for (const target of targets) {
          if (!mergedTargets.some((existing) => existing.url.toString() === target.url.toString())) mergedTargets.push(target);
        }
        records.set(row.legacyId, {
          row,
          sourceWindow: previous?.sourceWindow || window.key,
          targets: mergedTargets,
        });
      }

      windowState.recordsDiscovered = windowIds.size;
      await saveListArtifacts(manifest, module, window.key, pageNumber, response.url, response.html, rows, reportedTotal);
      console.log(`[${module}/${window.key}] página ${pageNumber}; ${windowIds.size} IDs.`);

      const nextOffset = nextOperationalPageOffset(
        offset,
        windowState.reportedTotal,
        rows.length,
        pageNumber,
        options.maxPages,
      );
      if (nextOffset === null) break;
      offset = nextOffset;
    }

    const mismatch =
      windowState.reportedTotal === null ||
      windowIds.size !== windowState.reportedTotal ||
      windowState.duplicateIds > 0;
    if (mismatch) {
      addManifestError(
        manifest,
        new Error(`A listagem informou ${windowState.reportedTotal}, mas expôs ${windowIds.size} IDs estáveis.`),
        "COUNT_MISMATCH",
        module,
        window.key,
        buildListUrl(options.baseUrl, module, window, 0),
      );
    }
    windowState.completed = !mismatch;
  }
  if (state.duplicateIds > 0) {
    addManifestError(
      manifest,
      new Error(`${state.duplicateIds} ID(s) apareceram em mais de uma janela do mesmo escopo.`),
      "DUPLICATE_ID_ACROSS_WINDOWS",
      module,
    );
  }
  state.globalCountVerified = verifyGlobalOperationalTotal(records.size, state.globalReportedTotal);
  if (!state.globalCountVerified) {
    addManifestError(
      manifest,
      new Error(
        `A contagem global informou ${state.globalReportedTotal}, mas as janelas consolidadas expuseram ${records.size} IDs.`,
      ),
      "GLOBAL_COUNT_MISMATCH",
      module,
    );
  }
  return records;
}

function normalizedFieldKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function addFlatField(fields: Record<string, string | string[]>, rawKey: string, rawValue: string | string[]): void {
  const key = rawKey.trim();
  if (!key || /(?:password|passwd|senha|secret|token|csrf|cookie|authorization|certificado)/i.test(key)) return;
  const values = (Array.isArray(rawValue) ? rawValue : [rawValue]).map((value) => value.trim()).filter(Boolean);
  if (values.length === 0 || values.every((value) => value === "[REDACTED]")) return;
  const existing = fields[key];
  const merged = [
    ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
    ...values,
  ];
  const unique = [...new Set(merged)];
  fields[key] = unique.length === 1 ? unique[0] : unique;
}

export function flattenedFields(
  row: LegacyListRow,
  details: CapturedRecord["details"],
): Record<string, string | string[]> {
  const fields: Record<string, string | string[]> = {};
  row.cells.forEach((cell, index) => addFlatField(fields, row.headers[index] || `coluna_${index + 1}`, cell));
  for (const detail of details) {
    const controles = new Map<string, typeof detail.raw.fields>();
    for (const field of detail.raw.fields) {
      if (!["checkbox", "radio"].includes(field.type)) continue;
      const grupo = controles.get(field.name) ?? [];
      grupo.push(field);
      controles.set(field.name, grupo);
    }
    for (const field of detail.raw.fields) {
      if (controles.has(field.name)) continue;
      addFlatField(fields, field.name, field.value);
      if (field.displayValue) addFlatField(fields, `${field.name}_rotulo`, field.displayValue);
    }
    for (const [nome, grupo] of controles) {
      const marcados = grupo.filter((field) => field.checked === true);
      const escolhidos = marcados.length > 0 ? marcados : grupo.filter((field) => field.type === "checkbox").slice(0, 1);
      if (escolhidos.length === 0) continue;
      const autoritativos: Record<string, string | string[]> = {};
      for (const field of escolhidos) {
        addFlatField(autoritativos, nome, field.checked ? field.value : "0");
        if (field.displayValue) addFlatField(autoritativos, `${nome}_rotulo`, field.displayValue);
      }
      if (autoritativos[nome] !== undefined) fields[nome] = autoritativos[nome];
      if (autoritativos[`${nome}_rotulo`] !== undefined) {
        fields[`${nome}_rotulo`] = autoritativos[`${nome}_rotulo`];
      }
    }
    for (const table of detail.raw.tables) {
      for (const tableRow of table.rows) {
        if (table.headers.length === tableRow.length) {
          tableRow.forEach((cell, index) => addFlatField(fields, table.headers[index] || `tabela_${index + 1}`, cell));
        } else if (tableRow.length === 2) addFlatField(fields, tableRow[0], tableRow[1]);
      }
    }
    for (const line of detail.raw.text.split("\n")) {
      const labeled = line.match(/^([^:]{2,100}):\s*(.+)$/);
      if (labeled) addFlatField(fields, labeled[1], labeled[2]);
    }
  }
  return fields;
}

export function paymentRows(details: CapturedRecord["details"]): Array<Record<string, string>> {
  const payments: Array<Record<string, string>> = [];
  for (const detail of details.filter((item) => /Detalhes(?:Recebimento|Pagamento)/.test(item.transport))) {
    for (const table of detail.raw.tables) {
      const headerKeys = table.headers.map(normalizedFieldKey);
      const hasValue = headerKeys.some((key) => /(?:^|_)valor(?:_|$)/.test(key));
      const hasSettlementIdentity = headerKeys.some((key) =>
        /data.*(?:pagamento|recebimento|baixa)|(?:pagamento|recebimento|baixa).*data|lancamento|^(?:n|no|numero)_?lanc$/.test(
          key,
        ),
      );
      if (!hasValue || !hasSettlementIdentity) continue;
      for (const row of table.rows) {
        if (table.headers.length !== row.length || row.length === 0) continue;
        if (row.every((cell) => !cell.trim())) continue;
        if (row.every((cell, index) => normalizedFieldKey(cell) === headerKeys[index])) continue;
        const raw = Object.fromEntries(table.headers.map((header, index) => [header || `coluna_${index + 1}`, row[index]]));
        const payment: Record<string, string> = {};
        for (const [header, value] of Object.entries(raw)) {
          const key = normalizedFieldKey(header);
          if (/^valor/.test(key)) payment.valor = value;
          else if (/data.*(?:pagamento|recebimento|baixa)|^(?:pagamento|recebimento|baixa)$/.test(key)) {
            payment.dataPagamento = value;
          } else if (/forma|tipo_(?:de_)?(?:recebimento|pagamento)/.test(key)) payment.forma = value;
          else if (/(?:conta|pix).*(?:^|_)id$|^(?:id_)?conta_bancaria$/.test(key) && /^\d+$/.test(value.trim())) {
            payment.conta_bancaria_id = value.trim();
          } else if (/^conta|conta_bancaria|pix/.test(key)) payment.conta_rotulo = value;
          else if (/lancamento|^(?:n|no|numero)_?lanc$/.test(key)) {
            const numero = value.match(/^\s*(\d+)/)?.[1];
            payment.numeroLancamento = numero || value;
            const responsavel = value.match(/Criado\s+por:\s*(.+?)(?=\s+\[|\s+\d{2}-\d{2}-\d{4}|$)/i)?.[1];
            const timestamp = value.match(/\b\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2}\b/)?.[0];
            const status = value.match(/\[([^\]]+)\]/)?.[1];
            if (responsavel) payment.responsavel = responsavel.trim();
            if (timestamp) payment.timestamp = timestamp;
            if (status) payment.status = status.trim();
          }
          else if (/documento|cheque|cartao/.test(key)) payment.documento = value;
          else if (/responsavel|criado_por|usuario/.test(key)) payment.responsavel = value;
          else if (/timestamp|data_hora|criado_em/.test(key)) payment.timestamp = value;
          else if (/status|estorno|situacao/.test(key)) payment.status = value;
        }
        payments.push(payment);
      }
    }
  }
  return payments;
}

export function contractParties(details: CapturedRecord["details"]): ParteContratoWidesys[] {
  return extrairPartesContratoWidesys(details.flatMap((detail) => detail.raw.fields));
}

export function buildCapturedRecord(
  module: ModuleName,
  legacyId: string,
  row: LegacyListRow,
  sourceWindow: string,
  details: CapturedRecord["details"],
  capturedAt = new Date().toISOString(),
): CapturedRecord {
  const fields = flattenedFields(row, details);
  const normalized: CapturedRecord = {
    baixas: paymentRows(details),
    capturedAt,
    details,
    fields,
    list: {
      cells: row.cells,
      contentHash: row.contentHash,
      headers: row.headers,
      ...(row.references && row.references.length > 0 ? { references: row.references } : {}),
      sourceWindow,
    },
    legacyId,
    raw: {
      fields: details.flatMap((detail) => detail.raw.fields),
      tables: details.flatMap((detail) => detail.raw.tables),
      text: details.map((detail) => detail.raw.text).join("\n\n"),
      title: details.map((detail) => detail.raw.title).filter(Boolean).join(" · "),
    },
    sourceUrl: details[0]?.sourceUrl || "",
  };
  if (module === "contratos") {
    const partes = contractParties(details);
    if (partes.length > 0) normalized.partes = partes;
  }
  return normalized;
}

export function capturedRecordMatchesEvidence(
  captured: CapturedRecord,
  evidence: RecordCheckpointEvidence,
): boolean {
  if (
    captured.legacyId !== evidence.legacyId ||
    captured.list?.contentHash !== evidence.rowContentHash ||
    captured.list?.sourceWindow !== evidence.sourceWindow
  ) {
    return false;
  }
  const actual = captured.details
    .map((detail) => `${detail.transport}\u0000${detail.sourceUrl}`)
    .sort();
  const expected = evidence.targets
    .map((target) => `${target.transport}\u0000${target.sourceUrl}`)
    .sort();
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function checkpointEvidence(legacyId: string, record: PendingRecord): RecordCheckpointEvidence {
  return {
    legacyId,
    rowContentHash: record.row.contentHash,
    sourceWindow: record.sourceWindow,
    targets: record.targets.map((target) => ({
      sourceUrl: publicUrl(target.url),
      transport: target.transport,
    })),
  };
}

function recordCapturePaths(module: ModuleName, legacyId: string, record: PendingRecord) {
  const directory = path.join(OUTPUT_DIRECTORY, module, "records");
  return {
    checkpointPath: path.join(directory, "checkpoints", `${legacyId}.json`),
    jsonPath: path.join(directory, `${legacyId}.json`),
    targetPaths: record.targets.map((target) =>
      path.join(directory, `${legacyId}-${sha256(target.url.toString()).slice(0, 10)}.html`),
    ),
  };
}

type LoadedRecordCheckpoint = {
  artifacts: Artifact[];
  captured: CapturedRecord;
};

async function loadRecordCheckpoint(
  captureId: string,
  module: ModuleName,
  legacyId: string,
  record: PendingRecord,
): Promise<LoadedRecordCheckpoint | null> {
  const paths = recordCapturePaths(module, legacyId, record);
  try {
    const checkpoint = JSON.parse(await readFile(paths.checkpointPath, "utf8")) as unknown;
    if (!operationalRecordCheckpointIsValid(checkpoint)) return null;
    const evidence = checkpointEvidence(legacyId, record);
    if (
      checkpoint.captureId !== captureId ||
      checkpoint.module !== module ||
      JSON.stringify(checkpoint.evidence) !== JSON.stringify(evidence)
    ) {
      return null;
    }

    const expectedPaths = new Set([
      relativeArtifactPath(paths.jsonPath),
      ...paths.targetPaths.map(relativeArtifactPath),
    ]);
    if (
      checkpoint.artifacts.length !== expectedPaths.size ||
      checkpoint.artifacts.some((artifact) => !expectedPaths.has(artifact.path))
    ) {
      return null;
    }
    for (const [index, target] of record.targets.entries()) {
      const artifact = checkpoint.artifacts.find(
        (candidate) => candidate.path === relativeArtifactPath(paths.targetPaths[index]),
      );
      if (
        !artifact ||
        artifact.kind !== "detail-html" ||
        artifact.sourceUrl !== publicUrl(target.url)
      ) {
        return null;
      }
    }
    const jsonArtifact = checkpoint.artifacts.find(
      (artifact) => artifact.path === relativeArtifactPath(paths.jsonPath),
    );
    if (
      !jsonArtifact ||
      jsonArtifact.kind !== "detail-json" ||
      jsonArtifact.sourceUrl !== publicUrl(record.targets[0].url)
    ) {
      return null;
    }

    const contents = new Map<string, string>();
    for (const artifact of checkpoint.artifacts) {
      const filePath = path.join(OUTPUT_DIRECTORY, ...artifact.path.split("/"));
      const content = await readFile(filePath);
      if (content.byteLength !== artifact.bytes || sha256(content) !== artifact.sha256) return null;
      contents.set(artifact.path, content.toString("utf8"));
    }

    const json = contents.get(relativeArtifactPath(paths.jsonPath));
    if (!json) return null;
    const captured = JSON.parse(json) as CapturedRecord;
    if (!capturedRecordMatchesEvidence(captured, evidence)) return null;

    const reconstructedDetails: CapturedRecord["details"] = [];
    for (const [index, target] of record.targets.entries()) {
      const html = contents.get(relativeArtifactPath(paths.targetPaths[index]));
      if (html === undefined) return null;
      const raw = extractRecord(html);
      reconstructedDetails.push({
        contentHash: sha256(JSON.stringify(raw)),
        raw,
        sourceUrl: publicUrl(target.url),
        transport: target.transport,
      });
    }
    const reconstructed = buildCapturedRecord(
      module,
      legacyId,
      record.row,
      record.sourceWindow,
      reconstructedDetails,
      captured.capturedAt,
    );
    if (JSON.stringify(captured) !== JSON.stringify(reconstructed)) return null;
    return { artifacts: checkpoint.artifacts, captured };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function fetchDetails(
  client: SameOriginClient,
  options: CliOptions,
  manifest: Manifest,
  module: ModuleName,
  state: ModuleManifest,
  records: Map<string, PendingRecord>,
): Promise<string[]> {
  // Somente IDs ficam em memória. Cada registro normalizado e seus hashes são
  // confirmados por um checkpoint atômico no disco; o raw nunca se acumula.
  const capturedIds: string[] = [];
  let processed = 0;
  for (const [legacyId, record] of records) {
    processed += 1;
    const paths = recordCapturePaths(module, legacyId, record);
    const resumed =
      options.captureMode === "resume"
        ? await loadRecordCheckpoint(manifest.captureId, module, legacyId, record)
        : null;
    if (resumed) {
      capturedIds.push(legacyId);
      state.recordsSkipped += 1;
    } else {
      try {
        const details: CapturedRecord["details"] = [];
        const artifacts: Artifact[] = [];
        for (const [targetIndex, target] of record.targets.entries()) {
          if (MODULES[module].mode === "parcela-ajax") {
            assertParcelaInfoUrl(target.url, options.baseUrl, module, legacyId, record.row.parcelaIdentity);
          } else assertCanonicalOperationalDetailUrl(target.url, options.baseUrl, module, legacyId);
          await delay(options.delayMs);
          const response = await client.get(target.url, (url, method) => {
            if (method !== "GET") throw new Error("Método não GET bloqueado no detalhe.");
            if (MODULES[module].mode === "parcela-ajax") {
              assertParcelaInfoUrl(url, options.baseUrl, module, legacyId, record.row.parcelaIdentity);
            } else assertCanonicalOperationalDetailUrl(url, options.baseUrl, module, legacyId);
            assertEquivalentOperationalUrl(url, target.url);
          });
          if (isJoomlaLoginPage(response.html)) {
            throw new Error("Sessão do Widesys expirou durante um detalhe.");
          }
          if (MODULES[module].mode === "detail") {
            assertDetailResponseUrl(response.url, options.baseUrl, module, legacyId);
          } else {
            assertParcelaInfoUrl(
              response.url,
              options.baseUrl,
              module,
              legacyId,
              record.row.parcelaIdentity,
            );
          }
          assertEquivalentOperationalUrl(response.url, target.url);
          const safeHtml = sanitizeHtml(response.html);
          const parsed = extractRecord(safeHtml);
          const contentHash = sha256(JSON.stringify(parsed));
          details.push({
            contentHash,
            raw: parsed,
            sourceUrl: publicUrl(target.url),
            transport: target.transport,
          });
          const htmlPath = paths.targetPaths[targetIndex];
          await atomicWrite(htmlPath, safeHtml);
          artifacts.push(
            artifactFor(htmlPath, safeHtml, "detail-html", module, record.sourceWindow, target.url),
          );
        }
        const normalized = buildCapturedRecord(module, legacyId, record.row, record.sourceWindow, details);
        const json = `${JSON.stringify(normalized, null, 2)}\n`;
        await atomicWrite(paths.jsonPath, json);
        artifacts.push(
          artifactFor(paths.jsonPath, json, "detail-json", module, record.sourceWindow, record.targets[0].url),
        );
        const checkpoint = buildRecordCheckpoint(
          manifest.captureId,
          module,
          legacyId,
          checkpointEvidence(legacyId, record),
          artifacts,
        );
        await atomicWrite(paths.checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
        capturedIds.push(legacyId);
        state.recordsSaved += 1;
      } catch (error) {
        state.detailErrors += 1;
        addManifestError(
          manifest,
          error,
          "DETAIL_FETCH_FAILED",
          module,
          record.sourceWindow,
          record.targets[0]?.url,
          legacyId,
        );
      }
    }
    if (processed % 20 === 0 || processed === records.size) {
      console.log(`[${module}] ${processed}/${records.size} detalhes GET processados; checkpoints atômicos em disco.`);
    }
  }
  return capturedIds;
}

export function shardScopeRecords<T>(records: T[], shardSize = SCOPE_SHARD_SIZE): T[][] {
  if (!Number.isSafeInteger(shardSize) || shardSize < 1) throw new Error("Tamanho de shard inválido.");
  if (records.length === 0) return [[]];
  const shards: T[][] = [];
  for (let offset = 0; offset < records.length; offset += shardSize) {
    shards.push(records.slice(offset, offset + shardSize));
  }
  return shards;
}

async function saveScopeFiles(
  manifest: Manifest,
  module: ModuleName,
  records: Map<string, PendingRecord>,
  capturedIds: string[],
  complete: boolean,
): Promise<void> {
  const scope = SCOPES[module];
  capturedIds.sort((left, right) => Number(left) - Number(right));
  const capturedAt = new Date().toISOString();
  const shards = shardScopeRecords(capturedIds);
  manifest.files = manifest.files.filter((file) => file.scope !== scope);
  const generatedArtifacts: Artifact[] = [];
  for (const [index, shardIds] of shards.entries()) {
    // No máximo SCOPE_SHARD_SIZE raws são materializados de cada vez. Os
    // artefatos são revalidados pelo checkpoint antes de assinar o manifesto.
    const shardRecords: CapturedRecord[] = [];
    for (const legacyId of shardIds) {
      const pending = records.get(legacyId);
      if (!pending) throw new Error(`Checkpoint ${legacyId} sem evidência da listagem atual.`);
      const loaded = await loadRecordCheckpoint(manifest.captureId, module, legacyId, pending);
      if (!loaded) throw new Error(`Checkpoint ${legacyId} ausente ou divergente dos artefatos capturados.`);
      shardRecords.push(loaded.captured);
      generatedArtifacts.push(...loaded.artifacts);
    }
    const content = `${JSON.stringify(
      {
        businessDate: manifest.businessDate,
        capturedAt,
        complete,
        part: index + 1,
        parts: shards.length,
        records: shardRecords,
        scope,
        timeZone: manifest.timeZone,
      },
      null,
      2,
    )}\n`;
    const filePath = path.join(
      OUTPUT_DIRECTORY,
      "scopes",
      `${scope}-part-${String(index + 1).padStart(5, "0")}.json`,
    );
    await atomicWrite(filePath, content);
    const relative = relativeArtifactPath(filePath);
    const hash = sha256(content);
    manifest.files.push({ count: shardRecords.length, path: relative, scope, sha256: hash });
    generatedArtifacts.push(
      artifactFor(filePath, content, "detail-json", module, "scope", new URL(manifest.sourceOrigin)),
    );
  }
  manifest.artifacts = mergeOperationalCheckpointArtifacts(
    manifest.artifacts,
    module,
    scope,
    generatedArtifacts,
  );
}

async function scrapeModule(
  client: SameOriginClient,
  options: CliOptions,
  manifest: Manifest,
  module: ModuleName,
): Promise<void> {
  manifest.errors = manifest.errors.filter((error) => error.module !== module);
  const state: ModuleManifest = {
    completed: false,
    detailErrors: 0,
    duplicateIds: 0,
    globalCountVerified: false,
    globalReportedTotal: null,
    listView: MODULES[module].listView,
    recordsDiscovered: 0,
    recordsSaved: 0,
    recordsSkipped: 0,
    windows: {},
  };
  manifest.modules[module] = state;
  await saveManifest(manifest);
  const records = await fetchModuleLists(client, options, manifest, module, state);
  state.recordsDiscovered = records.size;
  // Checkpoint de fase: durante os detalhes o manifesto deixa de crescer e não
  // é reserializado. Uma interrupção retoma pelos checkpoints por registro.
  await saveManifest(manifest);
  const capturedIds = await fetchDetails(client, options, manifest, module, state, records);
  state.completed =
    state.detailErrors === 0 &&
    state.duplicateIds === 0 &&
    state.globalCountVerified &&
    capturedIds.length === records.size &&
    Object.values(state.windows).every((windowState) => windowState.completed);
  await saveScopeFiles(manifest, module, records, capturedIds, state.completed);
  await saveManifest(manifest);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  console.log(`Origem validada: ${options.baseUrl.origin}`);
  console.log(`Módulos: ${options.modules.join(", ")}`);
  console.log(`Destino protegido pelo .gitignore: ${OUTPUT_DIRECTORY}`);
  for (const moduleName of options.modules) {
    console.log(`[${moduleName}] janelas: ${moduleWindows(moduleName, options).map((window) => window.key).join(", ")}`);
  }
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

  const client = new SameOriginClient();
  try {
    await login(client, options, username, password);
  } finally {
    password = "";
  }
  console.log("Autenticação concluída; todas as leituras operacionais seguintes usam GET.");

  for (const moduleName of options.modules) {
    try {
      console.log(`[${moduleName}] iniciando captura serial somente leitura.`);
      await scrapeModule(client, options, manifest, moduleName);
    } catch (error) {
      addManifestError(manifest, error, "MODULE_FAILED", moduleName);
      await saveManifest(manifest);
      console.warn(`[${moduleName}] falhou; consulte o manifesto protegido.`);
    }
  }

  const completed = options.modules.filter((moduleName) => manifest.modules[moduleName]?.completed).length;
  manifest.complete = completed === options.modules.length && manifest.errors.length === 0;
  manifest.completedAt = new Date().toISOString();
  manifest.capturedAt = manifest.completedAt;
  await saveManifest(manifest);
  const records = options.modules.reduce(
    (sum, moduleName) =>
      sum +
      (manifest.modules[moduleName]?.recordsSaved ?? 0) +
      (manifest.modules[moduleName]?.recordsSkipped ?? 0),
    0,
  );
  console.log(`Coleta encerrada: ${completed}/${options.modules.length} módulos completos; ${records} detalhes disponíveis.`);
  console.log("Revise data/legacy-widesys/operacao/manifest.json antes de criar qualquer importação financeira.");
  if (!manifest.complete) process.exitCode = 2;
}

function isDirectExecution(): boolean {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href);
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(`Falha segura: ${sanitizeManifestErrorMessage(error)}`);
    process.exitCode = 1;
  });
}
