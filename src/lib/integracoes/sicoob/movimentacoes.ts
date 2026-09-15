import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import { reaisParaCentavos } from "./normalizacao";
import type {
  ArquivoLiquidacoesSicoob,
  BaixarArquivoMovimentacaoSicoobDTO,
  LiquidacaoMovimentacaoSicoob,
} from "./tipos";

const ASSINATURA_LOCAL = 0x04034b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_EOCD = 0x06054b50;
const ASSINATURA_DESCRIPTOR = 0x08074b50;

export type LimitesArquivoMovimentacaoSicoob = {
  maximoCaracteresBase64: number;
  maximoBytesZip: number;
  maximoBytesDescompactados: number;
  maximoTaxaCompressao: number;
  maximoRegistros: number;
  maximoEntradasZip: number;
};

export const LIMITES_ARQUIVO_MOVIMENTACAO_SICOOB: Readonly<LimitesArquivoMovimentacaoSicoob> = Object.freeze({
  /** Aproximadamente 32 MiB de ZIP depois da decodificação. */
  maximoCaracteresBase64: 44 * 1024 * 1024,
  maximoBytesZip: 32 * 1024 * 1024,
  maximoBytesDescompactados: 32 * 1024 * 1024,
  maximoTaxaCompressao: 150,
  /** A API documenta até 500 mil registros por arquivo; o byte-limit prevalece. */
  // O endpoint aceita arquivos maiores, porém esta aplicação os materializa em
  // memória antes de aplicar o cursor. O limite operacional evita pressão no
  // processo web; volumes superiores devem ser fracionados na origem.
  maximoRegistros: 25_000,
  maximoEntradasZip: 1,
});

export class ErroArquivoMovimentacaoSicoob extends Error {
  readonly codigo: string;

  constructor(mensagem: string, codigo: string) {
    super(mensagem);
    this.name = "ErroArquivoMovimentacaoSicoob";
    this.codigo = codigo;
  }
}

type Registro = Record<string, unknown>;

function falhar(mensagem: string, codigo: string): never {
  throw new ErroArquivoMovimentacaoSicoob(mensagem, codigo);
}

function registro(valor: unknown): Registro | null {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Registro)
    : null;
}

function inteiroPositivo(valor: unknown, campo: string): number {
  if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor <= 0) {
    return falhar(
      `Registro LIQUI contém ${campo} inválido.`,
      "SICOOB_LIQUI_LAYOUT_INVALIDO",
    );
  }
  return valor;
}

function inteiroOpcional(valor: unknown, campo: string): number | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor < 0) {
    return falhar(
      `Registro LIQUI contém ${campo} inválido.`,
      "SICOOB_LIQUI_LAYOUT_INVALIDO",
    );
  }
  return valor;
}

function textoObrigatorio(valor: unknown, campo: string, maximo: number): string {
  if (typeof valor !== "string") {
    return falhar(
      `Registro LIQUI não contém ${campo} textual.`,
      "SICOOB_LIQUI_LAYOUT_INVALIDO",
    );
  }
  const limpo = valor.trim();
  if (!limpo || limpo.length > maximo) {
    return falhar(
      `Registro LIQUI contém ${campo} inválido.`,
      "SICOOB_LIQUI_LAYOUT_INVALIDO",
    );
  }
  return limpo;
}

function textoOpcional(valor: unknown, campo: string, maximo: number): string | null {
  if (valor === undefined || valor === null) return null;
  return textoObrigatorio(valor, campo, maximo);
}

