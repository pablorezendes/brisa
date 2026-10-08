export type ParametrosContexto = Record<string, string | string[] | undefined>;

const BASES = new Set(["/financeiro/contas-a-pagar", "/financeiro/contas-a-receber", "/recebimentos"]);
const ORIGENS = new Set(["BRISA", "WIDESYS", "PLANILHA"]);
const ESTADOS = new Set(["ATIVO", "PENDENTE", "VINCULADO", "QUARENTENA", "REVISAR", "AUSENTE"]);
const CHAVE_FINANCEIRA = /^(?:BRISA|WIDESYS):(?:RECEBER|PAGAR):[A-Za-z0-9_-]{1,160}$/;
const INSEGURO = /[\\\u0000-\u001f\u007f]/;
const FILTROS = ["q", "origem", "estado", "mes", "de", "ate", "pagina", "vencidos"] as const;

function texto(valor: unknown, limite: number): string | null {
  return typeof valor === "string" && valor.length <= limite && !INSEGURO.test(valor) ? valor : null;
}

function chaveFinanceira(valor: unknown): valor is string {
  return typeof valor === "string" && CHAVE_FINANCEIRA.test(valor);
}

function filtro(nome: typeof FILTROS[number], valor: unknown): string | null {
  const v = texto(valor, nome === "q" ? 120 : 32);
  if (!v) return null;
  switch (nome) {
    case "q": return v;
    case "origem": return ORIGENS.has(v) ? v : null;
    case "estado": return ESTADOS.has(v) ? v : null;
    case "mes": return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(v) ? v : null;
    case "de":
    case "ate": return /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(v) ? v : null;
    case "pagina": return /^[1-9]\d{0,6}$/.test(v) ? v : null;
    case "vencidos": return v === "1" ? v : null;
  }
}

function basePermitida(base: string, parametros: ParametrosContexto): boolean {
  // A visão de locação possui outros formulários e não participa deste popup.
  return BASES.has(base) && (base !== "/recebimentos" || parametros.visao === undefined || parametros.visao === "unificada");
}

function filtrosDaLista(parametros: ParametrosContexto): URLSearchParams {
  const p = new URLSearchParams();
  for (const nome of FILTROS) {
    const valor = filtro(nome, parametros[nome]);
    if (valor) p.set(nome, valor);
  }
  return p;
}

function href(base: string, parametros: URLSearchParams): string {
  const query = parametros.toString();
  return query ? `${base}?${query}` : base;
}

/** Contexto de navegação apenas; nenhum parâmetro desta URL concede acesso aos dados. */
export function contextoFinanceiro(base: string, parametros: ParametrosContexto): {
  retorno: string;
  hrefDetalhe: (chave: string, extras?: { destino?: string; buscarDestino?: string }) => string;
  hrefExcluir: (chave: string) => string;
} | null {
  if (!basePermitida(base, parametros)) return null;
  const filtros = filtrosDaLista(parametros);
  const retorno = href(base, filtros);
  const abrir = (chave: string, painel: "detalhe" | "excluir", extras?: { destino?: string; buscarDestino?: string }) => {
    if (!chaveFinanceira(chave)) return retorno;
    const p = new URLSearchParams(filtros);
    p.set("registro", chave);
    p.set("painel", painel);
    if (painel === "detalhe") {
      if (chaveFinanceira(extras?.destino)) p.set("destino", extras.destino);
      const busca = texto(extras?.buscarDestino, 120);
      if (busca) p.set("buscarDestino", busca);
    }
    return href(base, p);
  };
  return {
    retorno,
    hrefDetalhe: (chave, extras) => abrir(chave, "detalhe", extras),
    hrefExcluir: chave => abrir(chave, "excluir"),
  };
}

/** Canonicaliza destinos locais de ações sem resolver hosts ou aceitar caminhos arbitrários. */
export function validarRetornoFinanceiro(valor: unknown): string | null {
  if (typeof valor !== "string" || valor.length > 4096 || INSEGURO.test(valor) || valor.includes("//") || valor.includes("#")) return null;
  const indice = valor.indexOf("?");
  const base = indice < 0 ? valor : valor.slice(0, indice);
  if (!BASES.has(base)) return null;
  const query = indice < 0 ? "" : valor.slice(indice + 1);
  // URLSearchParams tolera escapes quebrados; destinos de formulário precisam ser inequívocos.
  try {
    const decodificado = decodeURIComponent(query.replaceAll("+", " "));
    if (INSEGURO.test(decodificado) || decodificado.includes("//")) return null;
  } catch {
    return null;
  }
  const recebidos = new URLSearchParams(query);
  const parametros: ParametrosContexto = Object.create(null);
  for (const [nome, conteudo] of recebidos) {
    if (Object.hasOwn(parametros, nome)) return null;
    parametros[nome] = conteudo;
  }
  if (!basePermitida(base, parametros)) return null;
  const p = filtrosDaLista(parametros);
  const registro = parametros.registro;
  const painel = parametros.painel;
  if (registro !== undefined || painel !== undefined) {
    if (!chaveFinanceira(registro) || (painel !== "detalhe" && painel !== "excluir")) return null;
    p.set("registro", registro);
    p.set("painel", painel);
    if (painel === "detalhe") {
      if (parametros.destino !== undefined) {
        if (!chaveFinanceira(parametros.destino)) return null;
        p.set("destino", parametros.destino);
      }
      const busca = texto(parametros.buscarDestino, 120);
      if (busca) p.set("buscarDestino", busca);
    }
  }
  return href(base, p);
}

/** Substitui mensagens anteriores sem perder filtros, paginação ou o popup em andamento. */
export function retornoFinanceiroComMensagem(valor: unknown, mensagem: { erro?: string; ok?: string }): string | null {
  const retorno = validarRetornoFinanceiro(valor);
  if (!retorno) return null;
  const indice = retorno.indexOf("?");
  const base = indice < 0 ? retorno : retorno.slice(0, indice);
  const p = new URLSearchParams(indice < 0 ? "" : retorno.slice(indice + 1));
  const erro = texto(mensagem.erro, 500);
  const ok = texto(mensagem.ok, 500);
  if (erro) p.set("erro", erro);
  else if (ok) p.set("ok", ok);
  return href(base, p);
}
