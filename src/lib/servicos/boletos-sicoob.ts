import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { Boleto, ContaBancaria, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  avaliarConciliacao,
  boletoEstaAtivo,
  camposPagadorPendentes,
  STATUS_BOLETO_ATIVOS,
  totalDevido,
} from "@/lib/dominio/boletos";
import {
  criarClienteSicoob,
  chaveIdempotenciaLiquidacaoSicoob,
  ErroApiSicoob,
  extrairIdentificadoresEventoSicoob,
  hashCanonicoEventoSicoob,
  chaveIdempotenciaEventoSicoob,
  carregarConfiguracaoSicoob,
  obterEstadoConfiguracaoSicoob,
  type BoletoSicoobNormalizado,
  type ContaCobrancaSicoobDTO,
  type LiquidacaoMovimentacaoSicoob,
  type StatusBoletoSicoob,
} from "@/lib/integracoes/sicoob";

type ResultadoEmissao = { boleto: Boleto; reutilizado: boolean };
type ResultadoWebhook = {
  duplicado: boolean;
  validacao: boolean;
  boletoEncontrado: boolean;
  boletoId: string | null;
};

const MODALIDADES_SICOOB = new Set([1, 3, 4, 5, 8]);
const ESPECIES_DOCUMENTO_SICOOB = new Set([
  "CH", "DM", "DMI", "DS", "DSI", "DR", "LC", "NCC", "NCE", "NCI", "NCR",
  "NP", "NPR", "TM", "TS", "NS", "RC", "FAT", "ND", "AP", "ME", "PC", "NF",
  "DD", "CC", "BDP", "OU",
]);
const MENSAGEM_CONFLITO_REEMISSAO =
  "Um boleto anterior foi liquidado enquanto uma reemissão ainda está ativa. Confira e baixe/cancele a cobrança mais nova no Sicoob antes de conciliar.";

export class ErroOperacaoBoleto extends Error {
  readonly codigo: string;

  constructor(mensagem: string, codigo = "BOLETO_OPERACAO_INVALIDA") {
    super(mensagem);
    this.name = "ErroOperacaoBoleto";
    this.codigo = codigo;
  }
}

function textoErroSeguro(erro: unknown): string {
  const mensagem = erro instanceof Error ? erro.message : "Falha inesperada na integração.";
  return mensagem
    .replace(/\b\d{11,14}\b/g, "[documento oculto]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 300);
}

function inteiroPositivo(
  valor: string | null,
  campo: string,
  maximo = Number.MAX_SAFE_INTEGER,
): number {
  if (!valor || !/^\d+$/.test(valor)) {
    throw new ErroOperacaoBoleto(`${campo} não foi configurado para esta conta.`);
  }
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero <= 0 || numero > maximo) {
    throw new ErroOperacaoBoleto(`${campo} deve ser um inteiro positivo válido.`);
  }
  return numero;
}

function contaParaApi(conta: ContaBancaria): ContaCobrancaSicoobDTO {
  if (!conta.codigoModalidade || !MODALIDADES_SICOOB.has(conta.codigoModalidade)) {
    throw new ErroOperacaoBoleto("Código da modalidade não configurado para esta conta.");
  }
  const numeroContaCorrente = inteiroPositivo(
    conta.numeroContaCorrenteApi,
    "Número da conta corrente para a API",
    2_147_483_647,
  );
  return {
    numeroCliente: inteiroPositivo(
      conta.numeroCliente,
      "Número do cliente Sisbr",
      2_147_483_647,
    ),
    codigoModalidade: conta.codigoModalidade,
    numeroContaCorrente,
    ...(conta.numeroContratoCobranca
      ? {
          numeroContratoCobranca: inteiroPositivo(
            conta.numeroContratoCobranca,
            "Número do contrato de cobrança",
          ),
        }
      : {}),
  };
}

function contaDoBoletoParaApi(
  boleto: Pick<
    Boleto,
    | "numeroClienteBanco"
    | "codigoModalidadeBanco"
    | "numeroContaBanco"
    | "contratoCobrancaBanco"
  >,
): ContaCobrancaSicoobDTO {
  return {
    numeroCliente: boleto.numeroClienteBanco,
    codigoModalidade: boleto.codigoModalidadeBanco,
    numeroContaCorrente: boleto.numeroContaBanco,
    ...(boleto.contratoCobrancaBanco
      ? { numeroContratoCobranca: boleto.contratoCobrancaBanco }
      : {}),
  };
}

function hojeNoBrasil(): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const porTipo = new Map(partes.map((parte) => [parte.type, parte.value]));
  return `${porTipo.get("year")}-${porTipo.get("month")}-${porTipo.get("day")}`;
}

function dataCivilNoBrasil(instanteIso: string): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instanteIso));
  const porTipo = new Map(partes.map((parte) => [parte.type, parte.value]));
  return `${porTipo.get("year")}-${porTipo.get("month")}-${porTipo.get("day")}`;
}

function diaAnterior(dataCivil: string): string {
  const [ano, mes, dia] = dataCivil.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  data.setUTCDate(data.getUTCDate() - 1);
  return data.toISOString().slice(0, 10);
}

function adicionarDias(dataCivil: string, dias: number): string {
  const [ano, mes, dia] = dataCivil.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

function validarDataCivil(valor: string, campo: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!match) throw new ErroOperacaoBoleto(`${campo} deve usar o formato AAAA-MM-DD.`);
  const data = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    data.getUTCFullYear() !== Number(match[1]) ||
    data.getUTCMonth() !== Number(match[2]) - 1 ||
    data.getUTCDate() !== Number(match[3])
  ) {
    throw new ErroOperacaoBoleto(`${campo} contém uma data inexistente.`);
  }
}

function chaveHex(...partes: string[]): string {
  return createHash("sha256").update(partes.join(":"), "utf8").digest("hex");
}

function seuNumero(chaveIdempotencia: string): string {
  return `BR${chaveIdempotencia.slice(0, 16).toUpperCase()}`;
}

function ambienteCompativel(conta: ContaBancaria): void {
  const estado = obterEstadoConfiguracaoSicoob();
  const esperado = estado.ambiente === "producao" ? "PRODUCAO" : "SANDBOX";
  if (conta.ambiente !== esperado) {
    throw new ErroOperacaoBoleto(
      `A conta está em ${conta.ambiente}, mas o servidor está configurado para ${esperado}.`,
      "SICOOB_AMBIENTE_DIVERGENTE",
    );
  }
  if (!estado.configurado) {
    throw new ErroOperacaoBoleto(
      `Integração Sicoob incompleta: ${estado.pendencias.join(", ")}.`,
      "SICOOB_CONFIGURACAO_INCOMPLETA",
    );
  }
}

function ambienteDoBoletoCompativel(boleto: Pick<Boleto, "ambienteBanco">): void {
  const estado = obterEstadoConfiguracaoSicoob();
  const esperado = estado.ambiente === "producao" ? "PRODUCAO" : "SANDBOX";
  if (boleto.ambienteBanco !== esperado) {
    throw new ErroOperacaoBoleto(
      `O título pertence a ${boleto.ambienteBanco}, mas o servidor está em ${esperado}.`,
      "SICOOB_AMBIENTE_DIVERGENTE",
    );
  }
  if (!estado.configurado) {
    throw new ErroOperacaoBoleto(
      `Integração Sicoob incompleta: ${estado.pendencias.join(", ")}.`,
      "SICOOB_CONFIGURACAO_INCOMPLETA",
    );
  }
}

function erroDeUnicidade(erro: unknown): boolean {
  return Boolean(
    erro &&
      typeof erro === "object" &&
      "code" in erro &&
      (erro as { code?: unknown }).code === "P2002",
  );
}

function validarContaIntegrada(conta: ContaBancaria): void {
  if (conta.codigoBanco !== "756") {
    throw new ErroOperacaoBoleto(
      "Somente contas do banco 756 podem usar a integração Sicoob.",
      "BANCO_INCOMPATIVEL",
    );
  }
  if (!conta.ativa || !conta.integracaoHabilitada) {
    throw new ErroOperacaoBoleto(
      "A conta não está ativa e habilitada para a integração Sicoob.",
      "CONTA_NAO_HABILITADA",
    );
  }
  ambienteCompativel(conta);
}

function validarContaEmissora(conta: ContaBancaria): void {
  validarContaIntegrada(conta);
  if (!conta.boletosHabilitados) {
    throw new ErroOperacaoBoleto(
      "A emissão de boletos está desabilitada para esta conta.",
      "CONTA_NAO_HABILITADA",
    );
  }
  if (
    !conta.codigoEspecieDocumento ||
    !ESPECIES_DOCUMENTO_SICOOB.has(conta.codigoEspecieDocumento)
  ) {
    throw new ErroOperacaoBoleto(
      "Configure a espécie do documento (RC, DS, DM...) conforme o convênio Sicoob.",
      "ESPECIE_DOCUMENTO_PENDENTE",
    );
  }
}

async function validarPerfilCredencialUnico(contaBancariaId: string): Promise<void> {
  const outras = await prisma.contaBancaria.count({
    where: {
      id: { not: contaBancariaId },
      ativa: true,
      integracaoHabilitada: true,
    },
  });
  if (outras > 0) {
    throw new ErroOperacaoBoleto(
      "Mais de uma conta está ligada ao perfil global de credencial Sicoob; desabilite as demais antes de operar.",
      "SICOOB_PERFIL_CREDENCIAL_AMBIGUO",
    );
  }
}

function statusLocal(
  retorno: BoletoSicoobNormalizado,
  boletoAtual?: Pick<Boleto, "status" | "dataVencimento">,
): string {
  const fallback =
    boletoAtual?.status && !["RASCUNHO", "EMITINDO"].includes(boletoAtual.status)
      ? boletoAtual.status
      : "REGISTRADO";
  const mapa: Record<StatusBoletoSicoob, string> = {
    REGISTRADO: "REGISTRADO",
    VENCIDO: "VENCIDO",
    LIQUIDADO: "LIQUIDADO",
    BAIXADO: "BAIXADO_SEM_PAGAMENTO",
    PROTESTADO: "VENCIDO",
    REJEITADO: "ERRO",
    CANCELADO: "BAIXADO_SEM_PAGAMENTO",
    DESCONHECIDO: fallback,
  };
  let status = mapa[retorno.status];
  if (
    status === "REGISTRADO" &&
    ["PAGAMENTO_REPORTADO", "CANCELAMENTO_REPORTADO"].includes(
      boletoAtual?.status ?? "",
    )
  ) {
    status = boletoAtual!.status;
  }
  if (
    status === "REGISTRADO" &&
    (retorno.dataVencimento ?? boletoAtual?.dataVencimento ?? "") < hojeNoBrasil()
  ) {
    status = "VENCIDO";
  }
  return status;
}

