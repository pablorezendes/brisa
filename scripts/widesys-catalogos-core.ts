import { createHash } from "node:crypto";

export const PAGE_LIMIT = 200;
export type PageStartParameter = "limitstart" | "list[start]";
export type PageCursor = { offset: number; parameter: PageStartParameter };

export type CatalogModule = {
  detailTasks?: readonly string[];
  detailViews?: readonly string[];
  key: string;
  label: string;
  list: Readonly<Record<string, string>>;
  /**
   * O Joomla pode listar categorias que o usuario enxerga, mas bloquear a
   * abertura direta de category.edit. Nesses casos a linha da listagem e a
   * evidencia autoritativa e nenhum GET de detalhe deve ser feito.
   */
  listOnly?: boolean;
  singleton?: boolean;
};

export function saoPauloCivilYear(now = new Date()): number {
  const year = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  }).format(now);
  return Number.parseInt(year, 10);
}

const category = (key: string, label: string, extension: string): CatalogModule => ({
  detailTasks: ["category.edit"],
  detailViews: ["category"],
  key,
  label,
  list: { extension, option: "com_categories" },
  listOnly: true,
});

const widesys = (
  key: string,
  label: string,
  view: string,
  detail: string,
  extra: Readonly<Record<string, string>> = {},
): CatalogModule => ({
  detailTasks: [`${detail}.edit`],
  detailViews: [detail],
  key,
  label,
  list: { option: "com_widesys", view, ...extra },
});

/**
 * Lista fechada de telas cadastrais. Nada fora deste registro pode ser lido pelo
 * coletor. Os caminhos foram extraidos do menu administrativo ja capturado.
 */
export const CATALOG_MODULES = [
  widesys("empresas", "Matriz e filiais", "empresas", "empresa"),
  widesys("contas", "Contas bancarias", "contas", "conta"),
  widesys("boletolayouts", "Layouts bancarios", "boletolayouts", "boletolayout"),
  {
    key: "calendarios",
    label: "Calendario financeiro",
    list: { option: "com_widesys", view: "calendarios" },
    singleton: true,
  },
  {
    key: "irrf",
    label: "Tabela IRRF",
    list: {
      layout: "edit",
      option: "com_widesys",
      periodo: String(saoPauloCivilYear()),
      view: "irrf",
    },
    singleton: true,
  },
  widesys("reajustes", "Indices de reajuste", "reajustes", "reajuste"),
  widesys("locacaoeventos", "Servicos de locacao", "locacaoeventos", "locacaoevento"),
  category("tipos-recebimento", "Tipos de recebimento", "com_widesys.tiposcobranca"),
  category("plano-contas", "Plano de contas", "com_widesys.planocontas"),
  category("contratos-marcacoes", "Marcacoes de contratos", "com_widesys.locacao"),
  category("locacao-garantias", "Garantias de locacao", "com_widesys.locacaogarantia"),
  category("pessoas-marcacoes", "Marcacoes de pessoas", "com_widesys.pessoa"),
  category("imoveis-tipos", "Tipos de imoveis", "com_widesys.produtostipos"),
  category(
    "imoveis-caracteristicas",
    "Caracteristicas do imovel",
    "com_widesys.produto.caracteristicas",
  ),
  category(
    "condominios-empreendimentos-caracteristicas",
    "Caracteristicas de condominio e empreendimento",
    "com_widesys.produto.caracteristicas_a",
  ),
  category(
    "plantas-caracteristicas",
    "Caracteristicas da planta",
    "com_widesys.produto.caracteristicas_p",
  ),
  category("imoveis-status", "Status de imoveis", "com_widesys.produtosstatus"),
  category(
    "imoveis-status-comercial",
    "Status comercial de imoveis",
    "com_widesys.produtosstatuscomercial",
  ),
  category("imoveis-marcacoes", "Marcacoes de imoveis", "com_widesys.produto.exigencias"),
  category("imoveis-origens", "Origens de captacao", "com_widesys.produtosorigens"),
  category(
    "empreendimentos-tipos",
    "Tipos de empreendimento",
    "com_widesys.empreendimentostipos",
  ),
  category(
    "empreendimentos-fases",
    "Fases de empreendimentos",
    "com_widesys.empreendimentosfases",
  ),
  category(
    "empreendimentos-status-comercial",
    "Status comercial de empreendimentos",
    "com_widesys.empreendimentostatuscomercial",
  ),
  widesys("documentos-emails", "Modelos de e-mail", "documentos", "documento", {
    "filter[documentos.catid]": "-82",
  }),
  widesys("documentos-vendas", "Contratos de venda", "documentos", "documento", {
    "filter[documentos.catid]": "-85",
  }),
  widesys("documentos-locacoes", "Contratos de locacao", "documentos", "documento", {
    "filter[documentos.catid]": "-84",
  }),
  widesys("documentos-fichas-captacao", "Fichas de captacao", "documentos", "documento", {
    "filter[documentos.catid]": "-81",
  }),
  widesys("documentos-modelos-locacao", "Modelos de contrato de locacao", "documentos", "documento", {
    "filter[documentos.catid]": "-80",
  }),
  widesys("documentos-modelos-venda", "Modelos de contrato de venda", "documentos", "documento", {
    "filter[documentos.catid]": "-79",
  }),
  {
    key: "origens-clientes",
    label: "Origens de clientes",
    list: { layout: "edit", option: "com_widesys", view: "origemclientes" },
    singleton: true,
  },
  category("nacionalidades", "Nacionalidades", "com_widesys.nacionalidades"),
  widesys("estados", "Estados", "estados", "estado"),
  widesys("cidades", "Cidades", "cidades", "cidade"),
  widesys("bairros", "Bairros", "bairros", "bairro"),
  widesys("paises", "Paises", "paises", "paise"),
] as const satisfies readonly CatalogModule[];

