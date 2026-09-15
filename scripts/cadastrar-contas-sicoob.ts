/**
 * Cadastra, de forma idempotente, as contas Sicoob informadas pela operação.
 *
 * Uso: npm run db:contas-sicoob
 *
 * Este script não grava titular, usuário legado, credenciais, certificado ou
 * token. Em contas já existentes, preserva toda a configuração da integração.
 * Os parâmetros do layout legado pertencem somente à conta operacional e são
 * inseridos apenas quando ainda não existe uma configuração para ela.
 */
import { PrismaClient } from "@prisma/client";
import {
  CAMPOS_CONVENIO_CONTA_PRINCIPAL_SICOOB,
  CONFIGURACAO_LAYOUT_SICOOB_LEGADO,
  camposAuditoriaLegadaAusentes,
  camposConvenioAusentes,
} from "../src/lib/dominio/layout-sicoob-legado";

const prisma = new PrismaClient();

const BANCO = {
  codigoBanco: "756",
  nomeBanco: "Banco Cooperativo do Brasil S.A. - BANCOOB",
  agencia: "3299",
} as const;

const CONTAS = [
  {
    numero: "1180-0",
    apelido: "Sicoob Brisa Azul",
    finalidade: "OPERACIONAL",
    padrao: true,
  },
  {
    numero: "11801",
    apelido: "Aplicação",
    finalidade: "APLICACAO",
    padrao: false,
  },
  {
    numero: "126764",
    apelido: "AC",
    finalidade: "OUTRA",
    padrao: false,
  },
  {
    numero: "466395",
    apelido: "Sicoob IPTU",
    finalidade: "IPTU",
    padrao: false,
  },
  {
    numero: "67407",
    apelido: "Paolla",
    finalidade: "OUTRA",
    padrao: false,
  },
] as const;

async function main() {
  const contas = await prisma.$transaction(
    CONTAS.map((conta) =>
      prisma.contaBancaria.upsert({
        where: {
          codigoBanco_agencia_numero: {
            codigoBanco: BANCO.codigoBanco,
            agencia: BANCO.agencia,
            numero: conta.numero,
          },
        },
        create: {
          ...BANCO,
          ...conta,
          ...(conta.numero === "1180-0"
            ? CAMPOS_CONVENIO_CONTA_PRINCIPAL_SICOOB
            : {}),
          padrao: false,
          ativa: true,
          integracaoHabilitada: false,
          boletosHabilitados: false,
          integracaoStatus: "NAO_CONFIGURADA",
          ambiente: "SANDBOX",
        },
        update: {
          nomeBanco: BANCO.nomeBanco,
        },
      })
    )
  );

  const padraoExistente = await prisma.contaBancaria.findFirst({
    where: { padrao: true },
    select: { id: true },
  });
  if (!padraoExistente) {
    await prisma.contaBancaria.update({
      where: {
        codigoBanco_agencia_numero: {
          codigoBanco: BANCO.codigoBanco,
          agencia: BANCO.agencia,
          numero: "1180-0",
        },
      },
      data: { padrao: true },
    });
    const principal = contas.find((conta) => conta.numero === "1180-0");
    if (principal) principal.padrao = true;
  }

  const principal = contas.find((conta) => conta.numero === "1180-0");
  if (!principal) {
    throw new Error("Conta principal Sicoob 1180-0 não foi cadastrada.");
  }

  const camposAusentes = camposConvenioAusentes(principal);
  if (Object.keys(camposAusentes).length > 0) {
    await prisma.contaBancaria.update({
      where: { id: principal.id },
      data: camposAusentes,
    });
  }

  const configuracaoCobranca = await prisma.configuracaoCobrancaSicoob.upsert({
    where: { contaBancariaId: principal.id },
    create: {
      contaBancariaId: principal.id,
      ...CONFIGURACAO_LAYOUT_SICOOB_LEGADO,
    },
    // Não reaplica valores raspados sobre uma configuração já revisada pela
    // operação. A presença do registro é a fronteira de idempotência.
    update: {},
  });
  const auditoriaAusente = camposAuditoriaLegadaAusentes(configuracaoCobranca);
  if (Object.keys(auditoriaAusente).length > 0) {
    await prisma.configuracaoCobrancaSicoob.update({
      where: { id: configuracaoCobranca.id },
      data: auditoriaAusente,
    });
  }

  console.log("Contas Sicoob prontas:");
  for (const conta of contas) {
    const marcador = conta.padrao ? " (padrão)" : "";
    console.log(`  agência ${conta.agencia} · conta ${conta.numero} · ${conta.apelido}${marcador}`);
  }
  console.log("Layout Sicoob legado vinculado somente à conta 1180-0 (sem segredos).");
  console.log("O cadastro não habilita integração nem emissão; configurações existentes são preservadas.");
}

main()
  .catch((erro) => {
    console.error("Falha ao cadastrar as contas Sicoob:", erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
