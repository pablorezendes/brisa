/**
 * Cadastra, de forma idempotente, as contas Sicoob informadas pela operação.
 *
 * Uso: npm run db:contas-sicoob
 *
 * Este script não grava titular, usuário legado, credenciais, certificado ou
 * token. Em contas já existentes, preserva toda a configuração da integração.
 */
import { PrismaClient } from "@prisma/client";

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

  console.log("Contas Sicoob prontas:");
  for (const conta of contas) {
    const marcador = conta.padrao ? " (padrão)" : "";
    console.log(`  agência ${conta.agencia} · conta ${conta.numero} · ${conta.apelido}${marcador}`);
  }
  console.log("O cadastro não habilita integração nem emissão; configurações existentes são preservadas.");
}

main()
  .catch((erro) => {
    console.error("Falha ao cadastrar as contas Sicoob:", erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
