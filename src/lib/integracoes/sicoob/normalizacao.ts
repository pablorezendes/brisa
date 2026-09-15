import type {
  BoletoSicoobNormalizado,
  EmitirBoletoSicoobDTO,
  StatusBoletoSicoob,
  StatusWebhookSicoob,
} from "./tipos";

type Registro = Record<string, unknown>;

function registro(valor: unknown): Registro | null {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) {
    return null;
  }
  return valor as Registro;
}

function texto(valor: unknown): string | null {
  if (typeof valor === "string") {
    const limpo = valor.trim();
    return limpo || null;
  }
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  return null;
}

function inteiro(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isSafeInteger(valor)) return valor;
  const candidato = texto(valor);
  if (!candidato || !/^\d+$/.test(candidato)) return null;
  const convertido = Number(candidato);
  return Number.isSafeInteger(convertido) ? convertido : null;
}

function primeiro(objeto: Registro, chaves: string[]): unknown {
  for (const chave of chaves) {
    if (objeto[chave] !== undefined && objeto[chave] !== null) {
      return objeto[chave];
    }
  }
  return undefined;
}

function semAcentos(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

/**
 * Converte um valor em reais para centavos sem multiplicar floats vindos como
 * texto. Vírgula indica formato pt-BR; ponto único indica decimal da API.
 */
export function reaisParaCentavos(valor: unknown): number | null {
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) return null;
    return reaisParaCentavos(valor.toFixed(2));
  }
  if (typeof valor !== "string") return null;

  let candidato = valor.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!candidato) return null;

  const negativoPorParenteses = candidato.startsWith("(") && candidato.endsWith(")");
  if (negativoPorParenteses) candidato = `-${candidato.slice(1, -1)}`;

  if (candidato.includes(",")) {
    if (!/^[+-]?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$/.test(candidato) &&
        !/^[+-]?\d+(?:,\d{1,2})?$/.test(candidato)) {
      return null;
    }
    candidato = candidato.replace(/\./g, "").replace(",", ".");
  } else if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(candidato)) {
    return null;
  }

  const sinal = candidato.startsWith("-") ? -1 : 1;
  const absoluto = candidato.replace(/^[+-]/, "");
  const [reais, fracao = ""] = absoluto.split(".");
  const centavosTexto = fracao.padEnd(2, "0");

  try {
    const total = BigInt(reais) * BigInt(100) + BigInt(centavosTexto || "0");
    const comSinal = sinal < 0 ? -total : total;
    const numero = Number(comSinal);
    return Number.isSafeInteger(numero) ? numero : null;
  } catch {
    return null;
  }
}

/** Converte centavos inteiros para o número decimal esperado pelo JSON da API. */
export function centavosParaValorApi(centavos: number): number {
  if (!Number.isSafeInteger(centavos)) {
    throw new TypeError("O valor do boleto deve estar em centavos inteiros seguros.");
  }
  return Number((centavos / 100).toFixed(2));
}

export function normalizarSituacaoBoleto(situacao: unknown): StatusBoletoSicoob {
  if (situacao === 1 || situacao === "1") return "REGISTRADO";
  if (situacao === 2 || situacao === "2") return "BAIXADO";
  if (situacao === 3 || situacao === "3") return "LIQUIDADO";

  const original = texto(situacao);
  if (!original) return "DESCONHECIDO";
  const valor = semAcentos(original).replace(/[\s_-]+/g, " ");

  if (/LIQUID|PAG[OA]/.test(valor)) return "LIQUIDADO";
  if (/BAIX/.test(valor)) return "BAIXADO";
  if (/VENCID/.test(valor)) return "VENCIDO";
  if (/PROTEST/.test(valor)) return "PROTESTADO";
  if (/REJEIT|RECUS/.test(valor)) return "REJEITADO";
  if (/CANCEL/.test(valor)) return "CANCELADO";
  if (/NORMAL|ABERTO|REGISTR|CARTEIRA/.test(valor)) return "REGISTRADO";
  return "DESCONHECIDO";
}

export function normalizarSituacaoWebhook(situacao: unknown): StatusWebhookSicoob {
  if (situacao === 1 || situacao === "1") return "AGUARDANDO_VALIDACAO";
  if (situacao === 2 || situacao === "2") return "VALIDADO";
  if (situacao === 3 || situacao === "3") return "INATIVO";
  const original = texto(situacao);
  if (!original) return "DESCONHECIDO";
  const valor = semAcentos(original);
  if (valor.includes("AGUARDANDO")) return "AGUARDANDO_VALIDACAO";
  if (valor.includes("VALIDAD")) return "VALIDADO";
  if (valor.includes("INATIV")) return "INATIVO";
  return "DESCONHECIDO";
}

