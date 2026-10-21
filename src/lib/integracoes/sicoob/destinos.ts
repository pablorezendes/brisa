import "server-only";

import type { AmbienteSicoob } from "./tipos";

export const BASES_OFICIAIS_SICOOB: Record<AmbienteSicoob, string> = {
  sandbox: "https://sandbox.sicoob.com.br/sicoob/sandbox/cobranca-bancaria/v3",
  producao: "https://api.sicoob.com.br/cobranca-bancaria/v3",
};

export const TOKEN_URL_OFICIAL_SICOOB =
  "https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token";

function urlSemCredenciais(valor: string): URL {
  const url = new URL(valor);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.port
  ) {
    throw new TypeError("O destino Sicoob deve ser HTTPS oficial, sem credenciais ou porta alternativa.");
  }
  return url;
}

/** A configuração não pode redirecionar certificados, tokens ou client secrets. */
export function validarBaseOficialSicoob(
  valor: string,
  ambiente: AmbienteSicoob,
): string {
  const url = urlSemCredenciais(valor);
  const oficial = BASES_OFICIAIS_SICOOB[ambiente];
  if (url.search || url.toString().replace(/\/$/, "") !== oficial) {
    throw new TypeError("A API deve usar o endereço oficial do ambiente Sicoob selecionado.");
  }
  return oficial;
}

export function validarTokenUrlOficialSicoob(valor: string): string {
  const url = urlSemCredenciais(valor);
  if (url.toString() !== TOKEN_URL_OFICIAL_SICOOB) {
    throw new TypeError("O OAuth deve usar o endereço oficial de autenticação Sicoob.");
  }
  return TOKEN_URL_OFICIAL_SICOOB;
}

/** Segunda barreira, aplicada imediatamente antes de qualquer requisição. */
export function destinoHttpSicoobPermitido(
  valor: URL,
  ambiente: AmbienteSicoob,
): boolean {
  try {
    const url = urlSemCredenciais(valor.toString());
    if (url.toString() === TOKEN_URL_OFICIAL_SICOOB) return true;
    const base = new URL(BASES_OFICIAIS_SICOOB[ambiente]);
    return (
      url.origin === base.origin &&
      (url.pathname === base.pathname || url.pathname.startsWith(`${base.pathname}/`))
    );
  } catch {
    return false;
  }
}