function dataHoraObrigatoria(valor: unknown, campo: string): string {
  const texto = textoObrigatorio(valor, campo, 40);
  const partes = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(
    texto,
  );
  if (!partes) {
    return falhar(
      `Registro LIQUI contém ${campo} fora do formato ISO com fuso horário.`,
      "SICOOB_LIQUI_LAYOUT_INVALIDO",
    );
  }
  const [, anoTexto, mesTexto, diaTexto, horaTexto, minutoTexto, segundoTexto, , fusoHoraTexto, fusoMinutoTexto] = partes;
  const ano = Number(anoTexto);
  const mes = Number(mesTexto);
  const dia = Number(diaTexto);
  const dataCivil = new Date(Date.UTC(ano, mes - 1, dia));
  if (
    dataCivil.getUTCFullYear() !== ano ||
    dataCivil.getUTCMonth() !== mes - 1 ||
    dataCivil.getUTCDate() !== dia ||
    Number(horaTexto) > 23 ||
    Number(minutoTexto) > 59 ||
    Number(segundoTexto) > 59 ||
    (fusoHoraTexto !== undefined &&
      (Number(fusoHoraTexto) > 23 || Number(fusoMinutoTexto) > 59))
  ) {
    return falhar(
      `Registro LIQUI contém ${campo} inexistente.`,
      "SICOOB_LIQUI_LAYOUT_INVALIDO",
    );
  }
  const instante = Date.parse(texto);
  if (!Number.isFinite(instante)) {
    return falhar(
      `Registro LIQUI contém ${campo} inexistente.`,
      "SICOOB_LIQUI_LAYOUT_INVALIDO",
    );
  }
  return new Date(instante).toISOString();
}

function dataHoraOpcional(valor: unknown, campo: string): string | null {
  if (valor === undefined || valor === null) return null;
  return dataHoraObrigatoria(valor, campo);
}

function dinheiroObrigatorio(valor: unknown, campo: string, permiteZero = false): number {
  if (
    typeof valor === "number" &&
    Math.abs(valor * 100 - Math.round(valor * 100)) > 1e-7
  ) {
    return falhar(
      `Registro LIQUI contém ${campo} com precisão superior a centavos.`,
      "SICOOB_LIQUI_LAYOUT_INVALIDO",
    );
  }
  const centavos = reaisParaCentavos(valor);
  if (centavos === null || (permiteZero ? centavos < 0 : centavos <= 0)) {
    return falhar(
      `Registro LIQUI contém ${campo} inválido.`,
      "SICOOB_LIQUI_LAYOUT_INVALIDO",
    );
  }
  return centavos;
}

function dinheiroOpcional(valor: unknown, campo: string): number | null {
  if (valor === undefined || valor === null) return null;
  return dinheiroObrigatorio(valor, campo, true);
}

