import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { PrismaClient } from "@prisma/client";
import {
  WIDESYS_CATALOG_MANIFEST_SCHEMA,
  widesysCatalogManifestContentHash,
} from "./widesys-catalog-manifest";

import {
  CATALOG_MODULES,
  PAGE_LIMIT,
  catalogPageExplicitlyEmpty,
  type CatalogModule,
} from "../../../scripts/widesys-catalogos-core";

export const ORIGEM_CATALOGOS_WIDESYS = "WIDESYS";
const ORIGEM_HTTP_WIDESYS = "https://brisaazul.app2.widesys.com.br";
const TAMANHO_MAXIMO_ARQUIVO = 32 * 1024 * 1024;
const TAMANHO_MAXIMO_MANIFESTO = 8 * 1024 * 1024;
const TAMANHO_LOTE = 100;
const MODULOS_PERMITIDOS = new Set(CATALOG_MODULES.map((item) => item.key));
const MODULOS_POR_CHAVE = new Map<string, CatalogModule>(
  CATALOG_MODULES.map((item) => [item.key, item]),
);
const NOME_SENSIVEL =
  /(?:passw|passwd|password|senha|secret|token|authorization|cookie|api[_-]?key|client[_-]?secret|certificad|certificate|private[_-]?key|(?:^|[^a-z])(?:pfx|p12|pem)(?:[^a-z]|$))/i;
const CONSULTA_SENSIVEL =
  /^(?:passw|passwd|password|senha|secret|token|csrf|authorization|cookie|api[_-]?key|client[_-]?secret)$/i;

type StatusCatalogo = "STAGING" | "QUARENTENA";

export type CatalogoLegadoPlanejado = {
  origem: typeof ORIGEM_CATALOGOS_WIDESYS;
  modulo: string;
  legadoId: string;
  titulo: string | null;
  label: string | null;
  sourceUrl: string | null;
  capturadoEm: Date;
  status: StatusCatalogo;
  quarentenaMotivo: string | null;
  snapshot: string;
  snapshotHash: string;
};

export type ReconciliacaoCatalogoWidesys = {
  modulo: string;
  total: number;
  staging: number;
  quarentena: number;
};

export type PlanoCatalogosWidesys = {
  origem: typeof ORIGEM_CATALOGOS_WIDESYS;
  capturaId: string;
  manifestoHash: string;
  capturadoEm: Date;
  registros: CatalogoLegadoPlanejado[];
  reconciliacao: ReconciliacaoCatalogoWidesys[];
};

export type RelatorioCatalogosWidesys = {
  origem: typeof ORIGEM_CATALOGOS_WIDESYS;
  capturaId: string;
  capturadoEm: string;
  total: number;
  quarentena: number;
  modulos: ReconciliacaoCatalogoWidesys[];
  alteracoes?: {
    criados: number;
    atualizados: number;
    inalterados: number;
    anterioresIgnorados: number;
    quarentena: number;
  };
};

type Registro = Record<string, unknown>;

type ArtefatoManifesto = {
  bytes: number;
  kind: string;
  module: string;
  path: string;
  sha256: string;
  sourceUrl: string | null;
};

type ContagemModuloManifesto = {
  countSource: "explicit-empty" | "reported" | "singleton" | "terminal-page";
  discovered: number;
  explicitlyEmpty: boolean;
};

export class ErroImportacaoCatalogosWidesys extends Error {
  constructor(
    public readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroImportacaoCatalogosWidesys";
  }
}

function falhar(codigo: string, mensagem: string): never {
  throw new ErroImportacaoCatalogosWidesys(codigo, mensagem);
}

function objeto(valor: unknown): Registro | null {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Registro)
    : null;
}

function texto(valor: unknown, limite = 10_000): string | null {
  if (typeof valor !== "string") return null;
  const normalizado = valor.trim();
  return normalizado && normalizado.length <= limite ? normalizado : null;
}

function inteiroNaoNegativo(valor: unknown): number | null {
  return typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 0
    ? valor
    : null;
}

function idCatalogoValido(valor: string): boolean {
  return /^(?:-?(?:0|[1-9]\d{0,158})|singleton|year-(?:19\d{2}|20\d{2}|21\d{2}|2200))$/.test(
    valor,
  ) && valor !== "-0";
}

function sha256(conteudo: string | Buffer): string {
  return createHash("sha256").update(conteudo).digest("hex");
}

function hashValido(valor: unknown): string {
  const hash = texto(valor, 64)?.toLowerCase();
  if (!hash || !/^[a-f\d]{64}$/.test(hash)) {
    falhar("WIDESYS_CATALOGOS_HASH_INVALIDO", "O manifesto contém um hash inválido.");
  }
  return hash;
}

function dataIso(valor: unknown, codigo: string): Date {
  const entrada = texto(valor, 50);
  if (!entrada) falhar(codigo, "A captura não informa uma data ISO válida.");
  const data = new Date(entrada);
  if (Number.isNaN(data.getTime()) || data.toISOString() !== entrada) {
    falhar(codigo, "A captura contém uma data fora do formato ISO canônico.");
  }
  return data;
}

function ordenarCanonico(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenarCanonico);
  const registro = objeto(valor);
  if (!registro) return valor;
  return Object.fromEntries(
    Object.entries(registro)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([chave, item]) => [chave, ordenarCanonico(item)]),
  );
}

