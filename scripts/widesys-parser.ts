import { createHash } from "node:crypto";

export type HtmlAttributeMap = Record<string, string>;

export type ParsedInput = {
  name: string;
  type: string;
  value: string;
  checked: boolean;
};

export type ParsedForm = {
  action: string;
  method: string;
  attributes: HtmlAttributeMap;
  inputs: ParsedInput[];
};

export type ParsedAnchor = {
  href: string;
  text: string;
  rel: string;
  attributes: HtmlAttributeMap;
};

export type ParsedRecord = {
  title: string;
  text: string;
  fields: Array<{
    name: string;
    type: string;
    value: string | string[];
    checked?: boolean;
    label?: string;
  }>;
  tables: Array<{
    headers: string[];
    rows: string[][];
  }>;
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

export function decodeHtml(value: string): string {
  return value.replace(/&(#x?[\da-f]+|[a-z]+);/gi, (entity, body: string) => {
    const normalized = body.toLowerCase();
    if (normalized in NAMED_ENTITIES) return NAMED_ENTITIES[normalized];
    if (!normalized.startsWith("#")) return entity;
    const hexadecimal = normalized.startsWith("#x");
    const parsed = Number.parseInt(normalized.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : entity;
  });
}

export function normalizeText(value: string): string {
  return decodeHtml(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function stripTags(html: string): string {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p\s*>|<\/div\s*>|<\/tr\s*>|<\/li\s*>|<\/h[1-6]\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseAttributes(source: string): HtmlAttributeMap {
  const attributes: HtmlAttributeMap = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1]?.toLowerCase();
    if (!name) continue;
    attributes[name] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function isSensitiveField(name: string, type = ""): boolean {
  const normalized = name.toLowerCase();
  return (
    type.toLowerCase() === "password" ||
    /(?:passw|passwd|senha|secret|token|csrf|cookie|authorization|client_secret)/i.test(normalized) ||
    /^[a-f\d]{24,128}$/i.test(name)
  );
}

export function extractForms(html: string): ParsedForm[] {
  const forms: ParsedForm[] = [];
  const formPattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  for (const formMatch of html.matchAll(formPattern)) {
    const attributes = parseAttributes(formMatch[1] ?? "");
    const inputs: ParsedInput[] = [];
    for (const inputMatch of (formMatch[2] ?? "").matchAll(/<input\b([^>]*)>/gi)) {
      const inputAttributes = parseAttributes(inputMatch[1] ?? "");
      const name = inputAttributes.name ?? "";
      if (!name) continue;
      const type = (inputAttributes.type || "text").toLowerCase();
      const rawValue = inputAttributes.value ?? "";
      inputs.push({
        name,
        type,
        value: isSensitiveField(name, type) ? "[REDACTED]" : rawValue,
        checked: "checked" in inputAttributes,
      });
    }
    forms.push({
      action: attributes.action ?? "",
      method: (attributes.method || "get").toLowerCase(),
      attributes,
      inputs,
    });
  }
  return forms;
}

export function findLoginForm(html: string): ParsedForm | null {
  return (
    extractForms(html).find((form) =>
      form.inputs.some(
        (input) => input.type === "password" || /^(?:passw|passwd|password|senha)$/i.test(input.name),
      ),
    ) ?? null
  );
}

export function isJoomlaLoginPage(html: string): boolean {
  return extractForms(html).some(
    (form) =>
      form.method === "post" &&
      form.inputs.some((input) =>
        /^(?:username|user|login|usuario|j_username)$/i.test(input.name),
      ) &&
      form.inputs.some(
        (input) => input.type === "password" || /^(?:passw|passwd|password|senha)$/i.test(input.name),
      ) &&
      form.inputs.some((input) => input.name === "option" && input.value === "com_login") &&
      form.inputs.some((input) => input.name === "task" && input.value === "login"),
  );
}

export function extractAnchors(html: string): ParsedAnchor[] {
  const anchors: ParsedAnchor[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attributes = parseAttributes(match[1] ?? "");
    if (!attributes.href) continue;
    anchors.push({
      href: attributes.href,
      text: stripTags(match[2] ?? ""),
      rel: attributes.rel ?? "",
      attributes,
    });
  }
  return anchors;
}

function selectedOptionValues(body: string): { values: string[]; labels: string[] } {
  const selected: { values: string[]; labels: string[] } = { values: [], labels: [] };
  const options = [...body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)];
  const active = options.filter((option) => "selected" in parseAttributes(option[1] ?? ""));
  for (const option of active.length > 0 ? active : options.slice(0, 1)) {
    const attributes = parseAttributes(option[1] ?? "");
    selected.values.push(attributes.value ?? stripTags(option[2] ?? ""));
    selected.labels.push(stripTags(option[2] ?? ""));
  }
  return selected;
}

function precedingLabel(html: string, index: number, name: string): string | undefined {
  const prefix = html.slice(Math.max(0, index - 1_000), index);
  const byFor = [...prefix.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)]
    .reverse()
    .find((match) => parseAttributes(match[1] ?? "").for === name);
  if (byFor) return stripTags(byFor[2] ?? "");
  const nearest = [...prefix.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)].at(-1);
  return nearest ? stripTags(nearest[1] ?? "") : undefined;
}

export function extractRecord(html: string): ParsedRecord {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const fields: ParsedRecord["fields"] = [];

  for (const match of html.matchAll(/<input\b([^>]*)>/gi)) {
    const attributes = parseAttributes(match[1] ?? "");
    const name = attributes.name || attributes.id;
    if (!name) continue;
    const type = (attributes.type || "text").toLowerCase();
    const value = isSensitiveField(name, type) ? "[REDACTED]" : attributes.value ?? "";
    fields.push({
      name,
      type,
      value,
      checked: "checked" in attributes,
      label: precedingLabel(html, match.index ?? 0, attributes.id || name),
    });
  }

  for (const match of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const attributes = parseAttributes(match[1] ?? "");
    const name = attributes.name || attributes.id;
    if (!name) continue;
    fields.push({
      name,
      type: "textarea",
      value: isSensitiveField(name) ? "[REDACTED]" : decodeHtml(match[2] ?? "").trim(),
      label: precedingLabel(html, match.index ?? 0, attributes.id || name),
    });
  }

  for (const match of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const attributes = parseAttributes(match[1] ?? "");
    const name = attributes.name || attributes.id;
    if (!name) continue;
    const selected = selectedOptionValues(match[2] ?? "");
    fields.push({
      name,
      type: "select",
      value: isSensitiveField(name) ? "[REDACTED]" : selected.values,
      label: precedingLabel(html, match.index ?? 0, attributes.id || name) || selected.labels.join(", "),
    });
  }

  const tables: ParsedRecord["tables"] = [];
  for (const tableMatch of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const headers = [...(tableMatch[1] ?? "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(
      (match) => stripTags(match[1] ?? ""),
    );
    const rows = [...(tableMatch[1] ?? "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map((row) =>
        [...(row[1] ?? "").matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) =>
          stripTags(cell[1] ?? ""),
        ),
      )
      .filter((row) => row.length > 0);
    if (headers.length > 0 || rows.length > 0) tables.push({ headers, rows });
  }

  return {
    title: titleMatch ? stripTags(titleMatch[1] ?? "") : "",
    text: stripTags(html),
    fields,
    tables,
  };
}

export function parseTotal(html: string): number | null {
  const text = stripTags(html);
  const candidates = [
    /\btotal\s*:?[\s\u00a0]*(\d[\d.,]*)\b/i,
    /\b(\d[\d.,]*)\s+(?:itens|registros|resultados|cadastros)\b/i,
    /\bde\s+(\d[\d.,]*)\s+(?:itens|registros|resultados)\b/i,
  ];
  for (const pattern of candidates) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const parsed = Number.parseInt(match[1].replace(/\D/g, ""), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  const dataTotal = html.match(/\bdata-total\s*=\s*["'](\d+)["']/i)?.[1];
  return dataTotal ? Number.parseInt(dataTotal, 10) : null;
}

export function sanitizeHtml(html: string): string {
  let sanitized = html.replace(
    /(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi,
    "$1/* conteúdo removido: pode conter tokens da sessão */$2",
  );
  sanitized = sanitized.replace(/<input\b([^>]*)>/gi, (element, source: string) => {
    const attributes = parseAttributes(source);
    const name = attributes.name || attributes.id || "";
    const type = (attributes.type || "text").toLowerCase();
    if (!isSensitiveField(name, type)) return element;
    if (/\bvalue\s*=\s*"[^"]*"/i.test(element)) {
      return element.replace(/\bvalue\s*=\s*"[^"]*"/i, 'value="[REDACTED]"');
    }
    if (/\bvalue\s*=\s*'[^']*'/i.test(element)) {
      return element.replace(/\bvalue\s*=\s*'[^']*'/i, "value='[REDACTED]'");
    }
    return element;
  });
  sanitized = sanitized.replace(
    /([?&](?:amp;)?)(?:[a-f\d]{24,128})=1(?=(?:[&#"'\s]|$))/gi,
    "$1csrf_token=[REDACTED]",
  );
  sanitized = sanitized.replace(
    /(["'](?:csrf|token|secret|password|passwd|senha)["']\s*:\s*["'])[^"']*(["'])/gi,
    "$1[REDACTED]$2",
  );
  sanitized = sanitized.replace(
    /(<meta\b[^>]*\bname\s*=\s*["'](?:csrf[^"']*|token)["'][^>]*\bcontent\s*=\s*["'])[^"']*(["'][^>]*>)/gi,
    "$1[REDACTED]$2",
  );
  return sanitized;
}

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
