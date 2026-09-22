import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { Prisma, type PrismaClient } from "@prisma/client";
import { conteudoHashManifestoOperacao } from "./manifesto-operacao-widesys";
import {
  extrairPartesContratoWidesys,
  type CampoParteContratoWidesys,
} from "./partes-contrato-widesys";

export const ORIGEM_OPERACAO_WIDESYS = "WIDESYS";
const ORIGEM_HTTP_WIDESYS = "https://brisaazul.app2.widesys.com.br";
const TAMANHO_MAXIMO_ARQUIVO = 64 * 1024 * 1024;
const FUSO_NEGOCIO = "America/Sao_Paulo";
// O Widesys exibe valores com duas casas, mas alguns relatórios recalculam o
// líquido antes de renderizar a baixa. Aceitamos somente a diferença máxima
// de um centavo; datas e contas, quando presentes dos dois lados, são exatas.
export const TOLERANCIA_RECONCILIACAO_BAIXA_CENTAVOS = 1;
export const POLITICA_RECONCILIACAO_BAIXA_MOVIMENTO = {
  conta: "EXATA_QUANDO_AMBAS_PRESENTES",
  data: "EXATA_QUANDO_AMBAS_PRESENTES",
  identidade: "MOVIMENTO_LEGADO_ID",
  natureza: "RECEBIMENTO_ENTRADA_PAGAMENTO_SAIDA",
  toleranciaValorCentavos: TOLERANCIA_RECONCILIACAO_BAIXA_CENTAVOS,
} as const;

export type EscopoOperacaoWidesys =
  | "CONTRATO"
  | "CONTRATO_PARTE"
  | "TITULO_RECEBER"
  | "TITULO_PAGAR"
  | "BAIXA_RECEBER"
  | "BAIXA_PAGAR"
  | "MOVIMENTO";

type BaseRegistro = {
  escopo: EscopoOperacaoWidesys;
  legadoId: string;
  sourceUrl: string | null;
  capturadoEm: Date;
  snapshot: string;
  snapshotHash: string;
  statusImportacao: "STAGING" | "QUARENTENA";
  quarentenaMotivo: string | null;
};

export type ContratoLegadoPlanejado = BaseRegistro & {
  escopo: "CONTRATO";
  numeroContrato: string | null;
  imovelLegadoId: string | null;
  situacaoOrigem: string | null;
  inicio: string | null;
  fim: string | null;
  primeiroVencimento: string | null;
  proximoReajuste: string | null;
  valorLocacao: number | null;
  valorAdministracao: number | null;
  valorCaucao: number | null;
  /** Evidência diagnóstica; sem total da fonte ela não prova enumeração completa. */
  capturaPartesEstruturada: boolean;
  capturaPartesProva: "DETALHE_ESTRUTURADO_SEM_CONTAGEM" | "INCOMPLETA";
};

export type ContratoParteLegadoPlanejado = BaseRegistro & {
  escopo: "CONTRATO_PARTE";
  contratoLegadoId: string;
  papel: "INQUILINO" | "PROPRIETARIO" | "BENEFICIARIO" | "FIADOR" | "CORRETOR";
  pessoaLegadoId: string | null;
  vinculoId: string | null;
  ordem: number;
  percentual: string | null;
  valor: number | null;
  flags: Record<string, string | string[]>;
};

export type TituloLegadoPlanejado = BaseRegistro & {
  escopo: "TITULO_RECEBER" | "TITULO_PAGAR";
  natureza: "RECEBER" | "PAGAR";
  numeroDocumento: string | null;
  parcela: string | null;
  contratoLegadoId: string | null;
  pessoaLegadoId: string | null;
  contrapartePapelOrigem: "INQUILINO" | "OUTRO" | "PROPRIETARIO" | null;
  contaBancariaLegadoId: string | null;
  contaBancariaRotulo: string | null;
  planoContaLegadoId: string | null;
  planoContaRotulo: string | null;
  tipoCobrancaLegadoId: string | null;
  tipoCobrancaRotulo: string | null;
  emissao: string | null;
  competencia: string | null;
  vencimento: string | null;
  pagamento: string | null;
  valorOriginal: number | null;
  valorDevido: number | null;
  valorAberto: number | null;
  valorPago: number | null;
  juros: number | null;
  multa: number | null;
  desconto: number | null;
  situacaoOrigem: string | null;
  situacaoNormalizada:
    | "PENDENTE"
    | "VENCIDO"
    | "PARCIAL"
    | "PAGO"
    | "CANCELADO"
    | "DESCONHECIDO";
  pagamentoParcial: boolean;
  inadimplente: boolean;
  /** Prova de que a captura observou todas as baixas deste título. */
  capturaBaixasCompleta: boolean;
  capturaBaixasProva:
    | "ESTRUTURADA_COHERENTE"
    | "INCOMPLETA"
    | "TRANSPORTE_DETALHES"
    | "VALOR_PAGO_ZERO_EXPLICITO";
};

export type MovimentoLegadoPlanejado = BaseRegistro & {
  escopo: "MOVIMENTO";
  natureza: "ENTRADA" | "SAIDA" | "TRANSFERENCIA" | "DESCONHECIDA";
  tituloEscopo: string | null;
  tituloLegadoId: string | null;
  contaBancariaLegadoId: string | null;
  contaBancariaRotulo: string | null;
  planoContaLegadoId: string | null;
  planoContaRotulo: string | null;
  documento: string | null;
  descricao: string | null;
  dataMovimento: string | null;
  competencia: string | null;
  valor: number | null;
  conciliado: boolean | null;
  situacaoOrigem: string | null;
};

export type BaixaLegadoPlanejada = BaseRegistro & {
  escopo: "BAIXA_RECEBER" | "BAIXA_PAGAR";
  natureza: "RECEBIMENTO" | "PAGAMENTO";
  tituloEscopo: "TITULO_RECEBER" | "TITULO_PAGAR";
  tituloLegadoId: string;
  movimentoLegadoId: string | null;
  contaBancariaLegadoId: string | null;
  contaBancariaRotulo: string | null;
  numeroDocumento: string | null;
  forma: string | null;
  dataPagamento: string | null;
  valor: number | null;
  responsavelOrigem: string | null;
  origemRegistradoEm: string | null;
  situacaoOrigem: string | null;
  estornada: boolean;
};

export type RegistroOperacaoPlanejado =
  | ContratoLegadoPlanejado
  | ContratoParteLegadoPlanejado
  | TituloLegadoPlanejado
  | MovimentoLegadoPlanejado
  | BaixaLegadoPlanejada;

export type ReconciliacaoEscopo = {
  quantidade: number;
  quarentena: number;
  /** Total monetário lido da fonte, antes de qualquer decisão de quarentena. */
  somaFonte: number;
  /** Parcela de somaFonte que pode seguir no staging. */
  somaAceita: number;
  /** Parcela de somaFonte isolada para revisão humana. */
  somaQuarentena: number;
  somaValorOriginal: number;
  somaValorDevido: number;
  somaValorAberto: number;
  somaValorPago: number;
  somaMovimentos: number;
  somaBaixas: number;
};

export type PlanoOperacaoWidesys = {
  origem: typeof ORIGEM_OPERACAO_WIDESYS;
  capturaId: string;
  esquemaVersao: number;
  manifestoHash: string;
  capturadoEm: Date;
  dataNegocio: string;
  escoposCobertos: EscopoOperacaoWidesys[];
  coberturaTemporal: Partial<
    Record<"TITULO_RECEBER" | "TITULO_PAGAR" | "MOVIMENTO", IntervaloTemporal>
  >;
  registros: RegistroOperacaoPlanejado[];
  politicaReconciliacao: typeof POLITICA_RECONCILIACAO_BAIXA_MOVIMENTO;
  reconciliacao: Record<EscopoOperacaoWidesys, ReconciliacaoEscopo>;
  escoposAusentes: EscopoOperacaoWidesys[];
  escoposPartesCompletos: Array<"CONTRATO_PARTE">;
  escoposBaixasCompletos: Array<"BAIXA_RECEBER" | "BAIXA_PAGAR">;
};

type ManifestDescriptor = {
  caminho: string;
  escopo: EscopoOperacaoWidesys | null;
  sha256: string;
  bytes: number | null;
  quantidade: number | null;
};

const MODULO_PARA_ESCOPO = {
  contratos: "CONTRATO",
  "contas-receber": "TITULO_RECEBER",
  "contas-pagar": "TITULO_PAGAR",
  movimentacoes: "MOVIMENTO",
} as const satisfies Record<string, EscopoOperacaoWidesys>;

const ESCOPOS_COBERTOS_POR_MODULO = {
  contratos: ["CONTRATO", "CONTRATO_PARTE"],
  "contas-receber": ["TITULO_RECEBER", "BAIXA_RECEBER"],
  "contas-pagar": ["TITULO_PAGAR", "BAIXA_PAGAR"],
  movimentacoes: ["MOVIMENTO"],
} as const satisfies Record<string, readonly EscopoOperacaoWidesys[]>;

type ModuloOperacaoWidesys = keyof typeof MODULO_PARA_ESCOPO;

export class ErroImportacaoOperacaoWidesys extends Error {
  constructor(
    public readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroImportacaoOperacaoWidesys";
  }
}

function falhar(codigo: string, mensagem: string): never {
  throw new ErroImportacaoOperacaoWidesys(codigo, mensagem);
}

function objeto(valor: unknown): Record<string, unknown> | null {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

function texto(valor: unknown): string | null {
  if (typeof valor === "string") {
    const normalizado = valor.trim();
    return normalizado ? normalizado : null;
  }
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  return null;
}

function inteiro(valor: unknown): number | null {
  if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor < 0) return null;
  return valor;
}

function sha256(conteudo: string | Buffer): string {
  return createHash("sha256").update(conteudo).digest("hex");
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

function dataIso(valor: unknown, codigo: string): Date {
  const entrada = texto(valor);
  if (!entrada) falhar(codigo, "A captura não informa uma data ISO válida.");
  const data = new Date(entrada);
  if (Number.isNaN(data.getTime()) || data.toISOString() !== entrada) {
    falhar(codigo, "A captura contém uma data fora do formato ISO canônico.");
  }
  return data;
}

function dataCivilNoFuso(instante: Date, fuso = FUSO_NEGOCIO): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: fuso,
    year: "numeric",
  }).formatToParts(instante);
  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((parte) => parte.type === tipo)?.value;
  const ano = valor("year");
  const mes = valor("month");
  const dia = valor("day");
  if (!ano || !mes || !dia) falhar("WIDESYS_OPERACAO_DATA_NEGOCIO_INVALIDA", "Data civil inválida.");
  return `${ano}-${mes}-${dia}`;
}

function dataNegocioDoManifesto(manifesto: Record<string, unknown>, capturadoEm: Date): string {
  const informada = texto(manifesto.businessDate ?? manifesto.dataNegocio);
  if (!informada) return dataCivilNoFuso(capturadoEm);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(informada) || normalizarData(informada) !== informada) {
    falhar("WIDESYS_OPERACAO_DATA_NEGOCIO_INVALIDA", "O manifesto contém data civil inválida.");
  }
  const fuso = texto(manifesto.timeZone ?? manifesto.fusoHorario);
  if (fuso && fuso !== FUSO_NEGOCIO) {
    falhar("WIDESYS_OPERACAO_FUSO_INVALIDO", "A captura operacional usa um fuso de negócio inesperado.");
  }
  return informada;
}