export async function emitirBoletoSicoob({
  recebimentoId,
  contaBancariaId,
  dataVencimento,
  usuarioId,
}: {
  recebimentoId: string;
  contaBancariaId: string;
  dataVencimento: string;
  usuarioId: string;
}): Promise<ResultadoEmissao> {
  validarDataCivil(dataVencimento, "Data de vencimento");
  const hoje = hojeNoBrasil();
  if (dataVencimento < hoje) {
    throw new ErroOperacaoBoleto(
      "Escolha hoje ou uma data futura para o vencimento do novo boleto.",
    );
  }

  const [recebimento, conta] = await Promise.all([
    prisma.recebimento.findUnique({
      where: { id: recebimentoId },
      include: {
        contrato: { include: { unidade: true, locatario: true } },
        empreendimento: true,
        boletos: { orderBy: { criadoEm: "desc" } },
        pagamentos: {
          where: { status: "CONFIRMADO" },
          select: { id: true },
        },
      },
    }),
    prisma.contaBancaria.findUnique({ where: { id: contaBancariaId } }),
  ]);
  if (!recebimento) throw new ErroOperacaoBoleto("Lançamento não encontrado.");
  if (!conta) throw new ErroOperacaoBoleto("Conta bancária não encontrada.");
  const mesFechado = await prisma.fechamentoMensal.findUnique({
    where: { mesLancamento: recebimento.mesLancamento },
    select: { id: true },
  });
  if (mesFechado) {
    throw new ErroOperacaoBoleto("O mês está fechado; reabra-o antes de emitir o boleto.");
  }
  if (recebimento.recebido !== null || recebimento.pagamentos.length > 0) {
    throw new ErroOperacaoBoleto("Este lançamento já possui recebimento registrado.");
  }
  if (recebimento.origemAgregada) {
    throw new ErroOperacaoBoleto("Lançamentos agregados não podem gerar boleto individual.");
  }
  const locatario = recebimento.contrato.locatario;
  if (!locatario) throw new ErroOperacaoBoleto("O contrato não possui pagador vinculado.");
  const pendentes = camposPagadorPendentes(locatario);
  if (pendentes.length) {
    throw new ErroOperacaoBoleto(
      `Complete o cadastro do pagador: ${pendentes.map((item) => item.rotulo).join(", ")}.`,
      "PAGADOR_INCOMPLETO",
    );
  }
  const valor = totalDevido(recebimento);
  if (valor <= 0) throw new ErroOperacaoBoleto("O lançamento não possui valor a cobrar.");
  const ativo = recebimento.boletos.find((boleto) => boletoEstaAtivo(boleto.status));
  if (ativo) {
    throw new ErroOperacaoBoleto(
      "Já existe um boleto ativo ou aguardando confirmação para este lançamento.",
      "BOLETO_DUPLICADO",
    );
  }
  validarContaEmissora(conta);
  await validarPerfilCredencialUnico(conta.id);
  const contaApi = contaParaApi(conta);
  const chaveIdempotencia = chaveHex(
    "boleto",
    recebimento.id,
    conta.id,
    String(valor),
    dataVencimento,
    String(recebimento.boletos.length + 1),
  );
  const numeroInterno = seuNumero(chaveIdempotencia);
  const existente = await prisma.boleto.findUnique({ where: { chaveIdempotencia } });
  if (existente && existente.status !== "ERRO") {
    return { boleto: existente, reutilizado: true };
  }

  const endereco = [
    locatario.endereco,
    locatario.numeroEndereco,
    locatario.complementoEndereco,
  ]
    .filter(Boolean)
    .join(", ");
  if (endereco.length > 40) {
    throw new ErroOperacaoBoleto(
      "O endereço do pagador excede 40 caracteres; abrevie-o no cadastro antes de emitir.",
      "PAGADOR_ENDERECO_LONGO",
    );
  }
  if (locatario.nome.length > 50) {
    throw new ErroOperacaoBoleto(
      "O nome do pagador excede 50 caracteres; ajuste o cadastro antes de emitir.",
      "PAGADOR_NOME_LONGO",
    );
  }

  const dadosBoleto: Prisma.BoletoUncheckedCreateInput = {
    contaBancariaId: conta.id,
    recebimentoId: recebimento.id,
    locatarioId: locatario.id,
    criadoPorUsuarioId: usuarioId,
    chaveIdempotencia,
    slotRecebimentoAtivo: recebimento.id,
    seuNumero: numeroInterno,
    ambienteBanco: conta.ambiente,
    numeroClienteBanco: contaApi.numeroCliente,
    numeroContaBanco: contaApi.numeroContaCorrente,
    codigoModalidadeBanco: contaApi.codigoModalidade,
    contratoCobrancaBanco: contaApi.numeroContratoCobranca,
    especieDocumentoBanco: conta.codigoEspecieDocumento!,
    status: "EMITINDO",
    valor,
    dataVencimento,
    pagadorNome: locatario.nome,
    pagadorCpfCnpj: locatario.cpfCnpj!,
    pagadorEmail: locatario.email,
    pagadorTelefone: locatario.telefone,
    pagadorCep: locatario.cep,
    pagadorEndereco: locatario.endereco,
    pagadorNumeroEndereco: locatario.numeroEndereco,
    pagadorComplemento: locatario.complementoEndereco,
    pagadorBairro: locatario.bairro,
    pagadorCidade: locatario.cidade,
    pagadorUf: locatario.uf,
    tentativas: existente ? existente.tentativas + 1 : 1,
    mensagemErro: null,
  };

  let boletoLocal: Boleto;
  let deveEmitirNoBanco = true;
  const reservaEmissaoToken = randomUUID();
  try {
    boletoLocal = await prisma.$transaction(async (tx) => {
      const reservaRecebimento = await tx.recebimento.updateMany({
        where: {
          id: recebimento.id,
          recebido: null,
          reservaEmissaoToken: null,
          pagamentos: { none: { status: "CONFIRMADO" } },
        },
        data: { reservaEmissaoToken },
      });
      if (reservaRecebimento.count !== 1) {
        throw new ErroOperacaoBoleto(
          "O lançamento foi alterado ou outra emissão está reservando-o. Atualize a tela.",
          "RECEBIMENTO_EM_USO",
        );
      }
      const fechamentoAtual = await tx.fechamentoMensal.findUnique({
        where: { mesLancamento: recebimento.mesLancamento },
        select: { id: true },
      });
      if (fechamentoAtual) {
        throw new ErroOperacaoBoleto(
          "O mês foi fechado durante a emissão; reabra-o antes de continuar.",
        );
      }
      const contaAtual = await tx.contaBancaria.findUnique({
        where: { id: conta.id },
      });
      if (!contaAtual) {
        throw new ErroOperacaoBoleto("A conta bancária deixou de existir durante a emissão.");
      }
      validarContaEmissora(contaAtual);
      const contaApiAtual = contaParaApi(contaAtual);
      const outraContaIntegrada = await tx.contaBancaria.count({
        where: {
          id: { not: contaAtual.id },
          codigoBanco: "756",
          ativa: true,
          integracaoHabilitada: true,
        },
      });
      if (
        outraContaIntegrada > 0 ||
        contaAtual.ambiente !== conta.ambiente ||
        contaAtual.codigoEspecieDocumento !== conta.codigoEspecieDocumento ||
        contaApiAtual.numeroCliente !== contaApi.numeroCliente ||
        contaApiAtual.numeroContaCorrente !== contaApi.numeroContaCorrente ||
        contaApiAtual.codigoModalidade !== contaApi.codigoModalidade ||
        contaApiAtual.numeroContratoCobranca !== contaApi.numeroContratoCobranca
      ) {
        throw new ErroOperacaoBoleto(
          "A configuração Sicoob mudou durante a emissão. Atualize a tela e tente novamente.",
          "CONTA_SICOOB_ALTERADA",
        );
      }
      const ativoAtual = await tx.boleto.findFirst({
        where: {
          recebimentoId: recebimento.id,
          status: { in: [...STATUS_BOLETO_ATIVOS] },
        },
        orderBy: { criadoEm: "desc" },
      });
      if (ativoAtual) {
        if (ativoAtual.chaveIdempotencia !== chaveIdempotencia) {
          throw new ErroOperacaoBoleto(
            "Outro boleto deste lançamento já foi emitido ou permanece em confirmação.",
            "BOLETO_DUPLICADO",
          );
        }
        deveEmitirNoBanco = false;
        await tx.recebimento.updateMany({
          where: { id: recebimento.id, reservaEmissaoToken },
          data: { reservaEmissaoToken: null },
        });
        return ativoAtual;
      }
      let reservado: Boleto;
      if (existente) {
        const reserva = await tx.boleto.updateMany({
          where: { id: existente.id, status: "ERRO" },
          data: dadosBoleto,
        });
        reservado = await tx.boleto.findUniqueOrThrow({
          where: { id: existente.id },
        });
        if (reserva.count !== 1 && reservado.status === "ERRO") {
          throw new ErroOperacaoBoleto(
            "A emissão foi alterada por outra operação. Atualize a tela.",
            "EMISSAO_EM_USO",
          );
        }
        if (reserva.count !== 1) deveEmitirNoBanco = false;
      } else {
        reservado = await tx.boleto.create({ data: dadosBoleto });
      }
      await tx.recebimento.updateMany({
        where: { id: recebimento.id, reservaEmissaoToken },
        data: { reservaEmissaoToken: null },
      });
      return reservado;
    });
  } catch (erro) {
    if (!erroDeUnicidade(erro)) throw erro;
    const mesmaEmissao = await prisma.boleto.findUnique({ where: { chaveIdempotencia } });
    if (mesmaEmissao) return { boleto: mesmaEmissao, reutilizado: true };
    throw new ErroOperacaoBoleto(
      "Outro boleto deste lançamento já está sendo emitido ou permanece ativo.",
      "BOLETO_DUPLICADO",
    );
  }
  if (!deveEmitirNoBanco) return { boleto: boletoLocal, reutilizado: true };

  let efeitoExternoPossivel = false;
  try {
    const resposta = await criarClienteSicoob().emitirBoleto({
      conta: contaApi,
      seuNumero: numeroInterno,
      valorCentavos: valor,
      dataEmissao: hoje,
      dataVencimento,
      identificacaoBoletoEmpresa: `BRISA-${recebimento.mesLancamento}`,
      codigoEspecieDocumento: conta.codigoEspecieDocumento!,
      pagador: {
        numeroCpfCnpj: locatario.cpfCnpj!,
        nome: locatario.nome,
        endereco,
        bairro: locatario.bairro!,
        cidade: locatario.cidade!,
        cep: locatario.cep!,
        uf: locatario.uf!,
        ...(locatario.email ? { email: locatario.email } : {}),
      },
      gerarPdf: false,
    });
    efeitoExternoPossivel = true;
    const respostaDivergente =
      resposta.seuNumero !== numeroInterno ||
      resposta.numeroCliente !== contaApi.numeroCliente ||
      resposta.numeroContaCorrente !== contaApi.numeroContaCorrente ||
      resposta.codigoModalidade !== contaApi.codigoModalidade ||
      resposta.valorOriginalCentavos !== valor ||
      (contaApi.numeroContratoCobranca !== undefined &&
        resposta.numeroContratoCobranca !== contaApi.numeroContratoCobranca) ||
      (resposta.dataVencimento !== null && resposta.dataVencimento !== dataVencimento);
    if (respostaDivergente) {
      throw new ErroApiSicoob(
        "O Sicoob respondeu com identificadores diferentes do título enviado; confira a emissão antes de repetir.",
        { codigo: "SICOOB_RESPOSTA_DIVERGENTE" },
      );
    }
    const statusConsultado = statusLocal(resposta, boletoLocal);
    const novoStatus =
      resposta.status === "LIQUIDADO" ? "PAGAMENTO_REPORTADO" : statusConsultado;
    // O título é a escrita crítica: nunca deve ser revertido porque a
    // atualização secundária de saúde da conta falhou.
    const atualizado = await prisma.boleto.update({
      where: { id: boletoLocal.id },
      data: {
        nossoNumero: resposta.nossoNumero,
        status: novoStatus,
        slotRecebimentoAtivo: boletoEstaAtivo(novoStatus)
          ? boletoLocal.recebimentoId
          : null,
        situacaoBanco: resposta.situacaoOriginal,
        linhaDigitavel: resposta.linhaDigitavel,
        codigoBarras: resposta.codigoBarras,
        qrCode: resposta.qrCode,
        emitidoEm: new Date(),
        ultimaConsultaEm: new Date(),
        mensagemErro:
          resposta.status === "LIQUIDADO"
            ? "Pagamento sinalizado; aguardando o arquivo LIQUI para conciliar."
            : null,
      },
    });
    await prisma.contaBancaria
      .update({
        where: { id: conta.id },
        data: {
          integracaoStatus: "PRONTA",
          ultimaSincronizacaoEm: new Date(),
          mensagemIntegracao: null,
        },
      })
      .catch(() => undefined);
    return { boleto: atualizado, reutilizado: false };
  } catch (erro) {
    const resultadoDesconhecido =
      efeitoExternoPossivel ||
      (erro instanceof ErroApiSicoob &&
        (erro.transitorio ||
          erro.status === 409 ||
          ["SICOOB_TIMEOUT", "SICOOB_REDE", "SICOOB_RESPOSTA_INVALIDA"].includes(
            erro.codigo,
          )));
    const mensagem = efeitoExternoPossivel
      ? "O banco respondeu, mas a confirmação local ficou pendente; não reemita antes de conferir."
      : textoErroSeguro(erro);
    const falhaDaIntegracao =
      efeitoExternoPossivel ||
      !(erro instanceof ErroApiSicoob) ||
      erro.transitorio ||
      erro.status === 401 ||
      erro.status === 403 ||
      erro.status === 429 ||
      (erro.status !== null && erro.status >= 500);
    await prisma.$transaction([
      prisma.boleto.update({
        where: { id: boletoLocal.id },
        data: {
          status: resultadoDesconhecido ? "RESULTADO_DESCONHECIDO" : "ERRO",
          slotRecebimentoAtivo: resultadoDesconhecido ? recebimento.id : null,
          mensagemErro: mensagem,
        },
      }),
      prisma.contaBancaria.update({
        where: { id: conta.id },
        data: {
          ...(falhaDaIntegracao ? { integracaoStatus: "ERRO" } : {}),
          ultimaSincronizacaoEm: new Date(),
          mensagemIntegracao: falhaDaIntegracao ? mensagem : null,
        },
      }),
    ]);
    throw erro;
  }
}

/**
 * Libera uma reserva somente depois de uma conferência humana explícita no
 * Sicoob. Não consulta nem cancela nada no banco: apenas registra a decisão
 * auditável para que uma emissão realmente inexistente possa ser refeita.
 */
export async function liberarEmissaoInconclusivaSicoob(
  boletoId: string,
  usuarioId: string,
): Promise<Boleto> {
  const boleto = await prisma.boleto.findUnique({ where: { id: boletoId } });
  if (!boleto) throw new ErroOperacaoBoleto("Boleto não encontrado.");
  if (
    boleto.nossoNumero ||
    !["EMITINDO", "RESULTADO_DESCONHECIDO"].includes(boleto.status)
  ) {
    throw new ErroOperacaoBoleto(
      "Somente uma emissão inconclusiva e sem nosso número pode ser liberada.",
      "EMISSAO_NAO_LIBERAVEL",
    );
  }
  const idadeMinima = new Date(Date.now() - 30 * 60_000);
  if (boleto.atualizadoEm > idadeMinima) {
    throw new ErroOperacaoBoleto(
      "Aguarde 30 minutos desde a última tentativa antes da conferência manual.",
      "EMISSAO_AINDA_RECENTE",
    );
  }

  const mensagem =
    "Reserva liberada após confirmação manual de que o título não existe no Sicoob.";
  const chaveEvento = `manual:liberacao-emissao:${boleto.id}:${chaveHex(
    usuarioId,
    boleto.id,
    boleto.atualizadoEm.toISOString(),
  )}`;
  await prisma.$transaction(async (tx) => {
    const liquidacaoRelacionada = await tx.eventoBoleto.findFirst({
      where: {
        origem: "MOVIMENTACAO",
        tipo: "LIQUIDACAO_CONFIRMADA",
        seuNumero: boleto.seuNumero,
        sincronizacao: {
          is: { contaBancariaId: boleto.contaBancariaId },
        },
      },
      select: { id: true },
    });
    if (liquidacaoRelacionada) {
      throw new ErroOperacaoBoleto(
        "Existe uma liquidação LIQUI relacionada a esta emissão. Localize o título pelo nosso número em vez de liberar uma reemissão.",
        "EMISSAO_COM_LIQUIDACAO_RELACIONADA",
      );
    }
    const alterado = await tx.boleto.updateMany({
      where: {
        id: boleto.id,
        nossoNumero: null,
        status: { in: ["EMITINDO", "RESULTADO_DESCONHECIDO"] },
        atualizadoEm: boleto.atualizadoEm,
      },
      data: {
        status: "ERRO",
        slotRecebimentoAtivo: null,
        mensagemErro: mensagem,
      },
    });
    if (alterado.count !== 1) {
      throw new ErroOperacaoBoleto(
        "A emissão mudou durante a conferência; atualize a tela antes de continuar.",
        "EMISSAO_EM_USO",
      );
    }
    await tx.eventoBoleto.create({
      data: {
        boletoId: boleto.id,
        chaveEvento,
        origem: "MANUAL",
        tipo: "EMISSAO_LIBERADA_APOS_CONFERENCIA",
        nossoNumero: null,
        seuNumero: boleto.seuNumero,
        payloadHash: hashCanonicoEventoSicoob({
          boletoId: boleto.id,
          usuarioId,
          confirmadoEm: new Date().toISOString(),
        }),
        statusProcessamento: "PROCESSADO",
        processadoEm: new Date(),
      },
    });
  });
  return prisma.boleto.findUniqueOrThrow({ where: { id: boleto.id } });
}

