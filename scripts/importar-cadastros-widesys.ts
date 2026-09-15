import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";

import {
  carregarPlanoCadastrosWidesys,
  criarRelatorioDryRunCadastrosWidesys,
  ErroImportacaoCadastrosWidesys,
  importarPlanoCadastrosWidesys,
} from "../src/lib/importacao/cadastros-widesys";

function argumentos(argv: string[]): { dryRun: boolean; diretorio: string } {
  let dryRun = false;
  let diretorio = resolve(process.cwd(), "data", "legacy-widesys");
  for (let indice = 0; indice < argv.length; indice += 1) {
    const argumento = argv[indice];
    if (argumento === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argumento === "--diretorio" || argumento === "--dir") {
      const valor = argv[indice + 1];
      if (!valor) throw new TypeError(`${argumento} exige um caminho.`);
      diretorio = resolve(valor);
      indice += 1;
      continue;
    }
    throw new TypeError(`Argumento não reconhecido: ${argumento}`);
  }
  return { dryRun, diretorio };
}

async function main(): Promise<void> {
  const opcoes = argumentos(process.argv.slice(2));
  const plano = carregarPlanoCadastrosWidesys(opcoes.diretorio);
  if (opcoes.dryRun) {
    console.log(JSON.stringify(criarRelatorioDryRunCadastrosWidesys(plano), null, 2));
    return;
  }

  const prisma = new PrismaClient();
  try {
    const relatorio = await importarPlanoCadastrosWidesys(prisma, plano);
    console.log(JSON.stringify(relatorio, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((erro: unknown) => {
  const codigo =
    erro instanceof ErroImportacaoCadastrosWidesys
      ? erro.codigo
      : erro instanceof TypeError
        ? "ARGUMENTO_INVALIDO"
        : "IMPORTACAO_FALHOU";
  const mensagem =
    erro instanceof ErroImportacaoCadastrosWidesys || erro instanceof TypeError
      ? erro.message
      : "A importação falhou sem gravar parcialmente. Consulte o log interno do servidor.";
  console.error(JSON.stringify({ sucesso: false, codigo, mensagem }));
  process.exitCode = 1;
});