function normalizarLiquidacao(valor: unknown, numeroClienteEsperado: number): LiquidacaoMovimentacaoSicoob {
  const item = registro(valor);
  if (!item) {
    return falhar(
      "Arquivo LIQUI contém item que não é um objeto JSON.",
      "SICOOB_LIQUI_LAYOUT_INVALIDO",
    );
  }
  const campos = Object.entries(item);
  if (
    campos.length > 64 ||
    campos.some(([, campo]) => campo !== null && typeof campo === "object")
  ) {
    return falhar(
      "Registro LIQUI não corresponde ao layout JSON plano documentado.",
      "SICOOB_LIQUI_LAYOUT_INVALIDO",
    );
  }
  if (item.codigoTipoMovimento !== 5 || item.siglaMovimento !== "LIQUI") {
    return falhar(
      "Arquivo solicitado como liquidação contém movimento diferente de 5/LIQUI.",
      "SICOOB_LIQUI_TIPO_INESPERADO",
    );
  }

  const numeroCliente = inteiroPositivo(item.numeroCliente, "numeroCliente");
  if (numeroCliente !== numeroClienteEsperado) {
    return falhar(
      "Arquivo LIQUI pertence a outro número de cliente.",
      "SICOOB_LIQUI_CLIENTE_DIVERGENTE",
    );
  }

  const numeroTitulo = inteiroPositivo(item.numeroTitulo, "numeroTitulo");
  const codigoBarras = textoOpcional(item.codigoBarras, "codigoBarras", 60);
  if (codigoBarras !== null && !/^\d+$/.test(codigoBarras)) {
    return falhar(
      "Registro LIQUI contém codigoBarras não numérico.",
      "SICOOB_LIQUI_LAYOUT_INVALIDO",
    );
  }

  return {
    codigoTipoMovimento: 5,
    siglaMovimento: "LIQUI",
    numeroCliente,
    numeroContrato: inteiroPositivo(item.numeroContrato, "numeroContrato"),
    codigoModalidade: inteiroPositivo(item.modalidade, "modalidade"),
    numeroTitulo: String(numeroTitulo),
    seuNumero: textoObrigatorio(item.seuNumero, "seuNumero", 18),
    numeroContaCorrente: inteiroPositivo(item.numeroContaCorrente, "numeroContaCorrente"),
    valorTituloCentavos: dinheiroObrigatorio(item.valorTitulo, "valorTitulo"),
    valorLiquidoCentavos: dinheiroObrigatorio(item.valorLiquido, "valorLiquido"),
    valorAbatimentoCentavos: dinheiroOpcional(item.valorAbatimento, "valorAbatimento"),
    valorDescontoCentavos: dinheiroOpcional(item.valorDesconto, "valorDesconto"),
    valorMoraCentavos: dinheiroOpcional(item.valorMora, "valorMora"),
    valorTarifaCentavos: dinheiroOpcional(item.valorTarifaMovimento, "valorTarifaMovimento"),
    dataMovimentoLiquidacao: dataHoraObrigatoria(
      item.dataMovimentoLiquidacao,
      "dataMovimentoLiquidacao",
    ),
    dataLiquidacao: dataHoraObrigatoria(item.dataLiquidacao, "dataLiquidacao"),
    dataPrevisaoCredito: dataHoraOpcional(item.dataPrevisaoCredito, "dataPrevisaoCredito"),
    codigoBarras,
    numeroBancoRecebedor: inteiroOpcional(item.numeroBancoRecebedor, "numeroBancoRecebedor"),
    numeroAgenciaRecebedora: inteiroOpcional(
      item.numeroAgenciaRecebedora,
      "numeroAgenciaRecebedora",
    ),
    idTipoOperacaoFinanceira: inteiroOpcional(
      item.idTipoOpFinanceira,
      "idTipoOpFinanceira",
    ),
    tipoOperacaoFinanceira: textoOpcional(
      item.tipoOpFinanceira,
      "tipoOpFinanceira",
      100,
    ),
    tipoCarteiraOperacaoCredito: textoOpcional(
      item.tipoCarteiraOpCredito,
      "tipoCarteiraOpCredito",
      40,
    ),
  };
}

function nomeSeguro(valor: unknown, extensao: ".zip" | ".json"): string {
  if (typeof valor !== "string") {
    return falhar("Resposta Sicoob não contém nome de arquivo válido.", "SICOOB_ARQUIVO_NOME_INVALIDO");
  }
  const nome = valor.trim();
  if (
    !nome ||
    nome.length > 200 ||
    nome.includes("\0") ||
    nome.includes("/") ||
    nome.includes("\\") ||
    nome === "." ||
    nome === ".." ||
    !nome.toLowerCase().endsWith(extensao)
  ) {
    return falhar("Resposta Sicoob contém nome de arquivo inseguro.", "SICOOB_ARQUIVO_NOME_INVALIDO");
  }
  return nome;
}

function decodificarBase64Estrito(valor: unknown, limites: LimitesArquivoMovimentacaoSicoob): Buffer {
  if (typeof valor !== "string" || valor.length === 0) {
    return falhar("Resposta Sicoob não contém arquivo Base64.", "SICOOB_ARQUIVO_BASE64_INVALIDO");
  }
  if (valor.length > limites.maximoCaracteresBase64) {
    return falhar("Arquivo Base64 excede o limite permitido.", "SICOOB_ARQUIVO_LIMITE_EXCEDIDO");
  }
  if (valor.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(valor)) {
    return falhar("Resposta Sicoob contém Base64 inválido.", "SICOOB_ARQUIVO_BASE64_INVALIDO");
  }
  const zip = Buffer.from(valor, "base64");
  if (zip.length > limites.maximoBytesZip || zip.toString("base64") !== valor) {
    return falhar(
      zip.length > limites.maximoBytesZip
        ? "Arquivo ZIP excede o limite permitido."
        : "Resposta Sicoob contém Base64 não canônico.",
      zip.length > limites.maximoBytesZip
        ? "SICOOB_ARQUIVO_LIMITE_EXCEDIDO"
        : "SICOOB_ARQUIVO_BASE64_INVALIDO",
    );
  }
  return zip;
}

