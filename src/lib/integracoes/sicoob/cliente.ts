import "server-only";

import { Buffer } from "node:buffer";

import {
  carregarConfiguracaoSicoob,
  type ConfiguracaoSicoob,
} from "./configuracao";
import { ErroApiSicoob, requisicaoHttpsJson, type RespostaHttp } from "./http";
import {
  LIMITES_ARQUIVO_MOVIMENTACAO_SICOOB,
  processarRespostaArquivoLiquidacoesSicoob,
} from "./movimentacoes";
import {
  montarPayloadEmissaoBoleto,
  normalizarBoletoSicoob,
} from "./normalizacao";
import type {
  BoletoSicoobNormalizado,
  ArquivoLiquidacoesSicoob,
  BaixarArquivoMovimentacaoSicoobDTO,
  ConsultarBoletoSicoobDTO,
  EmitirBoletoSicoobDTO,
  EstadoMovimentacaoSicoob,
  RegistrarWebhookBaixaOperacionalSicoobDTO,
  SolicitacaoMovimentacaoSicoob,
  SolicitarLiquidacoesSicoobDTO,
  WebhookSicoobRegistrado,
  WebhookSicoobDetalhe,
} from "./tipos";

type TokenEmCache = { token: string; expiraEm: number };
const tokens = new Map<string, TokenEmCache>();
const tokensEmAndamento = new Map<string, Promise<string>>();

function registro(valor: unknown): Record<string, unknown> | null {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

function textoIdentificador(valor: unknown): string | null {
  if (typeof valor === "string" && /^\d+$/.test(valor.trim())) return valor.trim();
  if (typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 0) {
    return String(valor);
  }
  return null;
}

function validarDataMovimentacao(valor: string, campo: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    throw new TypeError(`${campo} deve usar o formato AAAA-MM-DD.`);
  }
  const [ano, mes, dia] = valor.split("-").map(Number);
  const data = Date.UTC(ano, mes - 1, dia);
  const confirmacao = new Date(data);
  if (
    confirmacao.getUTCFullYear() !== ano ||
    confirmacao.getUTCMonth() !== mes - 1 ||
    confirmacao.getUTCDate() !== dia
  ) {
    throw new TypeError(`${campo} contém uma data inexistente.`);
  }
  return data;
}