function jsonCanonico(valor: unknown): string {
  return JSON.stringify(ordenarCanonico(valor));
}

function caminhoSeguro(raizReal: string, caminhoRelativo: string): string {
  if (isAbsolute(caminhoRelativo)) {
    falhar("WIDESYS_CATALOGOS_CAMINHO_INVALIDO", "O manifesto contém caminho absoluto.");
  }
  const resolvido = resolve(raizReal, caminhoRelativo);
  const relativo = relative(raizReal, resolvido);
  if (!relativo || relativo === ".." || relativo.startsWith(`..${sep}`) || isAbsolute(relativo)) {
    falhar("WIDESYS_CATALOGOS_CAMINHO_INVALIDO", "Um artefato aponta para fora da captura.");
  }
  let estado;
  try {
    estado = lstatSync(resolvido);
  } catch {
    falhar("WIDESYS_CATALOGOS_ARTEFATO_AUSENTE", "Um artefato do manifesto não foi encontrado.");
  }
  if (estado.isSymbolicLink()) {
    falhar("WIDESYS_CATALOGOS_LINK_SIMBOLICO", "Links simbólicos não são aceitos na captura.");
  }
  const real = realpathSync(resolvido);
  const relativoReal = relative(raizReal, real);
  if (relativoReal === ".." || relativoReal.startsWith(`..${sep}`) || isAbsolute(relativoReal)) {
    falhar("WIDESYS_CATALOGOS_CAMINHO_INVALIDO", "Um artefato resolve para fora da captura.");
  }
  return real;
}

function origemWidesys(valor: unknown): string {
  const entrada = texto(valor, 2_000);
  if (!entrada) falhar("WIDESYS_CATALOGOS_ORIGEM_INVALIDA", "A origem da captura é inválida.");
  let url: URL;
  try {
    url = new URL(entrada);
  } catch {
    falhar("WIDESYS_CATALOGOS_ORIGEM_INVALIDA", "A origem da captura é inválida.");
  }
  if (
    url.origin !== ORIGEM_HTTP_WIDESYS ||
    url.protocol !== "https:" ||
    url.username ||
    url.password
  ) {
    falhar("WIDESYS_CATALOGOS_ORIGEM_INVALIDA", "A captura não pertence ao Widesys autorizado.");
  }
  return url.origin;
}

function sourceUrlSeguro(valor: unknown): { url: string | null; sensivel: boolean } {
  const entrada = texto(valor, 4_000);
  if (!entrada) return { url: null, sensivel: false };
  let url: URL;
  try {
    url = new URL(entrada);
  } catch {
    falhar("WIDESYS_CATALOGOS_URL_INVALIDA", "Um registro contém URL de origem inválida.");
  }
  if (
    url.origin !== ORIGEM_HTTP_WIDESYS ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/administrator/index.php"
  ) {
    falhar("WIDESYS_CATALOGOS_URL_INVALIDA", "Um registro aponta para fora do administrador autorizado.");
  }
  let sensivel = false;
  for (const chave of [...url.searchParams.keys()]) {
    if (CONSULTA_SENSIVEL.test(chave) || /^[a-f\d]{24,128}$/i.test(chave)) {
      url.searchParams.delete(chave);
      sensivel = true;
    }
  }
  url.hash = "";
  return { url: url.toString(), sensivel };
}

function sanitizarTexto(valor: string): { valor: string; sensivel: boolean } {
  let sensivel = false;
  let seguro = valor.replace(
    /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gi,
    () => {
      sensivel = true;
      return "[REDACTED]";
    },
  );
  seguro = seguro.replace(
    /\b(password|passwd|senha|secret|token|authorization|cookie|api[_-]?key|client[_-]?secret)\b\s*[:=]\s*([^\s,;]+)/gi,
    (_trecho, nome: string) => {
      sensivel = true;
      return `${nome}=[REDACTED]`;
    },
  );
  seguro = seguro.replace(/\b[^\s"']+\.(?:p12|pfx|pem|key|crt|cer)\b/gi, () => {
    sensivel = true;
    return "[REDACTED]";
  });
  return { valor: seguro, sensivel };
}

function sanitizarSnapshot(valor: unknown): { valor: unknown; sensivel: boolean } {
  if (typeof valor === "string") return sanitizarTexto(valor);
  if (Array.isArray(valor)) {
    let sensivel = false;
    const itens = valor.map((item) => {
      const resultado = sanitizarSnapshot(item);
      sensivel ||= resultado.sensivel;
      return resultado.valor;
    });
    return { valor: itens, sensivel };
  }
  const registro = objeto(valor);
  if (!registro) return { valor, sensivel: false };

  let sensivel = false;
  const controleSensivel = [registro.name, registro.id].some(
    (item) => typeof item === "string" && NOME_SENSIVEL.test(item),
  );
  const seguro: Registro = {};
  for (const [chave, item] of Object.entries(registro)) {
    if (NOME_SENSIVEL.test(chave) || (controleSensivel && ["value", "options"].includes(chave))) {
      seguro[chave] = "[REDACTED]";
      sensivel = true;
      continue;
    }
    const resultado = sanitizarSnapshot(item);
    seguro[chave] = resultado.valor;
    sensivel ||= resultado.sensivel;
  }
  return { valor: seguro, sensivel };
}

function extrairTitulo(raw: Registro): string | null {
  return texto(raw.title, 500);
}