function normalizarChave(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^jform/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function escopoDe(valor: unknown): EscopoOperacaoWidesys | null {
  const chave = normalizarChave(texto(valor) ?? "");
  if (["contrato", "contratos", "locacao", "locacaos", "locacoes"].includes(chave)) {
    return "CONTRATO";
  }
  if (["contrato_parte", "contrato_partes", "locacao_partes"].includes(chave)) {
    return "CONTRATO_PARTE";
  }
  if (
    [
      "titulo_receber",
      "titulos_receber",
      "conta_receber",
      "contas_receber",
      "financontasrecebers",
      "recebiveis",
    ].includes(chave)
  ) {
    return "TITULO_RECEBER";
  }
  if (
    [
      "titulo_pagar",
      "titulos_pagar",
      "conta_pagar",
      "contas_pagar",
      "financontaspagars",
      "pagaveis",
    ].includes(chave)
  ) {
    return "TITULO_PAGAR";
  }
  if (
    ["movimento", "movimentos", "movimentacao", "movimentacoes", "finanlancamentos"].includes(
      chave,
    )
  ) {
    return "MOVIMENTO";
  }
  if (["baixa_receber", "baixas_receber", "recebimentos_titulo"].includes(chave)) {
    return "BAIXA_RECEBER";
  }
  if (["baixa_pagar", "baixas_pagar", "pagamentos_titulo"].includes(chave)) {
    return "BAIXA_PAGAR";
  }
  return null;
}

function assertHash(valor: unknown): string {
  const hash = texto(valor);
  if (!hash || !/^[a-f\d]{64}$/i.test(hash)) {
    falhar("WIDESYS_OPERACAO_HASH_INVALIDO", "O manifesto contém um hash inválido.");
  }
  return hash.toLowerCase();
}

function caminhoSeguro(raiz: string, caminho: string): string {
  if (isAbsolute(caminho)) {
    falhar("WIDESYS_OPERACAO_CAMINHO_INVALIDO", "O manifesto contém caminho absoluto.");
  }
  const resolvido = resolve(raiz, caminho);
  const relativo = relative(raiz, resolvido);
  if (!relativo || relativo.startsWith(`..${sep}`) || relativo === ".." || isAbsolute(relativo)) {
    falhar("WIDESYS_OPERACAO_CAMINHO_INVALIDO", "Um artefato aponta para fora da captura.");
  }
  if (lstatSync(resolvido).isSymbolicLink()) {
    falhar("WIDESYS_OPERACAO_LINK_SIMBOLICO", "Links simbólicos não são aceitos na captura.");
  }
  const real = realpathSync(resolvido);
  const raizReal = realpathSync(raiz);
  const relativoReal = relative(raizReal, real);
  if (relativoReal.startsWith(`..${sep}`) || relativoReal === ".." || isAbsolute(relativoReal)) {
    falhar("WIDESYS_OPERACAO_CAMINHO_INVALIDO", "Um artefato resolve para fora da captura.");
  }
  return real;
}

function descritoresDoManifesto(
  manifesto: Record<string, unknown>,
): ManifestDescriptor[] {
  const arquivos = Array.isArray(manifesto.files)
    ? manifesto.files
    : Array.isArray(manifesto.arquivos)
      ? manifesto.arquivos
      : null;
  if (arquivos) {
    return arquivos.map((entrada) => {
      const item = objeto(entrada);
      const caminho = texto(item?.path ?? item?.arquivo);
      if (!item || !caminho) {
        falhar("WIDESYS_OPERACAO_MANIFESTO_INVALIDO", "Há arquivo inválido no manifesto.");
      }
      return {
        caminho,
        escopo: escopoDe(item.scope ?? item.escopo),
        sha256: assertHash(item.sha256),
        bytes: inteiro(item.bytes),
        quantidade: inteiro(item.count ?? item.quantidade),
      };
    });
  }

  if (!Array.isArray(manifesto.artifacts)) {
    falhar("WIDESYS_OPERACAO_MANIFESTO_INVALIDO", "O manifesto não lista artefatos.");
  }
  return manifesto.artifacts.flatMap((entrada) => {
    const item = objeto(entrada);
    if (!item || item.kind !== "detail-json") return [];
    const escopo = escopoDe(item.module);
    if (!escopo) return [];
    const caminho = texto(item.path);
    if (!caminho) {
      falhar("WIDESYS_OPERACAO_MANIFESTO_INVALIDO", "Há artefato sem caminho.");
    }
    return [
      {
        caminho,
        escopo,
        sha256: assertHash(item.sha256),
        bytes: inteiro(item.bytes),
        quantidade: 1,
      },
    ];
  });
}

function sequenciaMeses(inicio: string, fim: string): string[] {
  const [anoInicial, mesInicial] = inicio.split("-").map(Number);
  const [anoFinal, mesFinal] = fim.split("-").map(Number);
  const meses: string[] = [];
  let ano = anoInicial;
  let mes = mesInicial;
  while (ano < anoFinal || (ano === anoFinal && mes <= mesFinal)) {
    meses.push(`${ano}-${String(mes).padStart(2, "0")}`);
    mes += 1;
    if (mes === 13) {
      ano += 1;
      mes = 1;
    }
  }
  return meses;
}

function inicioProximoMes(mesIso: string): string {
  const [ano, mes] = mesIso.split("-").map(Number);
  return mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;
}

function janelasEsperadas(
  modulo: ModuloOperacaoWidesys,
  fromMonth: string | null,
  toMonth: string,
  titlesTo: string,
): string[] {
  if (modulo === "contratos") return ["todos"];
  const padrao =
    modulo === "contas-receber"
      ? "2025-07"
      : modulo === "contas-pagar"
        ? "2025-11"
        : "2025-12";
  const janelas = sequenciaMeses(fromMonth ?? padrao, toMonth);
  if (modulo === "contas-receber" || modulo === "contas-pagar") {
    const futuro = inicioProximoMes(toMonth);
    if (futuro <= titlesTo) janelas.push(`futuro-${futuro}--${titlesTo}`);
  }
  return janelas;
}

type IntervaloTemporal = { inicio: string; fim: string };
type IntervaloMovimentos = IntervaloTemporal;

function ultimoDiaDoMes(mesIso: string): string {
  const [ano, mes] = mesIso.split("-").map(Number);
  const dia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${mesIso}-${String(dia).padStart(2, "0")}`;
}

function intervaloMovimentosDoManifesto(
  manifesto: Record<string, unknown>,
  dataNegocio: string,
): IntervaloMovimentos | null {
  const options = objeto(manifesto.options);
  const modulos = Array.isArray(options?.modules) ? options.modules.map(texto) : [];
  if (!modulos.includes("movimentacoes")) return null;
  const inicioMes = options?.fromMonth === null ? "2025-12" : texto(options?.fromMonth);
  const fimMes = texto(options?.toMonth);
  if (!inicioMes || !fimMes) return null;
  return {
    inicio: `${inicioMes}-01`,
    fim: dataNegocio.slice(0, 7) === fimMes ? dataNegocio : ultimoDiaDoMes(fimMes),
  };
}

function coberturaTemporalDoManifesto(
  manifesto: Record<string, unknown>,
  dataNegocio: string,
): PlanoOperacaoWidesys["coberturaTemporal"] {
  const options = objeto(manifesto.options);
  const modulos = Array.isArray(options?.modules) ? options.modules.map(texto) : [];
  const fromMonth = options?.fromMonth === null ? null : texto(options?.fromMonth);
  const titlesTo = texto(options?.titlesTo);
  const cobertura: PlanoOperacaoWidesys["coberturaTemporal"] = {};
  if (titlesTo && modulos.includes("contas-receber")) {
    cobertura.TITULO_RECEBER = {
      inicio: `${fromMonth ?? "2025-07"}-01`,
      fim: titlesTo,
    };
  }
  if (titlesTo && modulos.includes("contas-pagar")) {
    cobertura.TITULO_PAGAR = {
      inicio: `${fromMonth ?? "2025-11"}-01`,
      fim: titlesTo,
    };
  }
  const movimentos = intervaloMovimentosDoManifesto(manifesto, dataNegocio);
  if (movimentos) cobertura.MOVIMENTO = movimentos;
  return cobertura;
}

function validarManifestoAtual(
  manifesto: Record<string, unknown>,
  descritores: ManifestDescriptor[],
): ModuloOperacaoWidesys[] {
  if (manifesto.version !== 2 || manifesto.schemaVersion !== 2) {
    falhar(
      "WIDESYS_OPERACAO_VERSAO_NAO_SUPORTADA",
      "A aplicação exige um manifesto operacional íntegro na versão 2.",
    );
  }
  if (manifesto.complete !== true) {
    falhar("WIDESYS_OPERACAO_CAPTURA_INCOMPLETA", "A captura não foi marcada como completa.");
  }
  const startedAt = dataIso(manifesto.startedAt, "WIDESYS_OPERACAO_DATA_INVALIDA");
  const capturedAt = dataIso(manifesto.capturedAt, "WIDESYS_OPERACAO_DATA_INVALIDA");
  const completedAt = dataIso(manifesto.completedAt, "WIDESYS_OPERACAO_DATA_INVALIDA");
  if (startedAt > capturedAt || capturedAt > completedAt) {
    falhar(
      "WIDESYS_OPERACAO_JANELA_TEMPORAL_INVALIDA",
      "As datas de início, captura e conclusão do manifesto são incoerentes.",
    );
  }
  if (!texto(manifesto.captureId)) {
    falhar("WIDESYS_OPERACAO_MANIFESTO_INVALIDO", "O manifesto não informa captureId.");
  }
  if (!Array.isArray(manifesto.errors)) {
    falhar("WIDESYS_OPERACAO_MANIFESTO_INVALIDO", "O manifesto não informa sua lista de erros.");
  }
  const errors = manifesto.errors;
  if (errors.length > 0) {
    falhar("WIDESYS_OPERACAO_CAPTURA_COM_ERROS", "A captura contém erros e não pode ser aplicada.");
  }

  const contentHash = assertHash(manifesto.contentHash);
  const calculado = sha256(conteudoHashManifestoOperacao(manifesto));
  if (contentHash !== calculado) {
    falhar("WIDESYS_OPERACAO_MANIFESTO_HASH_DIVERGENTE", "O hash do manifesto diverge.");
  }

  if (!Array.isArray(manifesto.files) || !Array.isArray(manifesto.artifacts)) {
    falhar(
      "WIDESYS_OPERACAO_MANIFESTO_INVALIDO",
      "O manifesto versão 2 deve listar files e artifacts.",
    );
  }
  const options = objeto(manifesto.options);
  const selecionadosBrutos = options?.modules;
  if (!Array.isArray(selecionadosBrutos) || selecionadosBrutos.length === 0) {
    falhar("WIDESYS_OPERACAO_MANIFESTO_INVALIDO", "O manifesto não informa os módulos selecionados.");
  }
  const selecionados: ModuloOperacaoWidesys[] = [];
  for (const valor of selecionadosBrutos) {
    const modulo = texto(valor);
    if (!modulo || !(modulo in MODULO_PARA_ESCOPO)) {
      falhar("WIDESYS_OPERACAO_MODULO_INVALIDO", "O manifesto contém módulo desconhecido.");
    }
    selecionados.push(modulo as ModuloOperacaoWidesys);
  }
  if (new Set(selecionados).size !== selecionados.length) {
    falhar("WIDESYS_OPERACAO_MODULO_DUPLICADO", "O manifesto repete um módulo selecionado.");
  }
  const fromMonth = options?.fromMonth === null ? null : texto(options?.fromMonth);
  const toMonth = texto(options?.toMonth);
  const titlesTo = texto(options?.titlesTo);
  if (
    (fromMonth !== null && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(fromMonth)) ||
    !toMonth ||
    !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(toMonth) ||
    !titlesTo ||
    !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(titlesTo) ||
    normalizarData(titlesTo) !== titlesTo ||
    (fromMonth !== null && fromMonth > toMonth) ||
    titlesTo.slice(0, 7) < toMonth ||
    inteiro(options?.limit) !== 200 ||
    inteiro(options?.maxPages) === null ||
    inteiro(options?.maxPages) === 0 ||
    inteiro(options?.delayMs) === null ||
    !["new", "refresh", "resume"].includes(texto(options?.captureMode) ?? "")
  ) {
    falhar("WIDESYS_OPERACAO_OPCOES_INVALIDAS", "As opções assinadas da captura são inválidas.");
  }
  if (
    texto(manifesto.timeZone) !== FUSO_NEGOCIO ||
    texto(manifesto.businessDate) !== dataCivilNoFuso(startedAt)
  ) {
    falhar(
      "WIDESYS_OPERACAO_DATA_NEGOCIO_INVALIDA",
      "A data/fuso de negócio não corresponde ao início da captura.",
    );
  }

  const modules = objeto(manifesto.modules) ?? {};
  if (JSON.stringify(Object.keys(modules)) !== JSON.stringify(selecionados)) {
    falhar(
      "WIDESYS_OPERACAO_MODULOS_DIVERGENTES",
      "Os módulos capturados divergem da seleção original ou de sua ordem.",
    );
  }
  const escoposEsperados = selecionados.map((modulo) => MODULO_PARA_ESCOPO[modulo]);
  const escoposDescritos = [
    ...new Set(descritores.map((item) => item.escopo).filter((item): item is EscopoOperacaoWidesys => Boolean(item))),
  ];
  if (
    descritores.some((item) => item.escopo === null) ||
    JSON.stringify(escoposDescritos) !== JSON.stringify(escoposEsperados)
  ) {
    falhar(
      "WIDESYS_OPERACAO_ESCOPO_DIVERGENTE",
      "Os shards financeiros divergem dos módulos selecionados.",
    );
  }
  const caminhos = descritores.map((item) => item.caminho);
  if (new Set(caminhos).size !== caminhos.length) {
    falhar("WIDESYS_OPERACAO_ARQUIVO_DUPLICADO", "O manifesto repete um shard financeiro.");
  }

  const artifacts = manifesto.artifacts.map(objeto);
  if (artifacts.some((item) => !item)) {
    falhar("WIDESYS_OPERACAO_MANIFESTO_INVALIDO", "O manifesto contém artifact inválido.");
  }
  const caminhosArtifacts = artifacts.map((item) => texto(item?.path)).filter(Boolean);
  if (new Set(caminhosArtifacts).size !== caminhosArtifacts.length) {
    falhar("WIDESYS_OPERACAO_ARQUIVO_DUPLICADO", "O manifesto repete um artifact.");
  }
  for (const artifact of artifacts) {
    const modulo = texto(artifact?.module);
    if (!modulo || !selecionados.includes(modulo as ModuloOperacaoWidesys)) {
      falhar("WIDESYS_OPERACAO_MODULOS_DIVERGENTES", "Há artifact fora dos módulos selecionados.");
    }
  }

  for (const nome of selecionados) {
    const estadoBruto = modules[nome];
    const escopoModulo = MODULO_PARA_ESCOPO[nome];
    const estado = objeto(estadoBruto);
    if (
      !estado ||
      estado.completed !== true ||
      inteiro(estado.detailErrors) !== 0 ||
      inteiro(estado.duplicateIds) !== 0
    ) {
      falhar("WIDESYS_OPERACAO_CAPTURA_INCOMPLETA", `O módulo ${nome} não foi concluído.`);
    }
    const descobertos = inteiro(estado.recordsDiscovered);
    const salvos = inteiro(estado.recordsSaved);
    const ignorados = inteiro(estado.recordsSkipped);
    if (descobertos === null || salvos === null || ignorados === null || descobertos !== salvos + ignorados) {
      falhar(
        "WIDESYS_OPERACAO_CONTAGEM_DIVERGENTE",
        `A contagem descoberta do módulo ${nome} não fecha com salvos e ignorados.`,
      );
    }
    const descrito = descritores
      .filter((item) => item.escopo === escopoModulo)
      .reduce((total, item) => total + (item.quantidade ?? -1), 0);
    if (descritores.some((item) => item.escopo === escopoModulo && item.quantidade === null) || descobertos !== descrito) {
      falhar(
        "WIDESYS_OPERACAO_CONTAGEM_DIVERGENTE",
        `A contagem consolidada do módulo ${nome} diverge dos shards do manifesto.`,
      );
    }
    const totalGlobal = inteiro(estado.globalReportedTotal);
    if (estado.globalCountVerified !== true || totalGlobal === null || totalGlobal !== descobertos) {
      falhar(
        "WIDESYS_OPERACAO_TOTAL_GLOBAL_DIVERGENTE",
        `A contagem global independente do módulo ${nome} não fecha com as janelas.`,
      );
    }

    const windows = objeto(estado.windows);
    if (!windows || Object.keys(windows).length === 0) {
      falhar("WIDESYS_OPERACAO_CAPTURA_INCOMPLETA", `O módulo ${nome} não possui janelas auditáveis.`);
    }
    const esperadas = janelasEsperadas(nome, fromMonth, toMonth, titlesTo);
    if (JSON.stringify(Object.keys(windows)) !== JSON.stringify(esperadas)) {
      falhar(
        "WIDESYS_OPERACAO_JANELAS_DIVERGENTES",
        `As janelas do módulo ${nome} divergem das opções assinadas.`,
      );
    }
    let totalJanelas = 0;
    for (const [janela, estadoJanelaBruto] of Object.entries(windows)) {
      const estadoJanela = objeto(estadoJanelaBruto);
      const paginas = inteiro(estadoJanela?.pagesFetched);
      const encontrados = inteiro(estadoJanela?.recordsDiscovered);
      const informado = inteiro(estadoJanela?.reportedTotal);
      if (
        !estadoJanela ||
        estadoJanela.completed !== true ||
        inteiro(estadoJanela.duplicateIds) !== 0 ||
        paginas === null ||
        paginas < 1 ||
        encontrados === null ||
        informado === null ||
        encontrados !== informado
      ) {
        falhar(
          "WIDESYS_OPERACAO_CONTAGEM_DIVERGENTE",
          `A janela ${janela} do módulo ${nome} não possui fechamento verificável.`,
        );
      }
      totalJanelas += encontrados;
    }
    if (totalJanelas !== descobertos) {
      falhar(
        "WIDESYS_OPERACAO_CONTAGEM_DIVERGENTE",
        `As janelas do módulo ${nome} divergem da contagem consolidada.`,
      );
    }

    for (const descritor of descritores.filter((item) => item.escopo === escopoModulo)) {
      const correspondentes = artifacts.filter(
        (artifact) =>
          texto(artifact?.path) === descritor.caminho &&
          texto(artifact?.kind) === "detail-json" &&
          texto(artifact?.module) === nome &&
          texto(artifact?.sha256)?.toLowerCase() === descritor.sha256,
      );
      if (correspondentes.length !== 1) {
        falhar(
          "WIDESYS_OPERACAO_ARQUIVO_DIVERGENTE",
          `O shard ${descritor.caminho} não possui artifact correspondente.`,
        );
      }
    }
  }
  return selecionados;
}

function validarArtefatosFisicos(diretorio: string, manifesto: Record<string, unknown>): void {
  if (!Array.isArray(manifesto.artifacts)) {
    falhar("WIDESYS_OPERACAO_MANIFESTO_INVALIDO", "O manifesto não lista artifacts verificáveis.");
  }
  for (const entrada of manifesto.artifacts) {
    const artifact = objeto(entrada);
    const caminhoRelativo = texto(artifact?.path);
    const bytes = inteiro(artifact?.bytes);
    if (!artifact || !caminhoRelativo || bytes === null) {
      falhar("WIDESYS_OPERACAO_MANIFESTO_INVALIDO", "O manifesto contém artifact sem caminho ou tamanho.");
    }
    const hash = assertHash(artifact.sha256);
    let caminho: string;
    try {
      caminho = caminhoSeguro(diretorio, caminhoRelativo);
    } catch (erro) {
      if (erro instanceof ErroImportacaoOperacaoWidesys) throw erro;
      falhar("WIDESYS_OPERACAO_ARQUIVO_AUSENTE", "Um artifact declarado não está disponível.");
    }
    const estatistica = statSync(caminho);
    if (!estatistica.isFile() || estatistica.size > TAMANHO_MAXIMO_ARQUIVO || estatistica.size !== bytes) {
      falhar("WIDESYS_OPERACAO_BYTES_DIVERGENTES", "O tamanho de um artifact diverge do manifesto.");
    }
    if (sha256(readFileSync(caminho)) !== hash) {
      falhar("WIDESYS_OPERACAO_ARQUIVO_HASH_DIVERGENTE", "O hash de um artifact diverge do manifesto.");
    }
  }
}

function origemDoManifesto(manifesto: Record<string, unknown>): string {
  const origem = texto(
    manifesto.sourceOrigin ?? manifesto.baseOrigin ?? manifesto.origem ?? manifesto.origin,
  );
  if (origem !== ORIGEM_HTTP_WIDESYS) {
    falhar("WIDESYS_OPERACAO_ORIGEM_INVALIDA", "A captura não pertence à origem Widesys permitida.");
  }
  return origem;
}

function capturaCompleta(manifesto: Record<string, unknown>): boolean {
  return manifesto.complete === true;
}

type CampoValor = string | string[];
type Campos = Record<string, CampoValor>;

function campoSensivel(chave: string): boolean {
  return /(?:password|passwd|senha|secret|token|csrf|cookie|authorization|client_secret|certificado)/i.test(
    chave,
  );
}

function valorCampo(valor: unknown): CampoValor | null {
  if (Array.isArray(valor)) {
    const valores = valor.map(texto).filter((item): item is string => Boolean(item));
    return valores.length ? valores : null;
  }
  if (typeof valor === "boolean") return valor ? "1" : "0";
  return texto(valor);
}

function juntarCampo(campos: Campos, chave: string, valor: CampoValor): void {
  const existente = campos[chave];
  if (!existente) {
    campos[chave] = valor;
    return;
  }
  const unidos = [
    ...(Array.isArray(existente) ? existente : [existente]),
    ...(Array.isArray(valor) ? valor : [valor]),
  ];
  campos[chave] = [...new Set(unidos)];
}

function camposDoRegistro(registro: Record<string, unknown>): Campos {
  const campos: Campos = {};
  const diretos = objeto(registro.fields ?? registro.campos);
  if (diretos) {
    for (const [nome, bruto] of Object.entries(diretos)) {
      const chave = normalizarChave(nome);
      const valor = valorCampo(bruto);
      if (!chave || campoSensivel(chave) || valor === null) continue;
      juntarCampo(campos, chave, valor);
    }
  }
  const raw = objeto(registro.raw);
  const lista = Array.isArray(raw?.fields) ? raw.fields : [];
  for (const itemBruto of lista) {
    const item = objeto(itemBruto);
    const nome = texto(item?.name);
    if (!item || !nome) continue;
    const chave = normalizarChave(nome);
    const valor = valorCampo(item.value);
    if (!chave || campoSensivel(chave) || valor === null || valor === "[REDACTED]") continue;
    juntarCampo(campos, chave, valor);
    const rotulo = texto(item.label);
    if (rotulo && rotulo !== valor && !campoSensivel(`${chave}_rotulo`)) {
      juntarCampo(campos, `${chave}_rotulo`, rotulo);
    }
  }
  return Object.fromEntries(Object.entries(campos).sort(([a], [b]) => a.localeCompare(b)));
}

function primeiroValor(valor: CampoValor | undefined): string | null {
  if (Array.isArray(valor)) return valor.find((item) => item.trim())?.trim() ?? null;
  return valor?.trim() || null;
}

function buscar(campos: Campos, aliases: string[]): string | null {
  const normalizados = aliases.map(normalizarChave);
  for (const alias of normalizados) {
    const exato = primeiroValor(campos[alias]);
    if (exato) return exato;
  }
  for (const alias of normalizados) {
    const candidato = Object.entries(campos)
      .filter(([chave]) => chave.endsWith(`_${alias}`))
      .sort(([a], [b]) => a.length - b.length)
      .map(([, valor]) => primeiroValor(valor))
      .find(Boolean);
    if (candidato) return candidato;
  }
  return null;
}

function buscarExato(campos: Campos, aliases: string[]): string | null {
  for (const alias of aliases.map(normalizarChave)) {
    const valor = primeiroValor(campos[alias]);
    if (valor) return valor;
  }
  return null;
}

function normalizarData(valor: string | null): string | null {
  if (!valor) return null;
  const limpa = valor.trim().slice(0, 10);
  let ano: string;
  let mes: string;
  let dia: string;
  let match = limpa.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) [, ano, mes, dia] = match;
  else {
    match = limpa.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    if (!match) return null;
    [, dia, mes, ano] = match;
  }
  const normalizada = `${ano}-${mes}-${dia}`;
  const data = new Date(`${normalizada}T00:00:00.000Z`);
  return data.toISOString().slice(0, 10) === normalizada ? normalizada : null;
}

function lerData(campos: Campos, aliases: string[], motivos: string[], codigo: string): string | null {
  const bruto = buscar(campos, aliases);
  if (!bruto) return null;
  const normalizada = normalizarData(bruto);
  if (!normalizada) motivos.push(codigo);
  return normalizada;
}

function centavos(valor: string | null): number | null {
  if (!valor) return null;
  let limpa = valor.trim();
  let negativo = false;
  if (/^\(.*\)$/.test(limpa)) {
    negativo = true;
    limpa = limpa.slice(1, -1);
  }
  limpa = limpa.trim().replace(/^R\$\s*/i, "").trim();
  if (limpa.startsWith("-")) {
    negativo = true;
    limpa = limpa.slice(1).trim();
  }
  limpa = limpa.replace(/\s/g, "");
  let normalizada: string;
  if (/^\d+$/.test(limpa)) normalizada = limpa;
  else if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(limpa)) {
    normalizada = limpa.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(limpa)) {
    normalizada = limpa.replace(/,/g, "");
  } else if (/^\d+,\d{1,2}$/.test(limpa)) normalizada = limpa.replace(",", ".");
  else if (/^\d+\.\d{1,2}$/.test(limpa)) normalizada = limpa;
  else return null;
  const [inteiros, decimais = ""] = normalizada.split(".");
  const numero = Number(inteiros) * 100 + Number((decimais + "00").slice(0, 2));
  const final = negativo ? -numero : numero;
  return Number.isSafeInteger(final) && Math.abs(final) <= 2_147_483_647 ? final : null;
}

function lerCentavos(campos: Campos, aliases: string[], motivos: string[], codigo: string) {
  const bruto = buscar(campos, aliases);
  if (!bruto) return null;
  const valor = centavos(bruto);
  if (valor === null) motivos.push(codigo);
  return valor;
}

function lerCentavosExato(campos: Campos, aliases: string[], motivos: string[], codigo: string) {
  const bruto = buscarExato(campos, aliases);
  if (!bruto) return null;
  const valor = centavos(bruto);
  if (valor === null) motivos.push(codigo);
  return valor;
}

function lerControleMultaJuros(campos: Campos, motivos: string[]): number | null {
  const bruto =
    buscarExato(campos, ["multa_juros", "valor_multa_juros"]) ??
    Object.entries(campos)
      .filter(([chave]) => chave.endsWith("_multa_juros"))
      .sort(([a], [b]) => a.length - b.length)
      .map(([, valor]) => primeiroValor(valor))
      .find((valor): valor is string => Boolean(valor)) ??
    null;
  if (!bruto) return null;
  const valor = centavos(bruto);
  if (valor === null) motivos.push("TITULO_MULTA_JUROS_CONTROLE_INVALIDO");
  return valor;
}

function booleano(valor: string | null): boolean | null {
  if (!valor) return null;
  const chave = normalizarChave(valor);
  if (["1", "sim", "true", "conciliado", "baixado"].includes(chave)) return true;
  if (["0", "nao", "false", "pendente"].includes(chave)) return false;
  return null;
}

function urlPublica(valor: unknown, escopo: EscopoOperacaoWidesys): string | null {
  const entrada = texto(valor);
  if (!entrada) return null;
  let url: URL;
  try {
    url = new URL(entrada);
  } catch {
    falhar("WIDESYS_OPERACAO_URL_INVALIDA", "Um registro contém URL de origem inválida.");
  }
  if (url.username || url.password) {
    falhar("WIDESYS_OPERACAO_URL_INVALIDA", "Uma URL de origem contém userinfo proibido.");
  }
  if (url.origin !== ORIGEM_HTTP_WIDESYS || url.pathname !== "/administrator/index.php" || url.hash) {
    falhar("WIDESYS_OPERACAO_URL_INVALIDA", "Um registro aponta para URL fora do administrador permitido.");
  }
  const regras = (() => {
    if (escopo === "CONTRATO" || escopo === "CONTRATO_PARTE") {
      return [{
        valores: { option: "com_widesys", view: "locacao", layout: "edit" },
        numericos: ["id"],
      }];
    }
    if (escopo === "MOVIMENTO") {
      return [{
        valores: { option: "com_widesys", view: "finanlancamento", layout: "edit" },
        numericos: ["id"],
      }];
    }
    const receber = escopo === "TITULO_RECEBER" || escopo === "BAIXA_RECEBER";
    return [
      {
        valores: {
          option: "com_widesys",
          view: "ajax",
          format: "raw",
          task: receber ? "ajax.getParcelaInfo" : "ajax.getParcelaInfoPagar",
        },
        numericos: ["parcela_id"],
      },
      {
        valores: {
          option: "com_widesys",
          view: "ajax",
          format: "raw",
          task: receber ? "ajax.getDetalhesRecebimento" : "ajax.getDetalhesPagamento",
        },
        numericos: [receber ? "conta_receber_id" : "conta_pagar_id", "numero_parcela"],
      },
    ];
  })();
  const corresponde = regras.some((regra) => {
    const permitidos = new Set([...Object.keys(regra.valores), ...regra.numericos]);
    const chaves = [...url.searchParams.keys()];
    if (
      chaves.length !== permitidos.size ||
      chaves.some((chave) => !permitidos.has(chave) || url.searchParams.getAll(chave).length !== 1)
    ) {
      return false;
    }
    if (Object.entries(regra.valores).some(([chave, esperado]) => url.searchParams.get(chave) !== esperado)) {
      return false;
    }
    return regra.numericos.every((chave) => /^\d+$/.test(url.searchParams.get(chave) ?? ""));
  });
  if (!corresponde) {
    falhar("WIDESYS_OPERACAO_URL_INVALIDA", "Uma URL de origem não corresponde à rota canônica do escopo.");
  }
  return url.toString();
}

function motivoFinal(motivos: string[]): string | null {
  const unicos = [...new Set(motivos)].sort();
  return unicos.length ? unicos.join(";") : null;
}

function situacaoTitulo(valor: string | null, vencimento: string | null, dataNegocio: string) {
  const chave = normalizarChave(valor ?? "");
  if (/(cancel|estorn|anulad)/.test(chave)) return "CANCELADO" as const;
  // "Quitar" é o rótulo de uma ação disponível, não a confirmação de que a
  // ação aconteceu. Do mesmo modo, a origem usa explicitamente "pagamento
  // parcial" quando ainda existe saldo.
  if (/(?:^|_)quitar(?:_|$)/.test(chave)) return "PENDENTE" as const;
  if (/(?:pagamento|recebimento|liquidacao)_parcial|parcial_(?:pago|recebido|liquidado)/.test(chave)) {
    return "PARCIAL" as const;
  }
  if (/(?:^|_)(?:nao|sem)(?:_[a-z\d]+){0,3}_(?:pago|quitad|recebid|liquid)/.test(chave)) {
    return vencimento && vencimento < dataNegocio
      ? ("VENCIDO" as const)
      : ("PENDENTE" as const);
  }
  if (/(vencid|inadimpl)/.test(chave)) return "VENCIDO" as const;
  if (/(pendent|aberto|aguard)/.test(chave)) {
    return vencimento && vencimento < dataNegocio
      ? ("VENCIDO" as const)
      : ("PENDENTE" as const);
  }
  if (/(pago|quitad|recebid|liquid)/.test(chave)) return "PAGO" as const;
  return vencimento && vencimento < dataNegocio
    ? ("VENCIDO" as const)
    : ("DESCONHECIDO" as const);
}

function naturezaMovimento(valor: string | null, valorCentavos: number | null) {
  const chave = normalizarChave(valor ?? "");
  if (/transfer/.test(chave)) return "TRANSFERENCIA" as const;
  if (/(entrada|credito|receita)/.test(chave)) return "ENTRADA" as const;
  if (/(saida|debito|despesa)/.test(chave)) return "SAIDA" as const;
  if (valorCentavos !== null && valorCentavos < 0) return "SAIDA" as const;
  if (valorCentavos !== null && valorCentavos > 0) return "ENTRADA" as const;
  return "DESCONHECIDA" as const;
}

function papelContrato(
  valor: string | null,
): ContratoParteLegadoPlanejado["papel"] | null {
  const chave = normalizarChave(valor ?? "");
  if (/inquilin|locatari/.test(chave)) return "INQUILINO";
  if (/proprietari/.test(chave)) return "PROPRIETARIO";
  if (/beneficiari/.test(chave)) return "BENEFICIARIO";
  if (/fiador|avalista/.test(chave)) return "FIADOR";
  if (/corretor/.test(chave)) return "CORRETOR";
  return null;
}

type ReferenciaListaOperacao = {
  entidade: "CONTRATO" | "PESSOA";
  legadoId: string;
  papelOrigem: "INQUILINO" | "LOCACAO" | "OUTRO" | "PROPRIETARIO";
};

function referenciasDaLista(bruto: Record<string, unknown>): ReferenciaListaOperacao[] {
  const lista = objeto(bruto.list);
  const candidatas = Array.isArray(lista?.references) ? lista.references : [];
  const referencias = new Map<string, ReferenciaListaOperacao>();
  for (const candidata of candidatas) {
    const item = objeto(candidata);
    const entidade = texto(item?.entidade);
    const legadoId = texto(item?.legadoId);
    const papelOrigem = texto(item?.papelOrigem);
    const combinacaoValida =
      (entidade === "CONTRATO" && papelOrigem === "LOCACAO") ||
      (entidade === "PESSOA" && ["INQUILINO", "OUTRO", "PROPRIETARIO"].includes(papelOrigem ?? ""));
    if (!combinacaoValida || !legadoId || !/^\d+$/.test(legadoId)) continue;
    const referencia = { entidade, legadoId, papelOrigem } as ReferenciaListaOperacao;
    referencias.set(`${entidade}\u0000${papelOrigem}\u0000${legadoId}`, referencia);
  }
  return [...referencias.values()];
}

function planejarRegistro(
  bruto: Record<string, unknown>,
  escopoDescritor: EscopoOperacaoWidesys | null,
  _capturadoEmLote: Date,
  dataNegocio: string,
): RegistroOperacaoPlanejado {
  const escopo = escopoDescritor ?? escopoDe(bruto.scope ?? bruto.escopo ?? bruto.module);
  if (!escopo) falhar("WIDESYS_OPERACAO_ESCOPO_INVALIDO", "Registro sem escopo reconhecido.");
  const legadoId = texto(bruto.legacyId ?? bruto.legadoId ?? bruto.id);
  if (!legadoId || legadoId.length > 200) {
    falhar("WIDESYS_OPERACAO_ID_INVALIDO", "Registro sem identidade externa válida.");
  }
  const capturadoEm = dataIso(
    bruto.capturedAt ?? bruto.capturadoEm ?? bruto.fetchedAt,
    "WIDESYS_OPERACAO_DATA_REGISTRO_INVALIDA",
  );
  const sourceUrl = urlPublica(bruto.sourceUrl ?? bruto.urlOrigem, escopo);
  const campos = camposDoRegistro(bruto);
  const referenciasLista = referenciasDaLista(bruto);
  referenciasLista.forEach((referencia, indice) => {
    campos[`referencia_lista_${indice}_entidade`] = referencia.entidade;
    campos[`referencia_lista_${indice}_legado_id`] = referencia.legadoId;
    campos[`referencia_lista_${indice}_papel_origem`] = referencia.papelOrigem;
  });
  const snapshot = jsonCanonico({
    versao: 1,
    entidade: escopo,
    origem: ORIGEM_OPERACAO_WIDESYS,
    legadoId,
    campos,
  });
  const snapshotHash = sha256(snapshot);
  const informado = texto(bruto.snapshotHash);
  if (informado && informado !== snapshotHash) {
    falhar("WIDESYS_OPERACAO_REGISTRO_HASH_DIVERGENTE", `Hash divergente no item ${escopo}.`);
  }
  const motivos: string[] = [];
  const base = { legadoId, sourceUrl, capturadoEm, snapshot, snapshotHash };

  if (escopo === "CONTRATO") {
    const numeroContrato = buscar(campos, ["numero_contrato", "contrato_numero", "n_contrato"]);
    const imovelLegadoId = buscar(campos, ["produto_id", "imovel_id"]);
    if (!numeroContrato && !imovelLegadoId) motivos.push("CONTRATO_SEM_REFERENCIA");
    const quarentenaMotivo = motivoFinal(motivos);
    return {
      ...base,
      escopo,
      numeroContrato,
      imovelLegadoId,
      situacaoOrigem: buscar(campos, [
        "situacao_contrato_catid_rotulo",
        "situacao_contrato_rotulo",
        "situacao_contrato_catid",
        "situacao_contrato",
        "status_rotulo",
        "status",
      ]),
      inicio: lerData(
        campos,
        ["data_vigorar", "data_contrato_inicial", "data_inicio", "inicio"],
        motivos,
        "CONTRATO_INICIO_INVALIDO",
      ),
      fim: lerData(
        campos,
        ["data_contrato_final", "data_fim", "fim"],
        motivos,
        "CONTRATO_FIM_INVALIDO",
      ),
      primeiroVencimento: lerData(
        campos,
        ["vencto_pri_aluguel", "primeiro_vencimento", "data_primeiro_vencimento"],
        motivos,
        "CONTRATO_PRIMEIRO_VENCIMENTO_INVALIDO",
      ),
      proximoReajuste: lerData(
        campos,
        ["proximo_reajuste", "data_proximo_reajuste"],
        motivos,
        "CONTRATO_REAJUSTE_INVALIDO",
      ),
      valorLocacao: lerCentavos(campos, ["valor_locacao", "valor_aluguel"], motivos, "CONTRATO_VALOR_INVALIDO"),
      valorAdministracao: lerCentavos(
        campos,
        ["taxa_adm_mensal_real", "valor_administracao", "taxa_administracao_valor"],
        motivos,
        "CONTRATO_ADMINISTRACAO_INVALIDA",
      ),
      valorCaucao: lerCentavos(campos, ["valor_caucao", "caucao_valor"], motivos, "CONTRATO_CAUCAO_INVALIDA"),
      capturaPartesEstruturada: false,
      capturaPartesProva: "INCOMPLETA",
      statusImportacao: quarentenaMotivo || motivoFinal(motivos) ? "QUARENTENA" : "STAGING",
      quarentenaMotivo: motivoFinal(motivos),
    };
  }

  if (escopo === "CONTRATO_PARTE") {
    const contratoLegadoId = buscar(campos, ["contrato_id", "locacao_id"]);
    const pessoaLegadoId = buscar(campos, ["pessoa_id", "participante_id"]);
    const vinculoId = buscar(campos, ["vinculo_id"]);
    const papel = papelContrato(buscar(campos, ["papel", "tipo_parte", "tipo"]));
    if (!contratoLegadoId) motivos.push("PARTE_SEM_CONTRATO");
    if (!pessoaLegadoId) motivos.push("PARTE_SEM_PESSOA");
    if (!papel) motivos.push("PARTE_SEM_PAPEL");
    const ordemBruta = Number.parseInt(buscar(campos, ["ordem", "ordering"]) ?? "0", 10);
    const ordem = Number.isSafeInteger(ordemBruta) && ordemBruta >= 0 ? ordemBruta : 0;
    const flags = Object.fromEntries(
      Object.entries(campos)
        .filter(([chave]) => chave.startsWith("flag_"))
        .map(([chave, valor]) => [chave.slice("flag_".length), valor]),
    );
    const quarentenaMotivo = motivoFinal(motivos);
    return {
      ...base,
      escopo,
      contratoLegadoId: contratoLegadoId ?? "",
      papel: papel ?? "INQUILINO",
      pessoaLegadoId,
      vinculoId,
      ordem,
      percentual: buscar(campos, ["percentual", "porcentagem"]),
      valor: lerCentavos(campos, ["valor"], motivos, "PARTE_VALOR_INVALIDO"),
      flags,
      statusImportacao: quarentenaMotivo || motivoFinal(motivos) ? "QUARENTENA" : "STAGING",
      quarentenaMotivo: motivoFinal(motivos),
    };
  }

  if (escopo === "TITULO_RECEBER" || escopo === "TITULO_PAGAR") {
    const vencimento = lerData(campos, ["data_vencimento", "vencimento"], motivos, "TITULO_VENCIMENTO_INVALIDO");
    const valorOriginal = lerCentavos(
      campos,
      ["valor_original", "valor_titulo", "valor_documento"],
      motivos,
      "TITULO_VALOR_INVALIDO",
    );
    const valorDevido = lerCentavos(
      campos,
      ["valor_devido", "valor_cobrado", "valor"],
      motivos,
      "TITULO_DEVIDO_INVALIDO",
    );
    const valorAbertoInformado = lerCentavos(
      campos,
      ["valor_aberto", "saldo", "valor_pendente"],
      motivos,
      "TITULO_SALDO_INVALIDO",
    );
    const valorPago = lerCentavos(campos, ["valor_pago", "valor_recebido"], motivos, "TITULO_PAGO_INVALIDO");
    // `Multa/Juros` é um total de controle da grade. Nunca pode ser usado como
    // alias de juros: isso duplicaria a multa quando a mora real é zero.
    const juros = lerCentavosExato(
      campos,
      ["juros", "valor_juros", "mora", "valor_mora"],
      motivos,
      "TITULO_JUROS_INVALIDO",
    );
    const multa = lerCentavosExato(campos, ["multa", "valor_multa"], motivos, "TITULO_MULTA_INVALIDA");
    const multaJurosControle = lerControleMultaJuros(campos, motivos);
    if (multaJurosControle !== null && multaJurosControle !== (multa ?? 0) + (juros ?? 0)) {
      motivos.push("TITULO_MULTA_JUROS_DIVERGENTE");
    }
    const desconto = lerCentavos(campos, ["desconto", "valor_desconto"], motivos, "TITULO_DESCONTO_INVALIDO");
    for (const [valor, codigo] of [
      [valorOriginal, "TITULO_VALOR_NEGATIVO"],
      [valorDevido, "TITULO_DEVIDO_NEGATIVO"],
      [valorAbertoInformado, "TITULO_SALDO_NEGATIVO"],
      [valorPago, "TITULO_PAGO_NEGATIVO"],
      [juros, "TITULO_JUROS_NEGATIVO"],
      [multa, "TITULO_MULTA_NEGATIVA"],
      [desconto, "TITULO_DESCONTO_NEGATIVO"],
    ] as const) {
      if (valor !== null && valor < 0) motivos.push(codigo);
    }
    const valorBase = valorDevido ?? valorOriginal;
    if (valorBase !== null && valorPago !== null && valorPago > valorBase) {
      motivos.push("TITULO_PAGO_SUPERA_DEVIDO");
    }
    // Na listagem Widesys, "Valor devido" é o bruto do título e "Valor pago"
    // agrega as baixas efetivas. O saldo nunca pode copiar simplesmente o
    // valor devido, sobretudo nas baixas parciais.
    const valorAbertoCalculado =
      valorBase !== null && valorPago !== null ? Math.max(valorBase - valorPago, 0) : null;
    if (
      valorAbertoCalculado !== null &&
      valorAbertoInformado !== null &&
      valorAbertoCalculado !== valorAbertoInformado
    ) {
      motivos.push("TITULO_SALDO_DIVERGENTE");
    }
    const valorAberto = valorAbertoCalculado ?? valorAbertoInformado;
    if (valorOriginal === null && valorDevido === null && valorAberto === null && valorPago === null) {
      motivos.push("TITULO_SEM_VALOR");
    }
    if (!vencimento) motivos.push("TITULO_SEM_VENCIMENTO");
    const situacaoOrigem = buscar(campos, [
      "situacao_rotulo",
      "status_rotulo",
      "sit_rotulo",
      "situacao",
      "status",
      "sit",
    ]);
    const situacaoBase = situacaoTitulo(situacaoOrigem, vencimento, dataNegocio);
    const liquidadoPorValor =
      situacaoBase !== "CANCELADO" &&
      valorBase !== null &&
      valorBase > 0 &&
      valorPago !== null &&
      valorPago >= valorBase &&
      valorAberto === 0;
    const pagamentoParcial =
      !liquidadoPorValor &&
      valorPago !== null &&
      valorPago > 0 &&
      (valorAberto ?? 0) > 0 &&
      situacaoBase !== "CANCELADO";
    const situacaoNormalizada = liquidadoPorValor
      ? ("PAGO" as const)
      : pagamentoParcial
        ? ("PARCIAL" as const)
        : situacaoBase;
    const vencido = Boolean(vencimento && vencimento < dataNegocio);
    const contratoInformado = buscar(campos, ["locacao_id", "contrato_id"]);
    const pessoaInformada = buscar(campos, ["pessoa_id", "cliente_id", "fornecedor_id", "sacado_id"]);
    const referenciasContrato = [
      ...new Set(
        referenciasLista
          .filter((referencia) => referencia.entidade === "CONTRATO")
          .map((referencia) => referencia.legadoId),
      ),
    ];
    const referenciasPessoa = [
      ...new Set(
        referenciasLista
          .filter((referencia) => referencia.entidade === "PESSOA")
          .map((referencia) => referencia.legadoId),
      ),
    ];
    if (referenciasContrato.length > 1) motivos.push("TITULO_REFERENCIA_CONTRATO_AMBIGUA");
    if (referenciasPessoa.length > 1) motivos.push("TITULO_REFERENCIA_PESSOA_AMBIGUA");
    if (contratoInformado && referenciasContrato[0] && contratoInformado !== referenciasContrato[0]) {
      motivos.push("TITULO_REFERENCIA_CONTRATO_DIVERGENTE");
    }
    if (pessoaInformada && referenciasPessoa[0] && pessoaInformada !== referenciasPessoa[0]) {
      motivos.push("TITULO_REFERENCIA_PESSOA_DIVERGENTE");
    }
    const contratoLegadoId = contratoInformado ?? (referenciasContrato.length === 1 ? referenciasContrato[0] : null);
    const pessoaLegadoId = pessoaInformada ?? (referenciasPessoa.length === 1 ? referenciasPessoa[0] : null);
    const contrapartePapelOrigem =
      referenciasLista.find(
        (referencia) => referencia.entidade === "PESSOA" && referencia.legadoId === pessoaLegadoId,
      )?.papelOrigem ?? null;
    const quarentenaMotivo = motivoFinal(motivos);
    return {
      ...base,
      escopo,
      natureza: escopo === "TITULO_RECEBER" ? "RECEBER" : "PAGAR",
      numeroDocumento: buscar(campos, ["numero_documento", "nosso_numero", "documento"]),
      parcela: buscar(campos, ["parcela", "numero_parcela", "parc"]),
      contratoLegadoId,
      pessoaLegadoId,
      contrapartePapelOrigem:
        contrapartePapelOrigem === "LOCACAO" ? null : contrapartePapelOrigem,
      contaBancariaLegadoId: buscar(campos, ["conta_id", "conta_bancaria_id"]),
      contaBancariaRotulo: buscar(campos, ["conta_rotulo", "conta_pix_rotulo", "conta_pix"]),
      planoContaLegadoId: buscar(campos, ["plano_conta_id", "planoconta_id"]),
      planoContaRotulo: buscar(campos, ["plano_conta_rotulo", "planoconta_rotulo", "plano_conta"]),
      tipoCobrancaLegadoId: buscar(campos, ["tipo_cobranca_id", "tipocobranca_id"]),
      tipoCobrancaRotulo: buscar(campos, ["tipo_cobranca_rotulo", "tipocobranca_rotulo", "tipo_cobranca"]),
      emissao: lerData(campos, ["data_emissao", "emissao"], motivos, "TITULO_EMISSAO_INVALIDA"),
      competencia: buscar(campos, ["competencia", "mes_referencia"]),
      vencimento,
      pagamento: lerData(campos, ["data_pagamento", "pagamento", "data_baixa"], motivos, "TITULO_PAGAMENTO_INVALIDO"),
      valorOriginal,
      valorDevido,
      valorAberto,
      valorPago,
      juros,
      multa,
      desconto,
      situacaoOrigem,
      situacaoNormalizada,
      pagamentoParcial,
      inadimplente:
        vencido &&
        !["PAGO", "CANCELADO"].includes(situacaoNormalizada) &&
        (valorAberto ?? valorDevido ?? valorOriginal ?? 0) > 0,
      capturaBaixasCompleta: false,
      capturaBaixasProva: "INCOMPLETA",
      statusImportacao: quarentenaMotivo || motivoFinal(motivos) ? "QUARENTENA" : "STAGING",
      quarentenaMotivo: motivoFinal(motivos),
    };
  }

  if (escopo === "BAIXA_RECEBER" || escopo === "BAIXA_PAGAR") {
    const tituloLegadoId = buscar(campos, ["titulo_id", "conta_id", "conta_receber_id", "conta_pagar_id"]);
    const valor = lerCentavos(campos, ["valor_pago", "valor_baixa", "valor"], motivos, "BAIXA_VALOR_INVALIDO");
    const dataPagamento = lerData(
      campos,
      ["data_pagamento", "datapagamento", "data_baixa", "data"],
      motivos,
      "BAIXA_DATA_INVALIDA",
    );
    if (!tituloLegadoId) motivos.push("BAIXA_SEM_TITULO");
    if (valor === null) motivos.push("BAIXA_SEM_VALOR");
    else if (valor <= 0) motivos.push("BAIXA_VALOR_NAO_POSITIVO");
    if (!dataPagamento) motivos.push("BAIXA_SEM_DATA");
    const situacaoOrigem = buscar(campos, [
      "situacao_rotulo",
      "status_rotulo",
      "sit_rotulo",
      "situacao",
      "status",
      "sit",
    ]);
    const estornada = /(estorn|cancel|anulad)/.test(normalizarChave(situacaoOrigem ?? ""));
    const quarentenaMotivo = motivoFinal(motivos);
    return {
      ...base,
      escopo,
      natureza: escopo === "BAIXA_RECEBER" ? "RECEBIMENTO" : "PAGAMENTO",
      tituloEscopo: escopo === "BAIXA_RECEBER" ? "TITULO_RECEBER" : "TITULO_PAGAR",
      tituloLegadoId: tituloLegadoId ?? "",
      movimentoLegadoId: buscar(campos, ["numero_lancamento", "numerolancamento", "n_lanc", "lancamento_id"]),
      contaBancariaLegadoId: buscar(campos, ["conta_bancaria_id", "conta_id_bancaria"]),
      contaBancariaRotulo: buscar(campos, ["conta_rotulo", "conta_pix_rotulo", "conta_pix"]),
      numeroDocumento: buscar(campos, ["numero_documento", "documento"]),
      forma: buscar(campos, ["forma_pagamento", "forma", "tipo_pagamento"]),
      dataPagamento,
      valor,
      responsavelOrigem: buscar(campos, ["responsavel", "usuario", "criado_por"]),
      origemRegistradoEm: buscar(campos, ["registrado_em", "criado_em", "timestamp"]),
      situacaoOrigem,
      estornada,
      statusImportacao: quarentenaMotivo ? "QUARENTENA" : "STAGING",
      quarentenaMotivo,
    };
  }

  if (escopo !== "MOVIMENTO") {
    return falhar("WIDESYS_OPERACAO_ESCOPO_INVALIDO", "Escopo operacional não implementado.");
  }
  const valor = lerCentavos(campos, ["valor_movimento", "valor_lancamento", "valor"], motivos, "MOVIMENTO_VALOR_INVALIDO");
  const dataMovimento = lerData(
    campos,
    ["data_movimento", "data_lancamento", "data"],
    motivos,
    "MOVIMENTO_DATA_INVALIDA",
  );
  if (valor === null) motivos.push("MOVIMENTO_SEM_VALOR");
  if (!dataMovimento) motivos.push("MOVIMENTO_SEM_DATA");
  const situacaoOrigem = buscar(campos, [
    "situacao_rotulo",
    "status_rotulo",
    "sit_rotulo",
    "situacao",
    "status",
    "sit",
  ]);
  const tituloEscopoBruto = buscar(campos, ["titulo_escopo", "conta_tipo"]);
  const tituloReceberId = buscar(campos, ["conta_receber_id"]);
  const tituloPagarId = buscar(campos, ["conta_pagar_id"]);
  const tituloEscopoExplicito = (() => {
    const chave = normalizarChave(tituloEscopoBruto ?? "");
    if (/(?:^|_)receber(?:_|$)|recebivel/.test(chave)) return "TITULO_RECEBER";
    if (/(?:^|_)pagar(?:_|$)|pagavel/.test(chave)) return "TITULO_PAGAR";
    return null;
  })();
  const tituloEscopoInferido = (() => {
    if (tituloReceberId && !tituloPagarId) return "TITULO_RECEBER";
    if (tituloPagarId && !tituloReceberId) return "TITULO_PAGAR";
    return null;
  })();
  const tituloEscopoNormalizado = tituloEscopoExplicito ?? tituloEscopoInferido;
  const tituloIdGenerico = buscar(campos, ["titulo_id"]);
  const tituloLegadoId = tituloIdGenerico ?? tituloReceberId ?? tituloPagarId;
  if (
    (tituloReceberId && tituloPagarId) ||
    (tituloEscopoExplicito && tituloEscopoInferido && tituloEscopoExplicito !== tituloEscopoInferido) ||
    (tituloIdGenerico && tituloReceberId && tituloIdGenerico !== tituloReceberId) ||
    (tituloIdGenerico && tituloPagarId && tituloIdGenerico !== tituloPagarId)
  ) {
    motivos.push("MOVIMENTO_TITULO_CONFLITANTE");
  }
  if (tituloEscopoBruto && !tituloEscopoExplicito) motivos.push("MOVIMENTO_ESCOPO_TITULO_INVALIDO");
  if (tituloLegadoId && !tituloEscopoNormalizado) motivos.push("MOVIMENTO_TITULO_SEM_ESCOPO");
  if (tituloEscopoNormalizado && !tituloLegadoId) motivos.push("MOVIMENTO_ESCOPO_SEM_TITULO");
  const quarentenaMotivo = motivoFinal(motivos);
  const naturezaOrigem =
    buscar(campos, ["natureza_rotulo", "tipo_rotulo", "operacao_rotulo"]) ??
    buscar(campos, ["natureza", "operacao", "tipo"]);
  return {
    ...base,
    escopo,
    natureza: naturezaMovimento(naturezaOrigem, valor),
    tituloEscopo: tituloEscopoNormalizado,
    tituloLegadoId,
    contaBancariaLegadoId: buscar(campos, ["conta_id", "conta_bancaria_id"]),
    contaBancariaRotulo: buscar(campos, ["conta_rotulo", "conta_pix_rotulo", "conta_pix"]),
    planoContaLegadoId: buscar(campos, [
      "plano_conta_id",
      "plano_conta_catid",
      "planoconta_id",
      "planoconta_catid",
    ]),
    planoContaRotulo: buscar(campos, ["plano_conta_rotulo", "planoconta_rotulo", "planoconta_catid_rotulo", "plano_conta"]),
    documento: buscar(campos, ["numero_documento", "documento"]),
    descricao: buscar(campos, ["descricao", "historico", "observacao", "observacoes", "complemento"]),
    dataMovimento,
    competencia: buscar(campos, ["competencia", "mes_referencia"]),
    valor,
    conciliado: booleano(buscar(campos, ["conciliado", "conciliacao"])),
    situacaoOrigem,
    statusImportacao: quarentenaMotivo ? "QUARENTENA" : "STAGING",
    quarentenaMotivo,
  };
}

function arraysRelacionados(registro: Record<string, unknown>, chaves: string[]): unknown[] {
  const raw = objeto(registro.raw);
  for (const chave of chaves) {
    const valor = registro[chave] ?? raw?.[chave];
    if (Array.isArray(valor)) return valor;
  }
  return [];
}

function registroRelacionado(
  pai: Record<string, unknown>,
  campos: Record<string, unknown>,
  escopo: EscopoOperacaoWidesys,
  legadoId: string,
): Record<string, unknown> {
  return {
    id: legadoId,
    scope: escopo,
    capturedAt: pai.capturedAt ?? pai.capturadoEm ?? pai.fetchedAt,
    sourceUrl: pai.sourceUrl ?? pai.urlOrigem,
    fields: campos,
  };
}

function enriquecerSnapshot(
  registro: RegistroOperacaoPlanejado,
  derivados: Record<string, unknown>,
): void {
  const base = objeto(JSON.parse(registro.snapshot)) ?? {};
  registro.snapshot = jsonCanonico({
    ...base,
    derivados: { ...(objeto(base.derivados) ?? {}), ...derivados },
  });
  registro.snapshotHash = sha256(registro.snapshot);
}

function adicionarMotivo(registro: RegistroOperacaoPlanejado, codigo: string): void {
  registro.quarentenaMotivo = motivoFinal([
    ...(registro.quarentenaMotivo?.split(";").filter(Boolean) ?? []),
    codigo,
  ]);
  registro.statusImportacao = "QUARENTENA";
}

function reconciliarBaixasComMovimento(
  baixas: BaixaLegadoPlanejada[],
  movimento: MovimentoLegadoPlanejado,
): void {
  const divergencias: Array<[string, string]> = [];
  const jaQuarentenadas = baixas.filter(
    (baixa) => baixa.statusImportacao === "QUARENTENA",
  );
  if (jaQuarentenadas.length > 0) {
    adicionarMotivo(movimento, "MOVIMENTO_BAIXA_QUARENTENA");
  }
  if (movimento.dataMovimento) {
    const semData = baixas.filter((baixa) => !baixa.dataPagamento);
    if (semData.length > 0) {
      for (const baixa of semData) {
        adicionarMotivo(baixa, "BAIXA_MOVIMENTO_DATA_AUSENTE");
      }
      adicionarMotivo(movimento, "MOVIMENTO_BAIXA_DATA_AUSENTE");
    }
  }
  // A reconciliação financeira nunca usa uma baixa que já falhou em sua
  // própria validação. Ela continua vinculada para auditoria, e contamina o
  // movimento com um motivo explícito, mas não entra em somas ou comparações.
  const validas = baixas.filter(
    (baixa) =>
      baixa.statusImportacao !== "QUARENTENA" &&
      baixa.valor !== null &&
      baixa.valor > 0,
  );
  const somaBaixas = validas.reduce((total, baixa) => total + (baixa.valor ?? 0), 0);
  if (
    movimento.valor !== null &&
    Math.abs(somaBaixas - Math.abs(movimento.valor)) >
      TOLERANCIA_RECONCILIACAO_BAIXA_CENTAVOS
  ) {
    divergencias.push([
      "BAIXA_MOVIMENTO_VALOR_DIVERGENTE",
      "MOVIMENTO_BAIXA_VALOR_DIVERGENTE",
    ]);
  }
  if (movimento.dataMovimento && validas.some((baixa) => baixa.dataPagamento && baixa.dataPagamento !== movimento.dataMovimento)) {
    divergencias.push([
      "BAIXA_MOVIMENTO_DATA_DIVERGENTE",
      "MOVIMENTO_BAIXA_DATA_DIVERGENTE",
    ]);
  }
  const naturezasEsperadas = new Set<string>(
    validas.map((baixa) => (baixa.natureza === "RECEBIMENTO" ? "ENTRADA" : "SAIDA")),
  );
  if (
    movimento.natureza !== "DESCONHECIDA" &&
    (naturezasEsperadas.size !== 1 || !naturezasEsperadas.has(movimento.natureza))
  ) {
    divergencias.push([
      "BAIXA_MOVIMENTO_NATUREZA_DIVERGENTE",
      "MOVIMENTO_BAIXA_NATUREZA_DIVERGENTE",
    ]);
  }
  if (movimento.contaBancariaLegadoId && validas.some(
    (baixa) =>
      baixa.contaBancariaLegadoId &&
      baixa.contaBancariaLegadoId !== movimento.contaBancariaLegadoId,
  )) {
    divergencias.push([
      "BAIXA_MOVIMENTO_CONTA_DIVERGENTE",
      "MOVIMENTO_BAIXA_CONTA_DIVERGENTE",
    ]);
  }
  const titulos = new Set(validas.map((baixa) => `${baixa.tituloEscopo}\u0000${baixa.tituloLegadoId}`));
  const tituloMovimento =
    movimento.tituloEscopo && movimento.tituloLegadoId
      ? `${movimento.tituloEscopo}\u0000${movimento.tituloLegadoId}`
      : null;
  if (tituloMovimento && !titulos.has(tituloMovimento)) {
    divergencias.push([
      "BAIXA_MOVIMENTO_TITULO_CONFLITANTE",
      "MOVIMENTO_BAIXA_TITULO_CONFLITANTE",
    ]);
  }
  for (const [motivoBaixa, motivoMovimento] of divergencias) {
    for (const baixa of validas) adicionarMotivo(baixa, motivoBaixa);
    adicionarMotivo(movimento, motivoMovimento);
  }
  if (divergencias.length === 0 && movimento.contaBancariaLegadoId) {
    for (const baixa of validas) {
      if (baixa.contaBancariaLegadoId) continue;
      baixa.contaBancariaLegadoId = movimento.contaBancariaLegadoId;
      baixa.contaBancariaRotulo ??= movimento.contaBancariaRotulo;
      enriquecerSnapshot(baixa, {
        contaHerdadaDoMovimento: movimento.legadoId,
        contaBancariaLegadoId: movimento.contaBancariaLegadoId,
      });
    }
  }
  enriquecerSnapshot(movimento, {
    baixaMovimento: {
      baixasCapturadas: baixas.length,
      baixasEfetivas: validas.filter((baixa) => !baixa.estornada).length,
      crossTitle: titulos.size > 1,
      somaBaixas,
      titulosVinculados: [...titulos].sort(),
      toleranciaCentavos: TOLERANCIA_RECONCILIACAO_BAIXA_CENTAVOS,
    },
  });
}

function partesDosCamposSemanticos(bruto: Record<string, unknown>) {
  const raw = objeto(bruto.raw);
  const itens = Array.isArray(raw?.fields) ? raw.fields : [];
  const campos: CampoParteContratoWidesys[] = [];
  for (const itemBruto of itens) {
    const item = objeto(itemBruto);
    const name = texto(item?.name);
    const value = item?.value;
    if (
      !name ||
      !(
        typeof value === "string" ||
        (Array.isArray(value) && value.every((entrada) => typeof entrada === "string"))
      )
    ) {
      continue;
    }
    campos.push({
      name,
      value: value as string | string[],
      ...(typeof item?.type === "string" ? { type: item.type } : {}),
      ...(typeof item?.checked === "boolean" ? { checked: item.checked } : {}),
    });
  }
  return extrairPartesContratoWidesys(campos);
}

function partesAninhadas(
  bruto: Record<string, unknown>,
  contrato: ContratoLegadoPlanejado,
  dataNegocio: string,
): ContratoParteLegadoPlanejado[] {
  const candidatosEstruturados: Array<{
    papel: ContratoParteLegadoPlanejado["papel"];
    item: Record<string, unknown>;
    ordem: number;
  }> = [];
  const partesSemanticas = partesDosCamposSemanticos(bruto);
  if (partesSemanticas.length > 0) {
    partesSemanticas.forEach((item, ordem) => {
      const papel = papelContrato(item.papel);
      if (!papel) return;
      candidatosEstruturados.push({
        papel,
        item: { ...item },
        ordem: item.ordem ?? ordem,
      });
    });
  } else {
    const grupos: Array<[string[], ContratoParteLegadoPlanejado["papel"]]> = [
      [["inquilinos", "locatarios"], "INQUILINO"],
      [["proprietarios"], "PROPRIETARIO"],
      [["beneficiarios"], "BENEFICIARIO"],
      [["fiadores", "avalistas"], "FIADOR"],
      [["corretores"], "CORRETOR"],
    ];
    for (const [chaves, papel] of grupos) {
      arraysRelacionados(bruto, chaves).forEach((item, ordem) => {
        const registro = objeto(item);
        const ordemInformada = Number.parseInt(texto(registro?.ordem) ?? "", 10);
        if (registro) {
          candidatosEstruturados.push({
            papel,
            item: registro,
            ordem: Number.isSafeInteger(ordemInformada) && ordemInformada >= 0 ? ordemInformada : ordem,
          });
        }
      });
    }
    arraysRelacionados(bruto, ["partes", "participantes", "participants"]).forEach((item, ordem) => {
      const registro = objeto(item);
      const papel = papelContrato(texto(registro?.papel ?? registro?.tipo));
      const ordemInformada = Number.parseInt(texto(registro?.ordem) ?? "", 10);
      if (registro && papel) {
        candidatosEstruturados.push({
          papel,
          item: registro,
          ordem: Number.isSafeInteger(ordemInformada) && ordemInformada >= 0 ? ordemInformada : ordem,
        });
      }
    });
  }

  const candidatos = [...candidatosEstruturados];
  // O capturador já consolida `partes[]`. Reler os mesmos controles do HTML
  // duplicaria participantes quando os índices Joomla têm lacunas. Os campos
  // brutos são apenas fallback para capturas antigas sem estrutura.
  if (candidatos.length === 0) {
    const camposPai = camposDoRegistro(bruto);
    for (const [chave, valor] of Object.entries(camposPai)) {
      const match = chave.match(
        /(inquilin|locatari|proprietari|beneficiari|fiador|avalista|corretor)[a-z_]*?(\d+)[a-z_]*?(?:pessoa_id|inquilino_id|locatario_id|proprietario_id|beneficiario_id|fiador_id|avalista_id|corretor_id)$/,
      );
      if (!match) continue;
      const papel = papelContrato(match[1]);
      const pessoaId = primeiroValor(valor);
      if (!papel || !pessoaId) continue;
      const ordem = Number.parseInt(match[2], 10);
      const prefixo = chave.slice(0, chave.lastIndexOf("_"));
      const item: Record<string, unknown> = { pessoa_id: pessoaId };
      for (const [outraChave, outroValor] of Object.entries(camposPai)) {
        if (!outraChave.startsWith(prefixo)) continue;
        if (/percent|porcent/.test(outraChave)) item.percentual = primeiroValor(outroValor);
        if (/(?:^|_)valor$/.test(outraChave)) item.valor = primeiroValor(outroValor);
        if (/(?:^|_)id$/.test(outraChave) && outraChave !== chave) item.id = primeiroValor(outroValor);
      }
      candidatos.push({ papel, item, ordem });
    }
  }

  const unicos = new Map<string, ContratoParteLegadoPlanejado>();
  const identidadesPorId = new Map<string, string>();
  for (const candidato of candidatos) {
    const pessoaId = texto(
      candidato.item.pessoaLegadoId ??
        candidato.item.pessoa_id ??
        candidato.item.id_pessoa ??
        candidato.item.inquilino_id ??
        candidato.item.locatario_id ??
        candidato.item.proprietario_id ??
        candidato.item.beneficiario_id ??
        candidato.item.fiador_id ??
        candidato.item.avalista_id ??
        candidato.item.corretor_id,
    );
    const vinculoId = texto(
      candidato.item.vinculoId ??
        candidato.item.vinculo_id ??
        candidato.item.legacyId ??
        candidato.item.legadoId ??
        candidato.item.id,
    );
    const flags = objeto(candidato.item.flags);
    const flagsPlanos = flags
      ? Object.fromEntries(Object.entries(flags).map(([chave, valor]) => [`flag_${normalizarChave(chave)}`, valor]))
      : {};
    const campos = {
      ...candidato.item,
      flags: undefined,
      ...flagsPlanos,
      contrato_id: contrato.legadoId,
      papel: candidato.papel,
      pessoa_id: pessoaId,
      vinculo_id: vinculoId,
      ordem: candidato.ordem,
    };
    const identidadeSemantica = jsonCanonico({
      contratoLegadoId: contrato.legadoId,
      ordem: candidato.ordem,
      papel: candidato.papel,
      pessoaId,
      vinculoId,
    });
    // IDs de vínculo do Joomla são locais à tabela/papel e se repetem em
    // contratos diferentes. Nunca os trate como chave global. Mantemos o
    // núcleo estável em contrato+papel+vínculo; ordem/pessoa entram somente
    // para desambiguar duas linhas conflitantes dentro do mesmo namespace.
    const namespace = vinculoId
      ? { contratoLegadoId: contrato.legadoId, papel: candidato.papel, vinculoId }
      : {
          contratoLegadoId: contrato.legadoId,
          ordem: candidato.ordem,
          papel: candidato.papel,
          pessoaId,
        };
    const idBase = `parte:${sha256(jsonCanonico(namespace)).slice(0, 32)}`;
    const identidadeAnterior = identidadesPorId.get(idBase);
    const id =
      identidadeAnterior && identidadeAnterior !== identidadeSemantica
        ? `${idBase}:${sha256(identidadeSemantica).slice(0, 16)}`
        : idBase;
    identidadesPorId.set(idBase, identidadeSemantica);
    const planejado = planejarRegistro(
      registroRelacionado(bruto, campos, "CONTRATO_PARTE", id),
      "CONTRATO_PARTE",
      contrato.capturadoEm,
      dataNegocio,
    ) as ContratoParteLegadoPlanejado;
    unicos.set(
      `${planejado.papel}\u0000${planejado.pessoaLegadoId ?? ""}\u0000${planejado.vinculoId ?? ""}\u0000${planejado.ordem}`,
      planejado,
    );
  }
  return [...unicos.values()];
}

function tabelasDeBaixa(bruto: Record<string, unknown>): Record<string, unknown>[] {
  const raw = objeto(bruto.raw);
  const tabelas = Array.isArray(raw?.tables) ? raw.tables : [];
  const resultado: Record<string, unknown>[] = [];
  for (const tabelaBruta of tabelas) {
    const tabela = objeto(tabelaBruta);
    const cabecalhos = Array.isArray(tabela?.headers) ? tabela.headers.map((item) => texto(item) ?? "") : [];
    const chaves = cabecalhos.map(normalizarChave);
    const cabecalhoInequivocoDeBaixa = chaves.some((chave) =>
      /(?:^|_)(?:data_pagamento|data_baixa|numero_lancamento|n_lanc|lancamento|recebimento|pagamento|baixa)(?:_|$)/.test(
        chave,
      ),
    );
    if (
      !chaves.some((chave) => /valor/.test(chave)) ||
      !cabecalhoInequivocoDeBaixa
    ) {
      continue;
    }
    const linhas = Array.isArray(tabela?.rows) ? tabela.rows : [];
    for (const linhaBruta of linhas) {
      if (!Array.isArray(linhaBruta)) continue;
      resultado.push(
        Object.fromEntries(chaves.map((chave, indice) => [chave || `coluna_${indice}`, linhaBruta[indice]])),
      );
    }
  }
  return resultado;
}

function baixasAninhadas(
  bruto: Record<string, unknown>,
  titulo: TituloLegadoPlanejado,
  dataNegocio: string,
): BaixaLegadoPlanejada[] {
  const raw = objeto(bruto.raw);
  const possuiBaixasAutoritativas =
    Object.prototype.hasOwnProperty.call(bruto, "baixas") ||
    Boolean(raw && Object.prototype.hasOwnProperty.call(raw, "baixas"));
  const baixasAutoritativas = arraysRelacionados(bruto, ["baixas"]);
  const estruturadas = [
    ...arraysRelacionados(bruto, ["settlements", "liquidacoes"]),
    ...arraysRelacionados(
      bruto,
      titulo.escopo === "TITULO_RECEBER" ? ["recebimentos"] : ["pagamentos"],
    ),
  ];
  // `baixas[]` é produzido justamente a partir das tabelas AJAX. Usar ambos
  // somaria a mesma baixa duas vezes. Inclusive `baixas: []` é autoritativo:
  // tabelas são fallback apenas para capturas antigas sem essa propriedade.
  const itens = possuiBaixasAutoritativas
    ? baixasAutoritativas
    : estruturadas.length > 0
      ? estruturadas
      : tabelasDeBaixa(bruto);
  const escopo = titulo.escopo === "TITULO_RECEBER" ? "BAIXA_RECEBER" : "BAIXA_PAGAR";
  const resultado = new Map<string, BaixaLegadoPlanejada>();
  const ocorrenciasSemId = new Map<string, number>();
  itens.forEach((itemBruto) => {
    const item = objeto(itemBruto);
    if (!item) return;
    const campos = {
      ...item,
      titulo_id: titulo.legadoId,
    };
    const camposIdentidade = camposDoRegistro({ fields: campos });
    const movimento = buscar(camposIdentidade, [
      "movimento_legado_id",
      "numero_lancamento",
      "numerolancamento",
      "n_lanc",
      "lancamento_id",
    ]);
    const dataBruta = buscar(camposIdentidade, ["data_pagamento", "datapagamento", "data_baixa", "data"]);
    const valorBruto = buscar(camposIdentidade, ["valor_pago", "valor_baixa", "valor"]);
    const identidadeSemEstado = {
      data: normalizarData(dataBruta) ?? (dataBruta ? normalizarChave(dataBruta) : null),
      valor: centavos(valorBruto) ?? (valorBruto ? normalizarChave(valorBruto) : null),
      documento: (() => {
        const valor = buscar(camposIdentidade, ["numero_documento", "documento"]);
        return valor ? normalizarChave(valor) : null;
      })(),
      conta: (() => {
        const valor = buscar(camposIdentidade, ["conta_bancaria_id", "conta", "conta_id_bancaria"]);
        return valor ? normalizarChave(valor) : null;
      })(),
      forma: (() => {
        const valor = buscar(camposIdentidade, ["forma_pagamento", "forma", "tipo_pagamento"]);
        return valor ? normalizarChave(valor) : null;
      })(),
    };
    const idExplicito = texto(item.legacyId ?? item.legadoId ?? item.id);
    const chaveTitulo = sha256(titulo.legadoId).slice(0, 16);
    const fingerprint = sha256(jsonCanonico(identidadeSemEstado)).slice(0, 24);
    const ocorrencia = ocorrenciasSemId.get(fingerprint) ?? 0;
    if (!movimento && !idExplicito) ocorrenciasSemId.set(fingerprint, ocorrencia + 1);
    const chaveExterna = movimento
      ? `mov:${movimento.length <= 80 ? movimento : sha256(movimento).slice(0, 32)}`
      : idExplicito
        ? `id:${idExplicito.length <= 80 ? idExplicito : sha256(idExplicito).slice(0, 32)}`
        : `sem-id:${fingerprint}:${String(ocorrencia).padStart(5, "0")}`;
    const id = `baixa:${escopo}:${chaveTitulo}:${chaveExterna}`;
    const planejada = planejarRegistro(
      registroRelacionado(bruto, campos, escopo, id),
      escopo,
      titulo.capturadoEm,
      dataNegocio,
    ) as BaixaLegadoPlanejada;
    resultado.set(planejada.legadoId, planejada);
  });
  return [...resultado.values()];
}

function avaliarCompletudeBaixas(
  bruto: Record<string, unknown>,
  titulo: TituloLegadoPlanejado,
  baixas: BaixaLegadoPlanejada[],
): void {
  const transporteEsperado =
    titulo.escopo === "TITULO_RECEBER"
      ? "ajax.getDetalhesRecebimento"
      : "ajax.getDetalhesPagamento";
  const detalhes = Array.isArray(bruto.details) ? bruto.details : [];
  const transporteObservado = detalhes.some(
    (detalheBruto) => objeto(detalheBruto)?.transport === transporteEsperado,
  );
  const evidenciaDeclarada = objeto(bruto.baixaEvidence);
  if (evidenciaDeclarada) {
    const esperadoDeclarado = texto(evidenciaDeclarada.expectedTransport);
    const observadoDeclarado = evidenciaDeclarada.transportObserved;
    if (
      esperadoDeclarado !== transporteEsperado ||
      typeof observadoDeclarado !== "boolean" ||
      observadoDeclarado !== transporteObservado
    ) {
      adicionarMotivo(titulo, "TITULO_EVIDENCIA_BAIXAS_DIVERGENTE");
    }
  }
  const valorPagoBruto = buscar(camposDoRegistro(bruto), [
    "valor_pago",
    "valor_recebido",
  ]);
  const valorPagoExplicitamenteZero =
    valorPagoBruto !== null && centavos(valorPagoBruto) === 0;

  // Somente um zero explicitamente presente é prova negativa. Campo ausente
  // pode significar mudança do HTML ou falha de extração e jamais autoriza
  // tombstone de baixas anteriores. Para títulos pagos, o endpoint de detalhes
  // é prova imediata; `baixas: []` nunca pode, isoladamente, apagar estado.
  titulo.capturaBaixasCompleta =
    transporteObservado || valorPagoExplicitamenteZero;
  titulo.capturaBaixasProva = transporteObservado
    ? "TRANSPORTE_DETALHES"
    : valorPagoExplicitamenteZero
      ? "VALOR_PAGO_ZERO_EXPLICITO"
      : "INCOMPLETA";
  if ((titulo.valorPago ?? 0) > 0 && !transporteObservado && baixas.length === 0) {
    adicionarMotivo(titulo, "TITULO_BAIXAS_NAO_ESTRUTURADAS");
  }
  enriquecerSnapshot(titulo, {
    capturaBaixas: {
      completas: titulo.capturaBaixasCompleta,
      prova: titulo.capturaBaixasProva,
      quantidadeEstruturada: baixas.length,
      transporteEsperado,
      transporteObservado,
    },
  });
}

function avaliarCompletudePartes(
  bruto: Record<string, unknown>,
  contrato: ContratoLegadoPlanejado,
  partes: ContratoParteLegadoPlanejado[],
): void {
  const transporteEsperado = "locacao.edit";
  const detalhes = Array.isArray(bruto.details) ? bruto.details : [];
  const transporteObservado = detalhes.some(
    (detalheBruto) => objeto(detalheBruto)?.transport === transporteEsperado,
  );
  contrato.capturaPartesEstruturada = transporteObservado && partes.length > 0;
  contrato.capturaPartesProva = contrato.capturaPartesEstruturada
    ? "DETALHE_ESTRUTURADO_SEM_CONTAGEM"
    : "INCOMPLETA";
  enriquecerSnapshot(contrato, {
    capturaPartes: {
      estruturadas: contrato.capturaPartesEstruturada,
      enumeracaoCompleta: false,
      prova: contrato.capturaPartesProva,
      quantidadeEstruturada: partes.length,
      transporteEsperado,
      transporteObservado,
    },
  });
}

function reconciliarRelacionados(
  registros: RegistroOperacaoPlanejado[],
  dataNegocio: string,
  intervaloMovimentos: IntervaloMovimentos | null,
  escoposCobertos: readonly EscopoOperacaoWidesys[],
): void {
  const cobertos = new Set(escoposCobertos);
  const partesPorContrato = new Map<string, ContratoParteLegadoPlanejado[]>();
  const baixasPorTitulo = new Map<string, BaixaLegadoPlanejada[]>();
  const baixasPorMovimento = new Map<string, BaixaLegadoPlanejada[]>();
  const contratos = new Map(
    registros
      .filter((item): item is ContratoLegadoPlanejado => item.escopo === "CONTRATO")
      .map((item) => [item.legadoId, item]),
  );
  const titulos = new Map(
    registros
      .filter(
        (item): item is TituloLegadoPlanejado =>
          item.escopo === "TITULO_RECEBER" || item.escopo === "TITULO_PAGAR",
      )
      .map((item) => [`${item.escopo}\u0000${item.legadoId}`, item]),
  );
  const movimentos = new Map(
    registros
      .filter((item): item is MovimentoLegadoPlanejado => item.escopo === "MOVIMENTO")
      .map((item) => [item.legadoId, item]),
  );
  for (const registro of registros) {
    if (registro.escopo === "CONTRATO_PARTE") {
      const contrato = contratos.get(registro.contratoLegadoId);
      if (!contrato) {
        adicionarMotivo(registro, "PARTE_CONTRATO_NAO_CAPTURADO");
      } else if (contrato.statusImportacao === "QUARENTENA") {
        adicionarMotivo(registro, "PARTE_CONTRATO_QUARENTENA");
      }
      const grupo = partesPorContrato.get(registro.contratoLegadoId) ?? [];
      grupo.push(registro);
      partesPorContrato.set(registro.contratoLegadoId, grupo);
    } else if (registro.escopo === "BAIXA_RECEBER" || registro.escopo === "BAIXA_PAGAR") {
      const chave = `${registro.tituloEscopo}\u0000${registro.tituloLegadoId}`;
      const titulo = titulos.get(chave);
      if (!titulo) adicionarMotivo(registro, "BAIXA_TITULO_NAO_CAPTURADO");
      else if (titulo.statusImportacao === "QUARENTENA") adicionarMotivo(registro, "BAIXA_TITULO_QUARENTENA");
      if (registro.movimentoLegadoId) {
        const movimento = movimentos.get(registro.movimentoLegadoId);
        if (!movimento) {
          if (
            intervaloMovimentos &&
            registro.dataPagamento &&
            registro.dataPagamento >= intervaloMovimentos.inicio &&
            registro.dataPagamento <= intervaloMovimentos.fim
          ) {
            adicionarMotivo(registro, "BAIXA_MOVIMENTO_NAO_CAPTURADO");
          }
        } else {
          const grupoMovimento = baixasPorMovimento.get(registro.movimentoLegadoId) ?? [];
          grupoMovimento.push(registro);
          baixasPorMovimento.set(registro.movimentoLegadoId, grupoMovimento);
        }
      }
      const grupo = baixasPorTitulo.get(chave) ?? [];
      grupo.push(registro);
      baixasPorTitulo.set(chave, grupo);
    } else if (registro.escopo === "MOVIMENTO" && registro.tituloLegadoId) {
      const chave = `${registro.tituloEscopo ?? ""}\u0000${registro.tituloLegadoId}`;
      const titulo = titulos.get(chave);
      if (!registro.tituloEscopo) {
        adicionarMotivo(registro, "MOVIMENTO_TITULO_NAO_CAPTURADO");
      } else if (!titulo && cobertos.has(registro.tituloEscopo as EscopoOperacaoWidesys)) {
        adicionarMotivo(registro, "MOVIMENTO_TITULO_NAO_CAPTURADO");
      } else if (titulo?.statusImportacao === "QUARENTENA") {
        adicionarMotivo(registro, "MOVIMENTO_TITULO_QUARENTENA");
      }
    }
  }
  for (const [movimentoLegadoId, baixas] of baixasPorMovimento) {
    const movimento = movimentos.get(movimentoLegadoId);
    if (!movimento) continue;
    reconciliarBaixasComMovimento(baixas, movimento);
    if (movimento.statusImportacao === "QUARENTENA") {
      for (const baixa of baixas) adicionarMotivo(baixa, "BAIXA_MOVIMENTO_QUARENTENA");
    }
  }
  for (const registro of registros) {
    if (registro.escopo === "CONTRATO") {
      const partes = partesPorContrato.get(registro.legadoId) ?? [];
      if (partes.length === 0) adicionarMotivo(registro, "CONTRATO_PARTES_NAO_ESTRUTURADAS");
      enriquecerSnapshot(registro, {
        partesEstruturadas: partes.length,
        papeis: [...new Set(partes.map((parte) => parte.papel))].sort(),
      });
      continue;
    }
    if (registro.escopo !== "TITULO_RECEBER" && registro.escopo !== "TITULO_PAGAR") continue;
    const baixas = baixasPorTitulo.get(`${registro.escopo}\u0000${registro.legadoId}`) ?? [];
    const valorPagoFonte = registro.valorPago;
    const efetivas = baixas.filter(
      (baixa) =>
        !baixa.estornada &&
        baixa.statusImportacao !== "QUARENTENA" &&
        baixa.valor !== null &&
        baixa.valor > 0,
    );
    const somaEfetiva = efetivas.reduce((total, baixa) => total + (baixa.valor ?? 0), 0);
    if (
      !registro.capturaBaixasCompleta &&
      (valorPagoFonte ?? 0) > 0 &&
      baixas.length > 0 &&
      baixas.every((baixa) => baixa.statusImportacao !== "QUARENTENA") &&
      somaEfetiva === valorPagoFonte
    ) {
      registro.capturaBaixasCompleta = true;
      registro.capturaBaixasProva = "ESTRUTURADA_COHERENTE";
    }
    const valorBase = registro.valorDevido ?? registro.valorOriginal;
    if (valorBase !== null && somaEfetiva > valorBase) {
      adicionarMotivo(registro, "TITULO_BAIXAS_SUPERAM_DEVIDO");
      for (const baixa of efetivas) adicionarMotivo(baixa, "BAIXA_SOMA_SUPERA_TITULO");
    }
    if (baixas.length > 0) {
      if (registro.valorPago !== null && registro.valorPago !== somaEfetiva) {
        adicionarMotivo(registro, "TITULO_BAIXAS_DIVERGENTES");
      }
      registro.valorPago = somaEfetiva;
      if (valorBase !== null) registro.valorAberto = Math.max(valorBase - somaEfetiva, 0);
    } else if ((registro.valorPago ?? 0) > 0) {
      adicionarMotivo(registro, "TITULO_BAIXAS_NAO_ESTRUTURADAS");
    }
    registro.pagamentoParcial =
      somaEfetiva > 0 && (registro.valorAberto ?? 0) > 0 && registro.situacaoNormalizada !== "CANCELADO";
    if (
      somaEfetiva > 0 &&
      registro.valorAberto === 0 &&
      registro.situacaoNormalizada !== "CANCELADO"
    ) {
      registro.situacaoNormalizada = "PAGO";
    } else if (registro.pagamentoParcial) registro.situacaoNormalizada = "PARCIAL";
    if (
      registro.situacaoNormalizada === "PAGO" &&
      (registro.valorAberto ?? registro.valorDevido ?? registro.valorOriginal ?? 0) > 0
    ) {
      adicionarMotivo(registro, "TITULO_PAGO_COM_SALDO");
    }
    if (
      registro.situacaoNormalizada === "PAGO" &&
      baixas.length === 0 &&
      (registro.valorPago ?? 0) <= 0
    ) {
      adicionarMotivo(registro, "TITULO_PAGO_SEM_BAIXA");
    }
    if (
      ["PENDENTE", "VENCIDO"].includes(registro.situacaoNormalizada) &&
      registro.valorAberto === 0
    ) {
      adicionarMotivo(registro, "TITULO_ABERTO_SEM_SALDO");
    }
    const vencido = Boolean(registro.vencimento && registro.vencimento < dataNegocio);
    registro.inadimplente =
      vencido &&
      !["PAGO", "CANCELADO"].includes(registro.situacaoNormalizada) &&
      (registro.valorAberto ?? registro.valorDevido ?? registro.valorOriginal ?? 0) > 0;
    enriquecerSnapshot(registro, {
      capturaBaixas: {
        completas: registro.capturaBaixasCompleta,
        prova: registro.capturaBaixasProva,
        quantidadeEstruturada: baixas.length,
        transporteEsperado:
          registro.escopo === "TITULO_RECEBER"
            ? "ajax.getDetalhesRecebimento"
            : "ajax.getDetalhesPagamento",
        transporteObservado:
          registro.capturaBaixasProva === "TRANSPORTE_DETALHES",
      },
      baixasCapturadas: baixas.length,
      baixasEfetivas: efetivas.length,
      dataNegocio,
      inadimplente: registro.inadimplente,
      somaBaixasEfetivas: somaEfetiva,
      saldoAbertoCalculado: registro.valorAberto,
      situacaoNormalizada: registro.situacaoNormalizada,
    });
  }

  // A consistência do filho nunca pode superar a do pai. Alguns motivos do
  // pai só são descobertos durante a reconciliação (por exemplo, overpayment),
  // por isso esta propagação final é deliberadamente posterior aos cálculos.
  for (const registro of registros) {
    if (registro.escopo === "CONTRATO") {
      if (registro.statusImportacao === "QUARENTENA") {
        for (const parte of partesPorContrato.get(registro.legadoId) ?? []) {
          adicionarMotivo(parte, "PARTE_CONTRATO_QUARENTENA");
        }
      }
    } else if (
      (registro.escopo === "TITULO_RECEBER" || registro.escopo === "TITULO_PAGAR") &&
      registro.statusImportacao === "QUARENTENA"
    ) {
      for (const baixa of baixasPorTitulo.get(`${registro.escopo}\u0000${registro.legadoId}`) ?? []) {
        adicionarMotivo(baixa, "BAIXA_TITULO_QUARENTENA");
      }
    } else if (registro.escopo === "MOVIMENTO" && registro.tituloEscopo && registro.tituloLegadoId) {
      const titulo = titulos.get(`${registro.tituloEscopo}\u0000${registro.tituloLegadoId}`);
      if (titulo?.statusImportacao === "QUARENTENA") {
        adicionarMotivo(registro, "MOVIMENTO_TITULO_QUARENTENA");
      }
    }
  }
}

function registrosNoArquivo(valor: unknown): Record<string, unknown>[] {
  if (Array.isArray(valor)) {
    return valor.map(objeto).filter((item): item is Record<string, unknown> => Boolean(item));
  }
  const raiz = objeto(valor);
  if (!raiz) return [];
  const lista = raiz.records ?? raiz.registros ?? raiz.items;
  if (Array.isArray(lista)) {
    return lista.map(objeto).filter((item): item is Record<string, unknown> => Boolean(item));
  }
  return [raiz];
}

function reconciliacaoVazia(): Record<EscopoOperacaoWidesys, ReconciliacaoEscopo> {
  const vazio = (): ReconciliacaoEscopo => ({
    quantidade: 0,
    quarentena: 0,
    somaFonte: 0,
    somaAceita: 0,
    somaQuarentena: 0,
    somaValorOriginal: 0,
    somaValorDevido: 0,
    somaValorAberto: 0,
    somaValorPago: 0,
    somaMovimentos: 0,
    somaBaixas: 0,
  });
  return {
    CONTRATO: vazio(),
    CONTRATO_PARTE: vazio(),
    TITULO_RECEBER: vazio(),
    TITULO_PAGAR: vazio(),
    BAIXA_RECEBER: vazio(),
    BAIXA_PAGAR: vazio(),
    MOVIMENTO: vazio(),
  };
}

function valorFonteParaReconciliacao(registro: RegistroOperacaoPlanejado): number {
  if (registro.escopo === "TITULO_RECEBER" || registro.escopo === "TITULO_PAGAR") {
    return registro.valorDevido ?? registro.valorOriginal ?? registro.valorAberto ?? registro.valorPago ?? 0;
  }
  if (
    registro.escopo === "MOVIMENTO" ||
    registro.escopo === "BAIXA_RECEBER" ||
    registro.escopo === "BAIXA_PAGAR"
  ) {
    return registro.valor ?? 0;
  }
  return 0;
}

function reconciliar(registros: RegistroOperacaoPlanejado[]) {
  const resultado = reconciliacaoVazia();
  for (const registro of registros) {
    const linha = resultado[registro.escopo];
    linha.quantidade += 1;
    const valorFonte = valorFonteParaReconciliacao(registro);
    linha.somaFonte += valorFonte;
    if (registro.statusImportacao === "QUARENTENA") {
      linha.quarentena += 1;
      linha.somaQuarentena += valorFonte;
    } else linha.somaAceita += valorFonte;
    if (registro.escopo === "TITULO_RECEBER" || registro.escopo === "TITULO_PAGAR") {
      linha.somaValorOriginal += registro.valorOriginal ?? 0;
      linha.somaValorDevido += registro.valorDevido ?? 0;
      linha.somaValorAberto += registro.valorAberto ?? 0;
      linha.somaValorPago += registro.valorPago ?? 0;
    } else if (registro.escopo === "MOVIMENTO") linha.somaMovimentos += registro.valor ?? 0;
    else if (registro.escopo === "BAIXA_RECEBER" || registro.escopo === "BAIXA_PAGAR") {
      if (!registro.estornada) linha.somaBaixas += registro.valor ?? 0;
    }
  }
  return resultado;
}

export function carregarPlanoOperacaoWidesys(
  diretorioInformado = resolve(process.cwd(), "data", "legacy-widesys", "operacao"),
): PlanoOperacaoWidesys {
  const diretorio = realpathSync(resolve(diretorioInformado));
  const manifestoPath = resolve(diretorio, "manifest.json");
  const manifestoRaw = readFileSync(manifestoPath, "utf8");
  const manifesto = objeto(JSON.parse(manifestoRaw));
  if (!manifesto) falhar("WIDESYS_OPERACAO_MANIFESTO_INVALIDO", "Manifesto inválido.");
  origemDoManifesto(manifesto);
  if (!capturaCompleta(manifesto)) {
    falhar("WIDESYS_OPERACAO_CAPTURA_INCOMPLETA", "A captura não foi marcada como concluída.");
  }
  const descritores = descritoresDoManifesto(manifesto);
  if (descritores.length === 0) {
    falhar("WIDESYS_OPERACAO_SEM_ARTEFATOS", "Nenhum artefato operacional foi encontrado.");
  }
  const modulosCobertos = validarManifestoAtual(manifesto, descritores);
  validarArtefatosFisicos(diretorio, manifesto);

  const iniciadoEm = dataIso(manifesto.startedAt, "WIDESYS_OPERACAO_DATA_INVALIDA");
  const concluidoEm = dataIso(manifesto.completedAt, "WIDESYS_OPERACAO_DATA_INVALIDA");
  const capturadoEm = dataIso(
    manifesto.capturedAt,
    "WIDESYS_OPERACAO_DATA_INVALIDA",
  );
  const dataNegocio = dataNegocioDoManifesto(manifesto, capturadoEm);
  const registros: RegistroOperacaoPlanejado[] = [];
  for (const descritor of descritores) {
    const caminho = caminhoSeguro(diretorio, descritor.caminho);
    const estatistica = statSync(caminho);
    if (!estatistica.isFile() || estatistica.size > TAMANHO_MAXIMO_ARQUIVO) {
      falhar("WIDESYS_OPERACAO_ARQUIVO_INVALIDO", "Artefato ausente, inválido ou grande demais.");
    }
    if (descritor.bytes !== null && descritor.bytes !== estatistica.size) {
      falhar("WIDESYS_OPERACAO_BYTES_DIVERGENTES", "O tamanho de um artefato diverge do manifesto.");
    }
    const conteudo = readFileSync(caminho);
    if (sha256(conteudo) !== descritor.sha256) {
      falhar("WIDESYS_OPERACAO_ARQUIVO_HASH_DIVERGENTE", "O hash de um artefato diverge do manifesto.");
    }
    const artefato = JSON.parse(conteudo.toString("utf8"));
    const raizArtefato = objeto(artefato);
    if (!raizArtefato || raizArtefato.complete !== true) {
      falhar("WIDESYS_OPERACAO_ARQUIVO_INCOMPLETO", "Um shard não foi marcado como completo.");
    }
    if (escopoDe(raizArtefato.scope) !== descritor.escopo) {
      falhar("WIDESYS_OPERACAO_ESCOPO_DIVERGENTE", "O escopo interno de um shard diverge do manifesto.");
    }
    if (texto(raizArtefato.businessDate) !== dataNegocio || texto(raizArtefato.timeZone) !== FUSO_NEGOCIO) {
      falhar(
        "WIDESYS_OPERACAO_DATA_NEGOCIO_INVALIDA",
        "Um shard diverge da data ou do fuso de negócio do manifesto.",
      );
    }
    const capturadoEmArtefato = dataIso(
      raizArtefato.capturedAt,
      "WIDESYS_OPERACAO_DATA_REGISTRO_INVALIDA",
    );
    if (capturadoEmArtefato < iniciadoEm || capturadoEmArtefato > concluidoEm) {
      falhar(
        "WIDESYS_OPERACAO_DATA_REGISTRO_FORA_DA_CAPTURA",
        "Um shard foi produzido fora da janela temporal do manifesto.",
      );
    }
    const brutos = registrosNoArquivo(artefato);
    if (descritor.quantidade !== null && descritor.quantidade !== brutos.length) {
      falhar("WIDESYS_OPERACAO_CONTAGEM_DIVERGENTE", "A contagem de um artefato diverge do manifesto.");
    }
    for (const bruto of brutos) {
      const planejado = planejarRegistro(bruto, descritor.escopo, capturadoEm, dataNegocio);
      registros.push(planejado);
      if (planejado.escopo === "CONTRATO") {
        const partes = partesAninhadas(bruto, planejado, dataNegocio);
        avaliarCompletudePartes(bruto, planejado, partes);
        registros.push(...partes);
      } else if (
        planejado.escopo === "TITULO_RECEBER" ||
        planejado.escopo === "TITULO_PAGAR"
      ) {
        const baixas = baixasAninhadas(bruto, planejado, dataNegocio);
        avaliarCompletudeBaixas(bruto, planejado, baixas);
        registros.push(...baixas);
      }
    }
  }

  for (const registro of registros) {
    if (registro.capturadoEm < iniciadoEm || registro.capturadoEm > concluidoEm) {
      falhar(
        "WIDESYS_OPERACAO_DATA_REGISTRO_FORA_DA_CAPTURA",
        "Um registro informa capturedAt/fetchedAt fora da janela do manifesto.",
      );
    }
  }

  const escoposCobertos = modulosCobertos.flatMap((modulo) => [
    ...ESCOPOS_COBERTOS_POR_MODULO[modulo],
  ]);
  const coberturaTemporal = coberturaTemporalDoManifesto(manifesto, dataNegocio);
  reconciliarRelacionados(
    registros,
    dataNegocio,
    intervaloMovimentosDoManifesto(manifesto, dataNegocio),
    escoposCobertos,
  );

  const identidades = new Set<string>();
  for (const registro of registros) {
    const identidade = `${registro.escopo}\u0000${registro.legadoId}`;
    if (identidades.has(identidade)) {
      falhar("WIDESYS_OPERACAO_ID_DUPLICADO", "A captura repete uma identidade no mesmo escopo.");
    }
    identidades.add(identidade);
  }
  const ordemEscopo: Record<EscopoOperacaoWidesys, number> = {
    CONTRATO: 0,
    CONTRATO_PARTE: 1,
    TITULO_RECEBER: 2,
    TITULO_PAGAR: 3,
    BAIXA_RECEBER: 4,
    BAIXA_PAGAR: 5,
    MOVIMENTO: 6,
  };
  registros.sort(
    (a, b) => ordemEscopo[a.escopo] - ordemEscopo[b.escopo] || a.legadoId.localeCompare(b.legadoId),
  );
  const manifestoHash = assertHash(manifesto.contentHash);
  const capturaId =
    texto(manifesto.captureId ?? manifesto.capturaId ?? manifesto.contentHash) ?? manifestoHash;
  const esquemaVersao = 2;
  const todosEscopos: EscopoOperacaoWidesys[] = [
    "CONTRATO",
    "CONTRATO_PARTE",
    "TITULO_RECEBER",
    "TITULO_PAGAR",
    "BAIXA_RECEBER",
    "BAIXA_PAGAR",
    "MOVIMENTO",
  ];
  const presentes = new Set(registros.map((registro) => registro.escopo));
  const escoposBaixasCompletos = [
    ["TITULO_RECEBER", "BAIXA_RECEBER"],
    ["TITULO_PAGAR", "BAIXA_PAGAR"],
  ].flatMap(([escopoTitulo, escopoBaixa]) => {
    if (!escoposCobertos.includes(escopoTitulo as EscopoOperacaoWidesys)) return [];
    const titulosDoEscopo = registros.filter(
      (registro): registro is TituloLegadoPlanejado =>
        registro.escopo === escopoTitulo,
    );
    const motivosQueInvalidamCompletude = new Set([
      "TITULO_BAIXAS_DIVERGENTES",
      "TITULO_BAIXAS_NAO_ESTRUTURADAS",
      "TITULO_EVIDENCIA_BAIXAS_DIVERGENTE",
    ]);
    return titulosDoEscopo.every(
      (titulo) =>
        titulo.capturaBaixasCompleta &&
        !(titulo.quarentenaMotivo ?? "")
          .split(";")
          .some((motivo) => motivosQueInvalidamCompletude.has(motivo)),
    )
      ? [escopoBaixa as "BAIXA_RECEBER" | "BAIXA_PAGAR"]
      : [];
  });
  // A página de contrato não fornece uma contagem autoritativa de vínculos.
  // Mesmo quando extraímos participantes estruturados, não há como provar que
  // todos foram enumerados; por isso partes nunca recebem tombstone automático.
  const escoposPartesCompletos: Array<"CONTRATO_PARTE"> = [];
  return {
    origem: ORIGEM_OPERACAO_WIDESYS,
    capturaId,
    esquemaVersao,
    manifestoHash,
    capturadoEm,
    dataNegocio,
    escoposCobertos,
    coberturaTemporal,
    registros,
    politicaReconciliacao: POLITICA_RECONCILIACAO_BAIXA_MOVIMENTO,
    reconciliacao: reconciliar(registros),
    escoposAusentes: todosEscopos.filter(
      (escopo) => escoposCobertos.includes(escopo) && !presentes.has(escopo),
    ),
    escoposPartesCompletos,
    escoposBaixasCompletos,
  };
}

type Contadores = {
  criados: number;
  atualizados: number;
  inalterados: number;
  anterioresIgnorados: number;
  ausentesMarcados: number;
  quarentena: number;
};

export type RelatorioImportacaoOperacaoWidesys = {
  modo: "DRY_RUN" | "APLICADO" | "JA_APLICADO";
  capturaId: string;
  escoposCobertos: EscopoOperacaoWidesys[];
  coberturaTemporal: PlanoOperacaoWidesys["coberturaTemporal"];
  total: number;
  processados: number;
  porEscopo: Record<EscopoOperacaoWidesys, Contadores>;
  politicaReconciliacao: typeof POLITICA_RECONCILIACAO_BAIXA_MOVIMENTO;
  reconciliacao: Record<EscopoOperacaoWidesys, ReconciliacaoEscopo>;
  escoposAusentes: EscopoOperacaoWidesys[];
  escoposPartesCompletos: Array<"CONTRATO_PARTE">;
  escoposBaixasCompletos: Array<"BAIXA_RECEBER" | "BAIXA_PAGAR">;
};

function contadoresVazios(): Record<EscopoOperacaoWidesys, Contadores> {
  const vazio = (): Contadores => ({
    criados: 0,
    atualizados: 0,
    inalterados: 0,
    anterioresIgnorados: 0,
    ausentesMarcados: 0,
    quarentena: 0,
  });
  return {
    CONTRATO: vazio(),
    CONTRATO_PARTE: vazio(),
    TITULO_RECEBER: vazio(),
    TITULO_PAGAR: vazio(),
    BAIXA_RECEBER: vazio(),
    BAIXA_PAGAR: vazio(),
    MOVIMENTO: vazio(),
  };
}

export function criarRelatorioDryRunOperacaoWidesys(
  plano: PlanoOperacaoWidesys,
): RelatorioImportacaoOperacaoWidesys {
  const porEscopo = contadoresVazios();
  for (const registro of plano.registros) {
    if (registro.statusImportacao === "QUARENTENA") {
      porEscopo[registro.escopo].quarentena += 1;
    } else porEscopo[registro.escopo].criados += 1;
  }
  return {
    modo: "DRY_RUN",
    capturaId: plano.capturaId,
    escoposCobertos: plano.escoposCobertos,
    coberturaTemporal: plano.coberturaTemporal,
    total: plano.registros.length,
    processados: 0,
    porEscopo,
    politicaReconciliacao: plano.politicaReconciliacao,
    reconciliacao: plano.reconciliacao,
    escoposAusentes: plano.escoposAusentes,
    escoposPartesCompletos: plano.escoposPartesCompletos,
    escoposBaixasCompletos: plano.escoposBaixasCompletos,
  };
}

/**
 * Complementa o relatório puro com a fotografia atual do staging. Esta
 * variante é deliberadamente somente leitura e permite que o CLI mostre os
 * tombstones antes da aplicação real.
 */
export async function criarRelatorioDryRunComBancoOperacaoWidesys(
  prisma: PrismaClient,
  plano: PlanoOperacaoWidesys,
): Promise<RelatorioImportacaoOperacaoWidesys> {
  const relatorio = criarRelatorioDryRunOperacaoWidesys(plano);
  type ExistenteDryRun = {
    capturadoEm: Date;
    legadoId: string;
    quarentenaMotivo: string | null;
    snapshotHash: string;
    statusImportacao: string;
    ultimoItem?: ReferenciaUltimoItem;
  };
  const selecionar = {
    capturadoEm: true,
    legadoId: true,
    quarentenaMotivo: true,
    snapshotHash: true,
    statusImportacao: true,
    ultimoItem: { select: { lote: { select: { capturadoEm: true } } } },
  } as const;
  const [contratos, partes, titulos, baixas, movimentos] = await Promise.all([
    prisma.contratoLegado.findMany({
      where: { origem: ORIGEM_OPERACAO_WIDESYS },
      select: selecionar,
    }),
    prisma.contratoParteLegado.findMany({
      where: { origem: ORIGEM_OPERACAO_WIDESYS },
      select: selecionar,
    }),
    prisma.tituloFinanceiroLegado.findMany({
      where: { origem: ORIGEM_OPERACAO_WIDESYS },
      select: { ...selecionar, escopo: true },
    }),
    prisma.baixaFinanceiraLegado.findMany({
      where: { origem: ORIGEM_OPERACAO_WIDESYS },
      select: { ...selecionar, escopo: true },
    }),
    prisma.movimentoFinanceiroLegado.findMany({
      where: { origem: ORIGEM_OPERACAO_WIDESYS },
      select: selecionar,
    }),
  ]);
  const existentes = new Map<string, ExistenteDryRun>();
  for (const item of contratos) existentes.set(`CONTRATO\u0000${item.legadoId}`, item);
  for (const item of partes) existentes.set(`CONTRATO_PARTE\u0000${item.legadoId}`, item);
  for (const item of titulos) existentes.set(`${item.escopo}\u0000${item.legadoId}`, item);
  for (const item of baixas) existentes.set(`${item.escopo}\u0000${item.legadoId}`, item);
  for (const item of movimentos) existentes.set(`MOVIMENTO\u0000${item.legadoId}`, item);

  relatorio.porEscopo = contadoresVazios();
  for (const registro of plano.registros) {
    const linha = relatorio.porEscopo[registro.escopo];
    const existente = existentes.get(`${registro.escopo}\u0000${registro.legadoId}`);
    if (existente && decisaoCanonicaEm(existente) > plano.capturadoEm) {
      linha.anterioresIgnorados += 1;
    } else if (registro.statusImportacao === "QUARENTENA") {
      linha.quarentena += 1;
    } else if (!existente) {
      linha.criados += 1;
    } else if (
      existente.snapshotHash === registro.snapshotHash &&
      existente.statusImportacao === registro.statusImportacao &&
      existente.quarentenaMotivo === registro.quarentenaMotivo
    ) {
      linha.inalterados += 1;
    } else linha.atualizados += 1;
  }
  const ausentes = await marcarAusentesDaFonte(
    prisma as unknown as Prisma.TransactionClient,
    plano,
    null,
  );
  for (const escopo of Object.keys(ausentes) as EscopoOperacaoWidesys[]) {
    relatorio.porEscopo[escopo].ausentesMarcados = ausentes[escopo];
  }
  return relatorio;
}

function resumoLote(
  plano: PlanoOperacaoWidesys,
  processados: number,
  porEscopo: Record<EscopoOperacaoWidesys, Contadores>,
): string {
  return jsonCanonico({
    processados,
    escoposCobertos: plano.escoposCobertos,
    coberturaTemporal: plano.coberturaTemporal,
    porEscopo,
    politicaReconciliacao: plano.politicaReconciliacao,
    reconciliacao: plano.reconciliacao,
    escoposPartesCompletos: plano.escoposPartesCompletos,
    escoposBaixasCompletos: plano.escoposBaixasCompletos,
  });
}

type ReferenciaUltimoItem = {
  lote?: { capturadoEm: Date; id?: string } | null;
} | null;

function decisaoCanonicaEm(
  registro: {
    capturadoEm: Date;
    ultimoItem?: ReferenciaUltimoItem;
  },
  ignorarLoteId?: string,
): Date {
  if (ignorarLoteId && registro.ultimoItem?.lote?.id === ignorarLoteId) {
    return registro.capturadoEm;
  }
  const decisao = registro.ultimoItem?.lote?.capturadoEm;
  return decisao && decisao > registro.capturadoEm ? decisao : registro.capturadoEm;
}

async function herdarQuarentenaDoPaiCanonico(
  tx: Prisma.TransactionClient,
  registro: RegistroOperacaoPlanejado,
  loteId: string,
  decisaoCapturaEm: Date,
): Promise<boolean> {
  if (registro.escopo === "CONTRATO_PARTE") {
    const contrato = await tx.contratoLegado.findUnique({
      where: {
        origem_legadoId: {
          origem: ORIGEM_OPERACAO_WIDESYS,
          legadoId: registro.contratoLegadoId,
        },
      },
      select: {
        capturadoEm: true,
        statusImportacao: true,
        ultimoItem: { select: { lote: { select: { id: true, capturadoEm: true } } } },
      },
    });
    if (contrato && decisaoCanonicaEm(contrato, loteId) > decisaoCapturaEm) return true;
    if (!contrato) adicionarMotivo(registro, "PARTE_CONTRATO_NAO_CAPTURADO");
    else if (["AUSENTE_NA_FONTE", "QUARENTENA"].includes(contrato.statusImportacao)) {
      adicionarMotivo(registro, "PARTE_CONTRATO_QUARENTENA");
    }
    return false;
  }
  if (registro.escopo === "BAIXA_RECEBER" || registro.escopo === "BAIXA_PAGAR") {
    const titulo = await tx.tituloFinanceiroLegado.findUnique({
      where: {
        origem_escopo_legadoId: {
          origem: ORIGEM_OPERACAO_WIDESYS,
          escopo: registro.tituloEscopo,
          legadoId: registro.tituloLegadoId,
        },
      },
      select: {
        capturadoEm: true,
        statusImportacao: true,
        ultimoItem: { select: { lote: { select: { id: true, capturadoEm: true } } } },
      },
    });
    if (titulo && decisaoCanonicaEm(titulo, loteId) > decisaoCapturaEm) return true;
    if (!titulo) adicionarMotivo(registro, "BAIXA_TITULO_NAO_CAPTURADO");
    else if (["AUSENTE_NA_FONTE", "QUARENTENA"].includes(titulo.statusImportacao)) {
      adicionarMotivo(registro, "BAIXA_TITULO_QUARENTENA");
    }
    return false;
  }
  if (registro.escopo === "MOVIMENTO" && registro.tituloEscopo && registro.tituloLegadoId) {
    const titulo = await tx.tituloFinanceiroLegado.findUnique({
      where: {
        origem_escopo_legadoId: {
          origem: ORIGEM_OPERACAO_WIDESYS,
          escopo: registro.tituloEscopo,
          legadoId: registro.tituloLegadoId,
        },
      },
      select: { statusImportacao: true },
    });
    if (!titulo) adicionarMotivo(registro, "MOVIMENTO_TITULO_NAO_CAPTURADO");
    else if (["AUSENTE_NA_FONTE", "QUARENTENA"].includes(titulo.statusImportacao)) {
      adicionarMotivo(registro, "MOVIMENTO_TITULO_QUARENTENA");
    }
  }
  return false;
}

async function persistirRegistro(
  tx: Prisma.TransactionClient,
  registro: RegistroOperacaoPlanejado,
  loteId: string,
  decisaoCapturaEm: Date,
): Promise<"CRIAR" | "ATUALIZAR" | "INALTERADO" | "ANTERIOR_IGNORADO" | "QUARENTENA"> {
  const paiCanonicoMaisNovo = await herdarQuarentenaDoPaiCanonico(
    tx,
    registro,
    loteId,
    decisaoCapturaEm,
  );
  let existente: {
    capturadoEm: Date;
    quarentenaMotivo: string | null;
    snapshotHash: string;
    statusImportacao: string;
    ultimoItem?: ReferenciaUltimoItem;
  } | null = null;
  if (registro.escopo === "CONTRATO") {
    existente = await tx.contratoLegado.findUnique({
      where: { origem_legadoId: { origem: ORIGEM_OPERACAO_WIDESYS, legadoId: registro.legadoId } },
      select: {
        capturadoEm: true,
        quarentenaMotivo: true,
        snapshotHash: true,
        statusImportacao: true,
        ultimoItem: { select: { lote: { select: { id: true, capturadoEm: true } } } },
      },
    });
  } else if (registro.escopo === "CONTRATO_PARTE") {
    existente = await tx.contratoParteLegado.findUnique({
      where: { origem_legadoId: { origem: ORIGEM_OPERACAO_WIDESYS, legadoId: registro.legadoId } },
      select: {
        capturadoEm: true,
        quarentenaMotivo: true,
        snapshotHash: true,
        statusImportacao: true,
        ultimoItem: { select: { lote: { select: { id: true, capturadoEm: true } } } },
      },
    });
  } else if (registro.escopo === "TITULO_RECEBER" || registro.escopo === "TITULO_PAGAR") {
    existente = await tx.tituloFinanceiroLegado.findUnique({
      where: {
        origem_escopo_legadoId: {
          origem: ORIGEM_OPERACAO_WIDESYS,
          escopo: registro.escopo,
          legadoId: registro.legadoId,
        },
      },
      select: {
        capturadoEm: true,
        quarentenaMotivo: true,
        snapshotHash: true,
        statusImportacao: true,
        ultimoItem: { select: { lote: { select: { id: true, capturadoEm: true } } } },
      },
    });
  } else if (registro.escopo === "BAIXA_RECEBER" || registro.escopo === "BAIXA_PAGAR") {
    existente = await tx.baixaFinanceiraLegado.findUnique({
      where: {
        origem_escopo_legadoId: {
          origem: ORIGEM_OPERACAO_WIDESYS,
          escopo: registro.escopo,
          legadoId: registro.legadoId,
        },
      },
      select: {
        capturadoEm: true,
        quarentenaMotivo: true,
        snapshotHash: true,
        statusImportacao: true,
        ultimoItem: { select: { lote: { select: { id: true, capturadoEm: true } } } },
      },
    });
  } else if (registro.escopo === "MOVIMENTO") {
    existente = await tx.movimentoFinanceiroLegado.findUnique({
      where: {
        origem_escopo_legadoId: {
          origem: ORIGEM_OPERACAO_WIDESYS,
          escopo: registro.escopo,
          legadoId: registro.legadoId,
        },
      },
      select: {
        capturadoEm: true,
        quarentenaMotivo: true,
        snapshotHash: true,
        statusImportacao: true,
        ultimoItem: { select: { lote: { select: { id: true, capturadoEm: true } } } },
      },
    });
  } else return falhar("WIDESYS_OPERACAO_ESCOPO_INVALIDO", "Escopo não persistível.");
  const anterior =
    paiCanonicoMaisNovo ||
    Boolean(existente && decisaoCanonicaEm(existente, loteId) > decisaoCapturaEm);
  const semanticamenteIgual = Boolean(
    existente &&
      existente.snapshotHash === registro.snapshotHash &&
      existente.statusImportacao === registro.statusImportacao &&
      existente.quarentenaMotivo === registro.quarentenaMotivo,
  );
  const acao =
    anterior
      ? "ANTERIOR_IGNORADO"
      : registro.statusImportacao === "QUARENTENA"
      ? "QUARENTENA"
      : existente === null
        ? "CRIAR"
        : semanticamenteIgual
          ? "INALTERADO"
          : "ATUALIZAR";
  const itemEmQuarentena = acao === "QUARENTENA";
  const item = await tx.importacaoLegadoItem.upsert({
    where: { loteId_escopo_legadoId: { loteId, escopo: registro.escopo, legadoId: registro.legadoId } },
    create: {
      loteId,
      origem: ORIGEM_OPERACAO_WIDESYS,
      escopo: registro.escopo,
      legadoId: registro.legadoId,
      snapshotHash: registro.snapshotHash,
      acao,
      status: itemEmQuarentena ? "QUARENTENA" : "CONCLUIDO",
      quarentenaMotivo: itemEmQuarentena ? registro.quarentenaMotivo : null,
    },
    update: {
      snapshotHash: registro.snapshotHash,
      acao,
      status: itemEmQuarentena ? "QUARENTENA" : "CONCLUIDO",
      quarentenaMotivo: itemEmQuarentena ? registro.quarentenaMotivo : null,
      processadoEm: new Date(),
    },
    select: { id: true },
  });
  if (anterior) return acao;
  const comum = {
    ultimoItemId: item.id,
    statusImportacao: registro.statusImportacao,
    quarentenaMotivo: registro.quarentenaMotivo,
    sourceUrl: registro.sourceUrl,
    capturadoEm: registro.capturadoEm,
    snapshot: registro.snapshot,
    snapshotHash: registro.snapshotHash,
  };

  if (registro.escopo === "CONTRATO") {
    const dados = {
      ...comum,
      numeroContrato: registro.numeroContrato,
      imovelLegadoId: registro.imovelLegadoId,
      situacaoOrigem: registro.situacaoOrigem,
      inicio: registro.inicio,
      fim: registro.fim,
      primeiroVencimento: registro.primeiroVencimento,
      proximoReajuste: registro.proximoReajuste,
      valorLocacao: registro.valorLocacao,
      valorAdministracao: registro.valorAdministracao,
      valorCaucao: registro.valorCaucao,
    };
    await tx.contratoLegado.upsert({
      where: { origem_legadoId: { origem: ORIGEM_OPERACAO_WIDESYS, legadoId: registro.legadoId } },
      create: { origem: ORIGEM_OPERACAO_WIDESYS, legadoId: registro.legadoId, ...dados },
      update: dados,
    });
  } else if (registro.escopo === "CONTRATO_PARTE") {
    const contrato = await tx.contratoLegado.findUnique({
      where: {
        origem_legadoId: {
          origem: ORIGEM_OPERACAO_WIDESYS,
          legadoId: registro.contratoLegadoId,
        },
      },
      select: { id: true, statusImportacao: true },
    });
    const dados = {
      ultimoItemId: item.id,
      contratoId: contrato?.id ?? null,
      contratoLegadoId: registro.contratoLegadoId,
      papel: registro.papel,
      pessoaLegadoId: registro.pessoaLegadoId,
      ordem: registro.ordem,
      percentual: registro.percentual,
      valor: registro.valor,
      statusImportacao:
        contrato && contrato.statusImportacao !== "QUARENTENA" ? registro.statusImportacao : "QUARENTENA",
      quarentenaMotivo:
        registro.quarentenaMotivo ??
        (contrato?.statusImportacao === "QUARENTENA"
          ? "PARTE_CONTRATO_QUARENTENA"
          : contrato
            ? null
            : "PARTE_CONTRATO_NAO_CAPTURADO"),
      capturadoEm: registro.capturadoEm,
      snapshot: registro.snapshot,
      snapshotHash: registro.snapshotHash,
    };
    await tx.contratoParteLegado.upsert({
      where: { origem_legadoId: { origem: ORIGEM_OPERACAO_WIDESYS, legadoId: registro.legadoId } },
      create: { origem: ORIGEM_OPERACAO_WIDESYS, legadoId: registro.legadoId, ...dados },
      update: dados,
    });
  } else if (registro.escopo === "TITULO_RECEBER" || registro.escopo === "TITULO_PAGAR") {
    const dados = {
      ...comum,
      natureza: registro.natureza,
      numeroDocumento: registro.numeroDocumento,
      parcela: registro.parcela,
      contratoLegadoId: registro.contratoLegadoId,
      pessoaLegadoId: registro.pessoaLegadoId,
      contrapartePapelOrigem: registro.contrapartePapelOrigem,
      contaBancariaLegadoId: registro.contaBancariaLegadoId,
      contaBancariaRotulo: registro.contaBancariaRotulo,
      planoContaLegadoId: registro.planoContaLegadoId,
      planoContaRotulo: registro.planoContaRotulo,
      tipoCobrancaLegadoId: registro.tipoCobrancaLegadoId,
      tipoCobrancaRotulo: registro.tipoCobrancaRotulo,
      emissao: registro.emissao,
      competencia: registro.competencia,
      vencimento: registro.vencimento,
      pagamento: registro.pagamento,
      valorOriginal: registro.valorOriginal,
      valorDevido: registro.valorDevido,
      valorAberto: registro.valorAberto,
      valorPago: registro.valorPago,
      juros: registro.juros,
      multa: registro.multa,
      desconto: registro.desconto,
      situacaoOrigem: registro.situacaoOrigem,
      situacaoNormalizada: registro.situacaoNormalizada,
      pagamentoParcial: registro.pagamentoParcial,
      inadimplente: registro.inadimplente,
    };
    await tx.tituloFinanceiroLegado.upsert({
      where: {
        origem_escopo_legadoId: {
          origem: ORIGEM_OPERACAO_WIDESYS,
          escopo: registro.escopo,
          legadoId: registro.legadoId,
        },
      },
      create: {
        origem: ORIGEM_OPERACAO_WIDESYS,
        escopo: registro.escopo,
        legadoId: registro.legadoId,
        ...dados,
      },
      update: dados,
    });
  } else if (registro.escopo === "BAIXA_RECEBER" || registro.escopo === "BAIXA_PAGAR") {
    const dados = {
      ...comum,
      natureza: registro.natureza,
      tituloEscopo: registro.tituloEscopo,
      tituloLegadoId: registro.tituloLegadoId,
      movimentoLegadoId: registro.movimentoLegadoId,
      contaBancariaLegadoId: registro.contaBancariaLegadoId,
      contaBancariaRotulo: registro.contaBancariaRotulo,
      numeroDocumento: registro.numeroDocumento,
      forma: registro.forma,
      dataPagamento: registro.dataPagamento,
      valor: registro.valor,
      responsavelOrigem: registro.responsavelOrigem,
      origemRegistradoEm: registro.origemRegistradoEm,
      situacaoOrigem: registro.situacaoOrigem,
      estornada: registro.estornada,
    };
    await tx.baixaFinanceiraLegado.upsert({
      where: {
        origem_escopo_legadoId: {
          origem: ORIGEM_OPERACAO_WIDESYS,
          escopo: registro.escopo,
          legadoId: registro.legadoId,
        },
      },
      create: {
        origem: ORIGEM_OPERACAO_WIDESYS,
        escopo: registro.escopo,
        legadoId: registro.legadoId,
        ...dados,
      },
      update: dados,
    });
  } else if (registro.escopo === "MOVIMENTO") {
    const dados = {
      ...comum,
      natureza: registro.natureza,
      tituloEscopo: registro.tituloEscopo,
      tituloLegadoId: registro.tituloLegadoId,
      contaBancariaLegadoId: registro.contaBancariaLegadoId,
      contaBancariaRotulo: registro.contaBancariaRotulo,
      planoContaLegadoId: registro.planoContaLegadoId,
      planoContaRotulo: registro.planoContaRotulo,
      documento: registro.documento,
      descricao: registro.descricao,
      dataMovimento: registro.dataMovimento,
      competencia: registro.competencia,
      valor: registro.valor,
      conciliado: registro.conciliado,
      situacaoOrigem: registro.situacaoOrigem,
    };
    await tx.movimentoFinanceiroLegado.upsert({
      where: {
        origem_escopo_legadoId: {
          origem: ORIGEM_OPERACAO_WIDESYS,
          escopo: registro.escopo,
          legadoId: registro.legadoId,
        },
      },
      create: {
        origem: ORIGEM_OPERACAO_WIDESYS,
        escopo: registro.escopo,
        legadoId: registro.legadoId,
        ...dados,
      },
      update: dados,
    });
  } else return falhar("WIDESYS_OPERACAO_ESCOPO_INVALIDO", "Escopo não persistível.");
  return acao;
}

type CanonicoParaTombstone = {
  capturadoEm: Date;
  legadoId: string;
  snapshotHash: string;
  statusImportacao: string;
  ultimoItem?: ReferenciaUltimoItem;
};

function dentroDaCobertura(data: string | null, intervalo?: IntervaloTemporal): boolean {
  return Boolean(data && intervalo && data >= intervalo.inicio && data <= intervalo.fim);
}

/**
 * Uma captura completa é também uma fotografia de presença. Registros que
 * existiam no staging e sumiram ganham um novo item de auditoria e deixam de
 * ser considerados presentes; nenhum snapshot histórico é apagado. A data do
 * último item impede que uma captura antiga ressuscite ou sobrescreva um
 * tombstone decidido por uma captura mais nova.
 */
async function marcarAusentesDaFonte(
  tx: Prisma.TransactionClient,
  plano: PlanoOperacaoWidesys,
  loteId: string | null,
): Promise<Record<EscopoOperacaoWidesys, number>> {
  const contagens = Object.fromEntries(
    ([
      "CONTRATO",
      "CONTRATO_PARTE",
      "TITULO_RECEBER",
      "TITULO_PAGAR",
      "BAIXA_RECEBER",
      "BAIXA_PAGAR",
      "MOVIMENTO",
    ] as EscopoOperacaoWidesys[]).map((escopo) => [escopo, 0]),
  ) as Record<EscopoOperacaoWidesys, number>;
  const presentes = new Map<EscopoOperacaoWidesys, Set<string>>();
  const cobertos = new Set(plano.escoposCobertos);
  const vencimentoPorTitulo = new Map<string, string | null>();
  for (const registro of plano.registros) {
    const ids = presentes.get(registro.escopo) ?? new Set<string>();
    ids.add(registro.legadoId);
    presentes.set(registro.escopo, ids);
  }
  const ausente = (escopo: EscopoOperacaoWidesys, legadoId: string) =>
    !(presentes.get(escopo)?.has(legadoId) ?? false);
  const selecionar = {
    capturadoEm: true,
    legadoId: true,
    snapshotHash: true,
    statusImportacao: true,
    ultimoItem: { select: { lote: { select: { capturadoEm: true } } } },
  } as const;

  const candidatos: Array<{
    escopo: EscopoOperacaoWidesys;
    registro: CanonicoParaTombstone;
  }> = [];
  if (cobertos.has("CONTRATO")) {
    const contratos = await tx.contratoLegado.findMany({
      where: { origem: ORIGEM_OPERACAO_WIDESYS, capturadoEm: { lte: plano.capturadoEm } },
      select: selecionar,
    });
    candidatos.push(
      ...contratos
        .filter((registro) => ausente("CONTRATO", registro.legadoId))
        .map((registro) => ({ escopo: "CONTRATO" as const, registro })),
    );
  }
  if (
    cobertos.has("CONTRATO_PARTE") &&
    plano.escoposPartesCompletos.includes("CONTRATO_PARTE")
  ) {
    const partes = await tx.contratoParteLegado.findMany({
      where: { origem: ORIGEM_OPERACAO_WIDESYS, capturadoEm: { lte: plano.capturadoEm } },
      select: selecionar,
    });
    candidatos.push(
      ...partes
        .filter((registro) => ausente("CONTRATO_PARTE", registro.legadoId))
        .map((registro) => ({ escopo: "CONTRATO_PARTE" as const, registro })),
    );
  }
  for (const escopo of ["TITULO_RECEBER", "TITULO_PAGAR"] as const) {
    if (!cobertos.has(escopo)) continue;
    const registros = await tx.tituloFinanceiroLegado.findMany({
      where: {
        origem: ORIGEM_OPERACAO_WIDESYS,
        escopo,
        capturadoEm: { lte: plano.capturadoEm },
      },
      select: { ...selecionar, vencimento: true },
    });
    const cobertura = plano.coberturaTemporal[escopo];
    for (const registro of registros) {
      vencimentoPorTitulo.set(`${escopo}\u0000${registro.legadoId}`, registro.vencimento);
    }
    candidatos.push(
      ...registros
        .filter(
          (registro) =>
            ausente(escopo, registro.legadoId) &&
            dentroDaCobertura(registro.vencimento, cobertura),
        )
        .map((registro) => ({ escopo, registro })),
    );
  }
  for (const escopo of ["BAIXA_RECEBER", "BAIXA_PAGAR"] as const) {
    if (!cobertos.has(escopo) || !plano.escoposBaixasCompletos.includes(escopo)) {
      continue;
    }
    const registros = await tx.baixaFinanceiraLegado.findMany({
      where: {
        origem: ORIGEM_OPERACAO_WIDESYS,
        escopo,
        capturadoEm: { lte: plano.capturadoEm },
      },
      select: { ...selecionar, tituloEscopo: true, tituloLegadoId: true },
    });
    const escopoTitulo = escopo === "BAIXA_RECEBER" ? "TITULO_RECEBER" : "TITULO_PAGAR";
    const cobertura = plano.coberturaTemporal[escopoTitulo];
    candidatos.push(
      ...registros
        .filter((registro) => {
          if (registro.tituloEscopo !== escopoTitulo) return false;
          const vencimento = vencimentoPorTitulo.get(
            `${registro.tituloEscopo}\u0000${registro.tituloLegadoId}`,
          );
          return (
            ausente(escopo, registro.legadoId) &&
            dentroDaCobertura(vencimento ?? null, cobertura)
          );
        })
        .map((registro) => ({ escopo, registro })),
    );
  }
  if (cobertos.has("MOVIMENTO")) {
    const movimentos = await tx.movimentoFinanceiroLegado.findMany({
      where: {
        origem: ORIGEM_OPERACAO_WIDESYS,
        escopo: "MOVIMENTO",
        capturadoEm: { lte: plano.capturadoEm },
      },
      select: { ...selecionar, dataMovimento: true },
    });
    const cobertura = plano.coberturaTemporal.MOVIMENTO;
    candidatos.push(
      ...movimentos
        .filter(
          (registro) =>
            ausente("MOVIMENTO", registro.legadoId) &&
            dentroDaCobertura(registro.dataMovimento, cobertura),
        )
        .map((registro) => ({ escopo: "MOVIMENTO" as const, registro })),
    );
  }

  for (const { escopo, registro } of candidatos) {
    // Uma ausência já registrada permanece auditável no canônico. Criar outro
    // item MARCAR_AUSENTE em toda captura não acrescentaria informação e faria
    // o relatório parecer que a mesma ausência foi descoberta novamente.
    if (registro.statusImportacao === "AUSENTE_NA_FONTE") continue;
    if (decisaoCanonicaEm(registro) > plano.capturadoEm) continue;
    if (loteId === null) {
      contagens[escopo] += 1;
      continue;
    }
    const item = await tx.importacaoLegadoItem.upsert({
      where: { loteId_escopo_legadoId: { loteId, escopo, legadoId: registro.legadoId } },
      create: {
        loteId,
        origem: ORIGEM_OPERACAO_WIDESYS,
        escopo,
        legadoId: registro.legadoId,
        snapshotHash: registro.snapshotHash,
        acao: "MARCAR_AUSENTE",
        status: "CONCLUIDO",
      },
      update: {
        snapshotHash: registro.snapshotHash,
        acao: "MARCAR_AUSENTE",
        status: "CONCLUIDO",
        quarentenaMotivo: null,
        processadoEm: new Date(),
      },
      select: { id: true },
    });
    const data = {
      ultimoItemId: item.id,
      statusImportacao: "AUSENTE_NA_FONTE",
      quarentenaMotivo: null,
    };
    if (escopo === "CONTRATO") {
      await tx.contratoLegado.update({
        where: { origem_legadoId: { origem: ORIGEM_OPERACAO_WIDESYS, legadoId: registro.legadoId } },
        data,
      });
    } else if (escopo === "CONTRATO_PARTE") {
      await tx.contratoParteLegado.update({
        where: { origem_legadoId: { origem: ORIGEM_OPERACAO_WIDESYS, legadoId: registro.legadoId } },
        data,
      });
    } else if (escopo === "TITULO_RECEBER" || escopo === "TITULO_PAGAR") {
      await tx.tituloFinanceiroLegado.update({
        where: {
          origem_escopo_legadoId: {
            origem: ORIGEM_OPERACAO_WIDESYS,
            escopo,
            legadoId: registro.legadoId,
          },
        },
        data,
      });
    } else if (escopo === "BAIXA_RECEBER" || escopo === "BAIXA_PAGAR") {
      await tx.baixaFinanceiraLegado.update({
        where: {
          origem_escopo_legadoId: {
            origem: ORIGEM_OPERACAO_WIDESYS,
            escopo,
            legadoId: registro.legadoId,
          },
        },
        data,
      });
    } else {
      await tx.movimentoFinanceiroLegado.update({
        where: {
          origem_escopo_legadoId: {
            origem: ORIGEM_OPERACAO_WIDESYS,
            escopo,
            legadoId: registro.legadoId,
          },
        },
        data,
      });
    }
    contagens[escopo] += 1;
  }
  return contagens;
}

export async function importarPlanoOperacaoWidesys(
  prisma: PrismaClient,
  plano: PlanoOperacaoWidesys,
  opcoes: { tamanhoLote?: number } = {},
): Promise<RelatorioImportacaoOperacaoWidesys> {
  const tamanhoLote = opcoes.tamanhoLote ?? 100;
  if (!Number.isSafeInteger(tamanhoLote) || tamanhoLote < 1 || tamanhoLote > 1_000) {
    throw new TypeError("O tamanho do lote deve estar entre 1 e 1000.");
  }
  const existente = await prisma.importacaoLegadoLote.findUnique({
    where: { origem_capturaId: { origem: plano.origem, capturaId: plano.capturaId } },
  });
  if (existente && existente.manifestoHash !== plano.manifestoHash) {
    falhar("WIDESYS_OPERACAO_CAPTURA_REUTILIZADA", "O mesmo captureId foi reutilizado com outro manifesto.");
  }
  if (existente && ["CONCLUIDO", "QUARENTENA"].includes(existente.status)) {
    return {
      modo: "JA_APLICADO",
      capturaId: plano.capturaId,
      escoposCobertos: plano.escoposCobertos,
      coberturaTemporal: plano.coberturaTemporal,
      total: plano.registros.length,
      processados: plano.registros.length,
      porEscopo: contadoresVazios(),
      politicaReconciliacao: plano.politicaReconciliacao,
      reconciliacao: plano.reconciliacao,
      escoposAusentes: plano.escoposAusentes,
      escoposPartesCompletos: plano.escoposPartesCompletos,
      escoposBaixasCompletos: plano.escoposBaixasCompletos,
    };
  }
  const lote = existente
    ? await prisma.importacaoLegadoLote.update({
        where: { id: existente.id },
        data: {
          status: "PROCESSANDO",
          erroCodigo: null,
          totalEsperado: plano.registros.length,
          totalProcessado: 0,
          totalQuarentena: 0,
          resumo: "{}",
          concluidoEm: null,
        },
      })
    : await prisma.importacaoLegadoLote.create({
        data: {
          origem: plano.origem,
          capturaId: plano.capturaId,
          esquemaVersao: plano.esquemaVersao,
          manifestoHash: plano.manifestoHash,
          capturadoEm: plano.capturadoEm,
          totalEsperado: plano.registros.length,
        },
      });

  const porEscopo = contadoresVazios();
  let processados = 0;
  let quarentena = 0;
  try {
    for (let inicio = 0; inicio < plano.registros.length; inicio += tamanhoLote) {
      const parte = plano.registros.slice(inicio, inicio + tamanhoLote);
      const acoes = await prisma.$transaction(
        async (tx) => {
          const resultado: Array<{ escopo: EscopoOperacaoWidesys; acao: Awaited<ReturnType<typeof persistirRegistro>> }> = [];
          for (const registro of parte) {
            resultado.push({
              escopo: registro.escopo,
              acao: await persistirRegistro(
                tx,
                registro,
                lote.id,
                plano.capturadoEm,
              ),
            });
          }
          return resultado;
        },
        { maxWait: 10_000, timeout: 120_000 },
      );
      for (const { escopo, acao } of acoes) {
        if (acao === "CRIAR") porEscopo[escopo].criados += 1;
        else if (acao === "ATUALIZAR") porEscopo[escopo].atualizados += 1;
        else if (acao === "INALTERADO") porEscopo[escopo].inalterados += 1;
        else if (acao === "ANTERIOR_IGNORADO") porEscopo[escopo].anterioresIgnorados += 1;
        else porEscopo[escopo].quarentena += 1;
      }
      processados += parte.length;
      quarentena = Object.values(porEscopo).reduce((total, item) => total + item.quarentena, 0);
      await prisma.importacaoLegadoLote.update({
        where: { id: lote.id },
        data: {
          totalProcessado: processados,
          totalQuarentena: quarentena,
          resumo: resumoLote(plano, processados, porEscopo),
        },
      });
    }
    const ausentes = await prisma.$transaction(
      (tx) => marcarAusentesDaFonte(tx, plano, lote.id),
      { maxWait: 10_000, timeout: 120_000 },
    );
    for (const escopo of Object.keys(ausentes) as EscopoOperacaoWidesys[]) {
      porEscopo[escopo].ausentesMarcados += ausentes[escopo];
    }
    await prisma.importacaoLegadoLote.update({
      where: { id: lote.id },
      data: {
        status: quarentena > 0 ? "QUARENTENA" : "CONCLUIDO",
        concluidoEm: new Date(),
        totalProcessado: processados,
        totalQuarentena: quarentena,
        resumo: resumoLote(plano, processados, porEscopo),
      },
    });
  } catch (erro) {
    await prisma.importacaoLegadoLote
      .update({
        where: { id: lote.id },
        data: {
          status: "FALHOU",
          erroCodigo: "IMPORTACAO_INTERROMPIDA",
          totalProcessado: processados,
          totalQuarentena: quarentena,
          resumo: resumoLote(plano, processados, porEscopo),
        },
      })
      .catch(() => undefined);
    throw erro;
  }
  return {
    modo: "APLICADO",
    capturaId: plano.capturaId,
    escoposCobertos: plano.escoposCobertos,
    coberturaTemporal: plano.coberturaTemporal,
    total: plano.registros.length,
    processados,
    porEscopo,
    politicaReconciliacao: plano.politicaReconciliacao,
    reconciliacao: plano.reconciliacao,
    escoposAusentes: plano.escoposAusentes,
    escoposPartesCompletos: plano.escoposPartesCompletos,
    escoposBaixasCompletos: plano.escoposBaixasCompletos,
  };
}