async function solicitarToken(configuracao: ConfiguracaoSicoob): Promise<string> {
  if (configuracao.accessTokenEstatico) return configuracao.accessTokenEstatico;
  if (!configuracao.tokenUrl) {
    throw new ErroApiSicoob("URL OAuth do Sicoob não configurada.", {
      codigo: "SICOOB_OAUTH_INCOMPLETO",
    });
  }

  const formulario = new URLSearchParams({
    grant_type: "client_credentials",
    scope: configuracao.scopes,
  });
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (configuracao.tokenAuth === "basic" && configuracao.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(
      `${configuracao.clientId}:${configuracao.clientSecret}`,
    ).toString("base64")}`;
  } else {
    formulario.set("client_id", configuracao.clientId);
    if (configuracao.clientSecret) {
      formulario.set("client_secret", configuracao.clientSecret);
    }
  }

  const resposta = await requisicaoHttpsJson(new URL(configuracao.tokenUrl), configuracao, {
    metodo: "POST",
    headers: {
      ...headers,
      "Content-Length": String(Buffer.byteLength(formulario.toString())),
    },
    corpo: formulario.toString(),
  });
  const corpo = registro(resposta.corpo);
  const token = typeof corpo?.access_token === "string" ? corpo.access_token.trim() : "";
  if (!token) {
    throw new ErroApiSicoob("OAuth do Sicoob não retornou um token válido.", {
      codigo: "SICOOB_TOKEN_INVALIDO",
    });
  }
  const expiresInBruto = Number(corpo?.expires_in);
  const expiresIn = Number.isFinite(expiresInBruto) ? Math.max(60, expiresInBruto) : 300;
  tokens.set(configuracao.cacheTokenId, {
    token,
    expiraEm: Date.now() + expiresIn * 1_000,
  });
  return token;
}

async function obterToken(configuracao: ConfiguracaoSicoob): Promise<string> {
  if (configuracao.accessTokenEstatico) return configuracao.accessTokenEstatico;
  const cache = tokens.get(configuracao.cacheTokenId);
  if (cache && cache.expiraEm - 60_000 > Date.now()) return cache.token;

  const existente = tokensEmAndamento.get(configuracao.cacheTokenId);
  if (existente) return existente;
  const requisicao = solicitarToken(configuracao).finally(() => {
    tokensEmAndamento.delete(configuracao.cacheTokenId);
  });
  tokensEmAndamento.set(configuracao.cacheTokenId, requisicao);
  return requisicao;
}

function invalidarToken(configuracao: ConfiguracaoSicoob): void {
  if (!configuracao.accessTokenEstatico) tokens.delete(configuracao.cacheTokenId);
}

export class ClienteSicoob {
  private readonly configuracao: ConfiguracaoSicoob;

  constructor(configuracao: ConfiguracaoSicoob = carregarConfiguracaoSicoob()) {
    this.configuracao = configuracao;
  }

  private async chamarComResposta(
    metodo: "GET" | "POST" | "PATCH" | "DELETE",
    caminho: string,
    corpo?: Record<string, unknown>,
    controle: { repetirApos401?: boolean; maxRespostaBytes?: number } = {},
  ): Promise<RespostaHttp> {
    const repetirApos401 = controle.repetirApos401 ?? true;
    const token = await obterToken(this.configuracao);
    const serializado = corpo ? JSON.stringify(corpo) : undefined;
    try {
      return await requisicaoHttpsJson(
        new URL(caminho, `${this.configuracao.baseUrl}/`),
        this.configuracao,
        {
          metodo,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            client_id: this.configuracao.clientId,
            ...(serializado
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": String(Buffer.byteLength(serializado)),
                }
              : {}),
          },
          corpo: serializado,
          maxRespostaBytes: controle.maxRespostaBytes,
        },
      );
    } catch (erro) {
      if (
        repetirApos401 &&
        erro instanceof ErroApiSicoob &&
        erro.status === 401 &&
        !this.configuracao.accessTokenEstatico
      ) {
        invalidarToken(this.configuracao);
        return this.chamarComResposta(metodo, caminho, corpo, {
          ...controle,
          repetirApos401: false,
        });
      }
      throw erro;
    }
  }

  private async chamar(
    metodo: "GET" | "POST" | "PATCH" | "DELETE",
    caminho: string,
    corpo?: Record<string, unknown>,
    controle: { repetirApos401?: boolean; maxRespostaBytes?: number } = {},
  ): Promise<unknown> {
    return (await this.chamarComResposta(metodo, caminho, corpo, controle)).corpo;
  }

  async emitirBoleto(entrada: EmitirBoletoSicoobDTO): Promise<BoletoSicoobNormalizado> {
    const resposta = await this.chamar("POST", "boletos", montarPayloadEmissaoBoleto(entrada));
    const boleto = normalizarBoletoSicoob(resposta);
    if (!boleto.nossoNumero) {
      throw new ErroApiSicoob("Sicoob registrou resposta sem nosso número.", {
        codigo: "SICOOB_RESPOSTA_INVALIDA",
      });
    }
    return boleto;
  }

  async consultarBoleto(
    entrada: ConsultarBoletoSicoobDTO,
  ): Promise<BoletoSicoobNormalizado> {
    if (!Number.isSafeInteger(entrada.conta.numeroCliente) || entrada.conta.numeroCliente <= 0) {
      throw new TypeError("numeroCliente deve ser um inteiro positivo.");
    }
    if (
      !Number.isSafeInteger(entrada.conta.codigoModalidade) ||
      entrada.conta.codigoModalidade <= 0
    ) {
      throw new TypeError("codigoModalidade deve ser um inteiro positivo.");
    }
    const identificadores = [
      entrada.nossoNumero,
      entrada.linhaDigitavel,
      entrada.codigoBarras,
    ].filter((valor) => valor?.trim());
    if (identificadores.length !== 1) {
      throw new TypeError(
        "Informe exatamente um identificador: nossoNumero, linhaDigitavel ou codigoBarras.",
      );
    }
    for (const identificador of identificadores) {
      if (!/^\d+$/.test(identificador!)) {
        throw new TypeError("O identificador bancário deve conter apenas dígitos.");
      }
    }
    const query = new URLSearchParams({
      numeroCliente: String(entrada.conta.numeroCliente),
      codigoModalidade: String(entrada.conta.codigoModalidade),
    });
    if (entrada.nossoNumero) query.set("nossoNumero", entrada.nossoNumero.trim());
    if (entrada.linhaDigitavel) query.set("linhaDigitavel", entrada.linhaDigitavel.trim());
    if (entrada.codigoBarras) query.set("codigoBarras", entrada.codigoBarras.trim());
    if (entrada.conta.numeroContratoCobranca !== undefined) {
      query.set("numeroContratoCobranca", String(entrada.conta.numeroContratoCobranca));
    }
    return normalizarBoletoSicoob(await this.chamar("GET", `boletos?${query}`));
  }

  /**
   * Experimental enquanto as credenciais reais não forem homologadas no portal.
   * O contrato v3 retorna somente idWebhook no POST; por isso o estado inicial é
   * presumido e deve ser confirmado pelo endpoint de consulta do Sicoob. O evento
   * tipo 7 é uma baixa operacional: nunca deve marcar um recebimento como pago.
   * Confirme a liquidação com GET /boletos ou com a movimentação tipo 5 (LIQUI).
   */
  async registrarWebhookBaixaOperacionalExperimental(
    entrada: RegistrarWebhookBaixaOperacionalSicoobDTO,
  ): Promise<WebhookSicoobRegistrado> {
    let url: URL;
    try {
      url = new URL(entrada.url);
    } catch {
      throw new TypeError("A URL do webhook é inválida.");
    }
    if (url.protocol !== "https:") {
      throw new TypeError("A URL do webhook deve usar HTTPS.");
    }
    if (url.username || url.password || url.hash) {
      throw new TypeError("A URL do webhook não pode conter credenciais ou fragmento.");
    }
    const email = entrada.email?.trim();
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      throw new TypeError("O e-mail do webhook é inválido.");
    }
    const resposta = await this.chamar("POST", "webhooks", {
      url: url.toString(),
      codigoTipoMovimento: 7,
      codigoPeriodoMovimento: 1,
      ...(email ? { email } : {}),
    });
    const raiz = registro(resposta);
    const resultado = registro(raiz?.resultado) ?? raiz;
    const idBruto = resultado?.idWebhook;
    const idWebhook =
      typeof idBruto === "string" ||
      (typeof idBruto === "number" && Number.isSafeInteger(idBruto))
        ? String(idBruto).trim()
        : "";
    if (!idWebhook || !/^\d+$/.test(idWebhook)) {
      throw new ErroApiSicoob("Sicoob respondeu ao cadastro sem idWebhook válido.", {
        codigo: "SICOOB_WEBHOOK_RESPOSTA_INVALIDA",
      });
    }
    return {
      idWebhook,
      status: "AGUARDANDO_VALIDACAO",
      statusConfirmado: false,
    };
  }

  async consultarWebhookBaixaOperacional(
    idWebhook: string,
  ): Promise<WebhookSicoobDetalhe | null> {
    if (!/^\d{1,19}$/.test(idWebhook) || Number(idWebhook) <= 0) {
      throw new TypeError("idWebhook deve conter um inteiro positivo.");
    }
    const query = new URLSearchParams({ idWebhook, codigoTipoMovimento: "7" });
    const resposta = await this.chamarComResposta("GET", `webhooks?${query}`);
    if (resposta.status === 204) return null;
    const raiz = registro(resposta.corpo);
    const bruto = Array.isArray(raiz?.resultado) ? raiz.resultado : [];
    const item = bruto.find((valor) => {
      const objeto = registro(valor);
      return textoIdentificador(objeto?.idWebhook) === idWebhook;
    });
    const objeto = registro(item);
    const codigoSituacao = objeto?.codigoSituacao;
    if (
      !objeto ||
      objeto.codigoTipoMovimento !== 7 ||
      (codigoSituacao !== 1 && codigoSituacao !== 2 && codigoSituacao !== 3) ||
      typeof objeto.url !== "string"
    ) {
      if (bruto.length === 0) return null;
      throw new ErroApiSicoob("Sicoob retornou um webhook com formato inesperado.", {
        codigo: "SICOOB_WEBHOOK_RESPOSTA_INVALIDA",
      });
    }
    return {
      idWebhook,
      url: objeto.url,
      codigoSituacao,
      status:
        codigoSituacao === 1
          ? "AGUARDANDO_VALIDACAO"
          : codigoSituacao === 2
            ? "VALIDADO"
            : "INATIVO",
      statusConfirmado: true,
    };
  }

  async atualizarWebhookBaixaOperacional(
    idWebhook: string,
    entrada: RegistrarWebhookBaixaOperacionalSicoobDTO,
  ): Promise<void> {
    if (!/^\d{1,19}$/.test(idWebhook) || Number(idWebhook) <= 0) {
      throw new TypeError("idWebhook deve conter um inteiro positivo.");
    }
    const url = new URL(entrada.url);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      throw new TypeError("A URL do webhook deve ser HTTPS e não conter credenciais.");
    }
    const email = entrada.email?.trim();
    await this.chamar("PATCH", `webhooks/${encodeURIComponent(idWebhook)}`, {
      url: url.toString(),
      ...(email ? { email } : {}),
    });
  }

  async reativarWebhookBaixaOperacional(idWebhook: string): Promise<void> {
    if (!/^\d{1,19}$/.test(idWebhook) || Number(idWebhook) <= 0) {
      throw new TypeError("idWebhook deve conter um inteiro positivo.");
    }
    await this.chamar("PATCH", `webhooks/${encodeURIComponent(idWebhook)}/reativar`);
  }

  /**
   * Solicita o arquivo assíncrono de LIQUIDAÇÕES (tipo 5). Ao contrário do
   * webhook tipo 7, este movimento é evidência bancária de liquidação.
   */
  async solicitarMovimentacoesLiquidacao(
    entrada: SolicitarLiquidacoesSicoobDTO,
  ): Promise<SolicitacaoMovimentacaoSicoob> {
    if (!Number.isSafeInteger(entrada.numeroCliente) || entrada.numeroCliente <= 0) {
      throw new TypeError("numeroCliente deve ser um inteiro positivo.");
    }
    const inicio = validarDataMovimentacao(entrada.dataInicial, "dataInicial");
    const fim = validarDataMovimentacao(entrada.dataFinal, "dataFinal");
    if (fim < inicio || fim - inicio > 86_400_000) {
      throw new TypeError("O período de movimentação deve ter no máximo dois dias.");
    }
    const resposta = await this.chamar("POST", "boletos/movimentacoes", {
      numeroCliente: entrada.numeroCliente,
      tipoMovimento: 5,
      dataInicial: entrada.dataInicial,
      dataFinal: entrada.dataFinal,
    });
    const raiz = registro(resposta);
    const resultado = registro(raiz?.resultado) ?? raiz;
    const codigoSolicitacao = textoIdentificador(resultado?.codigoSolicitacao);
    if (!codigoSolicitacao) {
      throw new ErroApiSicoob("Sicoob não retornou o código da movimentação.", {
        codigo: "SICOOB_MOVIMENTACAO_RESPOSTA_INVALIDA",
      });
    }
    return {
      codigoSolicitacao,
      mensagem:
        typeof resultado?.mensagem === "string" ? resultado.mensagem.trim().slice(0, 300) : null,
    };
  }

  async consultarMovimentacoes(
    numeroCliente: number,
    codigoSolicitacao: string,
  ): Promise<EstadoMovimentacaoSicoob> {
    if (!Number.isSafeInteger(numeroCliente) || numeroCliente <= 0) {
      throw new TypeError("numeroCliente deve ser um inteiro positivo.");
    }
    if (!/^\d+$/.test(codigoSolicitacao)) {
      throw new TypeError("codigoSolicitacao deve conter apenas dígitos.");
    }
    const query = new URLSearchParams({
      numeroCliente: String(numeroCliente),
      codigoSolicitacao,
    });
    const resposta = await this.chamarComResposta("GET", `boletos/movimentacoes?${query}`);
    if (resposta.status === 204) {
      return {
        pronto: false,
        semRegistros: true,
        quantidadeArquivos: 0,
        quantidadeTotalRegistros: 0,
        idsArquivos: [],
      };
    }
    const raiz = registro(resposta.corpo);
    const resultado = registro(raiz?.resultado) ?? raiz;
    if (!resultado || !Array.isArray(resultado.idArquivos)) {
      throw new ErroApiSicoob("Sicoob retornou estado inválido da movimentação.", {
        codigo: "SICOOB_MOVIMENTACAO_RESPOSTA_INVALIDA",
      });
    }
    const ids = resultado.idArquivos.map(textoIdentificador);
    if (ids.some((id) => id === null || Number(id) <= 0)) {
      throw new ErroApiSicoob("Sicoob retornou identificador de arquivo inválido.", {
        codigo: "SICOOB_MOVIMENTACAO_RESPOSTA_INVALIDA",
      });
    }
    const idsValidos = ids as string[];
    if (new Set(idsValidos).size !== idsValidos.length) {
      throw new ErroApiSicoob("Sicoob retornou arquivos duplicados na movimentação.", {
        codigo: "SICOOB_MOVIMENTACAO_RESPOSTA_INVALIDA",
      });
    }
    const quantidade =
      typeof resultado?.quantidadeArquivo === "number" &&
      Number.isSafeInteger(resultado.quantidadeArquivo) &&
      resultado.quantidadeArquivo >= 0
        ? resultado.quantidadeArquivo
        : null;
    const total =
      typeof resultado?.quantidadeTotalRegistros === "number" &&
      Number.isSafeInteger(resultado.quantidadeTotalRegistros) &&
      resultado.quantidadeTotalRegistros >= 0
        ? resultado.quantidadeTotalRegistros
        : null;
    if (quantidade === null || quantidade !== idsValidos.length || total === null) {
      throw new ErroApiSicoob("Sicoob retornou uma lista parcial de arquivos.", {
        codigo: "SICOOB_MOVIMENTACAO_RESPOSTA_INVALIDA",
      });
    }
    return {
      pronto: true,
      semRegistros: quantidade === 0 && total === 0,
      quantidadeArquivos: quantidade,
      quantidadeTotalRegistros: total,
      idsArquivos: idsValidos,
    };
  }

  /**
   * Baixa um dos ZIPs indicados por consultarMovimentacoes e só retorna
   * registros depois de validar Base64, estrutura ZIP, CRC, UTF-8 e o layout
   * oficial do movimento 5/LIQUI. Nada é extraído para o sistema de arquivos.
   */
  async baixarArquivoMovimentacoesLiquidacao(
    entrada: BaixarArquivoMovimentacaoSicoobDTO,
  ): Promise<ArquivoLiquidacoesSicoob> {
    if (!Number.isSafeInteger(entrada.numeroCliente) || entrada.numeroCliente <= 0) {
      throw new TypeError("numeroCliente deve ser um inteiro positivo.");
    }
    for (const [campo, valor] of [
      ["codigoSolicitacao", entrada.codigoSolicitacao],
      ["idArquivo", entrada.idArquivo],
    ] as const) {
      if (!/^\d{1,10}$/.test(valor) || Number(valor) > 2_147_483_647 || Number(valor) <= 0) {
        throw new TypeError(`${campo} deve ser um inteiro positivo de 32 bits.`);
      }
    }
    const query = new URLSearchParams({
      numeroCliente: String(entrada.numeroCliente),
      codigoSolicitacao: entrada.codigoSolicitacao,
      idArquivo: entrada.idArquivo,
    });
    const resposta = await this.chamar(
      "GET",
      `boletos/movimentacoes/download?${query}`,
      undefined,
      {
        maxRespostaBytes:
          LIMITES_ARQUIVO_MOVIMENTACAO_SICOOB.maximoCaracteresBase64 + 1024 * 1024,
      },
    );
    return processarRespostaArquivoLiquidacoesSicoob(resposta, entrada);
  }
}

export function criarClienteSicoob(
  configuracao: ConfiguracaoSicoob = carregarConfiguracaoSicoob(),
): ClienteSicoob {
  return new ClienteSicoob(configuracao);
}