function encontrarEocd(zip: Buffer): number {
  const inicio = Math.max(0, zip.length - 22 - 65_535);
  for (let posicao = zip.length - 22; posicao >= inicio; posicao -= 1) {
    if (zip.readUInt32LE(posicao) === ASSINATURA_EOCD) return posicao;
  }
  return falhar("ZIP não contém diretório central válido.", "SICOOB_ARQUIVO_ZIP_INVALIDO");
}

function lerUtf8(bytes: Buffer, campo: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return falhar(`${campo} não está em UTF-8 válido.`, "SICOOB_ARQUIVO_UTF8_INVALIDO");
  }
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validarFlagsZip(flags: number, metodo: number): void {
  const permitidos = metodo === 8 ? 0x080e : 0x0808;
  if ((flags & ~permitidos) !== 0 || (flags & 0x0001) !== 0) {
    falhar("ZIP usa recursos ou criptografia não permitidos.", "SICOOB_ARQUIVO_ZIP_NAO_SUPORTADO");
  }
}

function validarExtrasSemZip64(extra: Buffer): void {
  let posicao = 0;
  while (posicao < extra.length) {
    if (posicao + 4 > extra.length) {
      falhar("ZIP contém campo extra truncado.", "SICOOB_ARQUIVO_ZIP_INVALIDO");
    }
    const tipo = extra.readUInt16LE(posicao);
    const tamanho = extra.readUInt16LE(posicao + 2);
    posicao += 4;
    if (posicao + tamanho > extra.length) {
      falhar("ZIP contém campo extra truncado.", "SICOOB_ARQUIVO_ZIP_INVALIDO");
    }
    if (tipo === 0x0001) {
      falhar("ZIP64 não é aceito para movimentações.", "SICOOB_ARQUIVO_ZIP_NAO_SUPORTADO");
    }
    posicao += tamanho;
  }
}

