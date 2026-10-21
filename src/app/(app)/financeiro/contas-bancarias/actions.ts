"use server";

import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirPermissaoFinanceira } from "@/lib/autorizacao";
import { prisma } from "@/lib/db";
import { filtroGovernanca, recursoEstaAtivo } from "@/lib/governanca/filtros";

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
const ACEITES = new Set(["N", "S"]);

function campo(formData: FormData, nome: string): string {
  const valor = formData.get(nome);
  return typeof valor === "string" ? valor.trim() : "";
}

function marcado(formData: FormData, nome: string): boolean {
  const valor = formData.get(nome);
  return valor === "on" || valor === "1" || valor === "true";
}

function inteiroNoIntervalo(
  formData: FormData,
  nome: string,
  rotulo: string,
  minimo: number,
  maximo: number,
): number {
  const valor = campo(formData, nome);
  if (!/^\d{1,3}$/.test(valor)) {
    voltar(formData, { erro: `${rotulo} deve ser um número inteiro.` });
  }
  const numero = Number.parseInt(valor, 10);
  if (numero < minimo || numero > maximo) {
    voltar(formData, { erro: `${rotulo} deve ficar entre ${minimo} e ${maximo}.` });
  }
  return numero;
}

function mensagensCobranca(formData: FormData): string[] {
  const valor = formData.get("mensagensCobranca");
  const texto = typeof valor === "string" ? valor : "";
  if (texto.length > 1_000) {
    voltar(formData, { erro: "As instruções do boleto excedem o limite permitido." });
  }
  const mensagens = texto
    .split(/\r?\n/)
    .map((mensagem) => mensagem.trim())
    .filter(Boolean);
  if (mensagens.length > 5) {
    voltar(formData, { erro: "Use no máximo cinco linhas de instrução no boleto." });
  }
  if (mensagens.some((mensagem) => mensagem.length > 40)) {
    voltar(formData, { erro: "Cada instrução do boleto pode ter no máximo 40 caracteres." });
  }
  return mensagens;
}

function voltar(formData: FormData, aviso: { ok?: string; erro?: string }): never {
  const params = new URLSearchParams();
  if (aviso.ok) params.set("ok", aviso.ok);
  if (aviso.erro) params.set("erro", aviso.erro);
  // Nunca redireciona para destinos externos ou parâmetros livres enviados pelo cliente.
  const retorno = campo(formData, "retorno") === "/integracoes/sicoob"
    ? "/integracoes/sicoob"
    : ROTA;
  const id = campo(formData, "id") || campo(formData, "contaBancariaId");
  const ancora = retorno === "/integracoes/sicoob" && RE_UUID.test(id) ? `#conta-${id}` : "";
  redirect(`${retorno}?${params.toString()}${ancora}`);
}

/**
 * Atualiza somente a configuração operacional da conta. Dados bancários de
 * identidade (banco, agência e número) e todos os segredos da API ficam fora
 * deste formulário e não podem ser alterados por esta action.
 */
