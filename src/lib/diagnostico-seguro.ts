/** Metadados técnicos permitidos em tela/log. Nunca serializa o erro original. */
export function digestSeguro(valor: unknown): string | undefined {
  return typeof valor === "string" && /^\d{1,20}$/.test(valor) ? valor : undefined;
}

const CODIGOS = new Set([
  "P1000", "P1001", "P1002", "P1003", "P1008", "P1010", "P1011", "P1012",
  "P1013", "P1014", "P1015", "P1016", "P1017", "P2002", "P2003", "P2021",
  "P2022", "P2024", "P2025", "P2028", "P2034", "ENOENT", "EACCES", "EPERM",
  "ENOSPC", "EIO", "ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "SQLITE_BUSY", "SQLITE_LOCKED",
]);

function propriedade(valor: unknown, chave: string): unknown {
  if ((typeof valor !== "object" && typeof valor !== "function") || valor === null) return undefined;
  // Uma exceção com getter defeituoso não pode derrubar o próprio diagnóstico.
  try { return (valor as Record<string, unknown>)[chave]; } catch { return undefined; }
}

function codigoSeguro(erro: unknown): string {
  let atual = erro;
  for (let nivel = 0; nivel < 3; nivel++) {
    const codigo = propriedade(atual, "code");
    if (typeof codigo === "string" && CODIGOS.has(codigo)) return codigo;
    atual = propriedade(atual, "cause");
  }
  return "ERRO_INTERNO";
}

/** Usa a rota do framework, com [id], jamais o caminho real da requisição. */
function rotaSegura(template: unknown): string {
  if (typeof template !== "string") return "/[rota-indisponivel]";
  const rota = template.split(/[?#]/, 1)[0];
  if (!rota.startsWith("/") || rota.length > 220 || !/^[a-zA-Z0-9/._()[\]-]+$/.test(rota)) return "/[rota-indisponivel]";
  // Defesa adicional: esta integração tem segredo no próprio caminho.
  return rota.replace(/(\/api\/integracoes\/sicoob\/webhook)(?:\/.*)?$/, "$1/[segredo]");
}

export function diagnosticoRequisicao(
  erro: unknown,
  request: { method?: unknown },
  context: { routePath?: unknown; routeType?: unknown },
) {
  const metodo = typeof request.method === "string" && ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(request.method) ? request.method : "OUTRO";
  const tipo = typeof context.routeType === "string" && ["render", "route", "action", "proxy"].includes(context.routeType) ? context.routeType : "outro";
  return {
    evento: "BRISA_REQUEST_ERROR",
    rota: rotaSegura(context.routePath),
    metodo,
    tipo,
    digest: digestSeguro(propriedade(erro, "digest")),
    codigo: codigoSeguro(erro),
  };
}
