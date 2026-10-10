#!/usr/bin/env tsx

/** Diagnóstico limitado: login e GETs, sem importação, gravação ou dados pessoais na saída. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertLoginRoute, verifiedOperationalTotal } from "./capturar-operacao-widesys";
import { isJoomlaLoginPage, parseAttributes, parseTotal } from "./widesys-parser";

const ORIGEM = "https://brisaazul.app2.widesys.com.br";
const INICIO = new URL(`${ORIGEM}/administrator/index.php?admin`);
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
const TELAS = {
  contratos: "locacaos",
  receber: "financontasrecebers",
  pagar: "financontaspagars",
  movimentacoes: "finanlancamentos",
} as const;

type Estado = "OK" | "CREDENCIAIS_AUSENTES" | "CREDENCIAIS_RECUSADAS" | "HTTP_ERRO" | "TEMPO_ESGOTADO" | "FALHA_REDE" | "RESPOSTA_INESPERADA" | "ROTA_BLOQUEADA" | "RESPOSTA_EXCEDE_LIMITE";
type ResultadoConsulta = { estado: Estado; http?: number; registrosNaAmostra?: number; totalInformado?: number | null };
class FalhaSegura extends Error {
  constructor(readonly estado: Estado, readonly http?: number) { super(estado); }
}

function resultadoErro(error: unknown): ResultadoConsulta {
  if (error instanceof FalhaSegura) return { estado: error.estado, ...(error.http ? { http: error.http } : {}) };
  if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) return { estado: "TEMPO_ESGOTADO" };
  // Nunca serializar mensagens remotas, stack, body, URL ou cabeçalhos.
  return { estado: "FALHA_REDE" };
}

async function lerLimitado(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const partes: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new FalhaSegura("RESPOSTA_EXCEDE_LIMITE");
      partes.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(partes).toString("utf8");
}

export function formularioLoginDiagnostico(html: string): { action: string; fields: URLSearchParams; usuario: string; senha: string } {
  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const form = parseAttributes(match[1]);
    if (form.method?.toLowerCase() !== "post") continue;
    const inputs = [...match[2].matchAll(/<input\b([^>]*)>/gi)].map((item) => parseAttributes(item[1]));
    const usuario = inputs.find((item) => /^(?:username|user|login|usuario|j_username)$/i.test(item.name ?? ""))?.name;
    const senha = inputs.find((item) => item.type?.toLowerCase() === "password")?.name;
    if (!usuario || !senha) continue;
    const fields = new URLSearchParams();
    for (const item of inputs) {
      if (!item.name || "disabled" in item) continue;
      const tipo = (item.type || "text").toLowerCase();
      if (["button", "file", "image", "reset", "submit"].includes(tipo)) continue;
      if (["checkbox", "radio"].includes(tipo) && !("checked" in item)) continue;
      if (fields.has(item.name)) throw new FalhaSegura("RESPOSTA_INESPERADA");
      fields.set(item.name, item.value || "");
    }
    if (fields.get("option") !== "com_login" || fields.get("task") !== "login") continue;
    return { action: form.action || "", fields, usuario, senha };
  }
  throw new FalhaSegura("RESPOSTA_INESPERADA");
}

export async function diagnosticarWidesys({
  env = process.env,
  fetcher = fetch,
}: { env?: Partial<NodeJS.ProcessEnv>; fetcher?: typeof fetch } = {}) {
  const resultado = {
    verificadoEm: new Date().toISOString(),
    origem: ORIGEM,
    somenteLeitura: true,
    importacaoExecutada: false,
    dadosPessoaisPersistidos: false,
    // A conexão disponível não significa uma assinatura de eventos/rotina automática.
    modoIntegracaoDisponivel: "CAPTURA_MANUAL_EM_LOTES",
    escopoTotaisTelas: "FILTROS_PADRAO_DO_LEGADO_NAO_SAO_TOTAIS_GLOBAIS",
    apiCadastros: { estado: "CREDENCIAIS_AUSENTES" } as ResultadoConsulta,
    acessoAdministrativo: { estado: "CREDENCIAIS_AUSENTES" } as ResultadoConsulta,
    telasFinanceiras: {} as Partial<Record<keyof typeof TELAS, ResultadoConsulta>>,
  };
  if (env.WIDESYS_BASE_URL) {
    try {
      const base = new URL(env.WIDESYS_BASE_URL);
      if (base.origin !== ORIGEM || base.username || base.password || base.hash) throw new Error();
    } catch {
      resultado.apiCadastros = resultado.acessoAdministrativo = { estado: "ROTA_BLOQUEADA" };
      return resultado;
    }
  }
  const usuario = (env.WIDESYS_USUARIO || env.WIDESYS_USERNAME || "").trim();
  const senha = env.WIDESYS_SENHA || env.WIDESYS_PASSWORD || "";
  if (!usuario || !senha) return resultado;

  try {
    const response = await fetcher(`${ORIGEM}/api/index.php/v1/widesys/clientes?page%5Blimit%5D=1`, {
      method: "GET", redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/vnd.api+json", Authorization: `Basic ${Buffer.from(`${usuario}:${senha}`).toString("base64")}` },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new FalhaSegura([401, 403].includes(response.status) ? "CREDENCIAIS_RECUSADAS" : "HTTP_ERRO", response.status);
    }
    const texto = await lerLimitado(response);
    let parsed;
    try { parsed = JSON.parse(texto); } catch { throw new FalhaSegura("RESPOSTA_INESPERADA", response.status); }
    if (!Array.isArray(parsed?.data)) throw new FalhaSegura("RESPOSTA_INESPERADA", response.status);
    const total = Number(parsed?.meta?.["total-items"]);
    resultado.apiCadastros = { estado: "OK", http: response.status, registrosNaAmostra: parsed.data.length, totalInformado: Number.isSafeInteger(total) && total >= 0 ? total : null };
  } catch (error) { resultado.apiCadastros = resultadoErro(error); }

  const cookies = new Map<string, string>();
  async function requisitar(initial: URL, method: "GET" | "POST", login: boolean, body?: string) {
    let url = initial;
    for (let salto = 0; salto < 4; salto++) {
      try {
        if (login) assertLoginRoute(url, INICIO, method);
        else if (url.href !== initial.href || method !== "GET") throw new Error();
      } catch { throw new FalhaSegura("ROTA_BLOQUEADA"); }
      const headers: Record<string, string> = { Accept: "text/html", "User-Agent": "BrisaReadOnlyConnectionCheck/1.0" };
      if (cookies.size) headers.Cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
      if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
      const response = await fetcher(url, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
      for (const cookie of response.headers.getSetCookie()) {
        const primeiro = cookie.split(";", 1)[0];
        const separador = primeiro.indexOf("=");
        if (separador > 0) cookies.set(primeiro.slice(0, separador), primeiro.slice(separador + 1));
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const destino = response.headers.get("location");
        if (!login || !destino || (method === "POST" && [307, 308].includes(response.status))) throw new FalhaSegura("ROTA_BLOQUEADA", response.status);
        url = new URL(destino, url);
        method = "GET";
        body = undefined;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new FalhaSegura([401, 403].includes(response.status) ? "CREDENCIAIS_RECUSADAS" : "HTTP_ERRO", response.status);
      }
      return { html: await lerLimitado(response), http: response.status, url };
    }
    throw new FalhaSegura("ROTA_BLOQUEADA");
  }

  try {
    const pagina = await requisitar(INICIO, "GET", true);
    const form = formularioLoginDiagnostico(pagina.html);
    form.fields.set(form.usuario, usuario);
    form.fields.set(form.senha, senha);
    const autenticado = await requisitar(new URL(form.action, pagina.url), "POST", true, form.fields.toString());
    if (isJoomlaLoginPage(autenticado.html)) throw new FalhaSegura("CREDENCIAIS_RECUSADAS", autenticado.http);
    resultado.acessoAdministrativo = { estado: "OK", http: autenticado.http };
  } catch (error) {
    resultado.acessoAdministrativo = resultadoErro(error);
    return resultado;
  }

  for (const [modulo, view] of Object.entries(TELAS) as [keyof typeof TELAS, string][]) {
    try {
      const url = new URL(INICIO.pathname, ORIGEM);
      url.search = new URLSearchParams({ option: "com_widesys", view, limit: "1", limitstart: "0" }).toString();
      const pagina = await requisitar(url, "GET", false);
      if (isJoomlaLoginPage(pagina.html)) throw new FalhaSegura("CREDENCIAIS_RECUSADAS", pagina.http);
      let totalInformado = parseTotal(pagina.html);
      const registrosNaAmostra = [...pagina.html.matchAll(/<input\b([^>]*)>/gi)]
        .map((item) => parseAttributes(item[1]))
        .filter((item) => item.name === "cid[]" && /^\d+$/.test(item.value ?? "")).length;
      if (!registrosNaAmostra && totalInformado === null) {
        try { totalInformado = verifiedOperationalTotal(pagina.html, []); }
        catch { throw new FalhaSegura("RESPOSTA_INESPERADA", pagina.http); }
      }
      if (!registrosNaAmostra && totalInformado !== 0) throw new FalhaSegura("RESPOSTA_INESPERADA", pagina.http);
      resultado.telasFinanceiras[modulo] = { estado: "OK", http: pagina.http, registrosNaAmostra, totalInformado };
    } catch (error) { resultado.telasFinanceiras[modulo] = resultadoErro(error); }
  }
  cookies.clear();
  return resultado;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  diagnosticarWidesys().then((resultado) => {
    console.log(JSON.stringify(resultado, null, 2));
    if (resultado.apiCadastros.estado !== "OK" || resultado.acessoAdministrativo.estado !== "OK" || Object.values(resultado.telasFinanceiras).some((item) => item.estado !== "OK")) process.exitCode = 1;
  }).catch(() => { console.error("Diagnóstico indisponível; nenhum dado importado."); process.exitCode = 1; });
}