function normalizarNomeCampo(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function extrairLabel(raw: Registro): string | null {
  if (!Array.isArray(raw.controls)) return null;
  const candidatos = new Set(["nome", "name", "titulo", "title", "descricao", "description"]);
  for (const entrada of raw.controls) {
    const controle = objeto(entrada);
    if (!controle) continue;
    const nome = texto(controle.name, 300) ?? texto(controle.id, 300);
    if (!nome) continue;
    const partes = normalizarNomeCampo(nome).split("_").filter(Boolean);
    if (!partes.some((parte) => candidatos.has(parte))) continue;
    const valor = texto(controle.value, 500);
    if (valor && valor !== "[REDACTED]") return valor;
  }
  return null;
}

function artefatosDoManifesto(manifesto: Registro): ArtefatoManifesto[] {
  if (!Array.isArray(manifesto.artifacts)) {
    falhar("WIDESYS_CATALOGOS_MANIFESTO_INVALIDO", "O manifesto não lista artefatos.");
  }
  const caminhos = new Set<string>();
  return manifesto.artifacts.map((entrada) => {
    const item = objeto(entrada);
    const caminho = texto(item?.path, 1_000);
    const modulo = texto(item?.module, 100);
    const kind = texto(item?.kind, 50);
    const bytes = inteiroNaoNegativo(item?.bytes);
    if (!item || !caminho || !modulo || !kind || bytes === null || bytes > TAMANHO_MAXIMO_ARQUIVO) {
      falhar("WIDESYS_CATALOGOS_ARTEFATO_INVALIDO", "O manifesto contém artefato inválido.");
    }
    if (!["detail-html", "detail-json", "list-html", "list-json"].includes(kind)) {
      falhar("WIDESYS_CATALOGOS_ARTEFATO_INVALIDO", "O manifesto contém tipo de artefato inválido.");
    }
    const caminhoNormalizado = caminho.replace(/\\/g, "/");
    if (caminhos.has(caminhoNormalizado.toLowerCase())) {
      falhar("WIDESYS_CATALOGOS_ARTEFATO_DUPLICADO", "O manifesto repete um caminho de artefato.");
    }
    caminhos.add(caminhoNormalizado.toLowerCase());
    if (!MODULOS_PERMITIDOS.has(modulo) || !caminhoNormalizado.startsWith(`${modulo}/`)) {
      falhar("WIDESYS_CATALOGOS_MODULO_INVALIDO", "O manifesto contém módulo fora da captura autorizada.");
    }
    const extensaoEsperada = kind.endsWith("-html") ? "html" : "json";
    if (
      kind.startsWith("list-") &&
      !new RegExp(`^${modulo}/pages/page-\\d{5}\\.${extensaoEsperada}$`).test(caminhoNormalizado)
    ) {
      falhar("WIDESYS_CATALOGOS_CAMINHO_INVALIDO", "Um artefato de lista está fora da pasta pages esperada.");
    }
    return {
      bytes,
      kind,
      module: modulo,
      path: caminhoNormalizado,
      sha256: hashValido(item.sha256),
      sourceUrl: texto(item.sourceUrl, 4_000),
    };
  });
}

function validarManifestoCompleto(
  manifesto: Registro,
  artefatos: ArtefatoManifesto[],
): {
  capturaId: string;
  capturadoEm: Date;
  contagens: Map<string, ContagemModuloManifesto>;
  iniciadoEm: Date;
  manifestoHash: string;
  esperados: Map<string, number>;
} {
  if (manifesto.version !== 1) {
    falhar("WIDESYS_CATALOGOS_VERSAO_INVALIDA", "A versão do manifesto não é suportada.");
  }
  if (manifesto.schema !== WIDESYS_CATALOG_MANIFEST_SCHEMA) {
    falhar("WIDESYS_CATALOGOS_VERSAO_INVALIDA", "O schema do manifesto não é suportado.");
  }
  const capturaId = texto(manifesto.captureId, 36);
  if (!capturaId || !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(capturaId)) {
    falhar("WIDESYS_CATALOGOS_MANIFESTO_INVALIDO", "O manifesto não possui um captureId UUID válido.");
  }
  const manifestoHash = hashValido(manifesto.contentHash);
  const calculado = widesysCatalogManifestContentHash(manifesto);
  if (calculado !== manifestoHash) {
    falhar("WIDESYS_CATALOGOS_MANIFESTO_HASH_DIVERGENTE", "O hash global do manifesto não confere.");
  }
  origemWidesys(manifesto.baseOrigin);
  if (!Array.isArray(manifesto.errors) || manifesto.errors.length !== 0) {
    falhar("WIDESYS_CATALOGOS_CAPTURA_COM_ERROS", "A captura contém erros e não pode ser aplicada.");
  }
  const capturadoEm = dataIso(manifesto.completedAt, "WIDESYS_CATALOGOS_CAPTURA_INCOMPLETA");
  const iniciadoEm = dataIso(manifesto.startedAt, "WIDESYS_CATALOGOS_MANIFESTO_INVALIDO");
  if (capturadoEm < iniciadoEm) {
    falhar("WIDESYS_CATALOGOS_MANIFESTO_INVALIDO", "A captura terminou antes de ser iniciada.");
  }
  const opcoes = objeto(manifesto.options);
  const modulosSelecionados = opcoes?.modules;
  const anosIrrf = opcoes?.irrfYears;
  if (
    !opcoes ||
    !Array.isArray(modulosSelecionados) ||
    modulosSelecionados.length === 0 ||
    new Set(modulosSelecionados).size !== modulosSelecionados.length ||
    modulosSelecionados.some((modulo) => typeof modulo !== "string" || !MODULOS_PERMITIDOS.has(modulo)) ||
    !Array.isArray(anosIrrf) ||
    anosIrrf.length === 0 ||
    anosIrrf.length > 50 ||
    anosIrrf.some(
      (ano, index) =>
        typeof ano !== "number" ||
        !Number.isSafeInteger(ano) ||
        ano < 1900 ||
        ano > 2200 ||
        (index > 0 && ano <= anosIrrf[index - 1]),
    ) ||
    opcoes.limit !== 200
  ) {
    falhar("WIDESYS_CATALOGOS_MANIFESTO_INVALIDO", "As opções do manifesto são inválidas.");
  }
  const modulos = objeto(manifesto.modules);
  if (!modulos || Object.keys(modulos).length === 0) {
    falhar("WIDESYS_CATALOGOS_MODULOS_INVALIDOS", "O manifesto não contém módulos concluídos.");
  }
  const chavesModulos = Object.keys(modulos);
  if (
    chavesModulos.length !== modulosSelecionados.length ||
    modulosSelecionados.some((modulo, index) => chavesModulos[index] !== modulo)
  ) {
    falhar("WIDESYS_CATALOGOS_MODULOS_INVALIDOS", "Os módulos concluídos divergem da seleção da captura.");
  }
  const selecao = new Set(modulosSelecionados as string[]);
  if (artefatos.some((artefato) => !selecao.has(artefato.module))) {
    falhar("WIDESYS_CATALOGOS_MODULO_INVALIDO", "Um artefato pertence a módulo fora da seleção da captura.");
  }
  const esperados = new Map<string, number>();
  const contagens = new Map<string, ContagemModuloManifesto>();
  for (const [modulo, estadoBruto] of Object.entries(modulos)) {
    if (!MODULOS_PERMITIDOS.has(modulo)) {
      falhar("WIDESYS_CATALOGOS_MODULO_INVALIDO", "O manifesto contém módulo fora da captura autorizada.");
    }
    const estado = objeto(estadoBruto);
    const descobertos = inteiroNaoNegativo(estado?.recordsDiscovered);
    const salvos = inteiroNaoNegativo(estado?.recordsSaved);
    const ignorados = inteiroNaoNegativo(estado?.recordsSkipped);
    const errosDetalhe = inteiroNaoNegativo(estado?.detailErrors);
    const paginas = inteiroNaoNegativo(estado?.pagesFetched);
    const reportedTotal = inteiroNaoNegativo(estado?.reportedTotal);
    const countSource = texto(estado?.countSource, 30);
    const explicitlyEmpty = estado?.explicitlyEmpty;
    const singleton = MODULOS_POR_CHAVE.get(modulo)?.singleton === true;
    if (
      !estado ||
      estado.completed !== true ||
      descobertos === null ||
      salvos === null ||
      ignorados === null ||
      errosDetalhe !== 0 ||
      paginas === null ||
      paginas < 1 ||
      salvos + ignorados !== descobertos ||
      reportedTotal === null ||
      reportedTotal !== descobertos ||
      typeof explicitlyEmpty !== "boolean" ||
      !["explicit-empty", "reported", "singleton", "terminal-page"].includes(countSource || "") ||
      (singleton && countSource !== "singleton") ||
      (!singleton && countSource === "singleton") ||
      (descobertos === 0 && (!explicitlyEmpty || countSource !== "explicit-empty")) ||
      (descobertos > 0 && (explicitlyEmpty || countSource === "explicit-empty"))
    ) {
      falhar("WIDESYS_CATALOGOS_CAPTURA_INCOMPLETA", `O módulo ${modulo} não foi concluído.`);
    }
    const listasHtml = artefatos.filter(
      (artefato) => artefato.module === modulo && artefato.kind === "list-html",
    );
    const listasJson = artefatos.filter(
      (artefato) => artefato.module === modulo && artefato.kind === "list-json",
    );
    const basesHtml = new Set(listasHtml.map((artefato) => artefato.path.replace(/\.html$/, "")));
    const basesJson = new Set(listasJson.map((artefato) => artefato.path.replace(/\.json$/, "")));
    if (
      listasHtml.length !== paginas ||
      listasJson.length !== paginas ||
      [...basesHtml].some((base) => !basesJson.has(base))
    ) {
      falhar(
        "WIDESYS_CATALOGOS_CAPTURA_INCOMPLETA",
        `As páginas verificáveis do módulo ${modulo} divergem do manifesto.`,
      );
    }
    esperados.set(modulo, descobertos);
    contagens.set(modulo, {
      countSource: countSource as ContagemModuloManifesto["countSource"],
      discovered: descobertos,
      explicitlyEmpty,
    });
  }

  return { capturaId, capturadoEm, contagens, iniciadoEm, manifestoHash, esperados };
}

function jsonArtefatoLista(conteudo: Buffer): Registro {
  try {
    const item = objeto(JSON.parse(conteudo.toString("utf8")) as unknown);
    if (item) return item;
  } catch {
    // A mensagem abaixo e deliberadamente unica para nao vazar o conteudo.
  }
  falhar("WIDESYS_CATALOGOS_LISTAGEM_INVALIDA", "Uma evidencia JSON de listagem e invalida.");
}

function idDeUrlDetalhe(valor: unknown, modulo: string): string {
  const entrada = texto(valor, 4_000);
  if (!entrada) {
    falhar("WIDESYS_CATALOGOS_LISTAGEM_INVALIDA", "Uma listagem contem URL de detalhe invalida.");
  }
  let url: URL;
  try {
    url = new URL(entrada);
  } catch {
    falhar("WIDESYS_CATALOGOS_LISTAGEM_INVALIDA", "Uma listagem contem URL de detalhe invalida.");
  }
  if (
    url.origin !== ORIGEM_HTTP_WIDESYS ||
    url.pathname !== "/administrator/index.php" ||
    url.username ||
    url.password
  ) {
    falhar("WIDESYS_CATALOGOS_LISTAGEM_INVALIDA", "Uma listagem aponta para detalhe fora da origem autorizada.");
  }
  const ids = url.searchParams.getAll("id");
  const id = ids.length === 1 ? ids[0] : null;
  if (!id || !idCatalogoValido(id)) {
    falhar("WIDESYS_CATALOGOS_LISTAGEM_INVALIDA", "Uma listagem contem identidade de detalhe invalida.");
  }
  const definicao = MODULOS_POR_CHAVE.get(modulo);
  if (
    !definicao ||
    url.searchParams.get("option") !== definicao.list.option ||
    url.searchParams.get("layout") !== "edit" ||
    !definicao.detailViews?.includes(url.searchParams.get("view") || "") ||
    (definicao.list.option === "com_categories" &&
      url.searchParams.get("extension") !== definicao.list.extension)
  ) {
    falhar("WIDESYS_CATALOGOS_LISTAGEM_INVALIDA", "Uma listagem contem detalhe de outro modulo.");
  }
  return id;
}

function validarEvidenciasListagem(
  artefatos: ArtefatoManifesto[],
  conteudos: ReadonlyMap<string, Buffer>,
  contagens: ReadonlyMap<string, ContagemModuloManifesto>,
): void {
  for (const [modulo, contagem] of contagens) {
    const definicao = MODULOS_POR_CHAVE.get(modulo);
    if (!definicao) {
      falhar("WIDESYS_CATALOGOS_MODULO_INVALIDO", "A listagem pertence a modulo desconhecido.");
    }
    const listasJson = artefatos
      .filter((artefato) => artefato.module === modulo && artefato.kind === "list-json")
      .sort((a, b) => a.path.localeCompare(b.path));
    const identidades = new Set<string>();
    let descobertosNasPaginas = 0;
    let evidenciaTerminal = false;
    let evidenciaVazia = false;
    let totalDeclaradoConfere = false;

    for (const artefato of listasJson) {
      const conteudo = conteudos.get(artefato.path);
      if (!conteudo) {
        falhar("WIDESYS_CATALOGOS_ARTEFATO_AUSENTE", "Uma listagem verificavel esta ausente.");
      }
      const pagina = jsonArtefatoLista(conteudo);
      const descobertos = inteiroNaoNegativo(pagina.discoveredOnPage);
      const reportedTotal = pagina.reportedTotal === null ? null : inteiroNaoNegativo(pagina.reportedTotal);
      const explicitamenteVazia = pagina.explicitlyEmpty;
      const terminal = pagina.terminalWithoutReportedTotal;
      if (
        pagina.module !== modulo ||
        descobertos === null ||
        reportedTotal === null && pagina.reportedTotal !== null ||
        typeof explicitamenteVazia !== "boolean" ||
        typeof terminal !== "boolean" ||
        !Array.isArray(pagina.detailUrls) ||
        (explicitamenteVazia && descobertos !== 0) ||
        (terminal && (reportedTotal !== null || descobertos >= PAGE_LIMIT))
      ) {
        falhar("WIDESYS_CATALOGOS_LISTAGEM_INVALIDA", `A listagem do modulo ${modulo} e inconsistente.`);
      }

      if (definicao.singleton) {
        if (pagina.detailUrls.length !== 0 || descobertos !== 1) {
          falhar("WIDESYS_CATALOGOS_LISTAGEM_INVALIDA", "Uma pagina singleton possui cardinalidade invalida.");
        }
      } else {
        if (pagina.detailUrls.length !== descobertos) {
          falhar("WIDESYS_CATALOGOS_LISTAGEM_INVALIDA", "Detalhes e contagem da pagina divergem.");
        }
        for (const detalhe of pagina.detailUrls) {
          const id = idDeUrlDetalhe(detalhe, modulo);
          if (identidades.has(id)) {
            falhar("WIDESYS_CATALOGOS_REGISTRO_DUPLICADO", "A listagem repete uma identidade de catalogo.");
          }
          identidades.add(id);
        }
      }

      const base = artefato.path.replace(/\.json$/, "");
      const html = conteudos.get(`${base}.html`);
      if (!html) {
        falhar("WIDESYS_CATALOGOS_CAPTURA_INCOMPLETA", "A evidencia HTML da listagem esta ausente.");
      }
      if (explicitamenteVazia) {
        if (!catalogPageExplicitlyEmpty(html.toString("utf8"))) {
          falhar("WIDESYS_CATALOGOS_VAZIO_SEM_EVIDENCIA", "O catalogo vazio nao possui evidencia textual.");
        }
        evidenciaVazia = true;
      }
      descobertosNasPaginas += descobertos;
      evidenciaTerminal ||= terminal;
      totalDeclaradoConfere ||= reportedTotal === contagem.discovered;
    }

    if (
      descobertosNasPaginas !== contagem.discovered ||
      (!definicao.singleton && identidades.size !== contagem.discovered) ||
      (contagem.countSource === "reported" && !totalDeclaradoConfere) ||
      (contagem.countSource === "terminal-page" && (!evidenciaTerminal || contagem.discovered === 0)) ||
      (contagem.countSource === "explicit-empty" &&
        (contagem.discovered !== 0 || !contagem.explicitlyEmpty || !evidenciaVazia))
    ) {
      falhar("WIDESYS_CATALOGOS_CONTAGEM_DIVERGENTE", `A contagem do modulo ${modulo} nao possui evidencia fechada.`);
    }
  }
}

function validarArtefato(raizReal: string, artefato: ArtefatoManifesto): Buffer {
  const caminho = caminhoSeguro(raizReal, artefato.path);
  const estado = statSync(caminho);
  if (!estado.isFile() || estado.size !== artefato.bytes) {
    falhar("WIDESYS_CATALOGOS_TAMANHO_DIVERGENTE", "O tamanho de um artefato diverge do manifesto.");
  }
  const conteudo = readFileSync(caminho);
  if (sha256(conteudo) !== artefato.sha256) {
    falhar("WIDESYS_CATALOGOS_HASH_DIVERGENTE", "O hash de um artefato diverge do manifesto.");
  }
  return conteudo;
}

function registroDoArtefato(
  artefato: ArtefatoManifesto,
  conteudo: Buffer,
  janela: { fim: Date; inicio: Date },
): CatalogoLegadoPlanejado {
  let bruto: unknown;
  try {
    bruto = JSON.parse(conteudo.toString("utf8")) as unknown;
  } catch {
    falhar("WIDESYS_CATALOGOS_JSON_INVALIDO", "Um registro de catálogo não contém JSON válido.");
  }
  const item = objeto(bruto);
  const id = texto(item?.id, 160);
  const modulo = texto(item?.module, 100);
  const raw = objeto(item?.raw);
  if (
    !item ||
    !id ||
    !idCatalogoValido(id) ||
    modulo !== artefato.module ||
    !raw
  ) {
    falhar("WIDESYS_CATALOGOS_REGISTRO_INVALIDO", "Um registro de catálogo é estruturalmente inválido.");
  }
  const capturadoEm = dataIso(item.fetchedAt, "WIDESYS_CATALOGOS_DATA_INVALIDA");
  if (capturadoEm < janela.inicio || capturadoEm > janela.fim) {
    falhar(
      "WIDESYS_CATALOGOS_DATA_FORA_CAPTURA",
      "Um registro possui fetchedAt fora da janela temporal do manifesto.",
    );
  }
  const source = sourceUrlSeguro(item.sourceUrl ?? artefato.sourceUrl);
  const preparado = Object.fromEntries(
    Object.entries(item).filter(
      ([chave]) =>
        !["capturedAt", "capturadoEm", "fetchedAt", "sourceUrl", "updatedAt"].includes(chave),
    ),
  );
  const sanitizado = sanitizarSnapshot(preparado);
  const snapshot = jsonCanonico(sanitizado.valor);
  const tituloExtraido = extrairTitulo(raw);
  const labelExtraido = extrairLabel(raw);
  const titulo = tituloExtraido ? sanitizarTexto(tituloExtraido) : null;
  const label = labelExtraido ? sanitizarTexto(labelExtraido) : null;
  const sensivel =
    sanitizado.sensivel || source.sensivel || Boolean(titulo?.sensivel) || Boolean(label?.sensivel);
  return {
    origem: ORIGEM_CATALOGOS_WIDESYS,
    modulo,
    legadoId: id,
    titulo: titulo?.valor ?? null,
    label: label?.valor ?? null,
    sourceUrl: source.url,
    capturadoEm,
    status: sensivel ? "QUARENTENA" : "STAGING",
    quarentenaMotivo: sensivel ? "CONTEUDO_SENSIVEL_REDACTADO" : null,
    snapshot,
    snapshotHash: sha256(snapshot),
  };
}

function reconciliar(
  registros: CatalogoLegadoPlanejado[],
  modulosEsperados: Iterable<string> = [],
): ReconciliacaoCatalogoWidesys[] {
  const modulos = new Map<string, ReconciliacaoCatalogoWidesys>();
  for (const modulo of modulosEsperados) {
    modulos.set(modulo, { modulo, total: 0, staging: 0, quarentena: 0 });
  }
  for (const registro of registros) {
    const atual = modulos.get(registro.modulo) ?? {
      modulo: registro.modulo,
      total: 0,
      staging: 0,
      quarentena: 0,
    };
    atual.total += 1;
    if (registro.status === "QUARENTENA") atual.quarentena += 1;
    else atual.staging += 1;
    modulos.set(registro.modulo, atual);
  }
  return [...modulos.values()].sort((a, b) => a.modulo.localeCompare(b.modulo));
}

export function carregarPlanoCatalogosWidesys(
  diretorioInformado = resolve(process.cwd(), "data", "legacy-widesys", "catalogos"),
): PlanoCatalogosWidesys {
  let raizReal: string;
  try {
    raizReal = realpathSync(resolve(diretorioInformado));
  } catch {
    falhar("WIDESYS_CATALOGOS_DIRETORIO_AUSENTE", "O diretório da captura de catálogos não existe.");
  }
  const manifestoCaminho = caminhoSeguro(raizReal, "manifest.json");
  const estadoManifesto = statSync(manifestoCaminho);
  if (!estadoManifesto.isFile() || estadoManifesto.size <= 0 || estadoManifesto.size > TAMANHO_MAXIMO_MANIFESTO) {
    falhar("WIDESYS_CATALOGOS_MANIFESTO_INVALIDO", "O manifesto possui tamanho inválido.");
  }
  let manifesto: Registro | null;
  try {
    manifesto = objeto(JSON.parse(readFileSync(manifestoCaminho, "utf8")) as unknown);
  } catch {
    manifesto = null;
  }
  if (!manifesto) {
    falhar("WIDESYS_CATALOGOS_MANIFESTO_INVALIDO", "O manifesto não contém JSON válido.");
  }

  const artefatos = artefatosDoManifesto(manifesto);
  const { capturaId, capturadoEm, contagens, iniciadoEm, manifestoHash, esperados } = validarManifestoCompleto(
    manifesto,
    artefatos,
  );
  const registros: CatalogoLegadoPlanejado[] = [];
  const chaves = new Set<string>();
  const contagem = new Map<string, number>();
  const conteudos = new Map<string, Buffer>();
  for (const artefato of artefatos) {
    const conteudo = validarArtefato(raizReal, artefato);
    conteudos.set(artefato.path, conteudo);
    if (artefato.kind !== "detail-json") continue;
    if (!artefato.path.startsWith(`${artefato.module}/records/`) || !artefato.path.endsWith(".json")) {
      falhar("WIDESYS_CATALOGOS_CAMINHO_INVALIDO", "Um detalhe JSON está fora da pasta records do módulo.");
    }
    const registro = registroDoArtefato(artefato, conteudo, {
      fim: capturadoEm,
      inicio: iniciadoEm,
    });
    const chave = `${registro.modulo}\u0000${registro.legadoId}`;
    if (chaves.has(chave)) {
      falhar("WIDESYS_CATALOGOS_REGISTRO_DUPLICADO", "A captura repete a identidade de um catálogo.");
    }
    chaves.add(chave);
    registros.push(registro);
    contagem.set(registro.modulo, (contagem.get(registro.modulo) ?? 0) + 1);
  }
  validarEvidenciasListagem(artefatos, conteudos, contagens);
  for (const [modulo, esperado] of esperados) {
    if ((contagem.get(modulo) ?? 0) !== esperado) {
      falhar("WIDESYS_CATALOGOS_CONTAGEM_DIVERGENTE", `A contagem do módulo ${modulo} diverge do manifesto.`);
    }
  }
  registros.sort((a, b) => a.modulo.localeCompare(b.modulo) || a.legadoId.localeCompare(b.legadoId));
  return {
    origem: ORIGEM_CATALOGOS_WIDESYS,
    capturaId,
    manifestoHash,
    capturadoEm,
    registros,
    reconciliacao: reconciliar(registros, esperados.keys()),
  };
}

export function criarRelatorioDryRunCatalogosWidesys(
  plano: PlanoCatalogosWidesys,
): RelatorioCatalogosWidesys {
  return {
    origem: plano.origem,
    capturaId: plano.capturaId,
    capturadoEm: plano.capturadoEm.toISOString(),
    total: plano.registros.length,
    quarentena: plano.registros.filter((item) => item.status === "QUARENTENA").length,
    modulos: plano.reconciliacao,
  };
}

export function validarIdentidadeCapturaCatalogos(
  manifestoHashExistente: string | null | undefined,
  manifestoHashAtual: string,
): void {
  if (manifestoHashExistente && manifestoHashExistente !== manifestoHashAtual) {
    falhar(
      "WIDESYS_CATALOGOS_CAPTURE_ID_COLISAO",
      "O captureId já existe associado a outro hash de manifesto.",
    );
  }
}

type Existente = {
  id: string;
  modulo: string;
  legadoId: string;
  snapshotHash: string;
  status: string;
  quarentenaMotivo: string | null;
  capturadoEm: Date;
};

export async function importarPlanoCatalogosWidesys(
  prisma: PrismaClient,
  plano: PlanoCatalogosWidesys,
): Promise<RelatorioCatalogosWidesys> {
  const resumo = JSON.stringify({ modulos: plano.reconciliacao });
  const capturaExistente = await prisma.catalogoLegadoCaptura.findUnique({
    where: { origem_capturaId: { origem: plano.origem, capturaId: plano.capturaId } },
    select: { manifestoHash: true },
  });
  validarIdentidadeCapturaCatalogos(capturaExistente?.manifestoHash, plano.manifestoHash);
  const captura = await prisma.catalogoLegadoCaptura.upsert({
    where: { origem_capturaId: { origem: plano.origem, capturaId: plano.capturaId } },
    create: {
      origem: plano.origem,
      capturaId: plano.capturaId,
      manifestoHash: plano.manifestoHash,
      capturadoEm: plano.capturadoEm,
      status: "PROCESSANDO",
      totalEsperado: plano.registros.length,
      totalQuarentena: plano.registros.filter((item) => item.status === "QUARENTENA").length,
      resumo,
    },
    update: {
      manifestoHash: plano.manifestoHash,
      capturadoEm: plano.capturadoEm,
      status: "PROCESSANDO",
      totalEsperado: plano.registros.length,
      totalProcessado: 0,
      totalQuarentena: plano.registros.filter((item) => item.status === "QUARENTENA").length,
      resumo,
      erroCodigo: null,
      concluidoEm: null,
    },
  });
  const alteracoes = {
    criados: 0,
    atualizados: 0,
    inalterados: 0,
    anterioresIgnorados: 0,
    quarentena: 0,
  };
  let processados = 0;
  try {
    for (let inicio = 0; inicio < plano.registros.length; inicio += TAMANHO_LOTE) {
      const lote = plano.registros.slice(inicio, inicio + TAMANHO_LOTE);
      const resultado = await prisma.$transaction(async (tx) => {
        const existentes = (await tx.catalogoLegadoRegistro.findMany({
          where: {
            origem: plano.origem,
            OR: lote.map((item) => ({ modulo: item.modulo, legadoId: item.legadoId })),
          },
          select: {
            id: true,
            modulo: true,
            legadoId: true,
            snapshotHash: true,
            status: true,
            quarentenaMotivo: true,
            capturadoEm: true,
          },
        })) as Existente[];
        const porChave = new Map(existentes.map((item) => [`${item.modulo}\u0000${item.legadoId}`, item]));
        const contadores = { criados: 0, atualizados: 0, inalterados: 0, anterioresIgnorados: 0, quarentena: 0 };
        for (const registro of lote) {
          const existente = porChave.get(`${registro.modulo}\u0000${registro.legadoId}`);
          const anterior = Boolean(existente && existente.capturadoEm > registro.capturadoEm);
          const semanticamenteIgual = Boolean(
            existente &&
              existente.snapshotHash === registro.snapshotHash &&
              existente.status === registro.status &&
              existente.quarentenaMotivo === registro.quarentenaMotivo,
          );
          const acao =
            registro.status === "QUARENTENA"
              ? "QUARENTENA"
              : anterior
                ? "ANTERIOR_IGNORADO"
                : !existente
                  ? "CRIAR"
                  : semanticamenteIgual
                    ? "INALTERADO"
                    : "ATUALIZAR";
          if (registro.status === "QUARENTENA") contadores.quarentena += 1;
          else if (acao === "CRIAR") contadores.criados += 1;
          else if (acao === "ATUALIZAR") contadores.atualizados += 1;
          else if (acao === "ANTERIOR_IGNORADO") contadores.anterioresIgnorados += 1;
          else contadores.inalterados += 1;

          const item = await tx.catalogoLegadoItem.upsert({
            where: {
              capturaId_modulo_legadoId: {
                capturaId: captura.id,
                modulo: registro.modulo,
                legadoId: registro.legadoId,
              },
            },
            create: {
              capturaId: captura.id,
              origem: plano.origem,
              modulo: registro.modulo,
              legadoId: registro.legadoId,
              snapshotHash: registro.snapshotHash,
              acao,
              status: registro.status === "QUARENTENA" ? "QUARENTENA" : "CONCLUIDO",
              quarentenaMotivo: registro.quarentenaMotivo,
            },
            update: {
              snapshotHash: registro.snapshotHash,
              acao,
              status: registro.status === "QUARENTENA" ? "QUARENTENA" : "CONCLUIDO",
              quarentenaMotivo: registro.quarentenaMotivo,
              processadoEm: new Date(),
            },
          });
          if (anterior) continue;
          await tx.catalogoLegadoRegistro.upsert({
            where: {
              origem_modulo_legadoId: {
                origem: plano.origem,
                modulo: registro.modulo,
                legadoId: registro.legadoId,
              },
            },
            create: {
              ...registro,
              ultimoItemId: item.id,
            },
            update: {
              titulo: registro.titulo,
              label: registro.label,
              sourceUrl: registro.sourceUrl,
              capturadoEm: registro.capturadoEm,
              status: registro.status,
              quarentenaMotivo: registro.quarentenaMotivo,
              snapshot: registro.snapshot,
              snapshotHash: registro.snapshotHash,
              ultimoItemId: item.id,
            },
          });
        }
        return contadores;
      });
      alteracoes.criados += resultado.criados;
      alteracoes.atualizados += resultado.atualizados;
      alteracoes.inalterados += resultado.inalterados;
      alteracoes.anterioresIgnorados += resultado.anterioresIgnorados;
      alteracoes.quarentena += resultado.quarentena;
      processados += lote.length;
      await prisma.catalogoLegadoCaptura.update({
        where: { id: captura.id },
        data: { totalProcessado: processados },
      });
    }
    await prisma.catalogoLegadoCaptura.update({
      where: { id: captura.id },
      data: { status: "CONCLUIDO", totalProcessado: processados, concluidoEm: new Date() },
    });
  } catch (erro) {
    await prisma.catalogoLegadoCaptura
      .update({
        where: { id: captura.id },
        data: { status: "FALHOU", totalProcessado: processados, erroCodigo: "IMPORTACAO_FALHOU" },
      })
      .catch(() => undefined);
    throw erro;
  }
  return { ...criarRelatorioDryRunCatalogosWidesys(plano), alteracoes };
}
