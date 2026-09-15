"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirPermissaoFinanceira } from "@/lib/autorizacao";
import { prisma } from "@/lib/db";

const ROTA = "/financeiro/contas-bancarias";
const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RE_NUMERO_CLIENTE = /^\d{1,15}$/;
const RE_CONTA_CORRENTE_API = /^\d{1,15}$/;
const RE_CONTRATO_COBRANCA = /^\d{1,15}$/;
const MODALIDADES_SICOOB = new Set([1, 3, 4, 5, 8]);
const ESPECIES_DOCUMENTO_SICOOB = new Set([
  "CH", "DM", "DMI", "DS", "DSI", "DR", "LC", "NCC", "NCE", "NCI", "NCR",
  "NP", "NPR", "TM", "TS", "NS", "RC", "FAT", "ND", "AP", "ME", "PC", "NF",
  "DD", "CC", "BDP", "OU",
]);
const FINALIDADES = new Set(["OPERACIONAL", "APLICACAO", "IPTU", "OUTRA"]);
const AMBIENTES = new Set(["SANDBOX", "PRODUCAO"]);

function campo(formData: FormData, nome: string): string {
  const valor = formData.get(nome);
  return typeof valor === "string" ? valor.trim() : "";
}

function marcado(formData: FormData, nome: string): boolean {
  const valor = formData.get(nome);
  return valor === "on" || valor === "1" || valor === "true";
}

function voltar(aviso: { ok?: string; erro?: string }): never {
  const params = new URLSearchParams();
  if (aviso.ok) params.set("ok", aviso.ok);
  if (aviso.erro) params.set("erro", aviso.erro);
  redirect(`${ROTA}?${params.toString()}`);
}

/**
 * Atualiza somente a configuração operacional da conta. Dados bancários de
 * identidade (banco, agência e número) e todos os segredos da API ficam fora
 * deste formulário e não podem ser alterados por esta action.
 */