/** Localiza pelo nosso número informado por uma pessoa e só vincula após
 * conferir, via API, todos os identificadores que o banco devolveu. */
export async function vincularEmissaoInconclusivaSicoob(
  boletoId: string,
  nossoNumero: string,
  usuarioId: string,
): Promise<Boleto> {
  if (!/^\d{1,30}$/.test(nossoNumero)) {
    throw new ErroOperacaoBoleto("Nosso número deve conter somente dígitos.");
  }
  const boleto = await prisma.boleto.findUnique({
    where: { id: boletoId },
    include: { contaBancaria: true },
  });
  if (!boleto) throw new ErroOperacaoBoleto("Boleto não encontrado.");
  if (
    boleto.nossoNumero ||
    !["EMITINDO", "RESULTADO_DESCONHECIDO"].includes(boleto.status)
  ) {
    throw new ErroOperacaoBoleto(
      "Esta emissão não está disponível para localização manual.",
      "EMISSAO_NAO_VINCULAVEL",
    );
  }
  if (boleto.atualizadoEm > new Date(Date.now() - 30 * 60_000)) {
    throw new ErroOperacaoBoleto(
      "Aguarde 30 minutos desde a última tentativa antes de localizar o título.",
      "EMISSAO_AINDA_RECENTE",
    );
  }
  validarContaIntegrada(boleto.contaBancaria);
  await validarPerfilCredencialUnico(boleto.contaBancariaId);
  const retorno = await criarClienteSicoob().consultarBoleto({
    conta: contaDoBoletoParaApi(boleto),
    nossoNumero,
  });
  const divergente =
    retorno.nossoNumero !== nossoNumero ||
    (retorno.seuNumero !== null && retorno.seuNumero !== boleto.seuNumero) ||
    (retorno.numeroCliente !== null &&
      retorno.numeroCliente !== boleto.numeroClienteBanco) ||
    (retorno.codigoModalidade !== null &&
      retorno.codigoModalidade !== boleto.codigoModalidadeBanco) ||
    (retorno.numeroContaCorrente !== null &&
      retorno.numeroContaCorrente !== boleto.numeroContaBanco) ||
    (retorno.valorOriginalCentavos !== null &&
      retorno.valorOriginalCentavos !== boleto.valor);
  if (divergente) {
    throw new ErroOperacaoBoleto(
      "O título localizado no Sicoob não corresponde à emissão do Brisa.",
      "SICOOB_RETORNO_DIVERGENTE",
    );
  }
  const statusConsultado = statusLocal(retorno, boleto);
  const novoStatus =
    retorno.status === "LIQUIDADO" ? "PAGAMENTO_REPORTADO" : statusConsultado;
  const payloadHash = hashCanonicoEventoSicoob({
    boletoId: boleto.id,
    nossoNumero,
    seuNumero: retorno.seuNumero,
    status: retorno.status,
    usuarioId,
  });
  await prisma.$transaction(async (tx) => {
    const alterado = await tx.boleto.updateMany({
      where: {
        id: boleto.id,
        nossoNumero: null,
        status: { in: ["EMITINDO", "RESULTADO_DESCONHECIDO"] },
        atualizadoEm: boleto.atualizadoEm,
      },
      data: {
        nossoNumero,
        status: novoStatus,
        slotRecebimentoAtivo: boletoEstaAtivo(novoStatus)
          ? boleto.recebimentoId
          : null,
        situacaoBanco: retorno.situacaoOriginal,
        linhaDigitavel: retorno.linhaDigitavel,
        codigoBarras: retorno.codigoBarras,
        qrCode: retorno.qrCode,
        emitidoEm: retorno.dataEmissao ? new Date(retorno.dataEmissao) : new Date(),
        ultimaConsultaEm: new Date(),
        mensagemErro:
          retorno.status === "LIQUIDADO"
            ? "Pagamento sinalizado; aguardando o arquivo LIQUI para conciliar."
            : null,
      },
    });
    if (alterado.count !== 1) {
      throw new ErroOperacaoBoleto(
        "A emissão mudou durante a localização; atualize a tela antes de continuar.",
        "EMISSAO_EM_USO",
      );
    }
    const liquidacoesIgnoradas = await tx.eventoBoleto.findMany({
      where: {
        origem: "MOVIMENTACAO",
        tipo: "LIQUIDACAO_CONFIRMADA",
        statusProcessamento: "IGNORADO",
        nossoNumero,
        seuNumero: boleto.seuNumero,
        sincronizacao: {
          is: {
            contaBancariaId: boleto.contaBancariaId,
            janelaInicio: { not: null },
          },
        },
      },
      select: {
        id: true,
        sincronizacao: { select: { janelaInicio: true } },
      },
    });
    if (liquidacoesIgnoradas.length > 0) {
      await tx.eventoBoleto.updateMany({
        where: { id: { in: liquidacoesIgnoradas.map((evento) => evento.id) } },
        data: {
          boletoId: boleto.id,
          statusProcessamento: "PENDENTE",
          processadoEm: null,
          erro: "Liquidação reaberta após a localização do título no Sicoob.",
        },
      });
      const inicioMaisAntigo = liquidacoesIgnoradas
        .map((evento) => evento.sincronizacao?.janelaInicio)
        .filter((inicio): inicio is string => Boolean(inicio))
        .sort()[0];
      if (inicioMaisAntigo) {
        const contaAtual = await tx.contaBancaria.findUniqueOrThrow({
          where: { id: boleto.contaBancariaId },
          select: { liquidacoesReprocessarDesde: true },
        });
        const reprocessarDesde = diaAnterior(inicioMaisAntigo);
        if (
          !contaAtual.liquidacoesReprocessarDesde ||
          reprocessarDesde < contaAtual.liquidacoesReprocessarDesde
        ) {
          await tx.contaBancaria.update({
            where: { id: boleto.contaBancariaId },
            data: { liquidacoesReprocessarDesde: reprocessarDesde },
          });
        }
      }
    }
    await tx.eventoBoleto.create({
      data: {
        boletoId: boleto.id,
        chaveEvento: `manual:vinculo-emissao:${boleto.id}:${payloadHash}`,
        origem: "MANUAL",
        tipo: "EMISSAO_LOCALIZADA_E_VINCULADA",
        nossoNumero,
        seuNumero: boleto.seuNumero,
        situacaoBanco: retorno.situacaoOriginal,
        payloadHash,
        statusProcessamento: "PROCESSADO",
        processadoEm: new Date(),
      },
    });
  });
  return prisma.boleto.findUniqueOrThrow({ where: { id: boleto.id } });
}

async function registrarLiquidacaoConfirmada({
  boletoId,
  eventoId,
  chaveLiquidacao,
  valorPago,
  dataPagamento,
  dataCredito,
  liquidadoEm,
}: {
  boletoId: string;
  eventoId: string;
  chaveLiquidacao: string;
  valorPago: number;
  dataPagamento: string;
  dataCredito: string | null;
  liquidadoEm: Date;
}): Promise<"PROCESSADO" | "ERRO"> {
  return prisma.$transaction(async (tx) => {
    const boleto = await tx.boleto.findUnique({
      where: { id: boletoId },
      include: {
        recebimento: {
          include: { pagamentos: { where: { status: "CONFIRMADO" } } },
        },
      },
    });
    if (!boleto?.nossoNumero) throw new ErroOperacaoBoleto("Boleto sem identificador bancário.");
    const chavePagamento = `pagamento:${chaveLiquidacao}`;
    let pagamento = await tx.pagamentoRecebimento.findUnique({
      where: { chaveIdempotencia: chavePagamento },
    });

    if (
      pagamento &&
      (pagamento.boletoId !== boleto.id ||
        pagamento.recebimentoId !== boleto.recebimentoId ||
        pagamento.valor !== valorPago ||
        pagamento.dataPagamento !== dataPagamento)
    ) {
      const mensagem = "A chave da liquidação já existe com dados divergentes; revisão manual necessária.";
      await tx.eventoBoleto.update({
        where: { id: eventoId },
        data: { statusProcessamento: "ERRO", erro: mensagem },
      });
      return "ERRO" as const;
    }

    const observacaoAnterior = boleto.recebimento.pagamentos.find(
      (item) =>
        item.boletoId === boleto.id &&
        item.origem === "SICOOB" &&
        item.chaveIdempotencia !== chavePagamento,
    );
    if (observacaoAnterior) {
      const mensagem =
        "O Sicoob retornou dados de liquidação diferentes da observação anterior; revisão manual necessária.";
      await tx.boleto.update({
        where: { id: boleto.id },
        data: {
          status: "LIQUIDADO",
          valorPago,
          conciliacaoStatus: "DIVERGENTE",
          conciliacaoMotivo: "LIQUIDACAO_DIVERGENTE",
          mensagemErro: mensagem,
        },
      });
      await tx.eventoBoleto.update({
        where: { id: eventoId },
        data: { statusProcessamento: "ERRO", erro: mensagem },
      });
      return "ERRO" as const;
    }

    if (!pagamento) {
      pagamento = await tx.pagamentoRecebimento.create({
        data: {
          recebimentoId: boleto.recebimentoId,
          boletoId: boleto.id,
          eventoBoletoId: eventoId,
          contaBancariaId: boleto.contaBancariaId,
          identificadorBanco: `${boleto.contaBancariaId}:${chaveLiquidacao}`,
          chaveIdempotencia: chavePagamento,
          valor: valorPago,
          dataPagamento,
          dataCredito,
          forma: "BOLETO",
          origem: "SICOOB",
          status: "CONFIRMADO",
        },
      });
    } else if (dataCredito && !pagamento.dataCredito) {
      pagamento = await tx.pagamentoRecebimento.update({
        where: { id: pagamento.id },
        data: { dataCredito },
      });
    }
    const boletoIrmaoAtivo = await tx.boleto.findFirst({
      where: {
        recebimentoId: boleto.recebimentoId,
        id: { not: boleto.id },
        status: { in: [...STATUS_BOLETO_ATIVOS] },
      },
      orderBy: { criadoEm: "desc" },
    });
    if (boletoIrmaoAtivo) {
      const mensagem = MENSAGEM_CONFLITO_REEMISSAO;
      await tx.pagamentoRecebimento.update({
        where: { id: pagamento.id },
        data: { motivoPendencia: mensagem },
      });
      await tx.boleto.update({
        where: { id: boleto.id },
        data: {
          status: "LIQUIDADO",
          slotRecebimentoAtivo: null,
          valorPago,
          liquidadoEm,
          conciliacaoStatus: "DIVERGENTE",
          conciliacaoMotivo: "BOLETO_IRMAO_ATIVO",
          mensagemErro: mensagem,
        },
      });
      await tx.boleto.update({
        where: { id: boletoIrmaoAtivo.id },
        data: {
          conciliacaoStatus: "DIVERGENTE",
          conciliacaoMotivo: "BOLETO_IRMAO_ATIVO",
          mensagemErro: mensagem,
        },
      });
      await tx.eventoBoleto.update({
        where: { id: eventoId },
        data: { boletoId: boleto.id, statusProcessamento: "ERRO", erro: mensagem },
      });
      return "ERRO" as const;
    }
    const totalConfirmado =
      boleto.recebimento.pagamentos.reduce((soma, item) => soma + item.valor, 0) +
      (boleto.recebimento.pagamentos.some((item) => item.id === pagamento.id)
        ? 0
        : valorPago);
    const fechamento = await tx.fechamentoMensal.findUnique({
      where: { mesLancamento: boleto.recebimento.mesLancamento },
      select: { id: true },
    });
    const decisao = avaliarConciliacao({
      total: totalDevido(boleto.recebimento),
      totalPagamentosConfirmados: totalConfirmado,
      recebidoLegado: boleto.recebimento.recebido,
      baixaManualSemVinculo:
        boleto.recebimento.recebido !== null &&
        boleto.recebimento.pagamentos.length === 0,
      mesFechado: Boolean(fechamento),
    });

    if (decisao.tipo === "CONCILIAR") {
      const agora = new Date();
      await tx.recebimento.update({
        where: { id: boleto.recebimentoId },
        data: { recebido: decisao.recebido, dataPagamento, via: "BOLETO" },
      });
      await tx.pagamentoRecebimento.updateMany({
        where: { recebimentoId: boleto.recebimentoId, status: "CONFIRMADO" },
        data: { conciliadoEm: agora, motivoPendencia: null },
      });
      await tx.boleto.update({
        where: { id: boleto.id },
        data: {
          status: "LIQUIDADO",
          valorPago: totalConfirmado,
          liquidadoEm,
          conciliacaoStatus: "CONCILIADO",
          conciliacaoMotivo: null,
          mensagemErro: null,
        },
      });
    } else {
      await tx.pagamentoRecebimento.update({
        where: { id: pagamento.id },
        data: { motivoPendencia: decisao.motivo },
      });
      await tx.boleto.update({
        where: { id: boleto.id },
        data: {
          status: "LIQUIDADO",
          valorPago: totalConfirmado,
          liquidadoEm,
          conciliacaoStatus: "DIVERGENTE",
          conciliacaoMotivo: "CONCILIACAO_FINANCEIRA",
          mensagemErro: `Liquidação confirmada; conciliação pendente (${decisao.motivo}).`,
        },
      });
    }
    await tx.eventoBoleto.update({
      where: { id: eventoId },
      data: {
        boletoId: boleto.id,
        statusProcessamento: "PROCESSADO",
        processadoEm: new Date(),
        erro: null,
      },
    });
    return "PROCESSADO" as const;
  });
}

