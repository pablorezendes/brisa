import "server-only";

import { request, type RequestOptions } from "node:https";

import type { ConfiguracaoSicoob } from "./configuracao";

const MAX_RESPOSTA_BYTES = 5 * 1024 * 1024;
const MAX_RESPOSTA_ABSOLUTO_BYTES = 48 * 1024 * 1024;

export type RespostaHttp = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  corpo: unknown;
};

export class ErroApiSicoob extends Error {
  readonly status: number | null;
  readonly codigo: string;
  readonly transitorio: boolean;

  constructor(
    mensagem: string,
    opcoes: { status?: number; codigo?: string; transitorio?: boolean } = {},
  ) {
    super(mensagem);
    this.name = "ErroApiSicoob";
    this.status = opcoes.status ?? null;
    this.codigo = opcoes.codigo ?? "SICOOB_API_ERRO";
    this.transitorio = opcoes.transitorio ?? false;
  }
}

function mensagemSegura(corpo: unknown, status: number): string {
  if (corpo && typeof corpo === "object") {
    const objeto = corpo as Record<string, unknown>;
    for (const chave of ["mensagem", "message", "descricao", "detail", "title"]) {
      if (typeof objeto[chave] === "string") {
        const texto = objeto[chave].trim().replace(/[\r\n\t]+/g, " ").slice(0, 300);
        if (texto) return texto;
      }
    }
  }
  return `Sicoob respondeu com HTTP ${status}.`;
}

export function requisicaoHttpsJson(
  url: URL,
  configuracao: ConfiguracaoSicoob,
  opcoes: {
    metodo: "GET" | "POST" | "PATCH" | "DELETE";
    headers?: Record<string, string>;
    corpo?: string;
    /** Exceção limitada para endpoints que retornam ZIP em Base64 dentro do JSON. */
    maxRespostaBytes?: number;
  },
): Promise<RespostaHttp> {
  if (url.protocol !== "https:") {
    return Promise.reject(
      new ErroApiSicoob("A integração Sicoob exige HTTPS.", {
        codigo: "SICOOB_URL_INSEGURA",
      }),
    );
  }

  const requestOptions: RequestOptions = {
    protocol: "https:",
    hostname: url.hostname,
    port: url.port || 443,
    method: opcoes.metodo,
    path: `${url.pathname}${url.search}`,
    headers: opcoes.headers,
    rejectUnauthorized: true,
    ...configuracao.tls,
  };
  const limiteSolicitado = opcoes.maxRespostaBytes;
  const maxRespostaBytes =
    typeof limiteSolicitado === "number" &&
    Number.isSafeInteger(limiteSolicitado) &&
    limiteSolicitado > MAX_RESPOSTA_BYTES
      ? Math.min(MAX_RESPOSTA_ABSOLUTO_BYTES, limiteSolicitado)
      : MAX_RESPOSTA_BYTES;

  return new Promise((resolve, reject) => {
    const req = request(requestOptions, (res) => {
      const partes: Buffer[] = [];
      let total = 0;
      res.on("data", (parte: Buffer | string) => {
        const buffer = Buffer.isBuffer(parte) ? parte : Buffer.from(parte);
        total += buffer.length;
        if (total > maxRespostaBytes) {
          req.destroy(
            new ErroApiSicoob("Resposta Sicoob excedeu o limite permitido.", {
              codigo: "SICOOB_RESPOSTA_GRANDE",
            }),
          );
          return;
        }
        partes.push(buffer);
      });
      res.on("end", () => {
        const status = res.statusCode ?? 0;
        const texto = Buffer.concat(partes).toString("utf8").trim();
        let corpo: unknown = null;
        if (texto) {
          try {
            corpo = JSON.parse(texto) as unknown;
          } catch {
            corpo = { mensagem: texto.slice(0, 300) };
          }
        }
        if (status < 200 || status >= 300) {
          reject(
            new ErroApiSicoob(mensagemSegura(corpo, status), {
              status,
              codigo: status === 401 ? "SICOOB_NAO_AUTORIZADO" : "SICOOB_HTTP_ERRO",
              transitorio: status === 408 || status === 429 || status >= 500,
            }),
          );
          return;
        }
        resolve({ status, headers: res.headers, corpo });
      });
    });

    req.setTimeout(configuracao.timeoutMs, () => {
      req.destroy(
        new ErroApiSicoob("Tempo limite excedido ao contatar o Sicoob.", {
          codigo: "SICOOB_TIMEOUT",
          transitorio: true,
        }),
      );
    });
    req.on("error", (erro) => {
      if (erro instanceof ErroApiSicoob) reject(erro);
      else {
        reject(
          new ErroApiSicoob("Falha de comunicação com o Sicoob.", {
            codigo: "SICOOB_REDE",
            transitorio: true,
          }),
        );
      }
    });
    if (opcoes.corpo) req.write(opcoes.corpo);
    req.end();
  });
}
