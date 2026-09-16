import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";

import {
  carregarPlanoOperacaoWidesys,
  criarRelatorioDryRunOperacaoWidesys,
  ErroImportacaoOperacaoWidesys,
  importarPlanoOperacaoWidesys,
} from "../src/lib/importacao/operacao-widesys";

type Opcoes = { dryRun: boolean; diretorio: string; tamanhoLote: number };

function argumentos(argv: string[]): Opcoes {
  const opcoes: Opcoes = {
    dryRun: false,
    diretorio: resolve(process.cwd(), "data", "legacy-widesys", "operacao"),
    tamanhoLote: 100,
  };
  for (let indice = 0; indice < argv.length; indice += 1) {
    const argumento = argv[indice];
    if (argumento === "--dry-run") opcoes.dryRun = true;
    else if (argumento === "--diretorio" || argumento === "--dir") {
      const valor = argv[indice + 1];
      if (!valor) throw new TypeError(`${argumento} exige um caminho.`);
      opcoes.diretorio = resolve(valor);
      indice += 1;
    } else if (argumento === "--lote") {
      const valor = Number.parseInt(argv[indice + 1] ?? "", 10);
      if (!Number.isSafeInteger(valor) || valor < 1 || valor > 1_000) {
        throw new TypeError("--lote exige um inteiro entre 1 e 1000.");
      }
      opcoes.tamanhoLote = valor;
      indice += 1;
    } else throw new TypeError(`Argumento não reconhecido: ${argumento}`);
  }
  return opcoes;
}

async function main(): Promise<void> {
  const opcoes = argumentos(process.argv.slice(2));
  const plano = carregarPlanoOperacaoWidesys(opcoes.diretorio);
  if (opcoes.dryRun) {
    console.log(JSON.stringify(criarRelatorioDryRunOperacaoWidesys(plano), null, 2));
    return;
  }

  const prisma = new PrismaClient();
  try {
    const relatorio = await importarPlanoOperacaoWidesys(prisma, plano, {
      tamanhoLote: opcoes.tamanhoLote,
    });
    console.log(JSON.stringify(relatorio, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((erro: unknown) => {
  const codigo =
    erro instanceof ErroImportacaoOperacaoWidesys
      ? erro.codigo
      : erro instanceof TypeError
        ? "ARGUMENTO_INVALIDO"
        : "IMPORTACAO_OPERACAO_FALHOU";
  const mensagem =
    erro instanceof ErroImportacaoOperacaoWidesys || erro instanceof TypeError
      ? erro.message
      : "A importação operacional falhou; nenhum vínculo com a operação atual foi criado.";
  console.error(JSON.stringify({ sucesso: false, codigo, mensagem }));
  process.exitCode = 1;
});