function dataIso(valor: unknown): string | null {
  const candidato = texto(valor);
  if (!candidato) return null;
  const trecho = candidato.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(trecho) ? trecho : null;
}

function resultadoDaResposta(resposta: unknown): Registro {
  let atual: unknown = resposta;
  const raiz = registro(atual);
  if (raiz && raiz.resultado !== undefined) atual = raiz.resultado;

  if (Array.isArray(atual)) atual = atual[0];
  const resultado = registro(atual);
  if (!resultado) return {};

  for (const chave of ["boleto", "boletos", "titulos"]) {
    const aninhado = resultado[chave];
    if (Array.isArray(aninhado) && aninhado.length > 0) {
      return registro(aninhado[0]) ?? resultado;
    }
    const comoRegistro = registro(aninhado);
    if (comoRegistro) return comoRegistro;
  }
  return resultado;
}

/** Reduz respostas variáveis da v3 a um DTO mínimo, sem repassar payload cru. */
export function normalizarBoletoSicoob(resposta: unknown): BoletoSicoobNormalizado {
  const item = resultadoDaResposta(resposta);
  const situacao = primeiro(item, [
    "situacaoBoleto",
    "descricaoSituacaoBoleto",
    "descricaoSituacao",
    "codigoSituacao",
    "situacao",
  ]);
  const qrCodeBruto = primeiro(item, ["qrCode", "qrcode", "pixCopiaECola"]);
  const qrCodeObjeto = registro(qrCodeBruto);

  return {
    nossoNumero: texto(primeiro(item, ["nossoNumero", "numeroTitulo"])),
    seuNumero: texto(item.seuNumero),
    numeroCliente: inteiro(item.numeroCliente),
    numeroContaCorrente: inteiro(item.numeroContaCorrente),
    codigoModalidade: inteiro(item.codigoModalidade),
    numeroContratoCobranca: inteiro(item.numeroContratoCobranca),
    status: normalizarSituacaoBoleto(situacao),
    situacaoOriginal: texto(situacao),
    valorOriginalCentavos: reaisParaCentavos(primeiro(item, ["valor", "valorTitulo"])),
    valorPagoCentavos: reaisParaCentavos(
      primeiro(item, ["valorPago", "valorLiquidacao", "valorLiquido"]),
    ),
    dataEmissao: dataIso(item.dataEmissao),
    dataVencimento: dataIso(item.dataVencimento),
    dataLiquidacao: dataIso(
      primeiro(item, ["dataLiquidacao", "dataPagamento", "dataCredito"]),
    ),
    codigoBarras: texto(item.codigoBarras),
    linhaDigitavel: texto(item.linhaDigitavel),
    qrCode: texto(qrCodeBruto) ?? texto(qrCodeObjeto?.emv) ?? texto(qrCodeObjeto?.payload),
    pdfBase64: texto(primeiro(item, ["pdfBoleto", "pdf"])),
  };
}

function validarInteiroPositivo(valor: number, campo: string): void {
  if (!Number.isSafeInteger(valor) || valor <= 0) {
    throw new TypeError(`${campo} deve ser um inteiro positivo.`);
  }
}

function validarDataIso(valor: string, campo: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    throw new TypeError(`${campo} deve usar o formato AAAA-MM-DD.`);
  }
  const [ano, mes, dia] = valor.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (
    data.getUTCFullYear() !== ano ||
    data.getUTCMonth() !== mes - 1 ||
    data.getUTCDate() !== dia
  ) {
    throw new TypeError(`${campo} contém uma data inexistente.`);
  }
}

function validarTexto(valor: string, campo: string, maximo: number): string {
  const limpo = valor.trim();
  if (!limpo || limpo.length > maximo) {
    throw new TypeError(`${campo} deve ter entre 1 e ${maximo} caracteres.`);
  }
  return limpo;
}