/** Reavalia uma liquidação já importada, por exemplo depois de reabrir o mês. */
export async function reprocessarConciliacaoSicoob(
  pagamentoId: string,
  usuarioId: string,
): Promise<"PROCESSADO" | "ERRO"> {
  const pagamento = await prisma.pagamentoRecebimento.findUnique({
    where: { id: pagamentoId },
    include: { boleto: true, eventoBoleto: true },
  });
  if (
    !pagamento ||
    pagamento.origem !== "SICOOB" ||
    pagamento.status !== "CONFIRMADO" ||
    !pagamento.boleto ||
    !pagamento.eventoBoleto
  ) {
    throw new ErroOperacaoBoleto("Liquidação Sicoob confirmada não encontrada.");
  }
  const chaveLiquidacao = pagamento.chaveIdempotencia.replace(/^pagamento:/, "");
  const chaveAuditoria = `reprocessamento:${pagamento.id}:${randomUUID()}`;
  const auditoria = await prisma.eventoBoleto.create({
    data: {
      boletoId: pagamento.boleto.id,
      chaveEvento: chaveAuditoria,
      origem: "MANUAL",
      tipo: "RECONCILIACAO_REPROCESSADA",
      nossoNumero: pagamento.boleto.nossoNumero,
      seuNumero: pagamento.boleto.seuNumero,
      payloadHash: hashCanonicoEventoSicoob({ pagamentoId, usuarioId }),
      statusProcessamento: "PENDENTE",
    },
  });
  try {
    const resultado = await registrarLiquidacaoConfirmada({
      boletoId: pagamento.boleto.id,
      eventoId: pagamento.eventoBoleto.id,
      chaveLiquidacao,
      valorPago: pagamento.valor,
      dataPagamento: pagamento.dataPagamento,
      dataCredito: pagamento.dataCredito,
      liquidadoEm:
        pagamento.boleto.liquidadoEm ??
        new Date(`${pagamento.dataPagamento}T12:00:00-03:00`),
    });
    await prisma.eventoBoleto.update({
      where: { id: auditoria.id },
      data: {
        statusProcessamento: resultado,
        processadoEm: new Date(),
        erro: resultado === "ERRO" ? "A divergência permanece após a reavaliação." : null,
      },
    });
    return resultado;
  } catch (erro) {
    await prisma.eventoBoleto.update({
      where: { id: auditoria.id },
      data: {
        statusProcessamento: "ERRO",
        processadoEm: new Date(),
        erro: textoErroSeguro(erro),
      },
    });
    throw erro;
  }
}

export async function sincronizarBoletoSicoob(
  boletoId: string,
  sincronizacaoId?: string,
): Promise<Boleto> {
  const boleto = await prisma.boleto.findUnique({
    where: { id: boletoId },
    include: { contaBancaria: true },
  });
  if (!boleto) throw new ErroOperacaoBoleto("Boleto não encontrado.");
  if (!boleto.nossoNumero) {
    throw new ErroOperacaoBoleto(
      "A emissão ainda não possui nosso número; ela precisa de conferência manual antes de qualquer nova tentativa.",
      "BOLETO_SEM_NOSSO_NUMERO",
    );
  }
  if (!boleto.contaBancaria.integracaoHabilitada) {
    throw new ErroOperacaoBoleto("A integração desta conta está desabilitada.");
  }
  if (boleto.contaBancaria.codigoBanco !== "756" || !boleto.contaBancaria.ativa) {
    throw new ErroOperacaoBoleto("A conta do título não está ativa na integração Sicoob.");
  }
  ambienteDoBoletoCompativel(boleto);
  await validarPerfilCredencialUnico(boleto.contaBancariaId);
  const conta = contaDoBoletoParaApi(boleto);
  const retorno = await criarClienteSicoob().consultarBoleto({
    conta,
    nossoNumero: boleto.nossoNumero,
  });
  const payloadHash = hashCanonicoEventoSicoob({
    contaBancariaId: boleto.contaBancariaId,
    nossoNumero: boleto.nossoNumero,
    status: retorno.status,
    dataLiquidacao: retorno.dataLiquidacao,
    valorPagoCentavos: retorno.valorPagoCentavos,
  });
  const chaveEvento = `consulta:${payloadHash}`;
  const evento = await prisma.eventoBoleto.upsert({
    where: { chaveEvento },
    create: {
      boletoId: boleto.id,
      sincronizacaoId,
      chaveEvento,
      origem: "CONSULTA",
      tipo: retorno.status === "LIQUIDADO" ? "LIQUIDACAO_SINALIZADA" : "STATUS_BOLETO",
      nossoNumero: boleto.nossoNumero,
      seuNumero: boleto.seuNumero,
      situacaoBanco: retorno.situacaoOriginal,
      payloadHash,
    },
    update: {},
  });

  const retornoDivergente = [
    retorno.nossoNumero !== null && retorno.nossoNumero !== boleto.nossoNumero,
    retorno.seuNumero !== null && retorno.seuNumero !== boleto.seuNumero,
    retorno.numeroCliente !== null && retorno.numeroCliente !== boleto.numeroClienteBanco,
    retorno.codigoModalidade !== null &&
      retorno.codigoModalidade !== boleto.codigoModalidadeBanco,
    retorno.numeroContaCorrente !== null &&
      retorno.numeroContaCorrente !== boleto.numeroContaBanco,
    retorno.valorOriginalCentavos !== null && retorno.valorOriginalCentavos !== boleto.valor,
  ].some(Boolean);
  if (retornoDivergente) {
    const mensagem = "Os identificadores retornados pelo banco divergem do título emitido.";
    await prisma.$transaction([
      prisma.boleto.update({
        where: { id: boleto.id },
        data: {
          ultimaConsultaEm: new Date(),
          conciliacaoStatus: "DIVERGENTE",
          conciliacaoMotivo: "IDENTIFICADORES_DIVERGENTES",
          mensagemErro: mensagem,
        },
      }),
      prisma.eventoBoleto.update({
        where: { id: evento.id },
        data: { statusProcessamento: "ERRO", erro: mensagem },
      }),
    ]);
    throw new ErroOperacaoBoleto(mensagem, "SICOOB_RETORNO_DIVERGENTE");
  }

  const estadoAtual = await prisma.boleto.findUniqueOrThrow({ where: { id: boleto.id } });
  const baixaResolveConflitoDeReemissao =
    estadoAtual.conciliacaoStatus === "DIVERGENTE" &&
    estadoAtual.conciliacaoMotivo === "BOLETO_IRMAO_ATIVO" &&
    ["BAIXADO", "CANCELADO", "REJEITADO"].includes(retorno.status);
  const estadoFinanceiroTerminal =
    ["LIQUIDADO", "BAIXADO_SEM_PAGAMENTO", "ESTORNADO"].includes(
      estadoAtual.status,
    ) ||
    estadoAtual.conciliacaoStatus === "CONCILIADO" ||
    (estadoAtual.conciliacaoStatus === "DIVERGENTE" &&
      !baixaResolveConflitoDeReemissao);
  const conflitoComLiquidacaoConfirmada =
    (estadoAtual.status === "LIQUIDADO" ||
      estadoAtual.conciliacaoStatus === "CONCILIADO") &&
    retorno.status !== "LIQUIDADO" &&
    retorno.status !== "DESCONHECIDO";
  if (estadoFinanceiroTerminal) {
    const mensagem =
      conflitoComLiquidacaoConfirmada
        ? "A consulta pontual divergiu do LIQUI já conciliado; a baixa foi preservada e exige revisão."
        : estadoAtual.mensagemErro;
    await prisma.$transaction([
      prisma.boleto.update({
        where: { id: boleto.id },
        data: {
          situacaoBanco: retorno.situacaoOriginal,
          ultimaConsultaEm: new Date(),
          mensagemErro: mensagem,
          linhaDigitavel: retorno.linhaDigitavel ?? estadoAtual.linhaDigitavel,
          codigoBarras: retorno.codigoBarras ?? estadoAtual.codigoBarras,
          qrCode: retorno.qrCode ?? estadoAtual.qrCode,
        },
      }),
      prisma.eventoBoleto.update({
        where: { id: evento.id },
        data: conflitoComLiquidacaoConfirmada
          ? { statusProcessamento: "ERRO", erro: mensagem }
          : { statusProcessamento: "PROCESSADO", processadoEm: new Date(), erro: null },
      }),
    ]);
    return prisma.boleto.findUniqueOrThrow({ where: { id: boleto.id } });
  }

  const statusConsultado = statusLocal(retorno, estadoAtual);
  const novoStatus =
    retorno.status === "LIQUIDADO"
      ? "PAGAMENTO_REPORTADO"
      : statusConsultado;
  const mensagemLiquidacao =
    retorno.status === "LIQUIDADO"
      ? "Liquidação sinalizada; aguardando o arquivo oficial LIQUI com valor e data para conciliar."
      : null;
  await prisma.boleto.updateMany({
    where: {
      id: boleto.id,
      status: { notIn: ["LIQUIDADO", "BAIXADO_SEM_PAGAMENTO", "ESTORNADO"] },
      OR: [
        { conciliacaoStatus: { notIn: ["CONCILIADO", "DIVERGENTE"] } },
        {
          conciliacaoStatus: "DIVERGENTE",
          conciliacaoMotivo: "BOLETO_IRMAO_ATIVO",
        },
      ],
    },
    data: {
      status: novoStatus,
      slotRecebimentoAtivo: boletoEstaAtivo(novoStatus)
        ? boleto.recebimentoId
        : null,
      situacaoBanco: retorno.situacaoOriginal,
      ultimaConsultaEm: new Date(),
      linhaDigitavel: retorno.linhaDigitavel ?? estadoAtual.linhaDigitavel,
      codigoBarras: retorno.codigoBarras ?? estadoAtual.codigoBarras,
      qrCode: retorno.qrCode ?? estadoAtual.qrCode,
      conciliacaoStatus: "PENDENTE",
      conciliacaoMotivo: null,
      mensagemErro: mensagemLiquidacao,
    },
  });
  await prisma.eventoBoleto.update({
    where: { id: evento.id },
    data: { statusProcessamento: "PROCESSADO", processadoEm: new Date(), erro: null },
  });
  return prisma.boleto.findUniqueOrThrow({ where: { id: boleto.id } });
}

export async function sincronizarBoletosAbertos(
  limite = 25,
  iniciadoPorUsuarioId?: string,
): Promise<{
  consultados: number;
  erros: number;
}> {
  const boletos = await prisma.boleto.findMany({
    where: {
      nossoNumero: { not: null },
      status: {
        in: [
          "REGISTRADO",
          "VENCIDO",
          "PAGAMENTO_REPORTADO",
          "CANCELAMENTO_REPORTADO",
          "RESULTADO_DESCONHECIDO",
        ],
      },
      contaBancaria: { integracaoHabilitada: true, ativa: true },
    },
    select: { id: true, contaBancariaId: true },
    orderBy: { ultimaConsultaEm: "asc" },
    take: Math.max(1, Math.min(limite, 100)),
  });
  let erros = 0;
  const porConta = new Map<string, typeof boletos>();
  for (const boleto of boletos) {
    const grupo = porConta.get(boleto.contaBancariaId) ?? [];
    grupo.push(boleto);
    porConta.set(boleto.contaBancariaId, grupo);
  }
  for (const [contaBancariaId, grupo] of porConta) {
    const sincronizacao = await prisma.sincronizacaoBancaria.create({
      data: {
        contaBancariaId,
        iniciadoPorUsuarioId,
        tipo: "BOLETOS",
        status: "EM_ANDAMENTO",
      },
    });
    let errosDaConta = 0;
    for (let inicio = 0; inicio < grupo.length; inicio += 4) {
      const lote = grupo.slice(inicio, inicio + 4);
      const resultados = await Promise.allSettled(
        lote.map((boleto) => sincronizarBoletoSicoob(boleto.id, sincronizacao.id)),
      );
      for (let indice = 0; indice < resultados.length; indice += 1) {
        const resultado = resultados[indice];
        if (resultado.status === "rejected") {
          erros += 1;
          errosDaConta += 1;
          await prisma.boleto.update({
            where: { id: lote[indice].id },
            data: {
              mensagemErro: textoErroSeguro(resultado.reason),
              ultimaConsultaEm: new Date(),
            },
          });
        }
      }
    }
    const concluidaEm = new Date();
    await prisma.$transaction([
      prisma.sincronizacaoBancaria.update({
        where: { id: sincronizacao.id },
        data: {
          status: errosDaConta > 0 ? "ERRO" : "CONCLUIDA",
          quantidadeLidos: grupo.length,
          quantidadeProcessados: grupo.length - errosDaConta,
          quantidadeErros: errosDaConta,
          mensagemErro:
            errosDaConta > 0 ? `${errosDaConta} boleto(s) exigem atenção.` : null,
          concluidaEm,
        },
      }),
      prisma.contaBancaria.update({
        where: { id: contaBancariaId },
        data: {
          ultimaSincronizacaoEm: concluidaEm,
          integracaoStatus: errosDaConta > 0 ? "ERRO" : "PRONTA",
          mensagemIntegracao:
            errosDaConta > 0 ? `${errosDaConta} boleto(s) exigem atenção.` : null,
        },
      }),
    ]);
  }
  return { consultados: boletos.length, erros };
}

