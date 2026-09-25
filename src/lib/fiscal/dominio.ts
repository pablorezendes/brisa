import { createHash } from "node:crypto";

export const MUNICIPIO_GOIANIA = "5208707";
export const ROTA_FISCAL = "/financeiro/notas-fiscais";
export type AmbienteFiscal = "HOMOLOGACAO" | "PRODUCAO";
export type PayloadFiscal = Record<string, string | number>;

export class ErroFiscal extends Error {
  constructor(message: string) { super(message); this.name = "ErroFiscal"; }
}

export function textoFiscal(valor: unknown, rotulo: string, max: number, obrigatorio = true): string {
  const texto = typeof valor === "string" ? valor.trim() : "";
  if ((obrigatorio && !texto) || texto.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(texto)) {
    throw new ErroFiscal(`${rotulo}: informe um texto válido com até ${max} caracteres.`);
  }
  return texto;
}

function digitos(valor: unknown, rotulo: string, tamanho: number): string {
  const texto = textoFiscal(valor, rotulo, 40).replace(/[.\-/\s]/g, "");
  if (!new RegExp(`^\\d{${tamanho}}$`).test(texto)) throw new ErroFiscal(`${rotulo}: informe ${tamanho} dígitos.`);
  return texto;
}

/** CPF e CNPJ numéricos; o cadastro alfanumérico é bloqueado até homologação específica. */
export function documentoFiscal(valor: unknown, somenteCnpj = false): string {
  const documento = textoFiscal(valor, "CPF/CNPJ", 24).replace(/[.\-/\s]/g, "");
  if (!/^\d+$/.test(documento) || /^(\d)\1+$/.test(documento) ||
    ![...(somenteCnpj ? [] : [11]), 14].includes(documento.length)) {
    throw new ErroFiscal("Informe um CPF/CNPJ numérico válido. CNPJ alfanumérico ainda requer homologação específica.");
  }
  const numeros = [...documento].map(Number);
  const digito = (base: number[], pesos: number[]) => {
    const resto = base.reduce((total, n, i) => total + n * pesos[i], 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const base = numeros.slice(0, -2);
  const pesos1 = documento.length === 11 ? [10,9,8,7,6,5,4,3,2] : [5,4,3,2,9,8,7,6,5,4,3,2];
  const pesos2 = documento.length === 11 ? [11,10,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
  const d1 = digito(base, pesos1);
  if (d1 !== numeros.at(-2) || digito([...base, d1], pesos2) !== numeros.at(-1)) {
    throw new ErroFiscal("CPF/CNPJ com dígitos verificadores inválidos.");
  }
  return documento;
}

export function valorFiscal(texto: unknown): number {
  const bruto = textoFiscal(texto, "Valor do serviço", 20);
  // Não aceita agrupadores ambíguos, notação científica nem arredondamento silencioso.
  if (!/^\d{1,8}(?:[.,]\d{1,2})?$/.test(bruto)) throw new ErroFiscal("Use o valor sem separador de milhar, com no máximo duas casas decimais.");
  const [inteiros, fracao = ""] = bruto.split(/[.,]/);
  const centavos = Number(inteiros) * 100 + Number(fracao.padEnd(2, "0"));
  if (!Number.isSafeInteger(centavos) || centavos < 1 || centavos > 2_147_483_647) throw new ErroFiscal("Valor do serviço fora do limite suportado.");
  return centavos;
}

export function hashFiscal(valor: unknown): string {
  return createHash("sha256").update(JSON.stringify(valor)).digest("hex");
}

export function ambienteFiscal(valor: unknown): AmbienteFiscal {
  if (valor !== "HOMOLOGACAO" && valor !== "PRODUCAO") throw new ErroFiscal("Ambiente fiscal inválido.");
  return valor;
}

export type ParametrosFiscais = {
  codigoTributacaoNacional: string; codigoTributacaoMunicipal: string; codigoNbs: string;
  opcaoSimples: string; regimeApuracao: string; regimeEspecial: string;
  codigoIndicadorOperacao: string; cstIbsCbs: string; classificacaoIbsCbs: string;
  tributosModo: string; tributosFederal: string; tributosEstadual: string; tributosMunicipal: string; tributosSimples: string;
  serieDps: string; proximoDps: string;
};

export const PARAMETROS_VAZIOS: ParametrosFiscais = {
  codigoTributacaoNacional: "", codigoTributacaoMunicipal: "", codigoNbs: "", opcaoSimples: "", regimeApuracao: "", regimeEspecial: "",
  codigoIndicadorOperacao: "", cstIbsCbs: "", classificacaoIbsCbs: "", tributosModo: "", tributosFederal: "", tributosEstadual: "", tributosMunicipal: "", tributosSimples: "", serieDps: "", proximoDps: "",
};

export function lerParametrosFiscais(texto: string): ParametrosFiscais {
  try {
    const dados = JSON.parse(texto);
    return Object.fromEntries(Object.entries(PARAMETROS_VAZIOS).map(([key, padrao]) => [key, typeof dados?.[key] === "string" ? dados[key] : padrao])) as ParametrosFiscais;
  } catch { return { ...PARAMETROS_VAZIOS }; }
}

function opcao(valor: string, opcoes: string[], rotulo: string): string {
  if (!opcoes.includes(valor)) throw new ErroFiscal(`Selecione ${rotulo}.`);
  return valor;
}

function percentual(valor: string, rotulo: string): number {
  if (!/^\d{1,2}(?:[.,]\d{1,2})?$/.test(valor)) throw new ErroFiscal(`${rotulo}: informe um percentual entre 0 e 99,99.`);
  return Number(valor.replace(",", "."));
}

export function validarParametrosFiscais(p: ParametrosFiscais): PayloadFiscal {
  const resultado: PayloadFiscal = {
    codigo_tributacao_nacional_iss: digitos(p.codigoTributacaoNacional, "Código de tributação nacional", 6),
    codigo_nbs: digitos(p.codigoNbs, "NBS", 9),
    codigo_opcao_simples_nacional: Number(opcao(p.opcaoSimples, ["1", "3"], "o enquadramento. MEI exige outro fluxo")),
    regime_especial_tributacao: Number(opcao(p.regimeEspecial, ["0"], "o regime normal. Regimes especiais exigem homologação adicional")),
    codigo_indicador_operacao: digitos(p.codigoIndicadorOperacao, "Indicador da operação IBS/CBS", 6),
    ibs_cbs_situacao_tributaria: digitos(p.cstIbsCbs, "CST IBS/CBS", 3),
    ibs_cbs_classificacao_tributaria: digitos(p.classificacaoIbsCbs, "Classificação IBS/CBS", 6),
    tributacao_iss: 1,
    tipo_retencao_iss: 1,
    finalidade_emissao: 0,
    indicador_destinatario: 0,
  };
  // NotaControl 1.01 (03/08/2026), p.7: Goiânia parametriza a alíquota, exceto
  // incidência fora do município ou Simples com retenção. Ambos estão fora
  // deste fluxo (prestação local, ISS não retido); portanto não inventar pAliq.
  if (p.codigoTributacaoMunicipal) resultado.codigo_tributacao_municipal_iss = digitos(p.codigoTributacaoMunicipal, "Tributação municipal", 3);
  if (p.opcaoSimples === "3") resultado.regime_tributario_simples_nacional = Number(opcao(p.regimeApuracao, ["1", "2", "3"], "o regime de apuração do Simples"));
  const modo = opcao(p.tributosModo, ["PERCENTUAIS", "SIMPLES", "NAO_INFORMAR"], "a regra dos tributos aproximados");
  if (modo === "SIMPLES") {
    if (p.opcaoSimples !== "3") throw new ErroFiscal("Tributos aproximados do Simples requerem emitente optante ME/EPP.");
    resultado.percentual_total_tributos_simples_nacional = percentual(p.tributosSimples, "Tributos do Simples");
  } else if (modo === "PERCENTUAIS") {
    resultado.percentual_total_tributos_federais = percentual(p.tributosFederal, "Tributos federais");
    resultado.percentual_total_tributos_estaduais = percentual(p.tributosEstadual, "Tributos estaduais");
    resultado.percentual_total_tributos_municipais = percentual(p.tributosMunicipal, "Tributos municipais");
  } else resultado.indicador_total_tributacao = 0;
  if (!/^\d{1,5}$/.test(p.serieDps) || Number(p.serieDps) < 1 || Number(p.serieDps) > 49999) throw new ErroFiscal("Série DPS deve estar entre 1 e 49999 e liberada pelo provedor.");
  if (!/^\d{1,15}$/.test(p.proximoDps) || Number(p.proximoDps) < 1) throw new ErroFiscal("Informe o próximo número DPS liberado pelo provedor.");
  return resultado;
}

export type ConfigFiscalBase = {
  ambiente: string; emitenteCnpj: string; inscricaoMunicipal: string; razaoSocial: string;
  codigoMunicipio: string; parametros: string;
};

/** Sequencial fica fora da impressão digital, pois a reserva de outra DPS não invalida uma nota. */
export function hashConfiguracaoFiscal(config: ConfigFiscalBase): string {
  const p = lerParametrosFiscais(config.parametros);
  return hashFiscal({ ambiente: config.ambiente, emitenteCnpj: config.emitenteCnpj, inscricaoMunicipal: config.inscricaoMunicipal,
    razaoSocial: config.razaoSocial, codigoMunicipio: config.codigoMunicipio, parametros: { ...p, proximoDps: "" } });
}

export function validarEmitente(config: ConfigFiscalBase): void {
  ambienteFiscal(config.ambiente);
  documentoFiscal(config.emitenteCnpj, true);
  textoFiscal(config.razaoSocial, "Razão social", 150);
  if (!/^[A-Za-z0-9.-]{1,15}$/.test(config.inscricaoMunicipal)) throw new ErroFiscal("Informe a inscrição municipal com até 15 caracteres.");
  if (config.codigoMunicipio !== MUNICIPIO_GOIANIA) throw new ErroFiscal("Este adaptador foi preparado exclusivamente para prestadores de Goiânia/GO.");
  validarParametrosFiscais(lerParametrosFiscais(config.parametros));
}

export type RascunhoFiscal = {
  origemChave: string; competencia: string; tomadorNome: string; tomadorDocumento: string;
  valorServico: string; descricao: string; municipioTomador: string; cepTomador: string;
  logradouroTomador: string; numeroTomador: string; bairroTomador: string; complementoTomador: string;
  consumidorFinal: string;
};

export function montarPayloadFiscal(config: ConfigFiscalBase, dados: RascunhoFiscal, emissao = new Date()): PayloadFiscal {
  validarEmitente(config);
  const competencia = textoFiscal(dados.competencia, "Data de competência", 10);
  const data = new Date(`${competencia}T12:00:00Z`);
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(emissao);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(competencia) || Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== competencia || competencia > hoje || competencia < "2026-01-01") throw new ErroFiscal("Competência inválida: use uma data real de 2026 em diante, não futura.");
  const documento = documentoFiscal(dados.tomadorDocumento);
  const parametros = lerParametrosFiscais(config.parametros);
  const payload: PayloadFiscal = {
    ...validarParametrosFiscais(parametros),
    data_emissao: emissao.toISOString(), data_competencia: competencia, emitente_dps: 1,
    serie_dps: Number(parametros.serieDps), numero_dps: Number(parametros.proximoDps),
    codigo_municipio_emissora: Number(MUNICIPIO_GOIANIA), codigo_municipio_prestacao: Number(MUNICIPIO_GOIANIA),
    cnpj_prestador: config.emitenteCnpj, inscricao_municipal_prestador: config.inscricaoMunicipal,
    ...(documento.length === 11 ? { cpf_tomador: documento } : { cnpj_tomador: documento }),
    razao_social_tomador: textoFiscal(dados.tomadorNome, "Nome do tomador", 150),
    codigo_municipio_tomador: Number(digitos(dados.municipioTomador, "Município do tomador", 7)),
    cep_tomador: digitos(dados.cepTomador, "CEP do tomador", 8),
    logradouro_tomador: textoFiscal(dados.logradouroTomador, "Logradouro", 255),
    numero_tomador: textoFiscal(dados.numeroTomador, "Número do endereço", 60),
    bairro_tomador: textoFiscal(dados.bairroTomador, "Bairro", 60),
    descricao_servico: textoFiscal(dados.descricao, "Descrição do serviço", 1000),
    valor_servico: valorFiscal(dados.valorServico) / 100,
    consumidor_final: Number(opcao(dados.consumidorFinal, ["0", "1"], "a destinação para consumo pessoal")),
  };
  const complemento = textoFiscal(dados.complementoTomador, "Complemento", 156, false);
  if (complemento) payload.complemento_tomador = complemento;
  return payload;
}

export function chaveFiscal(config: ConfigFiscalBase, origem: string): string {
  const chave = textoFiscal(origem, "Identificador da prestação", 140).normalize("NFKC").toUpperCase().replace(/\s+/g, " ");
  return hashFiscal(["nfse-goiania-v1", config.emitenteCnpj, ambienteFiscal(config.ambiente), chave]);
}

export const STATUS_FISCAIS: Record<string, string> = {
  RASCUNHO: "Rascunho", APROVADA: "Aprovada · pronta", TRANSMITINDO: "Transmitindo",
  PROCESSANDO: "Aguardando autorização", AUTORIZADA: "Autorizada", REJEITADA: "Rejeitada · corrigir",
  INCERTA: "Resultado incerto · consultar", CANCELADA: "Cancelada no órgão",
};