function extrairEntradaJson(zip: Buffer, limites: LimitesArquivoMovimentacaoSicoob): {
  nomeEntrada: string;
  conteudo: Buffer;
} {
  if (zip.length < 22) {
    return falhar("Arquivo ZIP está truncado.", "SICOOB_ARQUIVO_ZIP_INVALIDO");
  }
  const eocd = encontrarEocd(zip);
  const disco = zip.readUInt16LE(eocd + 4);
  const discoCentral = zip.readUInt16LE(eocd + 6);
  const entradasDisco = zip.readUInt16LE(eocd + 8);
  const entradas = zip.readUInt16LE(eocd + 10);
  const tamanhoCentral = zip.readUInt32LE(eocd + 12);
  const inicioCentral = zip.readUInt32LE(eocd + 16);
  const tamanhoComentario = zip.readUInt16LE(eocd + 20);
  if (eocd + 22 + tamanhoComentario !== zip.length) {
    return falhar("ZIP contém dados posteriores ao fechamento.", "SICOOB_ARQUIVO_ZIP_INVALIDO");
  }
  if (
    disco !== 0 ||
    discoCentral !== 0 ||
    entradasDisco !== entradas ||
    entradas === 0xffff ||
    tamanhoCentral === 0xffffffff ||
    inicioCentral === 0xffffffff
  ) {
    return falhar("ZIP multipartes ou ZIP64 não é aceito.", "SICOOB_ARQUIVO_ZIP_NAO_SUPORTADO");
  }
  if (entradas !== 1 || entradas > limites.maximoEntradasZip) {
    return falhar("ZIP deve conter exatamente um arquivo JSON.", "SICOOB_ARQUIVO_ZIP_ENTRADAS_INVALIDAS");
  }
  if (
    inicioCentral < 30 ||
    inicioCentral + tamanhoCentral !== eocd ||
    inicioCentral + 46 > eocd
  ) {
    return falhar("Diretório central do ZIP está fora dos limites.", "SICOOB_ARQUIVO_ZIP_INVALIDO");
  }
  if (zip.readUInt32LE(inicioCentral) !== ASSINATURA_CENTRAL) {
    return falhar("Diretório central do ZIP é inválido.", "SICOOB_ARQUIVO_ZIP_INVALIDO");
  }

  const versaoCriadora = zip.readUInt16LE(inicioCentral + 4);
  const flags = zip.readUInt16LE(inicioCentral + 8);
  const metodo = zip.readUInt16LE(inicioCentral + 10);
  const crcEsperado = zip.readUInt32LE(inicioCentral + 16);
  const tamanhoComprimido = zip.readUInt32LE(inicioCentral + 20);
  const tamanhoDescompactado = zip.readUInt32LE(inicioCentral + 24);
  const tamanhoNome = zip.readUInt16LE(inicioCentral + 28);
  const tamanhoExtra = zip.readUInt16LE(inicioCentral + 30);
  const tamanhoComentarioEntrada = zip.readUInt16LE(inicioCentral + 32);
  const discoInicial = zip.readUInt16LE(inicioCentral + 34);
  const atributosExternos = zip.readUInt32LE(inicioCentral + 38);
  const inicioLocal = zip.readUInt32LE(inicioCentral + 42);
  const fimCentral = inicioCentral + 46 + tamanhoNome + tamanhoExtra + tamanhoComentarioEntrada;
  if (fimCentral !== eocd || discoInicial !== 0 || inicioLocal !== 0) {
    return falhar("Entrada ZIP possui offsets inválidos.", "SICOOB_ARQUIVO_ZIP_INVALIDO");
  }
  if (metodo !== 0 && metodo !== 8) {
    return falhar("Método de compressão ZIP não suportado.", "SICOOB_ARQUIVO_ZIP_NAO_SUPORTADO");
  }
  validarFlagsZip(flags, metodo);
  if (tamanhoComprimido === 0xffffffff || tamanhoDescompactado === 0xffffffff) {
    return falhar("ZIP64 não é aceito para movimentações.", "SICOOB_ARQUIVO_ZIP_NAO_SUPORTADO");
  }
  if (tamanhoDescompactado > limites.maximoBytesDescompactados) {
    return falhar("Conteúdo descompactado excede o limite permitido.", "SICOOB_ARQUIVO_LIMITE_EXCEDIDO");
  }
  if (
    tamanhoDescompactado > 0 &&
    (tamanhoComprimido === 0 ||
      tamanhoDescompactado / tamanhoComprimido > limites.maximoTaxaCompressao)
  ) {
    return falhar("Taxa de compressão suspeita no ZIP.", "SICOOB_ARQUIVO_ZIP_BOMB");
  }

  const inicioNomeCentral = inicioCentral + 46;
  const nomeBytesCentral = zip.subarray(inicioNomeCentral, inicioNomeCentral + tamanhoNome);
  const extraCentral = zip.subarray(
    inicioNomeCentral + tamanhoNome,
    inicioNomeCentral + tamanhoNome + tamanhoExtra,
  );
  validarExtrasSemZip64(extraCentral);
  if ((flags & 0x0800) === 0 && nomeBytesCentral.some((byte) => byte > 0x7f)) {
    return falhar("Nome de entrada ZIP usa codificação não suportada.", "SICOOB_ARQUIVO_ZIP_NAO_SUPORTADO");
  }
  const nomeEntrada = nomeSeguro(lerUtf8(nomeBytesCentral, "Nome da entrada ZIP"), ".json");

  const sistemaCriador = versaoCriadora >>> 8;
  const modoUnix = atributosExternos >>> 16;
  const tipoUnix = modoUnix & 0xf000;
  if (sistemaCriador === 3 && tipoUnix !== 0 && tipoUnix !== 0x8000) {
    return falhar("Entrada ZIP não é um arquivo regular.", "SICOOB_ARQUIVO_ZIP_NAO_SUPORTADO");
  }
  if (zip.readUInt32LE(inicioLocal) !== ASSINATURA_LOCAL) {
    return falhar("Cabeçalho local do ZIP é inválido.", "SICOOB_ARQUIVO_ZIP_INVALIDO");
  }
  const flagsLocal = zip.readUInt16LE(inicioLocal + 6);
  const metodoLocal = zip.readUInt16LE(inicioLocal + 8);
  const crcLocal = zip.readUInt32LE(inicioLocal + 14);
  const comprimidoLocal = zip.readUInt32LE(inicioLocal + 18);
  const descompactadoLocal = zip.readUInt32LE(inicioLocal + 22);
  const tamanhoNomeLocal = zip.readUInt16LE(inicioLocal + 26);
  const tamanhoExtraLocal = zip.readUInt16LE(inicioLocal + 28);
  const inicioNomeLocal = inicioLocal + 30;
  const inicioConteudo = inicioNomeLocal + tamanhoNomeLocal + tamanhoExtraLocal;
  const fimConteudo = inicioConteudo + tamanhoComprimido;
  if (fimConteudo > inicioCentral || flagsLocal !== flags || metodoLocal !== metodo) {
    return falhar("Cabeçalho local diverge do diretório central.", "SICOOB_ARQUIVO_ZIP_INVALIDO");
  }
  const nomeBytesLocal = zip.subarray(inicioNomeLocal, inicioNomeLocal + tamanhoNomeLocal);
  if (!nomeBytesLocal.equals(nomeBytesCentral)) {
    return falhar("Nomes da entrada ZIP são divergentes.", "SICOOB_ARQUIVO_ZIP_INVALIDO");
  }
  validarExtrasSemZip64(
    zip.subarray(inicioNomeLocal + tamanhoNomeLocal, inicioConteudo),
  );
  const usaDescriptor = (flags & 0x0008) !== 0;
  if (!usaDescriptor) {
    if (
      crcLocal !== crcEsperado ||
      comprimidoLocal !== tamanhoComprimido ||
      descompactadoLocal !== tamanhoDescompactado ||
      fimConteudo !== inicioCentral
    ) {
      return falhar("Metadados locais do ZIP são divergentes.", "SICOOB_ARQUIVO_ZIP_INVALIDO");
    }
  } else {
    let posicaoDescriptor = fimConteudo;
    if (
      posicaoDescriptor + 4 <= inicioCentral &&
      zip.readUInt32LE(posicaoDescriptor) === ASSINATURA_DESCRIPTOR
    ) {
      posicaoDescriptor += 4;
    }
    if (
      posicaoDescriptor + 12 !== inicioCentral ||
      zip.readUInt32LE(posicaoDescriptor) !== crcEsperado ||
      zip.readUInt32LE(posicaoDescriptor + 4) !== tamanhoComprimido ||
      zip.readUInt32LE(posicaoDescriptor + 8) !== tamanhoDescompactado
    ) {
      return falhar("Descriptor de dados do ZIP é inválido.", "SICOOB_ARQUIVO_ZIP_INVALIDO");
    }
  }

  const comprimido = zip.subarray(inicioConteudo, fimConteudo);
  let conteudo: Buffer;
  try {
    conteudo =
      metodo === 0
        ? Buffer.from(comprimido)
        : inflateRawSync(comprimido, {
            maxOutputLength: limites.maximoBytesDescompactados,
          });
  } catch {
    return falhar("Não foi possível descompactar o ZIP.", "SICOOB_ARQUIVO_ZIP_INVALIDO");
  }
  if (conteudo.length !== tamanhoDescompactado || crc32(conteudo) !== crcEsperado) {
    return falhar("Integridade CRC/tamanho do ZIP é inválida.", "SICOOB_ARQUIVO_ZIP_INTEGRO_INVALIDO");
  }
  return { nomeEntrada, conteudo };
}