type CursorLiquidacoes = {
  codigoSolicitacao: string;
  idsArquivos: string[] | null;
  proximoArquivo: number;
  proximoRegistro: number;
  quantidadeEsperada: number | null;
  registrosPercorridos: number;
  solicitacoesExpiradas: number;
  solicitadoEm: string;
  consultarApos: string | null;
};

type ResultadoLiquidacoes = {
  solicitadas: number;
  concluidas: number;
  aguardando: number;
  lidas: number;
  processadas: number;
  erros: number;
};

type EncerramentoLiquidacoes = {
  status: "CONCLUIDA" | "ERRO" | "AGUARDANDO";
  lidas: number;
  processadas: number;
  erros: number;
};

const MAX_ERROS_TRANSITORIOS_LIQUIDACOES = 5;
const IDADE_MAXIMA_SYNC_LIQUIDACOES_MS = 2 * 60 * 60_000;

function encerramentoDoRegistroLiquidacoes(registro: {
  status: string;
  quantidadeLidos: number;
  quantidadeProcessados: number;
  quantidadeErros: number;
}): EncerramentoLiquidacoes {
  return {
    status:
      registro.status === "CONCLUIDA"
        ? "CONCLUIDA"
        : registro.status === "ERRO"
          ? "ERRO"
          : "AGUARDANDO",
    lidas: registro.quantidadeLidos,
    processadas: registro.quantidadeProcessados,
    erros:
      registro.status === "ERRO" ? Math.max(1, registro.quantidadeErros) : 0,
  };
}

function agregarEncerramentoLiquidacoes(
  resultado: ResultadoLiquidacoes,
  encerramento: EncerramentoLiquidacoes,
): void {
  resultado.lidas += encerramento.lidas;
  resultado.processadas += encerramento.processadas;
  resultado.erros += encerramento.erros;
  if (encerramento.status === "CONCLUIDA") resultado.concluidas += 1;
  else if (encerramento.status === "AGUARDANDO") resultado.aguardando += 1;
}

function serializarCursorLiquidacoes(cursor: CursorLiquidacoes): string {
  return JSON.stringify(cursor);
}

function instanteIsoValido(valor: unknown): valor is string {
  return typeof valor === "string" && Number.isFinite(Date.parse(valor));
}

function interpretarCursorLiquidacoes(valor: string | null): CursorLiquidacoes | null {
  if (!valor) return null;
  // Compatibilidade com uma solicitação gravada antes do cursor estruturado.
  if (/^\d+$/.test(valor)) {
    return {
      codigoSolicitacao: valor,
      idsArquivos: null,
      proximoArquivo: 0,
      proximoRegistro: 0,
      quantidadeEsperada: null,
      registrosPercorridos: 0,
      solicitacoesExpiradas: 0,
      solicitadoEm: new Date(0).toISOString(),
      consultarApos: null,
    };
  }
  try {
    const cursor = JSON.parse(valor) as Partial<CursorLiquidacoes>;
    if (
      !/^\d+$/.test(cursor.codigoSolicitacao ?? "") ||
      !Number.isSafeInteger(cursor.proximoArquivo) ||
      (cursor.proximoArquivo ?? -1) < 0 ||
      (cursor.proximoRegistro !== undefined &&
        (!Number.isSafeInteger(cursor.proximoRegistro) ||
          (cursor.proximoRegistro ?? -1) < 0)) ||
      (cursor.idsArquivos !== null &&
        (!Array.isArray(cursor.idsArquivos) ||
          cursor.idsArquivos.some((id) => !/^\d+$/.test(id)))) ||
      (cursor.quantidadeEsperada !== null &&
        (!Number.isSafeInteger(cursor.quantidadeEsperada) ||
          (cursor.quantidadeEsperada ?? -1) < 0)) ||
      (cursor.registrosPercorridos !== undefined &&
        (!Number.isSafeInteger(cursor.registrosPercorridos) ||
          (cursor.registrosPercorridos ?? -1) < 0)) ||
      (cursor.solicitacoesExpiradas !== undefined &&
        (!Number.isSafeInteger(cursor.solicitacoesExpiradas) ||
          (cursor.solicitacoesExpiradas ?? -1) < 0)) ||
      (cursor.solicitadoEm !== undefined && !instanteIsoValido(cursor.solicitadoEm)) ||
      (cursor.consultarApos !== undefined &&
        cursor.consultarApos !== null &&
        !instanteIsoValido(cursor.consultarApos))
    ) {
      return null;
    }
    return {
      codigoSolicitacao: cursor.codigoSolicitacao!,
      idsArquivos: cursor.idsArquivos ?? null,
      proximoArquivo: cursor.proximoArquivo!,
      proximoRegistro: cursor.proximoRegistro ?? 0,
      quantidadeEsperada: cursor.quantidadeEsperada ?? null,
      registrosPercorridos: cursor.registrosPercorridos ?? 0,
      solicitacoesExpiradas: cursor.solicitacoesExpiradas ?? 0,
      solicitadoEm: cursor.solicitadoEm ?? new Date(0).toISOString(),
      consultarApos: cursor.consultarApos ?? null,
    };
  } catch {
    return null;
  }
}

async function processarLiquidacaoSicoob(
  conta: ContaBancaria,
  liquidacao: LiquidacaoMovimentacaoSicoob,
  sincronizacaoId: string,
): Promise<"PROCESSADO" | "ERRO"> {
  const chaveEvento = chaveIdempotenciaLiquidacaoSicoob(liquidacao);
  const payloadHash = hashCanonicoEventoSicoob(liquidacao);
  const alternativas: Prisma.BoletoWhereInput[] = [
    { nossoNumero: liquidacao.numeroTitulo },
    { seuNumero: liquidacao.seuNumero },
    ...(liquidacao.codigoBarras ? [{ codigoBarras: liquidacao.codigoBarras }] : []),
  ];
  const candidatos = await prisma.boleto.findMany({
    where: { contaBancariaId: conta.id, OR: alternativas },
    take: 3,
  });
  const coerentes = candidatos.filter(
    (boleto) =>
      boleto.nossoNumero === liquidacao.numeroTitulo &&
      boleto.seuNumero === liquidacao.seuNumero &&
      (!liquidacao.codigoBarras || boleto.codigoBarras === liquidacao.codigoBarras),
  );
  const boleto = coerentes.length === 1 ? coerentes[0] : null;
  const erroCorrespondencia =
    coerentes.length > 1
      ? "Liquidação ambígua; mais de um título corresponde aos identificadores bancários."
      : candidatos.length > 0
        ? "Os identificadores do arquivo LIQUI apontam para títulos diferentes."
        : "Liquidação sem boleto correspondente nesta conta.";
  const evento = await prisma.eventoBoleto.upsert({
    where: { chaveEvento },
    create: {
      boletoId: boleto?.id ?? null,
      sincronizacaoId,
      chaveEvento,
      origem: "MOVIMENTACAO",
      tipo: "LIQUIDACAO_CONFIRMADA",
      nossoNumero: liquidacao.numeroTitulo,
      seuNumero: liquidacao.seuNumero,
      situacaoBanco: "LIQUI",
      payloadHash,
      statusProcessamento: "PENDENTE",
      erro: boleto ? null : erroCorrespondencia,
    },
    update: {
      sincronizacaoId,
    },
  });

  if (!boleto) {
    if (["PROCESSADO", "IGNORADO"].includes(evento.statusProcessamento)) {
      return "PROCESSADO";
    }
    await prisma.eventoBoleto.updateMany({
      where: {
        id: evento.id,
        statusProcessamento: { in: ["PENDENTE", "ERRO", "EM_PROCESSAMENTO"] },
      },
      data: {
        statusProcessamento: "PENDENTE",
        erro: erroCorrespondencia,
      },
    });
    return "ERRO";
  }

  // Este CAS disputa com a decisão manual de ignorar. Qualquer ordem termina
  // com o boleto correspondente reservado para a baixa — nunca descartado.
  const reservaEvento = await prisma.eventoBoleto.updateMany({
    where: {
      id: evento.id,
      statusProcessamento: {
        in: ["PENDENTE", "ERRO", "EM_PROCESSAMENTO", "IGNORADO"],
      },
      OR: [{ boletoId: null }, { boletoId: boleto.id }],
    },
    data: {
      boletoId: boleto.id,
      statusProcessamento: "EM_PROCESSAMENTO",
      processadoEm: null,
      erro: null,
    },
  });
  if (reservaEvento.count !== 1) {
    const atual = await prisma.eventoBoleto.findUniqueOrThrow({
      where: { id: evento.id },
    });
    if (atual.boletoId && atual.boletoId !== boleto.id) return "ERRO";
    return atual.statusProcessamento === "PROCESSADO" ? "PROCESSADO" : "ERRO";
  }

  const identificadoresDivergentes =
    boleto.numeroClienteBanco !== liquidacao.numeroCliente ||
    boleto.numeroContaBanco !== liquidacao.numeroContaCorrente ||
    boleto.codigoModalidadeBanco !== liquidacao.codigoModalidade ||
    (boleto.contratoCobrancaBanco !== null &&
      boleto.contratoCobrancaBanco !== liquidacao.numeroContrato) ||
    boleto.valor !== liquidacao.valorTituloCentavos;
  if (identificadoresDivergentes) {
    const mensagem =
      "Conta, convênio, modalidade, contrato ou valor nominal do LIQUI diverge do título emitido.";
    await prisma.$transaction([
      prisma.eventoBoleto.update({
        where: { id: evento.id },
        data: { statusProcessamento: "ERRO", erro: mensagem },
      }),
      prisma.boleto.update({
        where: { id: boleto.id },
        data: {
          conciliacaoStatus: "DIVERGENTE",
          conciliacaoMotivo: "LIQUI_DIVERGENTE",
          mensagemErro: mensagem,
        },
      }),
    ]);
    return "ERRO";
  }

  return registrarLiquidacaoConfirmada({
    boletoId: boleto.id,
    eventoId: evento.id,
    chaveLiquidacao: chaveEvento,
    valorPago: liquidacao.valorLiquidoCentavos,
    dataPagamento: dataCivilNoBrasil(liquidacao.dataLiquidacao),
    dataCredito: liquidacao.dataPrevisaoCredito
      ? dataCivilNoBrasil(liquidacao.dataPrevisaoCredito)
      : null,
    liquidadoEm: new Date(liquidacao.dataLiquidacao),
  });
}

export async function ignorarLiquidacaoExternaSicoob(
  eventoId: string,
  usuarioId: string,
): Promise<void> {
  const evento = await prisma.eventoBoleto.findUnique({
    where: { id: eventoId },
    include: { sincronizacao: { select: { contaBancariaId: true } } },
  });
  if (
    !evento ||
    evento.origem !== "MOVIMENTACAO" ||
    evento.tipo !== "LIQUIDACAO_CONFIRMADA" ||
    evento.boletoId ||
    !evento.sincronizacao ||
    !["PENDENTE", "ERRO"].includes(evento.statusProcessamento)
  ) {
    throw new ErroOperacaoBoleto(
      "Somente uma liquidação LIQUI sem título pode ser ignorada.",
      "LIQUIDACAO_NAO_IGNORAVEL",
    );
  }
  const agora = new Date();
  const hashAuditoria = hashCanonicoEventoSicoob({
    eventoId: evento.id,
    usuarioId,
    ignoradoEm: agora.toISOString(),
  });
  await prisma.$transaction(async (tx) => {
    const identificadoresParciais: Prisma.BoletoWhereInput[] = [];
    if (evento.seuNumero) identificadoresParciais.push({ seuNumero: evento.seuNumero });
    if (evento.nossoNumero) identificadoresParciais.push({ nossoNumero: evento.nossoNumero });
    const candidatoInterno = identificadoresParciais.length
      ? await tx.boleto.findFirst({
          where: {
            contaBancariaId: evento.sincronizacao!.contaBancariaId,
            OR: identificadoresParciais,
          },
          select: { id: true },
        })
      : null;
    if (candidatoInterno) {
      throw new ErroOperacaoBoleto(
        "Há um título interno com identificador parcial compatível. Localize ou corrija o boleto antes de ignorar a liquidação.",
        "LIQUIDACAO_COM_CANDIDATO_INTERNO",
      );
    }
    const alterado = await tx.eventoBoleto.updateMany({
      where: {
        id: evento.id,
        boletoId: null,
        statusProcessamento: { in: ["PENDENTE", "ERRO"] },
      },
      data: {
        statusProcessamento: "IGNORADO",
        processadoEm: agora,
        erro: "Liquidação externa ao Brisa, ignorada após conferência manual.",
      },
    });
    if (alterado.count !== 1) {
      throw new ErroOperacaoBoleto(
        "A liquidação mudou durante a conferência; atualize a tela antes de continuar.",
        "LIQUIDACAO_EM_PROCESSAMENTO",
      );
    }
    await tx.eventoBoleto.create({
      data: {
        chaveEvento: `manual:liquidacao-ignorada:${evento.id}:${hashAuditoria}`,
        origem: "MANUAL",
        tipo: "LIQUIDACAO_EXTERNA_IGNORADA",
        nossoNumero: evento.nossoNumero,
        seuNumero: evento.seuNumero,
        payloadHash: hashAuditoria,
        statusProcessamento: "PROCESSADO",
        processadoEm: agora,
      },
    });
  });
}

