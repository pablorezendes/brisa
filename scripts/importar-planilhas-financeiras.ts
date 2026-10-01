import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { parsePlanilhaFinanceira } from "../src/lib/importacao/planilhas-financeiras-parser";
import { carregarPlanilhasFinanceiras } from "../src/lib/importacao/planilhas-financeiras";

const db = new PrismaClient();
async function main() {
  const args = process.argv.slice(2);
  if (args.some((a, i) => !["--aplicar", "--diretorio"].includes(a) && args[i - 1] !== "--diretorio")) throw new Error("ARGUMENTOS_INVALIDOS");
  const indice = args.indexOf("--diretorio");
  if (indice >= 0 && (!args[indice + 1] || args[indice + 1].startsWith("--"))) throw new Error("DIRETORIO_OBRIGATORIO");
  const pasta = resolve(indice >= 0 ? args[indice + 1] : "importação");
  const nomes = (await readdir(pasta)).filter(n => /\.xlsx$/i.test(n) && !n.startsWith("~$")).sort();
  if (!nomes.length) throw new Error("NENHUMA_PLANILHA_XLSX");
  const arquivos = [];
  for (const nome of nomes) arquivos.push(await parsePlanilhaFinanceira(join(pasta, nome)));
  const aplicar = args.includes("--aplicar");
  if (aplicar) {
    // Backup consistente, inclusive quando outro processo usa o SQLite.
    const bases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
    const principal = bases.find(b => b.name === "main")?.file;
    if (!principal) throw new Error("BACKUP_EXIGE_BANCO_EM_ARQUIVO");
    const pastaBackup = join(dirname(principal), "backups-importacao");
    await mkdir(pastaBackup, { recursive: true, mode: 0o700 });
    const destino = join(pastaBackup, `antes-planilhas-${Date.now()}-${randomUUID()}.db`);
    await db.$executeRawUnsafe(`VACUUM INTO '${destino.replaceAll("'", "''")}'`);
    console.log(`Backup consistente criado: ${destino}`);
  }
  const resultado = await carregarPlanilhasFinanceiras(db, arquivos, { aplicar });
  console.log(JSON.stringify(resultado, null, 2));
  console.log(aplicar ? "Carga concluída. Consulte Financeiro > Importações de planilhas. Pendências não alteram o caixa." : "Prévia somente leitura. Use --aplicar para carregar; não execute seed.");
}
main().catch(e => {
  const codigo = e && typeof e === "object" && "code" in e && typeof e.code === "string" && /^P\d{4}$/.test(e.code) ? e.code : "FALHA_IMPORTACAO";
  const mensagem = e instanceof Error && /^[A-Z_]{3,80}$/.test(e.message) ? e.message : "Confira estrutura das planilhas, schema e ambiente. Nenhum dado de cliente é impresso no erro.";
  console.error(`[${codigo}] ${mensagem}`);
  process.exitCode = 1;
}).finally(() => db.$disconnect());