function validarLimites(
  parciais: Partial<LimitesArquivoMovimentacaoSicoob> | undefined,
): LimitesArquivoMovimentacaoSicoob {
  const limites = { ...LIMITES_ARQUIVO_MOVIMENTACAO_SICOOB, ...parciais };
  for (const [nome, valor] of Object.entries(limites)) {
    if (!Number.isSafeInteger(valor) || valor <= 0) {
      throw new TypeError(`Limite ${nome} deve ser um inteiro positivo.`);
    }
  }
  return limites;
}

/**
 * Decodifica o ZIP em memória sem escrever em disco. A fronteira aceita apenas
 * um JSON UTF-8 e um array estrito de movimentos 5/LIQUI do cliente esperado.
 */
export function decodificarArquivoLiquidacoesSicoob(
  arquivoBase64: unknown,
  contexto: Pick<BaixarArquivoMovimentacaoSicoobDTO, "numeroCliente" | "idArquivo"> & {
    nomeArquivo: unknown;
  },
  limitesParciais?: Partial<LimitesArquivoMovimentacaoSicoob>,
): ArquivoLiquidacoesSicoob {
  const limites = validarLimites(limitesParciais);
  const nomeArquivo = nomeSeguro(contexto.nomeArquivo, ".zip");
  const zip = decodificarBase64Estrito(arquivoBase64, limites);
  const { nomeEntrada, conteudo } = extrairEntradaJson(zip, limites);
  const textoJson = lerUtf8(conteudo, "Conteúdo da movimentação").replace(/^\uFEFF/, "");
  let bruto: unknown;
  try {
    bruto = JSON.parse(textoJson) as unknown;
  } catch {
    return falhar("Conteúdo da movimentação não é JSON válido.", "SICOOB_ARQUIVO_JSON_INVALIDO");
  }
  if (!Array.isArray(bruto)) {
    return falhar("Conteúdo da movimentação deve ser um array JSON.", "SICOOB_LIQUI_LAYOUT_INVALIDO");
  }
  if (bruto.length > limites.maximoRegistros) {
    return falhar("Arquivo excede o limite de registros permitido.", "SICOOB_ARQUIVO_LIMITE_EXCEDIDO");
  }
  const liquidacoes = bruto.map((item) => normalizarLiquidacao(item, contexto.numeroCliente));
  return {
    idArquivo: contexto.idArquivo,
    nomeArquivo,
    nomeEntrada,
    quantidadeRegistros: liquidacoes.length,
    liquidacoes,
  };
}