/** Monta e valida somente os campos documentados para POST /boletos v3. */
export function montarPayloadEmissaoBoleto(entrada: EmitirBoletoSicoobDTO): Registro {
  validarInteiroPositivo(entrada.conta.numeroCliente, "numeroCliente");
  validarInteiroPositivo(entrada.conta.codigoModalidade, "codigoModalidade");
  validarInteiroPositivo(entrada.conta.numeroContaCorrente, "numeroContaCorrente");
  if (entrada.valorCentavos <= 0) {
    throw new TypeError("valorCentavos deve ser maior que zero.");
  }
  validarDataIso(entrada.dataEmissao, "dataEmissao");
  validarDataIso(entrada.dataVencimento, "dataVencimento");
  if (entrada.dataVencimento < entrada.dataEmissao) {
    throw new TypeError("dataVencimento não pode ser anterior a dataEmissao.");
  }
  if (entrada.dataLimitePagamento) {
    validarDataIso(entrada.dataLimitePagamento, "dataLimitePagamento");
    if (entrada.dataLimitePagamento < entrada.dataVencimento) {
      throw new TypeError("dataLimitePagamento não pode ser anterior a dataVencimento.");
    }
  }

  const cpfCnpj = entrada.pagador.numeroCpfCnpj.replace(/\D/g, "");
  if (!/^(?:\d{11}|\d{14})$/.test(cpfCnpj)) {
    throw new TypeError("numeroCpfCnpj deve conter um CPF ou CNPJ com apenas dígitos.");
  }
  const cep = entrada.pagador.cep.replace(/\D/g, "");
  if (!/^\d{8}$/.test(cep)) throw new TypeError("cep deve conter 8 dígitos.");
  const uf = entrada.pagador.uf.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(uf)) throw new TypeError("uf deve conter duas letras.");

  const mensagens = entrada.mensagensInstrucao?.map((mensagem, indice) =>
    validarTexto(mensagem, `mensagensInstrucao[${indice}]`, 40),
  );
  if (mensagens && mensagens.length > 5) {
    throw new TypeError("mensagensInstrucao aceita no máximo 5 mensagens.");
  }

  const politica = entrada.politica ?? {};
  const especie = entrada.codigoEspecieDocumento.trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(especie)) {
    throw new TypeError("codigoEspecieDocumento deve ter de 1 a 3 letras.");
  }
  const parcela = entrada.numeroParcela ?? 1;
  if (!Number.isSafeInteger(parcela) || parcela < 1 || parcela > 99) {
    throw new TypeError("numeroParcela deve ser um inteiro entre 1 e 99.");
  }
  const payload: Registro = {
    numeroCliente: entrada.conta.numeroCliente,
    codigoModalidade: entrada.conta.codigoModalidade,
    numeroContaCorrente: entrada.conta.numeroContaCorrente,
    codigoEspecieDocumento: especie,
    identificacaoEmissaoBoleto: entrada.identificacaoEmissaoBoleto ?? 1,
    identificacaoDistribuicaoBoleto: entrada.identificacaoDistribuicaoBoleto ?? 1,
    dataEmissao: entrada.dataEmissao,
    seuNumero: validarTexto(entrada.seuNumero, "seuNumero", 18),
    valor: centavosParaValorApi(entrada.valorCentavos),
    dataVencimento: entrada.dataVencimento,
    tipoDesconto: politica.tipoDesconto ?? 0,
    numeroParcela: parcela,
    aceite: entrada.aceite ?? false,
    tipoMulta: politica.tipoMulta ?? 0,
    tipoJurosMora: politica.tipoJurosMora ?? 3,
    codigoProtesto: politica.codigoProtesto ?? 3,
    codigoNegativacao: politica.codigoNegativacao ?? 3,
    pagador: {
      numeroCpfCnpj: cpfCnpj,
      nome: validarTexto(entrada.pagador.nome, "pagador.nome", 50),
      endereco: validarTexto(entrada.pagador.endereco, "pagador.endereco", 40),
      bairro: validarTexto(entrada.pagador.bairro, "pagador.bairro", 30),
      cidade: validarTexto(entrada.pagador.cidade, "pagador.cidade", 40),
      cep,
      uf,
      ...(entrada.pagador.email?.trim() ? { email: entrada.pagador.email.trim() } : {}),
    },
    gerarPdf: entrada.gerarPdf ?? false,
  };

  if (entrada.conta.numeroContratoCobranca !== undefined) {
    validarInteiroPositivo(
      entrada.conta.numeroContratoCobranca,
      "numeroContratoCobranca",
    );
    payload.numeroContratoCobranca = entrada.conta.numeroContratoCobranca;
  }
  if (entrada.identificacaoBoletoEmpresa) {
    payload.identificacaoBoletoEmpresa = validarTexto(
      entrada.identificacaoBoletoEmpresa,
      "identificacaoBoletoEmpresa",
      25,
    );
  }
  if (entrada.codigoCadastrarPix !== undefined) {
    payload.codigoCadastrarPIX = entrada.codigoCadastrarPix;
  }
  if (entrada.dataLimitePagamento) payload.dataLimitePagamento = entrada.dataLimitePagamento;
  if (mensagens?.length) payload.mensagensInstrucao = mensagens;
  if (politica.numeroDiasProtesto !== undefined) {
    validarInteiroPositivo(politica.numeroDiasProtesto, "numeroDiasProtesto");
    payload.numeroDiasProtesto = politica.numeroDiasProtesto;
  }
  if (politica.numeroDiasNegativacao !== undefined) {
    validarInteiroPositivo(politica.numeroDiasNegativacao, "numeroDiasNegativacao");
    payload.numeroDiasNegativacao = politica.numeroDiasNegativacao;
  }
  return payload;
}