export async function atualizarContaBancaria(formData: FormData): Promise<void> {
  await exigirPermissaoAcesso("contas.editar", { global: true });
  await exigirPermissaoAcesso("integracoes.gerenciar", { global: true });
  await exigirPermissaoAcesso("boletos.configurar", { global: true });
  const sessao = await exigirPermissaoFinanceira("GERENCIAR_CONTAS");

  const id = campo(formData, "id");
  if (id.length > 64 || !RE_UUID.test(id)) {
    voltar(formData, { erro: "Conta bancária inválida." });
  }

  const apelido = campo(formData, "apelido");
  if (!apelido || apelido.length > 80) {
    voltar(formData, { erro: "Informe um apelido com até 80 caracteres." });
  }

  const finalidade = campo(formData, "finalidade");
  if (!FINALIDADES.has(finalidade)) {
    voltar(formData, { erro: "Finalidade da conta inválida." });
  }

  const numeroClienteInformado = campo(formData, "numeroCliente");
  if (
    numeroClienteInformado &&
    (!RE_NUMERO_CLIENTE.test(numeroClienteInformado) ||
      Number(numeroClienteInformado) <= 0 ||
      Number(numeroClienteInformado) > 2_147_483_647)
  ) {
    voltar(formData, {
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
    voltar(formData, {
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
    voltar(formData, { erro: "O contrato de cobrança deve conter de 1 a 15 dígitos." });
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
    voltar(formData, { erro: "Selecione uma espécie documental aceita pelo Sicoob." });
  }
  const codigoEspecieDocumento = codigoEspecieDocumentoInformado || null;

  const ambiente = campo(formData, "ambiente").toUpperCase();
  if (!AMBIENTES.has(ambiente)) voltar(formData, { erro: "Ambiente Sicoob inválido." });

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
    voltar(formData, { erro: "Selecione uma modalidade de cobrança aceita pelo Sicoob." });
  }

  const ativa = marcado(formData, "ativa");
  const padrao = marcado(formData, "padrao");
  const integracaoHabilitada = marcado(formData, "integracaoHabilitada");
  const boletosHabilitados = marcado(formData, "boletosHabilitados");
  const confirmarProducao = marcado(formData, "confirmarProducao");

  if (!ativa && (padrao || integracaoHabilitada || boletosHabilitados)) {
    voltar(formData, {
      erro: "Uma conta inativa não pode ser padrão nem operar a integração ou boletos.",
    });
  }
  if (boletosHabilitados && !integracaoHabilitada) {
    voltar(formData, {
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
    voltar(formData, {
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

    if (ativa !== atual.ativa) return { encontrado: true, erroGovernanca: true, erroPadrao: false, erroAmbiente: false, erroProducao: false, erroPerfilCredencial: false };

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

  if ("erroGovernanca" in resultado && resultado.erroGovernanca) voltar(formData, { erro: "Para inativar ou restaurar a conta, use Revisar e resolver. Essa ação exige conferir os títulos e registra auditoria." });
  if (!resultado.encontrado) {
    voltar(formData, { erro: "Conta bancária não encontrada." });
  }
  if (resultado.erroPadrao) {
    voltar(formData, {
      erro: "Escolha outra conta padrão antes de desmarcar a atual.",
    });
  }
  if (resultado.erroAmbiente) {
    voltar(formData, {
      erro: "Não é possível trocar identificadores/ambiente ou desligar o retorno enquanto existem títulos ativos, incertos ou divergentes nesta conta.",
    });
  }
  if (resultado.erroProducao) {
    voltar(formData, {
      erro: "Confirme conscientemente a ativação em produção antes de salvar.",
    });
  }
  if (resultado.erroPerfilCredencial) {
    voltar(formData, {
      erro: "Este servidor usa um único perfil de credencial Sicoob. Desabilite a conta atualmente integrada antes de autorizar outra.",
    });
  }

  revalidatePath(ROTA);
  revalidatePath("/integracoes");
  revalidatePath("/integracoes/sicoob");
  revalidatePath("/financeiro");
  voltar(formData, { ok: "Configuração da conta atualizada com segurança." });
}

/**
 * Edita somente as regras de novos boletos. Identidade bancária, credenciais,
 * certificado e títulos já emitidos não são alterados por esta action.
 */
export async function atualizarPoliticaCobrancaSicoob(
  formData: FormData,
): Promise<void> {
  await exigirPermissaoAcesso("contas.editar", { global: true });
  await exigirPermissaoAcesso("integracoes.gerenciar", { global: true });
  await exigirPermissaoAcesso("boletos.configurar", { global: true });
  const sessao = await exigirPermissaoFinanceira("GERENCIAR_CONTAS");
  const contaBancariaId = campo(formData, "contaBancariaId");
  if (contaBancariaId.length > 64 || !RE_UUID.test(contaBancariaId)) {
    voltar(formData, { erro: "Conta bancária inválida." });
  }

  const aceite = campo(formData, "aceite").toUpperCase();
  if (!ACEITES.has(aceite)) {
    voltar(formData, { erro: "Selecione uma opção válida para o aceite do boleto." });
  }
  const toleranciaPagamentoDias = inteiroNoIntervalo(
    formData,
    "toleranciaPagamentoDias",
    "A tolerância para pagamento",
    0,
    180,
  );
  const diasProtesto = inteiroNoIntervalo(
    formData,
    "diasProtesto",
    "O prazo de protesto",
    0,
    99,
  );
  const mensagens = mensagensCobranca(formData);

  const atualizado = await prisma.$transaction(async (tx) => {
    const configuracao = await tx.configuracaoCobrancaSicoob.findUnique({
      where: { contaBancariaId },
      select: { id: true },
    });
    if (!configuracao) return false;

    await tx.configuracaoCobrancaSicoob.update({
      where: { id: configuracao.id },
      data: {
        aceite,
        toleranciaPagamentoDias,
        diasProtesto,
        protestoEmDiasUteis:
          diasProtesto > 0 && marcado(formData, "protestoEmDiasUteis"),
        mensagens: JSON.stringify(mensagens),
      },
    });
    await tx.contaBancaria.update({
      where: { id: contaBancariaId },
      data: { atualizadoPorUsuarioId: sessao.sub },
    });
    return true;
  });

  if (!atualizado) {
    voltar(formData, { erro: "A política de cobrança desta conta não foi encontrada." });
  }
  revalidatePath(ROTA);
  revalidatePath("/integracoes");
  revalidatePath("/integracoes/sicoob");
  revalidatePath("/financeiro/boletos");
  voltar(formData, { ok: "Política de novos boletos atualizada." });
}

/** Cadastro simples: não recebe nem altera campos de integração, credenciais ou identidade bancária. */
export async function atualizarCadastroContaBancaria(formData: FormData): Promise<void> {
  await exigirPermissaoAcesso("contas.editar", { global: true });
  const sessao = await exigirPermissaoFinanceira("GERENCIAR_CONTAS");
  const id = campo(formData, "id");
  if (!RE_UUID.test(id)) voltar(formData, { erro: "Conta bancária inválida." });
  const apelido = campo(formData, "apelido");
  if (!apelido || apelido.length > 80) voltar(formData, { erro: "Informe um apelido com até 80 caracteres." });
  const finalidade = campo(formData, "finalidade");
  if (!FINALIDADES.has(finalidade)) voltar(formData, { erro: "Finalidade da conta inválida." });
  const padrao = marcado(formData, "padrao");

  const resultado = await prisma.$transaction(async (tx) => {
    if (!await recursoEstaAtivo(tx, "CONTA", id)) {
      return "Esta conta foi excluída ou inativada. Confira a lixeira antes de editar o cadastro.";
    }
    const atual = await tx.contaBancaria.findUnique({ where: { id }, select: { id: true, ativa: true } });
    if (!atual) return "A conta bancária não foi encontrada.";
    if (padrao && !atual.ativa) return "Uma conta inativa não pode ser padrão.";
    if (!padrao) {
      const outraPadrao = await tx.contaBancaria.findFirst({
        where: {
          AND: [{ id: { not: id }, padrao: true, ativa: true }, await filtroGovernanca(tx, "CONTA")],
        },
        select: { id: true },
      });
      if (!outraPadrao) return "Escolha outra conta padrão antes de desmarcar a atual.";
    } else {
      await tx.contaBancaria.updateMany({ where: { id: { not: id }, padrao: true }, data: { padrao: false } });
    }
    await tx.contaBancaria.update({
      where: { id },
      data: { apelido, finalidade, padrao, atualizadoPorUsuarioId: sessao.sub },
    });
    return null;
  });
  if (resultado) voltar(formData, { erro: resultado });
  revalidatePath(ROTA);
  revalidatePath("/integracoes");
  revalidatePath("/integracoes/sicoob");
  revalidatePath("/financeiro/boletos");
  revalidatePath("/financeiro");
  voltar(formData, { ok: "Cadastro atualizado. A configuração da integração foi preservada." });
}
