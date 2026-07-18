/** Seed: importa data/dataset.json e grava o relatório de exceções. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { importarDataset, type Dataset } from "../src/lib/importacao/importar";

const prisma = new PrismaClient();

async function main() {
  const caminho = join(__dirname, "..", "data", "dataset.json");
  const ds = JSON.parse(readFileSync(caminho, "utf-8")) as Dataset;

  console.log("Importando dataset…");
  const r = await importarDataset(prisma, ds);

  console.log(`  empreendimentos : ${r.empreendimentos}`);
  console.log(`  unidades        : ${r.unidades}`);
  console.log(`  locatários      : ${r.locatarios}`);
  console.log(`  contratos       : ${r.contratos}`);
  console.log(`  recebimentos    : ${r.recebimentos}`);
  console.log(`  lanç. caixa     : ${r.lancamentosCaixa}`);
  console.log(`  apurações Airbnb: ${r.apuracoesTemporada}`);
  console.log(`  categorias caixa: ${r.categorias}`);

  const caminhoExc = join(__dirname, "..", "data", "excecoes-importacao.json");
  writeFileSync(caminhoExc, JSON.stringify(r.excecoes, null, 2), "utf-8");
  console.log(`  exceções        : ${r.excecoes.length} → data/excecoes-importacao.json`);
  for (const e of r.excecoes.slice(0, 20)) {
    console.log(`    [${e.tipo}] ${e.detalhe}`);
  }
  if (r.excecoes.length > 20) console.log(`    … +${r.excecoes.length - 20}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