async function encerrarSincronizacaoLiquidacoes(
  sincronizacaoId: string,
  contaBancariaId: string,
  lockToken: string,
  contadores: { lidas: number; processadas: number; erros: number },
  erro?: string,
  avanco?: {
    inicio: string;
    fim: string;
    reprocessamento: boolean;
    presumidoSemConteudo?: boolean;
    aviso?: string;
  },
): Promise<EncerramentoLiquidacoes> {
  const concluidaEm = new Date();
  return prisma.$transaction(async (tx) => {
    const reserva = await tx.sincronizacaoBancaria.updateMany({
      where: { id: sincronizacaoId, lockToken },
      data: {
        // Renova brevemente a posse; os contadores e o avanço são decididos
        // abaixo, no mesmo snapshot transacional dos eventos.
        lockExpiraEm: new Date(concluidaEm.getTime() + 60_000),
      },
    });
    if (reserva.count !== 1) {
      const atual = await tx.sincronizacaoBancaria.findUniqueOrThrow({
        where: { id: sincronizacaoId },
        select: {
          status: true,
          quantidadeLidos: true,
          quantidadeProcessados: true,
          quantidadeErros: true,
        },
      });
      return encerramentoDoRegistroLiquidacoes(atual);
    }
    const [processadasAtuais, pendenciasDaSincronizacao, pendenciasDaConta] =
      await Promise.all([
      tx.eventoBoleto.count({
        where: {
          sincronizacaoId,
          statusProcessamento: { in: ["PROCESSADO", "IGNORADO"] },
        },
      }),
      tx.eventoBoleto.count({
        where: {
          sincronizacaoId,
          statusProcessamento: { notIn: ["PROCESSADO", "IGNORADO"] },
        },
      }),
      tx.eventoBoleto.count({
        where: {
          origem: "MOVIMENTACAO",
          tipo: "LIQUIDACAO_CONFIRMADA",
          statusProcessamento: { notIn: ["PROCESSADO", "IGNORADO"] },
          sincronizacao: {
            is: {
              contaBancariaId,
              ...(avanco?.reprocessamento
                ? {
                    OR: [
                      { janelaFim: { lte: avanco.fim } },
                      {
                        janelaFim: null,
                        janelaInicio: { lte: avanco.fim },
                      },
                    ],
                  }
                : {}),
            },
          },
        },
      }),
    ]);
    const pendenciasRelevantes = avanco?.reprocessamento
      ? pendenciasDaConta
      : pendenciasDaSincronizacao;
    const errosAtuais = Math.max(
      contadores.erros,
      pendenciasRelevantes,
      erro ? 1 : 0,
    );
    const statusFinal = erro || errosAtuais > 0 ? "ERRO" : "CONCLUIDA";
    await tx.sincronizacaoBancaria.update({
      where: { id: sincronizacaoId },
      data: {
        status: statusFinal,
        slotExecucao: null,
        lockToken: null,
        lockExpiraEm: null,
        quantidadeLidos: contadores.lidas,
        quantidadeProcessados: processadasAtuais,
        quantidadeErros: errosAtuais,
        mensagemErro:
          erro ??
          (errosAtuais > 0
            ? `${errosAtuais} liquidação(ões) exigem conciliação manual.`
            : avanco?.aviso ?? null),
        concluidaEm,
      },
    });
    const contaAtual = await tx.contaBancaria.findUniqueOrThrow({
      where: { id: contaBancariaId },
      select: {
        liquidacoesSincronizadasAte: true,
        liquidacoesReprocessarDesde: true,
      },
    });
    let atualizacaoCurso: Prisma.ContaBancariaUpdateInput = {};
    if (!erro && errosAtuais === 0 && avanco) {
      if (avanco.reprocessamento) {
        if (contaAtual.liquidacoesReprocessarDesde === avanco.inicio) {
          atualizacaoCurso = {
            liquidacoesReprocessarDesde:
              contaAtual.liquidacoesSincronizadasAte &&
              avanco.fim >= contaAtual.liquidacoesSincronizadasAte
                ? null
                : avanco.fim,
          };
        }
      } else {
        atualizacaoCurso = { liquidacoesSincronizadasAte: avanco.fim };
        if (
          avanco.presumidoSemConteudo &&
          (!contaAtual.liquidacoesReprocessarDesde ||
            avanco.inicio < contaAtual.liquidacoesReprocessarDesde)
        ) {
          atualizacaoCurso.liquidacoesReprocessarDesde = avanco.inicio;
        }
      }
    }
    await tx.contaBancaria.update({
      where: { id: contaBancariaId },
      data: {
        ultimaSincronizacaoEm: concluidaEm,
        integracaoStatus: erro || errosAtuais > 0 ? "ERRO" : "PRONTA",
        mensagemIntegracao:
          erro ??
          (errosAtuais > 0
            ? `${errosAtuais} liquidação(ões) aguardam revisão.`
            : avanco?.aviso ?? null),
        ...atualizacaoCurso,
      },
    });
    return {
      status: statusFinal,
      lidas: contadores.lidas,
      processadas: processadasAtuais,
      erros: errosAtuais,
    };
  });
}

async function liberarLeaseLiquidacoes(
  sincronizacaoId: string,
  lockToken: string,
): Promise<void> {
  await prisma.sincronizacaoBancaria.updateMany({
    where: { id: sincronizacaoId, lockToken },
    data: { lockToken: null, lockExpiraEm: null },
  });
}

class LeaseLiquidacoesPerdido extends Error {
  constructor() {
    super("A sincronização foi assumida por outra execução.");
    this.name = "LeaseLiquidacoesPerdido";
  }
}

async function atualizarSincronizacaoComLease(
  sincronizacaoId: string,
  lockToken: string,
  data: Prisma.SincronizacaoBancariaUpdateManyMutationInput,
): Promise<void> {
  const atualizada = await prisma.sincronizacaoBancaria.updateMany({
    where: { id: sincronizacaoId, lockToken },
    data: {
      ...data,
      lockExpiraEm: new Date(Date.now() + 10 * 60_000),
    },
  });
  if (atualizada.count !== 1) throw new LeaseLiquidacoesPerdido();
}

