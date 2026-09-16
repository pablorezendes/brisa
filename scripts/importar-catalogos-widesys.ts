import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";

import {
  carregarPlanoCatalogosWidesys,
  criarRelatorioDryRunCatalogosWidesys,
  ErroImportacaoCatalogosWidesys,
  importarPlanoCatalogosWidesys,
} from "../src/lib/importacao/catalogos-widesys";

type Opcoes = { dryRun: boolean; diretorio: string };

export function argumentosCatalogos(argv: string[]): Opcoes {
  let dryRun = false;
  let diretorio = resolve(process.cwd(), "data", "legacy-widesys", "catalogos");
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
  const opcoes = argumentosCatalogos(process.argv.slice(2));
  const plano = carregarPlanoCatalogosWidesys(opcoes.diretorio);
  if (opcoes.dryRun) {
    console.log(JSON.stringify(criarRelatorioDryRunCatalogosWidesys(plano), null, 2));
    return;
  }

  const prisma = new PrismaClient();
  try {
    console.log(JSON.stringify(await importarPlanoCatalogosWidesys(prisma, plano), null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((erro: unknown) => {
  const codigo =
    erro instanceof ErroImportacaoCatalogosWidesys
      ? erro.codigo
      : erro instanceof TypeError
        ? "ARGUMENTO_INVALIDO"
        : "IMPORTACAO_FALHOU";
  const mensagem =
    erro instanceof ErroImportacaoCatalogosWidesys || erro instanceof TypeError
      ? erro.message
      : "A importação de catálogos falhou. Nenhum registro é promovido automaticamente.";
  console.error(JSON.stringify({ sucesso: false, codigo, mensagem }));
  process.exitCode = 1;
});