/** Valida o envelope oficial resultado.{arquivo,nomeArquivo} antes de abrir o ZIP. */
export function processarRespostaArquivoLiquidacoesSicoob(
  resposta: unknown,
  contexto: BaixarArquivoMovimentacaoSicoobDTO,
  limites?: Partial<LimitesArquivoMovimentacaoSicoob>,
): ArquivoLiquidacoesSicoob {
  const raiz = registro(resposta);
  const resultado = registro(raiz?.resultado);
  if (!resultado) {
    return falhar(
      "Sicoob retornou envelope inválido no download da movimentação.",
      "SICOOB_ARQUIVO_RESPOSTA_INVALIDA",
    );
  }
  return decodificarArquivoLiquidacoesSicoob(
    resultado.arquivo,
    {
      numeroCliente: contexto.numeroCliente,
      idArquivo: contexto.idArquivo,
      nomeArquivo: resultado.nomeArquivo,
    },
    limites,
  );
}

/** Chave estável para deduplicar a mesma liquidação em reprocessamentos. */
export function chaveIdempotenciaLiquidacaoSicoob(
  liquidacao: LiquidacaoMovimentacaoSicoob,
): string {
  const canonico = JSON.stringify([
    liquidacao.codigoTipoMovimento,
    liquidacao.numeroCliente,
    liquidacao.codigoModalidade,
    liquidacao.numeroContaCorrente,
    liquidacao.numeroTitulo,
    liquidacao.seuNumero,
    liquidacao.dataMovimentoLiquidacao,
    liquidacao.dataLiquidacao,
    liquidacao.valorLiquidoCentavos,
  ]);
  return `sicoob-liqui-v1:${createHash("sha256").update(canonico).digest("hex")}`;
}