async function sincronizarLiquidacoesDaConta(
  conta: ContaBancaria,
  iniciadoPorUsuarioId: string | undefined,
  limiteEmMs: number,
): Promise<ResultadoLiquidacoes> {
  const resultado: ResultadoLiquidacoes = {
    solicitadas: 0,
    concluidas: 0,
    aguardando: 0,
    lidas: 0,
    processadas: 0,
    erros: 0,
  };
  validarContaIntegrada(conta);
  await validarPerfilCredencialUnico(conta.id);
  const contaApi = contaParaApi(conta);
  const slotExecucao = `${conta.id}:LIQUIDACOES`;

  let sincronizacao = await prisma.sincronizacaoBancaria.findFirst({
    where: { slotExecucao },
  });
  if (!sincronizacao) {
    const hoje = hojeNoBrasil();
    try {
      sincronizacao = await prisma.$transaction(async (tx) => {
        const cursoAtual = await tx.contaBancaria.findUniqueOrThrow({
          where: { id: conta.id },
          select: {
            liquidacoesSincronizadasAte: true,
            liquidacoesReprocessarDesde: true,
          },
        });
        const sincronizadasAte =
          cursoAtual.liquidacoesSincronizadasAte &&
          cursoAtual.liquidacoesSincronizadasAte <= hoje
            ? cursoAtual.liquidacoesSincronizadasAte
            : diaAnterior(hoje);
        const reprocessarDesdeConfigurado =
          sincronizadasAte >= hoje &&
          cursoAtual.liquidacoesReprocessarDesde &&
          cursoAtual.liquidacoesReprocessarDesde <= sincronizadasAte
            ? cursoAtual.liquidacoesReprocessarDesde
            : null;
        const iniciarAuditoriaMovel =
          !reprocessarDesdeConfigurado && sincronizadasAte >= hoje;
        const reprocessarDesde = iniciarAuditoriaMovel
          ? adicionarDias(hoje, -7)
          : reprocessarDesdeConfigurado;
        const reprocessamento = Boolean(reprocessarDesde);
        const inicio = reprocessarDesde ?? sincronizadasAte;
        const limiteFim = reprocessamento ? sincronizadasAte : hoje;
        const proximoDia = adicionarDias(inicio, 1);
        const fim = proximoDia < limiteFim ? proximoDia : limiteFim;
        const criada = await tx.sincronizacaoBancaria.create({
          data: {
            contaBancariaId: conta.id,
            iniciadoPorUsuarioId,
            tipo: reprocessamento
              ? "LIQUIDACOES_REPROCESSAMENTO"
              : "LIQUIDACOES",
            status: "PENDENTE",
            slotExecucao,
            janelaInicio: inicio,
            janelaFim: fim,
          },
        });
        if (iniciarAuditoriaMovel) {
          await tx.contaBancaria.update({
            where: { id: conta.id },
            data: { liquidacoesReprocessarDesde: inicio },
          });
        }
        return criada;
      });
    } catch (erro) {
      if (!erroDeUnicidade(erro)) throw erro;
      sincronizacao = await prisma.sincronizacaoBancaria.findFirstOrThrow({
        where: { slotExecucao },
      });
    }
  }

  const sincronizacaoId = sincronizacao.id;
  const lockToken = randomUUID();
  const agora = new Date();
  const lease = await prisma.sincronizacaoBancaria.updateMany({
    where: {
      id: sincronizacaoId,
      OR: [
        { lockToken: null },
        { lockExpiraEm: null },
        { lockExpiraEm: { lt: agora } },
      ],
    },
    data: {
      lockToken,
      lockExpiraEm: new Date(agora.getTime() + 10 * 60_000),
    },
  });
  if (lease.count !== 1) {
    resultado.aguardando += 1;
    return resultado;
  }

  // O registro pode ter avançado entre a primeira leitura e a aquisição do
  // lease. Recarregamos o cursor somente depois de confirmar a posse.
  sincronizacao = await prisma.sincronizacaoBancaria.findFirstOrThrow({
    where: { id: sincronizacaoId, lockToken },
  });

  let cursor = interpretarCursorLiquidacoes(sincronizacao.cursor);
  try {
    const cliente = criarClienteSicoob();
    if (!cursor) {
      const solicitacao = await cliente.solicitarMovimentacoesLiquidacao({
        numeroCliente: contaApi.numeroCliente,
        dataInicial: sincronizacao.janelaInicio ?? diaAnterior(hojeNoBrasil()),
        dataFinal: sincronizacao.janelaFim ?? hojeNoBrasil(),
      });
      cursor = {
        codigoSolicitacao: solicitacao.codigoSolicitacao,
        idsArquivos: null,
        proximoArquivo: 0,
        proximoRegistro: 0,
        quantidadeEsperada: null,
        registrosPercorridos: 0,
        solicitacoesExpiradas: 0,
        solicitadoEm: new Date().toISOString(),
        consultarApos: null,
      };
      await atualizarSincronizacaoComLease(sincronizacaoId, lockToken, {
        status: "EM_ANDAMENTO",
        cursor: serializarCursorLiquidacoes(cursor),
        mensagemErro: null,
      });
      resultado.solicitadas += 1;
    }

    if (!cursor.idsArquivos) {
      if (cursor.consultarApos && Date.parse(cursor.consultarApos) > Date.now()) {
        resultado.aguardando += 1;
        await liberarLeaseLiquidacoes(sincronizacao.id, lockToken);
        return resultado;
      }
      const estado = await cliente.consultarMovimentacoes(
        contaApi.numeroCliente,
        cursor.codigoSolicitacao,
      );
      if (!estado.pronto) {
        const tempoDaSolicitacao = Date.now() - Date.parse(cursor.solicitadoEm);
        if (tempoDaSolicitacao < 45 * 60_000) {
          cursor.consultarApos = new Date(Date.now() + 5 * 60_000).toISOString();
          await atualizarSincronizacaoComLease(sincronizacaoId, lockToken, {
            cursor: serializarCursorLiquidacoes(cursor),
            mensagemErro: estado.semRegistros
              ? "Solicitação sem conteúdo por enquanto; uma nova consulta será feita sem avançar a janela."
              : "Arquivo LIQUI ainda em preparação; uma nova consulta será feita sem avançar a janela.",
          });
          resultado.aguardando += 1;
          await liberarLeaseLiquidacoes(sincronizacao.id, lockToken);
          return resultado;
        }

        const solicitacoesExpiradas = cursor.solicitacoesExpiradas + 1;
        const janelaInicio = sincronizacao.janelaInicio ?? diaAnterior(hojeNoBrasil());
        const janelaFim = sincronizacao.janelaFim ?? hojeNoBrasil();
        if (estado.semRegistros && solicitacoesExpiradas >= 3) {
          const aviso =
            "Três solicitações independentes terminaram sem conteúdo. A janela avançou de forma provisória e entrou na fila de reauditoria móvel.";
          const encerramento = await encerrarSincronizacaoLiquidacoes(
            sincronizacao.id,
            conta.id,
            lockToken,
            { lidas: 0, processadas: 0, erros: 0 },
            undefined,
            {
              inicio: janelaInicio,
              fim: janelaFim,
              reprocessamento:
                sincronizacao.tipo === "LIQUIDACOES_REPROCESSAMENTO",
              presumidoSemConteudo: true,
              aviso,
            },
          );
          agregarEncerramentoLiquidacoes(resultado, encerramento);
          return resultado;
        }
        if (solicitacoesExpiradas >= 3) {
          const mensagem =
            "O Sicoob não concluiu três solicitações sucessivas; a janela foi encerrada sem avanço e será criada novamente.";
          const encerramento = await encerrarSincronizacaoLiquidacoes(
            sincronizacao.id,
            conta.id,
            lockToken,
            { lidas: 0, processadas: 0, erros: 1 },
            mensagem,
          );
          agregarEncerramentoLiquidacoes(resultado, encerramento);
          return resultado;
        }

        const novaSolicitacao = await cliente.solicitarMovimentacoesLiquidacao({
          numeroCliente: contaApi.numeroCliente,
          dataInicial: janelaInicio,
          dataFinal: janelaFim,
        });
        cursor = {
          codigoSolicitacao: novaSolicitacao.codigoSolicitacao,
          idsArquivos: null,
          proximoArquivo: 0,
          proximoRegistro: 0,
          quantidadeEsperada: null,
          registrosPercorridos: 0,
          solicitacoesExpiradas,
          solicitadoEm: new Date().toISOString(),
          consultarApos: new Date(Date.now() + 2 * 60_000).toISOString(),
        };
        await atualizarSincronizacaoComLease(sincronizacaoId, lockToken, {
          cursor: serializarCursorLiquidacoes(cursor),
          mensagemErro: `Solicitação anterior expirou sem conteúdo; tentativa ${solicitacoesExpiradas + 1} de 3 criada para a mesma janela.`,
        });
        resultado.solicitadas += 1;
        resultado.aguardando += 1;
        await liberarLeaseLiquidacoes(sincronizacao.id, lockToken);
        return resultado;
      }
      cursor.idsArquivos = estado.idsArquivos;
      cursor.quantidadeEsperada = estado.quantidadeTotalRegistros;
      cursor.consultarApos = null;
      await atualizarSincronizacaoComLease(sincronizacaoId, lockToken, {
        cursor: serializarCursorLiquidacoes(cursor),
      });
    }

    const inicioExecucao = Date.now();
    for (let indice = cursor.proximoArquivo; indice < cursor.idsArquivos.length; indice += 1) {
      if (Date.now() - inicioExecucao >= limiteEmMs) {
        cursor.proximoArquivo = indice;
        const [eventosLidos, processadas] = await Promise.all([
          prisma.eventoBoleto.count({ where: { sincronizacaoId } }),
          prisma.eventoBoleto.count({
            where: {
              sincronizacaoId,
              statusProcessamento: { in: ["PROCESSADO", "IGNORADO"] },
            },
          }),
        ]);
        const lidas = cursor.registrosPercorridos;
        const erros = eventosLidos - processadas;
        await atualizarSincronizacaoComLease(sincronizacaoId, lockToken, {
          cursor: serializarCursorLiquidacoes(cursor),
          quantidadeLidos: lidas,
          quantidadeProcessados: processadas,
          quantidadeErros: erros,
        });
        resultado.aguardando += 1;
        resultado.lidas += lidas;
        resultado.processadas += processadas;
        resultado.erros += erros;
        await liberarLeaseLiquidacoes(sincronizacaoId, lockToken);
        return resultado;
      }
      await atualizarSincronizacaoComLease(sincronizacaoId, lockToken, {
        cursor: serializarCursorLiquidacoes(cursor),
      });
      const idArquivo = cursor.idsArquivos[indice];
      const arquivo = await cliente.baixarArquivoMovimentacoesLiquidacao({
        numeroCliente: contaApi.numeroCliente,
        codigoSolicitacao: cursor.codigoSolicitacao,
        idArquivo,
      });
      const registroInicial = indice === cursor.proximoArquivo ? cursor.proximoRegistro : 0;
      for (let registro = registroInicial; registro < arquivo.liquidacoes.length; registro += 1) {
        if (Date.now() - inicioExecucao >= limiteEmMs) {
          cursor.proximoArquivo = indice;
          cursor.proximoRegistro = registro;
          const [eventosLidos, processadas] = await Promise.all([
            prisma.eventoBoleto.count({ where: { sincronizacaoId: sincronizacao.id } }),
            prisma.eventoBoleto.count({
              where: {
                sincronizacaoId: sincronizacao.id,
                statusProcessamento: { in: ["PROCESSADO", "IGNORADO"] },
              },
            }),
          ]);
          const lidas = cursor.registrosPercorridos;
          const erros = eventosLidos - processadas;
          await atualizarSincronizacaoComLease(sincronizacaoId, lockToken, {
            cursor: serializarCursorLiquidacoes(cursor),
            quantidadeLidos: lidas,
            quantidadeProcessados: processadas,
            quantidadeErros: erros,
          });
          resultado.aguardando += 1;
          resultado.lidas += lidas;
          resultado.processadas += processadas;
          resultado.erros += erros;
          await liberarLeaseLiquidacoes(sincronizacao.id, lockToken);
          return resultado;
        }
        await processarLiquidacaoSicoob(
          conta,
          arquivo.liquidacoes[registro],
          sincronizacao.id,
        );
        cursor.proximoRegistro = registro + 1;
        cursor.registrosPercorridos += 1;
        if (cursor.registrosPercorridos % 25 === 0) {
          await atualizarSincronizacaoComLease(sincronizacaoId, lockToken, {
            cursor: serializarCursorLiquidacoes(cursor),
          });
        }
      }
      cursor.proximoArquivo = indice + 1;
      cursor.proximoRegistro = 0;
      await atualizarSincronizacaoComLease(sincronizacaoId, lockToken, {
        cursor: serializarCursorLiquidacoes(cursor),
      });
    }
    const [eventosLidos, processadas] = await Promise.all([
      prisma.eventoBoleto.count({ where: { sincronizacaoId: sincronizacao.id } }),
      prisma.eventoBoleto.count({
        where: {
          sincronizacaoId: sincronizacao.id,
          statusProcessamento: { in: ["PROCESSADO", "IGNORADO"] },
        },
      }),
    ]);
    const lidas = cursor.registrosPercorridos;
    const contagemDivergente =
      cursor.quantidadeEsperada === null ||
      cursor.quantidadeEsperada !== cursor.registrosPercorridos;
    const erros = eventosLidos - processadas + (contagemDivergente ? 1 : 0);
    const mensagemIntegridade = contagemDivergente
      ? `O Sicoob anunciou ${cursor.quantidadeEsperada ?? "uma quantidade desconhecida de"} registro(s), mas ${cursor.registrosPercorridos} foram percorridos. A janela não avançou.`
      : undefined;
    const encerramento = await encerrarSincronizacaoLiquidacoes(
      sincronizacao.id,
      conta.id,
      lockToken,
      { lidas, processadas, erros },
      mensagemIntegridade,
      erros === 0
        ? {
            inicio: sincronizacao.janelaInicio ?? diaAnterior(hojeNoBrasil()),
            fim: sincronizacao.janelaFim ?? hojeNoBrasil(),
            reprocessamento:
              sincronizacao.tipo === "LIQUIDACOES_REPROCESSAMENTO",
          }
        : undefined,
    );
    agregarEncerramentoLiquidacoes(resultado, encerramento);
    return resultado;
  } catch (erro) {
    const mensagem = textoErroSeguro(erro);
    if (erro instanceof ErroApiSicoob && erro.transitorio) {
      const decisao = await prisma.$transaction(async (tx) => {
        const atual = await tx.sincronizacaoBancaria.findUniqueOrThrow({
          where: { id: sincronizacaoId },
          select: {
            status: true,
            lockToken: true,
            quantidadeLidos: true,
            quantidadeProcessados: true,
            quantidadeErros: true,
            iniciadaEm: true,
          },
        });
        if (atual.lockToken !== lockToken) {
          return {
            tipo: "AUTORITATIVO" as const,
            encerramento: encerramentoDoRegistroLiquidacoes(atual),
          };
        }

        const tentativas = atual.quantidadeErros + 1;
        const idade = Date.now() - atual.iniciadaEm.getTime();
        if (
          tentativas >= MAX_ERROS_TRANSITORIOS_LIQUIDACOES ||
          idade >= IDADE_MAXIMA_SYNC_LIQUIDACOES_MS
        ) {
          return {
            tipo: "ENCERRAR" as const,
            tentativas,
            lidas: Math.max(
              atual.quantidadeLidos,
              cursor?.registrosPercorridos ?? 0,
            ),
            processadas: atual.quantidadeProcessados,
          };
        }

        const liberada = await tx.sincronizacaoBancaria.updateMany({
          where: { id: sincronizacaoId, lockToken },
          data: {
            status: "EM_ANDAMENTO",
            lockToken: null,
            lockExpiraEm: null,
            quantidadeErros: { increment: 1 },
            mensagemErro: `${mensagem} Tentativa transitória ${tentativas} de ${MAX_ERROS_TRANSITORIOS_LIQUIDACOES}; a janela e o cursor foram preservados.`,
          },
        });
        if (liberada.count !== 1) {
          const autoritativa = await tx.sincronizacaoBancaria.findUniqueOrThrow({
            where: { id: sincronizacaoId },
            select: {
              status: true,
              quantidadeLidos: true,
              quantidadeProcessados: true,
              quantidadeErros: true,
            },
          });
          return {
            tipo: "AUTORITATIVO" as const,
            encerramento: encerramentoDoRegistroLiquidacoes(autoritativa),
          };
        }
        await tx.contaBancaria.update({
          where: { id: conta.id },
          data: {
            integracaoStatus: "ERRO",
            mensagemIntegracao: `${mensagem} Nova tentativa será feita sem avançar a janela.`,
          },
        });
        return {
          tipo: "AGUARDAR" as const,
          encerramento: {
            status: "AGUARDANDO" as const,
            lidas: atual.quantidadeLidos,
            processadas: atual.quantidadeProcessados,
            erros: 1,
          },
        };
      });

      if (decisao.tipo === "ENCERRAR") {
        const mensagemLimite = `${mensagem} O limite de falhas transitórias foi atingido; a sincronização foi encerrada sem avançar a janela e a fila será replanejada.`;
        const encerramento = await encerrarSincronizacaoLiquidacoes(
          sincronizacao.id,
          conta.id,
          lockToken,
          {
            lidas: decisao.lidas,
            processadas: decisao.processadas,
            erros: decisao.tentativas,
          },
          mensagemLimite,
        );
        agregarEncerramentoLiquidacoes(resultado, encerramento);
      } else {
        agregarEncerramentoLiquidacoes(resultado, decisao.encerramento);
      }
      return resultado;
    }
    const [eventosLidos, processadas] = await Promise.all([
      prisma.eventoBoleto.count({ where: { sincronizacaoId: sincronizacao.id } }),
      prisma.eventoBoleto.count({
        where: {
          sincronizacaoId: sincronizacao.id,
          statusProcessamento: { in: ["PROCESSADO", "IGNORADO"] },
        },
      }),
    ]);
    const lidas = cursor?.registrosPercorridos ?? eventosLidos;
    const encerramento = await encerrarSincronizacaoLiquidacoes(
      sincronizacao.id,
      conta.id,
      lockToken,
      {
        lidas,
        processadas,
        erros: eventosLidos - processadas + 1,
      },
      mensagem,
    );
    agregarEncerramentoLiquidacoes(resultado, encerramento);
    return resultado;
  }
}

/** Solicita/polla/baixa os movimentos oficiais 5/LIQUI das contas autorizadas. */
export async function sincronizarLiquidacoesSicoob(
  iniciadoPorUsuarioId?: string,
  limitePorContaMs = 40_000,
): Promise<ResultadoLiquidacoes> {
  const contas = await prisma.contaBancaria.findMany({
    where: {
      codigoBanco: "756",
      ativa: true,
      integracaoHabilitada: true,
    },
    orderBy: [{ padrao: "desc" }, { atualizadoEm: "asc" }],
  });
  const total: ResultadoLiquidacoes = {
    solicitadas: 0,
    concluidas: 0,
    aguardando: 0,
    lidas: 0,
    processadas: 0,
    erros: 0,
  };
  for (const conta of contas) {
    const parcial = await sincronizarLiquidacoesDaConta(
      conta,
      iniciadoPorUsuarioId,
      limitePorContaMs,
    );
    for (const chave of Object.keys(total) as (keyof ResultadoLiquidacoes)[]) {
      total[chave] += parcial[chave];
    }
  }
  return total;
}

export async function sincronizarCarteiraSicoob(
  limiteBoletos = 20,
  iniciadoPorUsuarioId?: string,
) {
  const boletos = await sincronizarBoletosAbertos(limiteBoletos, iniciadoPorUsuarioId);
  const liquidacoes = await sincronizarLiquidacoesSicoob(iniciadoPorUsuarioId, 20_000);
  return { boletos, liquidacoes };
}

function contemValidacaoWebhook(payload: unknown, profundidade = 0): boolean {
  if (profundidade > 12 || payload === null || typeof payload !== "object") return false;
  if (Array.isArray(payload)) {
    return payload.some((item) => contemValidacaoWebhook(item, profundidade + 1));
  }
  for (const [chave, valor] of Object.entries(payload as Record<string, unknown>)) {
    if (chave.toLowerCase() === "validacaowebhook" && valor === true) return true;
    if (contemValidacaoWebhook(valor, profundidade + 1)) return true;
  }
  return false;
}

function contemCancelamentoBaixa(payload: unknown, profundidade = 0): boolean {
  if (profundidade > 12 || payload === null || typeof payload !== "object") return false;
  if (Array.isArray(payload)) {
    return payload.some((item) => contemCancelamentoBaixa(item, profundidade + 1));
  }
  for (const [chave, valor] of Object.entries(payload as Record<string, unknown>)) {
    const normalizada = chave.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    if (normalizada === "cancelamentobaixa" && valor === true) return true;
    if (contemCancelamentoBaixa(valor, profundidade + 1)) return true;
  }
  return false;
}