export type CatalogModuleKey = (typeof CATALOG_MODULES)[number]["key"];

export function catalogModule(key: string): CatalogModule | undefined {
  return CATALOG_MODULES.find((module) => module.key === key);
}

export function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return named[body.toLowerCase()] ?? entity;
  });
}

export function parseAttributes(fragment: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of fragment.matchAll(
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,
  )) {
    const name = (match[1] || "").toLowerCase();
    if (!name) continue;
    attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

export function normalizeText(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

const SECRET_FIELD =
  /(?:passw|passwd|password|senha|secret|token|authorization|cookie|api[_-]?key|client[_-]?secret|certificad|certificate|private[_-]?key|(?:^|[\W_])(?:pfx|p12|pem)(?:[\W_]|$))/i;
const SECRET_QUERY =
  /(?:^|[_-])(?:passw|passwd|password|senha|secret|token|csrf|authorization|cookie|api[_-]?key|client[_-]?secret)(?:$|[_-])/i;
const CERTIFICATE_FILE = /\.(?:p12|pfx|pem|key|crt|cer)(?:$|[?#])/i;

function isSensitiveQueryKey(key: string): boolean {
  return SECRET_QUERY.test(key) || /^[a-f\d]{24,128}$/i.test(key);
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(
      /\b(password|passwd|senha|secret|token(?:[_-][a-z\d]+)?|(?:access|refresh|auth|id)[_-]?token|authorization|cookie|api[_-]?key|client[_-]?secret)\b\s*[:=]\s*([^\s,;]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(/\b[^\s"']+\.(?:p12|pfx|pem|key|crt|cer)\b/gi, "[CERTIFICATE REDACTED]");
}

function redactSensitiveDisplayedValues(html: string): string {
  const label =
    "(?:senha(?:\\s+(?:do|de))?\\s+certificad[oa]|senha|password|passphrase|client[\\s_-]*secret|api[\\s_-]*key|(?:access|refresh|auth)[\\s_-]*token|token|authorization|cookie|private[\\s_-]*key|certificad[oa])";
  const wrappers = "(?:\\s*<\\/?(?:strong|b|em|i|small|span)\\b[^>]*>)*";
  const pattern = new RegExp(
    `(<(?:td|th|dt|label|div|span)\\b[^>]*>${wrappers}\\s*${label}\\s*:?\\s*${wrappers}<\\/(?:td|th|dt|label|div|span)>\\s*<(td|dd|div|span)\\b[^>]*>)[\\s\\S]*?(<\\/\\2>)`,
    "gi",
  );
  return html.replace(pattern, "$1[REDACTED]$3");
}

export function publicUrl(input: URL): string {
  const url = new URL(input);
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) {
    if (isSensitiveQueryKey(key)) url.searchParams.delete(key);
  }
  url.hash = "";
  return url.toString();
}

/** Sanitizes absolute and relative URLs before they are persisted in raw HTML. */
export function sanitizePersistedUrl(value: string): string {
  const decoded = decodeEntities(value);
  if (CERTIFICATE_FILE.test(decoded)) return "[CERTIFICATE REDACTED]";

  const question = decoded.indexOf("?");
  if (question < 0) return decoded;
  const hash = decoded.indexOf("#", question);
  const prefix = decoded.slice(0, question);
  const query = decoded.slice(question + 1, hash < 0 ? undefined : hash);
  const fragment = hash < 0 ? "" : decoded.slice(hash);
  const parameters = new URLSearchParams(query);
  for (const key of [...parameters.keys()]) {
    if (isSensitiveQueryKey(key)) parameters.delete(key);
  }
  const safeQuery = parameters.toString();
  return `${prefix}${safeQuery ? `?${safeQuery}` : ""}${fragment}`;
}

function sanitizePersistedQuery(value: string): string {
  const sanitized = sanitizePersistedUrl(`?${decodeEntities(value).replace(/^\?/, "")}`);
  return sanitized.startsWith("?") ? sanitized.slice(1) : sanitized;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Remove scripts, event handlers, CSRF material and credential/certificate fields. */
export function sanitizeCatalogHtml(html: string): string {
  let safe = redactSensitiveDisplayedValues(html)
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gi, "[CERTIFICATE REDACTED]")
    .replace(/data:application\/(?:x-pkcs12|pkix-cert|x-x509-ca-cert);base64,[a-z\d+/=]+/gi, "[CERTIFICATE REDACTED]")
    .replace(/<!--([\s\S]*?)-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<meta\b[^>]*(?:csrf|token|secret|authorization|cookie)[^>]*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    // Nenhum data-* e necessario para importar os controles/tabelas. Alguns
    // componentes Joomla guardam JSON HTML-encoded nesses atributos, o que
    // poderia carregar client_secret, tokens ou configuracoes de certificado.
    .replace(/\s+data-[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, "")
    .replace(
      /\s+([^\s=/>]*(?:secret|token|authorization|cookie|certificad|certificate|private[_-]?key)[^\s=/>]*)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
      (_all, name) => ` ${name}="[REDACTED]"`,
    )
    .replace(
      /\s+(href|action|src|formaction|poster|data-(?:url|href|action|query|querystring))\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
      (_all, name: string, double, single, unquoted) => {
        const value = double ?? single ?? unquoted ?? "";
        const sanitized = /data-(?:query|querystring)/i.test(name)
          ? sanitizePersistedQuery(value)
          : sanitizePersistedUrl(value);
        return ` ${name}="${escapeAttribute(sanitized)}"`;
      },
    )
    .replace(/\s+(?:srcset|style)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/<a\b[^>]*href\s*=\s*(?:"[^"]*\.(?:p12|pfx|pem|key|crt|cer)[^"]*"|'[^']*\.(?:p12|pfx|pem|key|crt|cer)[^']*')[^>]*>[\s\S]*?<\/a>/gi, "[CERTIFICATE REDACTED]");

  safe = safe.replace(/<input\b([^>]*)>/gi, (tag, rawAttributes: string) => {
    const attributes = parseAttributes(rawAttributes);
    const name = attributes.name || attributes.id || "";
    const hiddenCsrf =
      (attributes.type || "").toLowerCase() === "hidden" &&
      (/^[a-f\d]{24,128}$/i.test(name) || SECRET_FIELD.test(name));
    if (hiddenCsrf) return "";
    if (SECRET_FIELD.test(name) || (attributes.type || "").toLowerCase() === "file") {
      const withoutValue = tag.replace(/\s+value\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
      return withoutValue.replace(/\s*\/?\s*>$/, ' value="[REDACTED]">');
    }
    return tag;
  });

  safe = safe.replace(
    /<textarea\b([^>]*)>[\s\S]*?<\/textarea>/gi,
    (tag, rawAttributes: string) =>
      SECRET_FIELD.test(parseAttributes(rawAttributes).name || parseAttributes(rawAttributes).id || "")
        ? `<textarea${rawAttributes}>[REDACTED]</textarea>`
        : tag,
  );
  safe = safe.replace(
    /<select\b([^>]*)>[\s\S]*?<\/select>/gi,
    (tag, rawAttributes: string) =>
      SECRET_FIELD.test(parseAttributes(rawAttributes).name || parseAttributes(rawAttributes).id || "")
        ? `<select${rawAttributes}><option selected>[REDACTED]</option></select>`
        : tag,
  );
  return redactSensitiveText(safe);
}

export type ExtractedLink = { href: string; source: "href" | "onclick"; text: string };

/** Extracts URL-shaped strings only; JavaScript is never evaluated. */
export function extractReadCandidates(html: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attributes = parseAttributes(match[1] ?? "");
    if (attributes.href) {
      links.push({ href: attributes.href, source: "href", text: normalizeText(match[2] ?? "") });
    }
    if (attributes.onclick) {
      for (const urlMatch of attributes.onclick.matchAll(/(?:['"])([^'"]*index\.php\?[^'"]+)(?:['"])/gi)) {
        links.push({ href: decodeEntities(urlMatch[1] ?? ""), source: "onclick", text: normalizeText(match[2] ?? "") });
      }
    }
  }
  for (const match of html.matchAll(/\bonclick\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const javascript = decodeEntities(match[1] ?? match[2] ?? "");
    for (const urlMatch of javascript.matchAll(/(?:['"])([^'"]*index\.php\?[^'"]+)(?:['"])/gi)) {
      links.push({ href: decodeEntities(urlMatch[1] ?? ""), source: "onclick", text: "" });
    }
  }
  return links.filter(
    (link, index) =>
      link.href && links.findIndex((candidate) => candidate.href === link.href && candidate.source === link.source) === index,
  );
}

export function assertAdminBase(baseUrl: URL): void {
  if (baseUrl.protocol !== "https:") throw new Error("A origem Widesys precisa usar HTTPS.");
  if (baseUrl.username || baseUrl.password) throw new Error("A URL base nao pode conter credenciais.");
  if (baseUrl.pathname !== "/administrator/index.php") {
    throw new Error("A URL base precisa apontar para /administrator/index.php.");
  }
}

export function assertAdminIndexUrl(url: URL, baseUrl: URL): void {
  assertAdminBase(baseUrl);
  if (url.origin !== baseUrl.origin) throw new Error("Leitura externa bloqueada.");
  if (url.pathname !== baseUrl.pathname) throw new Error("Leitura fora do index administrativo bloqueada.");
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("URL administrativa insegura.");
}

export function assertSafeAdminRead(url: URL, baseUrl: URL): void {
  assertAdminIndexUrl(url, baseUrl);
  const task = (url.searchParams.get("task") || "").toLowerCase();
  if (task && !task.endsWith(".edit") && task !== "display") {
    throw new Error("Task que nao e de leitura foi bloqueada.");
  }
  if (/(?:save|apply|delete|remove|publish|unpublish|archive|trash|batch|upload|import|export|generate|gerar|send|emitir|liquidar|baixar)/i.test(task)) {
    throw new Error("Task mutavel foi bloqueada.");
  }
}

export function listUrl(
  module: CatalogModule,
  baseUrl: URL,
  offset = 0,
  startParameter: PageStartParameter = "limitstart",
): URL {
  const url = new URL("index.php", baseUrl);
  for (const [key, value] of Object.entries(module.list)) url.searchParams.set(key, value);
  if (!module.singleton) {
    url.searchParams.set(catalogListLimitParameter(module), String(PAGE_LIMIT));
    if (offset > 0) url.searchParams.set(startParameter, String(offset));
  }
  assertCatalogListUrl(url, baseUrl, module);
  return url;
}

export function catalogListLimitParameter(module: CatalogModule): "limit" | "list[limit]" {
  return module.list.option === "com_widesys" ? "limit" : "list[limit]";
}

export function assertCatalogListUrl(url: URL, baseUrl: URL, module: CatalogModule): void {
  assertSafeAdminRead(url, baseUrl);
  for (const [key, value] of Object.entries(module.list)) {
    if (url.searchParams.get(key) !== value) throw new Error(`Listagem fora da whitelist de ${module.key}.`);
  }
  const limitParameter = catalogListLimitParameter(module);
  const allowed = new Set([...Object.keys(module.list), limitParameter, "limitstart", "list[start]"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) throw new Error(`Parametro de listagem nao permitido: ${key}.`);
  }
  if (!module.singleton && url.searchParams.get(limitParameter) !== String(PAGE_LIMIT)) {
    throw new Error("Limite de pagina fora do valor autorizado.");
  }
  const starts = ["limitstart", "list[start]"].filter((key) => url.searchParams.has(key));
  if (starts.length > 1) throw new Error("Mais de um parametro de paginacao foi bloqueado.");
  for (const key of starts) {
    if (!/^\d+$/.test(url.searchParams.get(key) || "")) throw new Error("Offset de pagina invalido.");
  }
}

function numericId(url: URL): string | null {
  const ids = url.searchParams.getAll("id");
  if (ids.length !== 1 || !catalogNumericIdIsValid(ids[0] || "")) return null;
  return ids[0] ?? null;
}

function catalogNumericIdIsValid(value: string): boolean {
  return /^(?:0|[1-9]\d{0,158}|-[1-9]\d{0,158})$/.test(value);
}

/** Converts an allowed href/onclick detail into a minimal canonical GET URL. */
export function canonicalDetailUrl(
  candidate: string,
  currentUrl: URL,
  baseUrl: URL,
  module: CatalogModule,
): URL | null {
  if (module.singleton || !candidate || /^(?:javascript:|mailto:|tel:|#)/i.test(candidate.trim())) return null;
  let input: URL;
  try {
    input = new URL(decodeEntities(candidate), currentUrl);
  } catch {
    return null;
  }
  try {
    // A evidencia pode vir como task=*.edit, mas essa URL nunca e requisitada.
    assertAdminIndexUrl(input, baseUrl);
  } catch {
    return null;
  }
  const id = numericId(input);
  if (!id || input.searchParams.get("option") !== module.list.option) return null;
  if (module.list.option === "com_categories" && input.searchParams.get("extension") !== module.list.extension) {
    return null;
  }

  const task = (input.searchParams.get("task") || "").toLowerCase();
  const view = (input.searchParams.get("view") || "").toLowerCase();
  const layout = (input.searchParams.get("layout") || "").toLowerCase();
  const taskAllowed = Boolean(task && module.detailTasks?.includes(task));
  const viewAllowed = Boolean(layout === "edit" && view && module.detailViews?.includes(view));
  if (!taskAllowed && !viewAllowed) return null;

  const canonical = new URL("index.php", baseUrl);
  canonical.searchParams.set("option", module.list.option);
  if (module.list.option === "com_categories") {
    canonical.searchParams.set("extension", module.list.extension || "");
  }
  // A rota direta e somente leitura; task=*.edit pode fazer checkout do registro no Joomla.
  const canonicalView = viewAllowed ? view : module.detailViews?.[0];
  if (canonicalView) {
    canonical.searchParams.set("view", canonicalView);
    canonical.searchParams.set("layout", "edit");
  } else canonical.searchParams.set("task", task);
  canonical.searchParams.set("id", id);
  assertCatalogDetailUrl(canonical, baseUrl, module, id);
  return canonical;
}

export function assertCatalogDetailUrl(
  url: URL,
  baseUrl: URL,
  module: CatalogModule,
  expectedId: string,
): void {
  assertSafeAdminRead(url, baseUrl);
  if (url.searchParams.get("option") !== module.list.option) throw new Error("Componente de detalhe nao permitido.");
  const id = numericId(url);
  if (!id) throw new Error("Detalhe sem id numerico unico.");
  if (!catalogNumericIdIsValid(expectedId) || id !== expectedId) {
    throw new Error("ID do detalhe diverge da identidade descoberta na listagem.");
  }
  if (module.list.option === "com_categories" && url.searchParams.get("extension") !== module.list.extension) {
    throw new Error("Extensao de categoria nao autorizada.");
  }
  if (url.searchParams.has("task")) {
    throw new Error("GET com task foi bloqueado para evitar checkout ou lock.");
  }
  const view = (url.searchParams.get("view") || "").toLowerCase();
  const layout = (url.searchParams.get("layout") || "").toLowerCase();
  const viewAllowed = Boolean(layout === "edit" && view && module.detailViews?.includes(view));
  if (!viewAllowed) throw new Error(`Detalhe fora da whitelist de ${module.key}.`);

  const allowed = new Set(["option", "id", "view", "layout"]);
  if (module.list.option === "com_categories") allowed.add("extension");
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) throw new Error(`Parametro de detalhe nao permitido: ${key}.`);
  }
}

type CanonicalDetailCandidate = { label: string; url: URL };

function canonicalDetailsFromFragment(
  html: string,
  currentUrl: URL,
  baseUrl: URL,
  module: CatalogModule,
): Map<string, CanonicalDetailCandidate> {
  const details = new Map<string, CanonicalDetailCandidate>();
  for (const candidate of extractReadCandidates(html)) {
    const canonical = canonicalDetailUrl(candidate.href, currentUrl, baseUrl, module);
    const id = canonical ? numericId(canonical) : null;
    if (!canonical || !id) continue;
    const existing = details.get(id);
    const label = normalizeText(candidate.text);
    if (!existing) details.set(id, { label, url: canonical });
    else if (!existing.label && label) details.set(id, { label, url: canonical });
  }
  return details;
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function listRowSnapshot(row: string, label: string, module: CatalogModule): string {
  const safeRow = sanitizeCatalogHtml(row);
  const title = normalizeText(label) || module.label;
  return sanitizeCatalogHtml(
    [
      "<!doctype html><html><head>",
      `<title>${escapeHtmlText(title)}</title>`,
      "</head><body><table><tbody>",
      safeRow,
      "</tbody></table></body></html>",
    ].join(""),
  );
}

export type CatalogDetailEvidence = {
  evidenceHash: string;
  id: string;
  label: string;
  /** Snapshot sanitizado da linha; obrigatorio para modulos listOnly. */
  listSnapshotHtml?: string;
  url: URL;
};

export function discoverDetailEvidence(
  html: string,
  currentUrl: URL,
  baseUrl: URL,
  module: CatalogModule,
): CatalogDetailEvidence[] {
  const evidence = new Map<string, CatalogDetailEvidence>();
  for (const rowMatch of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const row = rowMatch[0];
    for (const [id, candidate] of canonicalDetailsFromFragment(row, currentUrl, baseUrl, module)) {
      if (evidence.has(id)) {
        throw new Error(`A listagem repetiu o ID ${id} em mais de uma linha.`);
      }
      const snapshot = listRowSnapshot(row, candidate.label, module);
      evidence.set(id, {
        evidenceHash: sha256(`${candidate.url.toString()}\n${normalizeText(snapshot)}`),
        id,
        label: candidate.label,
        listSnapshotHtml: snapshot,
        url: candidate.url,
      });
    }
  }
  // Um modulo listOnly precisa de uma linha verificavel: um link solto fora da
  // tabela nao e suficiente para materializar um cadastro.
  if (module.listOnly) return [...evidence.values()];
  for (const [id, candidate] of canonicalDetailsFromFragment(html, currentUrl, baseUrl, module)) {
    if (!evidence.has(id)) {
      evidence.set(id, {
        evidenceHash: sha256(candidate.url.toString()),
        id,
        label: candidate.label,
        url: candidate.url,
      });
    }
  }
  return [...evidence.values()];
}

export function discoverDetails(html: string, currentUrl: URL, baseUrl: URL, module: CatalogModule): URL[] {
  return discoverDetailEvidence(html, currentUrl, baseUrl, module).map((detail) => detail.url);
}

export function catalogRequiresDetailFetch(module: CatalogModule): boolean {
  return !module.singleton && !module.listOnly;
}

export type CatalogPageCountEvidence = {
  discovered: number;
  explicitlyEmpty: boolean;
  nextOffsets: readonly number[];
  offset: number;
  reportedTotal: number | null;
};

export type CatalogCountResolution = {
  explicitlyEmpty: boolean;
  source: "explicit-empty" | "reported" | "terminal-page";
  total: number;
};

/**
 * Resolve a contagem somente quando a prova e fechada: total declarado pelo
 * legado ou sequencia contigua que termina numa pagina menor que o limite.
 */
export function resolveCatalogCount(
  pages: readonly CatalogPageCountEvidence[],
): CatalogCountResolution {
  if (pages.length === 0) throw new Error("Catalogo sem pagina para reconciliar.");
  const sorted = [...pages].sort((left, right) => left.offset - right.offset);
  if (new Set(sorted.map((page) => page.offset)).size !== sorted.length) {
    throw new Error("A captura repetiu o mesmo offset de pagina.");
  }
  for (const page of sorted) {
    if (
      !Number.isSafeInteger(page.offset) ||
      page.offset < 0 ||
      !Number.isSafeInteger(page.discovered) ||
      page.discovered < 0 ||
      page.discovered > PAGE_LIMIT
    ) {
      throw new Error("Evidencia de paginacao invalida.");
    }
  }

  const reported = [...new Set(
    sorted
      .map((page) => page.reportedTotal)
      .filter((total): total is number => total !== null),
  )];
  if (reported.length > 1) throw new Error("A listagem informou totais divergentes entre paginas.");
  if (reported.length === 1) {
    const total = reported[0] as number;
    if (!Number.isSafeInteger(total) || total < 0) throw new Error("Total declarado invalido.");
    if (total === 0) {
      if (!sorted.some((page) => page.explicitlyEmpty)) {
        throw new Error("Catalogo declarado vazio sem evidencia textual explicita.");
      }
      return { explicitlyEmpty: true, source: "explicit-empty", total: 0 };
    }
    return { explicitlyEmpty: false, source: "reported", total };
  }

  if (sorted[0]?.offset !== 0) throw new Error("A paginacao sem total nao comeca no offset zero.");
  for (let index = 0; index < sorted.length; index += 1) {
    const page = sorted[index];
    if (!page || page.offset !== index * PAGE_LIMIT) {
      throw new Error("A paginacao sem total possui lacuna ou offset inesperado.");
    }
    if (index < sorted.length - 1 && page.discovered !== PAGE_LIMIT) {
      throw new Error("Uma pagina intermediaria sem total esta incompleta.");
    }
  }
  const terminal = sorted.at(-1);
  if (!terminal || terminal.discovered >= PAGE_LIMIT) {
    throw new Error("Nao foi possivel provar a ultima pagina sem total declarado.");
  }
  if (terminal.nextOffsets.some((offset) => offset > terminal.offset)) {
    throw new Error("A pagina candidata a terminal ainda aponta para uma pagina seguinte.");
  }
  const total = sorted.reduce((sum, page) => sum + page.discovered, 0);
  if (total === 0) {
    if (!terminal.explicitlyEmpty) throw new Error("Catalogo vazio sem evidencia textual explicita.");
    return { explicitlyEmpty: true, source: "explicit-empty", total: 0 };
  }
  return { explicitlyEmpty: false, source: "terminal-page", total };
}

export function catalogCountMatches(
  reportedTotal: number | null,
  discoveredTotal: number,
  singleton = false,
  explicitlyEmpty = false,
): boolean {
  return singleton ||
    (reportedTotal === null ? explicitlyEmpty && discoveredTotal === 0 : reportedTotal === discoveredTotal);
}

export function catalogPageExplicitlyEmpty(html: string): boolean {
  return /\b(?:nenhum(?:a)?\s+(?:registro|resultado)|sem\s+(?:registro|resultado)|0\s+resultados?|atualmente,?\s+n[aã]o\s+h[aá]\s+categorias?)\b/iu.test(
    normalizeText(sanitizeCatalogHtml(html)),
  );
}

export function catalogPageHasEvidence(
  html: string,
  discoveredTotal: number,
  reportedTotal: number | null,
  singleton = false,
): boolean {
  const safeHtml = sanitizeCatalogHtml(html);
  const hasStructure = /<(?:form|table)\b/i.test(safeHtml);
  if (!hasStructure || /\b(?:fatal error|access denied|acesso negado|pagina nao encontrada)\b/i.test(normalizeText(safeHtml))) {
    return false;
  }
  if (singleton) {
    const record = extractCatalogRecord(safeHtml);
    return Boolean(
      record.title &&
      !/^(?:administracao|administração|dashboard|painel(?: de controle)?)$/i.test(record.title.trim()) &&
      (record.controls.length > 0 || record.tables.some((table) => table.some((row) => row.length > 0))),
    );
  }
  if (discoveredTotal > 0) return true;
  if (reportedTotal !== null) return reportedTotal === 0;
  return catalogPageExplicitlyEmpty(safeHtml);
}

export function discoverPageCursors(html: string): PageCursor[] {
  const cursors = new Map<string, PageCursor>();
  for (const candidate of extractReadCandidates(html)) {
    try {
      const url = new URL(decodeEntities(candidate.href), "https://invalid.local/administrator/index.php");
      for (const parameter of ["list[start]", "limitstart"] as const) {
        const raw = url.searchParams.get(parameter);
        if (!raw || !/^\d+$/.test(raw)) continue;
        const offset = Number.parseInt(raw, 10);
        if (offset >= 0) cursors.set(`${parameter}:${offset}`, { offset, parameter });
      }
    } catch {
      // Fragmentos malformados nao entram na fila.
    }
  }
  return [...cursors.values()].sort(
    (left, right) => left.offset - right.offset || left.parameter.localeCompare(right.parameter),
  );
}

/** Compatibilidade para consumidores que precisam somente dos offsets. */
export function discoverPageOffsets(html: string): number[] {
  return [...new Set(discoverPageCursors(html).map((cursor) => cursor.offset))].sort(
    (left, right) => left - right,
  );
}

export function parseReportedTotal(html: string): number | null {
  const normalized = normalizeText(html);
  const patterns = [
    /\b([\d.]+)\s+resultados?\b/i,
    /\btotal\s*[:=]?\s*([\d.]+)\b/i,
    /\bde\s+([\d.]+)\s+(?:itens|registros|resultados)\b/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match?.[1]) continue;
    const value = Number.parseInt(match[1].replace(/\D/g, ""), 10);
    if (Number.isSafeInteger(value) && value >= 0) return value;
  }
  return null;
}

type ExtractedControl = {
  checked?: boolean;
  id?: string;
  name?: string;
  options?: Array<{ selected: boolean; text: string; value: string }>;
  type: string;
  value?: string;
};

export function extractCatalogRecord(html: string): {
  controls: ExtractedControl[];
  tables: string[][][];
  title: string;
} {
  const controls: ExtractedControl[] = [];
  for (const match of html.matchAll(/<input\b([^>]*)>/gi)) {
    const attributes = parseAttributes(match[1] ?? "");
    const type = (attributes.type || "text").toLowerCase();
    if (["button", "image", "reset", "submit"].includes(type)) continue;
    controls.push({
      checked: Object.hasOwn(attributes, "checked") || undefined,
      id: attributes.id || undefined,
      name: attributes.name || undefined,
      type,
      value: attributes.value || undefined,
    });
  }
  for (const match of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const attributes = parseAttributes(match[1] ?? "");
    controls.push({
      id: attributes.id || undefined,
      name: attributes.name || undefined,
      type: "textarea",
      value: normalizeText(match[2] ?? ""),
    });
  }
  for (const match of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const attributes = parseAttributes(match[1] ?? "");
    const options = [...(match[2] ?? "").matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map(
      (option) => {
        const optionAttributes = parseAttributes(option[1] ?? "");
        return {
          selected: Object.hasOwn(optionAttributes, "selected"),
          text: normalizeText(option[2] ?? ""),
          value: optionAttributes.value || "",
        };
      },
    );
    controls.push({
      id: attributes.id || undefined,
      name: attributes.name || undefined,
      options,
      type: "select",
      value: options.find((option) => option.selected)?.value,
    });
  }

  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((table) =>
    [...(table[1] ?? "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
      [...(row[1] ?? "").matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
        normalizeText(cell[1] ?? ""),
      ),
    ),
  );
  const title = normalizeText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  return { controls, tables, title };
}