export async function atualizarContaBancaria(formData: FormData): Promise<void> {
  const sessao = await exigirPermissaoFinanceira("GERENCIAR_CONTAS");

  const id = campo(formData, "id");
  if (id.length > 64 || !RE_UUID.test(id)) {
    voltar({ erro: "Conta bancária inválida." });
  }

  const apelido = campo(formData, "apelido");
  if (!apelido || apelido.length > 80) {
    voltar({ erro: "Informe um apelido com até 80 caracteres." });
  }

  const finalidade = campo(formData, "finalidade");
  if (!FINALIDADES.has(finalidade)) {
    voltar({ erro: "Finalidade da conta inválida." });
  }

  const numeroClienteInformado = campo(formData, "numeroCliente");
  if (
    numeroClienteInformado &&
    (!RE_NUMERO_CLIENTE.test(numeroClienteInformado) ||
      Number(numeroClienteInformado) <= 0 ||
      Number(numeroClienteInformado) > 2_147_483_647)
  ) {
    voltar({
      erro: "O número do cliente Sicoob deve ser um inteiro positivo de até 2.147.483.647.",
    });
  }
  const numeroCliente = numeroClienteInformado || null;

  const contaCorrenteApiInformada = campo(
    formData,
    "numeroContaCorrenteApi",
  );
  if (
    contaCorrenteApiInformada &&
    (!RE_CONTA_CORRENTE_API.test(contaCorrenteApiInformada) ||
      Number(contaCorrenteApiInformada) <= 0 ||
      Number(contaCorrenteApiInformada) > 2_147_483_647)
  ) {
    voltar({
      erro: "A conta do convênio deve ser um inteiro positivo de até 2.147.483.647, sem o dígito.",
    });
  }
  const numeroContaCorrenteApi = contaCorrenteApiInformada || null;

  const contratoCobrancaInformado = campo(formData, "numeroContratoCobranca");
  if (
    contratoCobrancaInformado &&
    (!RE_CONTRATO_COBRANCA.test(contratoCobrancaInformado) ||
      Number(contratoCobrancaInformado) <= 0 ||
      !Number.isSafeInteger(Number(contratoCobrancaInformado)))
  ) {
    voltar({ erro: "O contrato de cobrança deve conter de 1 a 15 dígitos." });
  }
  const numeroContratoCobranca = contratoCobrancaInformado || null;

  const codigoEspecieDocumentoInformado = campo(
    formData,
    "codigoEspecieDocumento",
  ).toUpperCase();
  if (
    codigoEspecieDocumentoInformado &&
    !ESPECIES_DOCUMENTO_SICOOB.has(codigoEspecieDocumentoInformado)
  ) {
    voltar({ erro: "Selecione uma espécie documental aceita pelo Sicoob." });
  }
  const codigoEspecieDocumento = codigoEspecieDocumentoInformado || null;

  const ambiente = campo(formData, "ambiente").toUpperCase();
  if (!AMBIENTES.has(ambiente)) voltar({ erro: "Ambiente Sicoob inválido." });

  const modalidadeInformada = campo(formData, "codigoModalidade");
  const codigoModalidade = modalidadeInformada
    ? Number.parseInt(modalidadeInformada, 10)
    : null;
  if (
    modalidadeInformada &&
    (!/^\d{1,2}$/.test(modalidadeInformada) ||
      codigoModalidade === null ||
      !MODALIDADES_SICOOB.has(codigoModalidade))
  ) {
    voltar({ erro: "Selecione uma modalidade de cobrança aceita pelo Sicoob." });
  }

  const ativa = marcado(formData, "ativa");
  const padrao = marcado(formData, "padrao");
  const integracaoHabilitada = marcado(formData, "integracaoHabilitada");
  const boletosHabilitados = marcado(formData, "boletosHabilitados");
  const confirmarProducao = marcado(formData, "confirmarProducao");

  if (!ativa && (padrao || integracaoHabilitada || boletosHabilitados)) {
    voltar({
      erro: "Uma conta inativa não pode ser padrão nem operar a integração ou boletos.",
    });
  }
  if (boletosHabilitados && !integracaoHabilitada) {
    voltar({
      erro: "Habilite a integração com a API antes de habilitar boletos.",
    });
  }
  if (
    (integracaoHabilitada || boletosHabilitados) &&
    (!numeroCliente ||
      !numeroContaCorrenteApi ||
      !codigoEspecieDocumento ||
      codigoModalidade === null)
  ) {
    voltar({
      erro: "Informe cliente, conta do convênio, modalidade e espécie do documento antes de habilitar a integração ou os boletos.",
    });
  }

  const resultado = await prisma.$transaction(async (tx) => {
    const atual = await tx.contaBancaria.findUnique({
      where: { id },
      select: {
        id: true,
        padrao: true,
        numeroCliente: true,
        numeroContaCorrenteApi: true,
        codigoEspecieDocumento: true,
        codigoModalidade: true,
        numeroContratoCobranca: true,
        integracaoHabilitada: true,
        ativa: true,
        ambiente: true,
      },
    });
    if (!atual) {
      return {
        encontrado: false,
        erroPadrao: false,
        erroAmbiente: false,
        erroProducao: false,
        erroPerfilCredencial: false,
      };
    }

    if (
      ambiente === "PRODUCAO" &&
      integracaoHabilitada &&
      (atual.ambiente !== "PRODUCAO" || !atual.integracaoHabilitada) &&
      !confirmarProducao
    ) {
      return {
        encontrado: true,
        erroPadrao: false,
        erroAmbiente: false,
        erroProducao: true,
        erroPerfilCredencial: false,
      };
    }

    if (integracaoHabilitada) {
      const outraContaIntegrada = await tx.contaBancaria.findFirst({
        where: { id: { not: id }, integracaoHabilitada: true },
        select: { id: true },
      });
      if (outraContaIntegrada) {
        return {
          encontrado: true,
          erroPadrao: false,
          erroAmbiente: false,
          erroProducao: false,
          erroPerfilCredencial: true,
        };
      }
    }

    const identidadeRetornoAlterada =
      atual.numeroCliente !== numeroCliente ||
      atual.numeroContaCorrenteApi !== numeroContaCorrenteApi ||
      atual.codigoModalidade !== codigoModalidade ||
      atual.numeroContratoCobranca !== numeroContratoCobranca;
    const interrompeRetornoBancario =
      atual.ambiente !== ambiente ||
      identidadeRetornoAlterada ||
      (atual.ativa && !ativa) ||
      (atual.integracaoHabilitada && !integracaoHabilitada);
    if (interrompeRetornoBancario) {
      const titulosAbertos = await tx.boleto.count({
        where: {
          contaBancariaId: id,
          OR: [
            {
              status: {
                in: [
                  "EMITINDO",
                  "RESULTADO_DESCONHECIDO",
                  "REGISTRADO",
                  "VENCIDO",
                  "PAGAMENTO_REPORTADO",
                  "CANCELAMENTO_REPORTADO",
                ],
              },
            },
            { conciliacaoStatus: "DIVERGENTE" },
          ],
        },
      });
      if (titulosAbertos > 0) {
        return {
          encontrado: true,
          erroPadrao: false,
          erroAmbiente: true,
          erroProducao: false,
          erroPerfilCredencial: false,
        };
      }
    }

    // A aplicação sempre mantém exatamente uma conta padrão. Para trocar,
    // basta marcar a nova; a anterior é desmarcada na mesma transação.
    if (!padrao) {
      const outraPadrao = await tx.contaBancaria.findFirst({
        where: { id: { not: id }, padrao: true, ativa: true },
        select: { id: true },
      });
      if (!outraPadrao) {
        return {
          encontrado: true,
          erroPadrao: true,
          erroAmbiente: false,
          erroProducao: false,
          erroPerfilCredencial: false,
        };
      }
    }

    if (padrao) {
      await tx.contaBancaria.updateMany({
        where: { id: { not: id }, padrao: true },
        data: { padrao: false },
      });
    }

    const configuracaoAlterada =
      atual.numeroCliente !== numeroCliente ||
      atual.numeroContaCorrenteApi !== numeroContaCorrenteApi ||
      atual.codigoEspecieDocumento !== codigoEspecieDocumento ||
      atual.codigoModalidade !== codigoModalidade ||
      atual.numeroContratoCobranca !== numeroContratoCobranca ||
      atual.integracaoHabilitada !== integracaoHabilitada ||
      atual.ambiente !== ambiente;

    await tx.contaBancaria.update({
      where: { id },
      data: {
        apelido,
        finalidade,
        numeroCliente,
        numeroContaCorrenteApi,
        codigoEspecieDocumento,
        codigoModalidade,
        numeroContratoCobranca,
        ambiente,
        ativa,
        padrao,
        integracaoHabilitada,
        boletosHabilitados,
        atualizadoPorUsuarioId: sessao.sub,
        ...(identidadeRetornoAlterada || atual.ambiente !== ambiente
          ? {
              liquidacoesSincronizadasAte: null,
              liquidacoesReprocessarDesde: null,
            }
          : {}),
        ...(!integracaoHabilitada || configuracaoAlterada
          ? {
              integracaoStatus: "NAO_CONFIGURADA",
              mensagemIntegracao: null,
            }
          : {}),
        ...(!integracaoHabilitada || atual.ambiente !== ambiente
          ? { webhookId: null, webhookStatus: null }
          : {}),
      },
    });

    return {
      encontrado: true,
      erroPadrao: false,
      erroAmbiente: false,
      erroProducao: false,
      erroPerfilCredencial: false,
    };
  });

  if (!resultado.encontrado) {
    voltar({ erro: "Conta bancária não encontrada." });
  }
  if (resultado.erroPadrao) {
    voltar({
      erro: "Escolha outra conta padrão antes de desmarcar a atual.",
    });
  }
  if (resultado.erroAmbiente) {
    voltar({
      erro: "Não é possível trocar identificadores/ambiente ou desligar o retorno enquanto existem títulos ativos, incertos ou divergentes nesta conta.",
    });
  }
  if (resultado.erroProducao) {
    voltar({
      erro: "Confirme conscientemente a ativação em produção antes de salvar.",
    });
  }
  if (resultado.erroPerfilCredencial) {
    voltar({
      erro: "Este servidor usa um único perfil de credencial Sicoob. Desabilite a conta atualmente integrada antes de autorizar outra.",
    });
  }

  revalidatePath(ROTA);
  revalidatePath("/financeiro");
  voltar({ ok: "Configuração da conta atualizada com segurança." });
}