function movimentoWebhookEhBaixaOperacional(
  payload: unknown,
  estado = { encontrou: false, valido: true, nos: 0 },
  profundidade = 0,
): boolean {
  estado.nos += 1;
  if (estado.nos > 5_000 || profundidade > 12 || payload === null) {
    estado.valido = false;
    return false;
  }
  if (Array.isArray(payload)) {
    for (const item of payload) movimentoWebhookEhBaixaOperacional(item, estado, profundidade + 1);
    return estado.encontrou && estado.valido;
  }
  if (typeof payload !== "object") return estado.encontrou && estado.valido;
  for (const [chave, valor] of Object.entries(payload as Record<string, unknown>)) {
    const normalizada = chave.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    if (normalizada === "codigotipomovimento" || normalizada === "tipomovimento") {
      estado.encontrou = true;
      if (valor !== 7) estado.valido = false;
    }
    if (valor !== null && typeof valor === "object") {
      movimentoWebhookEhBaixaOperacional(valor, estado, profundidade + 1);
    }
  }
  return estado.encontrou && estado.valido;
}

function identidadePerfilSicoob(): {
  ambiente: string;
  credencialFingerprint: string;
} {
  const configuracao = carregarConfiguracaoSicoob();
  const ambiente = configuracao.ambiente.toUpperCase();
  return {
    ambiente,
    credencialFingerprint: chaveHex(
      "perfil-sicoob-v1",
      ambiente,
      configuracao.clientId,
    ),
  };
}

async function obterOuCriarPerfilSicoob(
  conta: ContaBancaria,
): Promise<{
  id: string;
  ambiente: string;
  credencialFingerprint: string;
  webhookId: string | null;
  webhookStatus: string | null;
  webhookUrlHash: string | null;
}> {
  const identidade = identidadePerfilSicoob();
  const where = {
    ambiente_credencialFingerprint: identidade,
  };
  const existente = await prisma.perfilIntegracaoSicoob.findUnique({ where });
  if (existente) {
    if (!existente.webhookId && conta.webhookId) {
      return prisma.perfilIntegracaoSicoob.update({
        where: { id: existente.id },
        data: {
          webhookId: conta.webhookId,
          webhookStatus: conta.webhookStatus,
        },
      });
    }
    return existente;
  }
  try {
    return await prisma.perfilIntegracaoSicoob.create({
      data: {
        ...identidade,
        ...(conta.ambiente === identidade.ambiente
          ? {
              webhookId: conta.webhookId,
              webhookStatus: conta.webhookStatus,
            }
          : {}),
      },
    });
  } catch (erro) {
    if (!erroDeUnicidade(erro)) throw erro;
    return prisma.perfilIntegracaoSicoob.findUniqueOrThrow({ where });
  }
}

/** Persiste o aviso operacional; jamais dá baixa financeira pelo webhook tipo 7. */
export async function registrarNotificacaoWebhookSicoob(
  payload: unknown,
): Promise<ResultadoWebhook> {
  const payloadHash = hashCanonicoEventoSicoob(payload);
  const ids = extrairIdentificadoresEventoSicoob(payload);
  const validacao = contemValidacaoWebhook(payload);
  if (!validacao && !movimentoWebhookEhBaixaOperacional(payload)) {
    throw new ErroOperacaoBoleto(
      "O callback não corresponde ao movimento 7 do Sicoob.",
      "WEBHOOK_PAYLOAD_INVALIDO",
    );
  }
  const cancelamento = contemCancelamentoBaixa(payload);
  const chaveEvento = chaveIdempotenciaEventoSicoob(payload);
  const identificadoresUnicos = [
    ids.nossosNumeros,
    ids.seusNumeros,
    ids.codigosBarras,
    ids.idsWebhook,
    ids.numerosCliente,
  ].every((valores) => valores.length <= 1);
  const temIdentificador =
    ids.nossosNumeros.length > 0 ||
    ids.seusNumeros.length > 0 ||
    ids.codigosBarras.length > 0;
  const ambienteAtual = obterEstadoConfiguracaoSicoob().ambiente.toUpperCase();
  const perfisDoWebhook = ids.idsWebhook.length
    ? await prisma.perfilIntegracaoSicoob.findMany({
        where: {
          ambiente: ambienteAtual,
          webhookId: { in: ids.idsWebhook },
        },
        select: { webhookId: true },
      })
    : [];
  const webhookDesconhecido =
    ids.idsWebhook.length > 0 && perfisDoWebhook.length === 0;
  const validacaoNaoAssociada =
    validacao && (ids.idsWebhook.length === 0 || webhookDesconhecido);
  const contasDoWebhook = await prisma.contaBancaria.findMany({
    where: {
      ativa: true,
      integracaoHabilitada: true,
      ambiente: ambienteAtual,
      ...(webhookDesconhecido ? { id: "__webhook_desconhecido__" } : {}),
      ...(ids.numerosCliente.length
        ? { numeroCliente: { in: ids.numerosCliente } }
        : {}),
    },
    select: { id: true },
  });
  const contaDesconhecida = contasDoWebhook.length === 0;
  const escopoConta = contasDoWebhook.map((conta) => conta.id);
  const alternativas: Prisma.BoletoWhereInput[] = [
    ...(ids.nossosNumeros.length ? [{ nossoNumero: { in: ids.nossosNumeros } }] : []),
    ...(ids.seusNumeros.length ? [{ seuNumero: { in: ids.seusNumeros } }] : []),
    ...(ids.codigosBarras.length ? [{ codigoBarras: { in: ids.codigosBarras } }] : []),
  ];
  const candidatos =
    validacao || !identificadoresUnicos || !temIdentificador || contaDesconhecida
      ? []
      : await prisma.boleto.findMany({
          where: { contaBancariaId: { in: escopoConta }, OR: alternativas },
          take: 3,
        });
  const coerentes = candidatos.filter(
    (item) =>
      (!ids.nossosNumeros.length ||
        (item.nossoNumero !== null && ids.nossosNumeros.includes(item.nossoNumero))) &&
      (!ids.seusNumeros.length || ids.seusNumeros.includes(item.seuNumero)) &&
      (!ids.codigosBarras.length ||
        (item.codigoBarras !== null && ids.codigosBarras.includes(item.codigoBarras))),
  );
  const boleto = coerentes.length === 1 ? coerentes[0] : null;
  const erroCorrespondencia = validacaoNaoAssociada
    ? "Validação recebida sem um perfil de webhook reconhecido."
    : validacao
      ? null
    : !identificadoresUnicos
      ? "Aviso com identificadores conflitantes."
      : webhookDesconhecido
      ? "Aviso recebido para um webhook não reconhecido."
      : contaDesconhecida
        ? "Aviso recebido sem conta ativa correspondente ao perfil Sicoob."
      : coerentes.length > 1
        ? "Aviso ambíguo; mais de um boleto corresponde aos identificadores."
        : !boleto
          ? "Aviso sem boleto correspondente."
          : null;
  const evento = await prisma.eventoBoleto.upsert({
    where: { chaveEvento },
    create: {
      boletoId: boleto?.id ?? null,
      chaveEvento,
      origem: "WEBHOOK",
      tipo: validacao
        ? "VALIDACAO_WEBHOOK"
        : cancelamento
          ? "CANCELAMENTO_BAIXA_OPERACIONAL"
          : "PAGAMENTO_BAIXA_OPERACIONAL",
      nossoNumero: ids.nossosNumeros[0] ?? null,
      seuNumero: ids.seusNumeros[0] ?? null,
      payloadHash,
      statusProcessamento: "PENDENTE",
      erro: erroCorrespondencia,
    },
    update: {},
  });
  if (["PROCESSADO", "IGNORADO"].includes(evento.statusProcessamento)) {
    return {
      duplicado: true,
      validacao,
      boletoEncontrado: Boolean(evento.boletoId),
      boletoId: evento.boletoId,
    };
  }

  await prisma.$transaction(async (tx) => {
    if (validacao) {
      if (validacaoNaoAssociada) {
        await tx.eventoBoleto.update({
          where: { id: evento.id },
          data: { statusProcessamento: "PENDENTE", erro: erroCorrespondencia },
        });
        return;
      }
      if (ids.idsWebhook.length) {
        await tx.perfilIntegracaoSicoob.updateMany({
          where: {
            ambiente: ambienteAtual,
            webhookId: { in: ids.idsWebhook },
          },
          data: { webhookStatus: "VALIDADO" },
        });
        await tx.contaBancaria.updateMany({
          where: {
            ambiente: ambienteAtual,
            ativa: true,
            integracaoHabilitada: true,
          },
          data: { webhookStatus: "VALIDADO" },
        });
      }
      await tx.eventoBoleto.update({
        where: { id: evento.id },
        data: { statusProcessamento: "PROCESSADO", processadoEm: new Date(), erro: null },
      });
      return;
    }
    if (!boleto) {
      await tx.eventoBoleto.update({
        where: { id: evento.id },
        data: { statusProcessamento: "PENDENTE", erro: erroCorrespondencia },
      });
      return;
    }
    const estadoAtual = await tx.boleto.findUnique({ where: { id: boleto.id } });
    if (
      estadoAtual &&
      !["LIQUIDADO", "BAIXADO_SEM_PAGAMENTO", "ESTORNADO"].includes(
        estadoAtual.status,
      ) &&
      !["CONCILIADO", "DIVERGENTE"].includes(estadoAtual.conciliacaoStatus)
    ) {
      await tx.boleto.updateMany({
        where: {
          id: boleto.id,
          status: { notIn: ["LIQUIDADO", "BAIXADO_SEM_PAGAMENTO", "ESTORNADO"] },
          conciliacaoStatus: { notIn: ["CONCILIADO", "DIVERGENTE"] },
        },
        data: {
          status: cancelamento ? "CANCELAMENTO_REPORTADO" : "PAGAMENTO_REPORTADO",
          conciliacaoStatus: "PENDENTE",
          mensagemErro: cancelamento
            ? "Cancelamento da intenção de pagamento informado; aguardando o arquivo LIQUI."
            : "Pagamento informado pelo Sicoob; aguardando confirmação no arquivo LIQUI.",
        },
      });
    }
    await tx.eventoBoleto.update({
      where: { id: evento.id },
      data: {
        boletoId: boleto.id,
        statusProcessamento: "PROCESSADO",
        processadoEm: new Date(),
        erro: null,
      },
    });
  });
  return {
    duplicado: false,
    validacao,
    boletoEncontrado: Boolean(boleto),
    boletoId: boleto?.id ?? null,
  };
}

export async function registrarWebhookDaConta(
  contaBancariaId: string,
  usuarioId: string,
): Promise<{ idWebhook: string; status: string }> {
  const conta = await prisma.contaBancaria.findUnique({ where: { id: contaBancariaId } });
  if (!conta) throw new ErroOperacaoBoleto("Conta bancária não encontrada.");
  if (!conta.integracaoHabilitada) {
    throw new ErroOperacaoBoleto("Habilite e teste a integração antes de cadastrar o webhook.");
  }
  validarContaIntegrada(conta);
  await validarPerfilCredencialUnico(conta.id);
  const origem = process.env.APP_PUBLIC_URL?.trim();
  const segredo = process.env.SICOOB_WEBHOOK_SECRET?.trim();
  if (!origem) throw new ErroOperacaoBoleto("APP_PUBLIC_URL não configurada.");
  if (!segredo || !/^[A-Za-z0-9_-]{43,128}$/.test(segredo)) {
    throw new ErroOperacaoBoleto(
      "SICOOB_WEBHOOK_SECRET deve ser Base64URL/hex forte, com 43 a 128 caracteres.",
    );
  }
  let url: URL;
  try {
    url = new URL(`/api/integracoes/sicoob/webhook/${encodeURIComponent(segredo)}`, origem);
  } catch {
    throw new ErroOperacaoBoleto("APP_PUBLIC_URL inválida.");
  }
  if (url.protocol !== "https:") {
    throw new ErroOperacaoBoleto("O webhook do Sicoob exige uma URL pública HTTPS.");
  }
  const entrada = {
    url: url.toString(),
    ...(process.env.SICOOB_WEBHOOK_EMAIL?.trim()
      ? { email: process.env.SICOOB_WEBHOOK_EMAIL.trim() }
      : {}),
  };
  const cliente = criarClienteSicoob();
  const perfil = await obterOuCriarPerfilSicoob(conta);
  const webhookIdAtual = perfil.webhookId ?? conta.webhookId;
  let resultado: { idWebhook: string; status: string };
  if (webhookIdAtual) {
    const atual = await cliente.consultarWebhookBaixaOperacional(webhookIdAtual);
    if (atual) {
      if (atual.codigoSituacao === 3) {
        await cliente.reativarWebhookBaixaOperacional(webhookIdAtual);
      }
      if (atual.url !== entrada.url || atual.codigoSituacao === 3) {
        await cliente.atualizarWebhookBaixaOperacional(webhookIdAtual, entrada);
        resultado = {
          idWebhook: webhookIdAtual,
          status: "AGUARDANDO_VALIDACAO" as const,
        };
      } else {
        resultado = { idWebhook: atual.idWebhook, status: atual.status };
      }
    } else {
      resultado = await cliente.registrarWebhookBaixaOperacionalExperimental(entrada);
    }
  } else {
    resultado = await cliente.registrarWebhookBaixaOperacionalExperimental(entrada);
  }
  await prisma.$transaction([
    prisma.perfilIntegracaoSicoob.update({
      where: { id: perfil.id },
      data: {
        webhookId: resultado.idWebhook,
        webhookStatus: resultado.status,
        webhookUrlHash: chaveHex("webhook-url-v1", entrada.url),
      },
    }),
    prisma.contaBancaria.update({
      where: { id: conta.id },
      data: {
        webhookId: resultado.idWebhook,
        webhookStatus: resultado.status,
        atualizadoPorUsuarioId: usuarioId,
        mensagemIntegracao: null,
      },
    }),
  ]);
  return { idWebhook: resultado.idWebhook, status: resultado.status };
}
