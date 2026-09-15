import { createHash } from "node:crypto";

import type { IdentificadoresEventoSicoob } from "./tipos";

const MAX_PROFUNDIDADE = 16;
const MAX_NOS = 5_000;
const MAX_CANONICO = 1_000_000;

function serializarCanonico(
  valor: unknown,
  vistos: Set<object>,
  estado: { nos: number },
  profundidade: number,
): string {
  estado.nos += 1;
  if (estado.nos > MAX_NOS || profundidade > MAX_PROFUNDIDADE) {
    throw new TypeError("Payload excede os limites seguros para canonicalização.");
  }
  if (valor === null) return "null";
  if (typeof valor === "string" || typeof valor === "boolean") {
    return JSON.stringify(valor);
  }
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) throw new TypeError("Payload contém número não finito.");
    return JSON.stringify(valor);
  }
  if (typeof valor === "undefined") return "null";
  if (typeof valor !== "object") {
    throw new TypeError("Payload contém tipo não suportado.");
  }
  if (vistos.has(valor)) throw new TypeError("Payload circular não é suportado.");
  vistos.add(valor);
  try {
    if (Array.isArray(valor)) {
      return `[${valor
        .map((item) => serializarCanonico(item, vistos, estado, profundidade + 1))
        .join(",")}]`;
    }
    const objeto = valor as Record<string, unknown>;
    const pares = Object.keys(objeto)
      .filter((chave) => objeto[chave] !== undefined)
      .sort()
      .map(
        (chave) =>
          `${JSON.stringify(chave)}:${serializarCanonico(
            objeto[chave],
            vistos,
            estado,
            profundidade + 1,
          )}`,
      );
    return `{${pares.join(",")}}`;
  } finally {
    vistos.delete(valor);
  }
}

export function canonicalizarEventoSicoob(payload: unknown): string {
  if (payload === undefined) {
    throw new TypeError("Payload ausente não pode ser canonicalizado.");
  }
  const resultado = serializarCanonico(payload, new Set(), { nos: 0 }, 0);
  if (Buffer.byteLength(resultado, "utf8") > MAX_CANONICO) {
    throw new TypeError("Payload excede o tamanho seguro para canonicalização.");
  }
  return resultado;
}

/** Chave idempotente: SHA-256 do JSON com chaves ordenadas. */
export function hashCanonicoEventoSicoob(payload: unknown): string {
  return createHash("sha256").update(canonicalizarEventoSicoob(payload)).digest("hex");
}

function chaveNormalizada(chave: string): string {
  return chave
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function identificadorSeguro(valor: unknown): string | null {
  const convertido =
    typeof valor === "string"
      ? valor.trim()
      : typeof valor === "number" && Number.isSafeInteger(valor)
        ? String(valor)
        : null;
  if (!convertido || convertido.length > 128) return null;
  return /^[A-Za-z0-9._:/-]+$/.test(convertido) ? convertido : null;
}

/**
 * Extrai apenas identificadores conhecidos e não retorna nome, documento,
 * endereço ou valores do pagador. O callback continua sendo não confiável:
 * uma liquidação deve ser confirmada via GET /boletos autenticado.
 */
export function extrairIdentificadoresEventoSicoob(
  payload: unknown,
): IdentificadoresEventoSicoob {
  const conjuntos = {
    nossosNumeros: new Set<string>(),
    seusNumeros: new Set<string>(),
    codigosBarras: new Set<string>(),
    numerosCliente: new Set<string>(),
    numerosIdentificadorBaixa: new Set<string>(),
    idsWebhook: new Set<string>(),
    idsEvento: new Set<string>(),
  };
  let nos = 0;

  function visitar(valor: unknown, profundidade: number): void {
    nos += 1;
    if (nos > MAX_NOS || profundidade > MAX_PROFUNDIDADE || valor === null) return;
    if (Array.isArray(valor)) {
      for (const item of valor) visitar(item, profundidade + 1);
      return;
    }
    if (typeof valor !== "object") return;

    for (const [chave, conteudo] of Object.entries(valor as Record<string, unknown>)) {
      const normalizada = chaveNormalizada(chave);
      const id = identificadorSeguro(conteudo);
      if (id) {
        if (normalizada === "nossonumero" || normalizada === "numerotitulo") {
          conjuntos.nossosNumeros.add(id);
        } else if (normalizada === "seunumero") {
          conjuntos.seusNumeros.add(id);
        } else if (normalizada === "codigobarras") {
          conjuntos.codigosBarras.add(id);
        } else if (normalizada === "numerocliente") {
          conjuntos.numerosCliente.add(id);
        } else if (normalizada === "idwebhook") {
          conjuntos.idsWebhook.add(id);
        } else if (normalizada === "numeroidentificadorbaixa") {
          conjuntos.numerosIdentificadorBaixa.add(id);
        } else if (
          normalizada === "idevento" ||
          normalizada === "idsolicitacao" ||
          normalizada === "codigosolicitacao"
        ) {
          conjuntos.idsEvento.add(id);
        }
      }
      visitar(conteudo, profundidade + 1);
    }
  }

  visitar(payload, 0);
  return {
    nossosNumeros: [...conjuntos.nossosNumeros],
    seusNumeros: [...conjuntos.seusNumeros],
    codigosBarras: [...conjuntos.codigosBarras],
    numerosCliente: [...conjuntos.numerosCliente],
    numerosIdentificadorBaixa: [...conjuntos.numerosIdentificadorBaixa],
    idsWebhook: [...conjuntos.idsWebhook],
    idsEvento: [...conjuntos.idsEvento],
  };
}

/** Prioriza o identificador bancário de baixa; usa hash somente como fallback. */
export function chaveIdempotenciaEventoSicoob(payload: unknown): string {
  const identificador = extrairIdentificadoresEventoSicoob(payload)
    .numerosIdentificadorBaixa[0];
  let cancelamento = false;
  function procurarCancelamento(valor: unknown, profundidade: number): void {
    if (profundidade > MAX_PROFUNDIDADE || valor === null || typeof valor !== "object") return;
    if (Array.isArray(valor)) {
      for (const item of valor) procurarCancelamento(item, profundidade + 1);
      return;
    }
    for (const [chave, conteudo] of Object.entries(valor as Record<string, unknown>)) {
      if (chaveNormalizada(chave) === "cancelamentobaixa" && conteudo === true) {
        cancelamento = true;
      }
      procurarCancelamento(conteudo, profundidade + 1);
    }
  }
  procurarCancelamento(payload, 0);
  return identificador
    ? `sicoob:baixa:${identificador}:${cancelamento ? "cancelada" : "informada"}`
    : `sicoob:sha256:${hashCanonicoEventoSicoob(payload)}`;
}
