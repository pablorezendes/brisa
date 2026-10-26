import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { conferirValoresDiferentes } from "../src/lib/unificacao/persistencia-valores-diferentes";

const db = new PrismaClient();
async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => !["--aplicar", "--dry-run"].includes(a)) || (args.includes("--aplicar") && args.includes("--dry-run"))) throw new Error("ARGUMENTOS_INVALIDOS");
  const aplicar = args.includes("--aplicar");
  if (aplicar) {
    const bases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
    const principal = bases.find(b => b.name === "main")?.file;
    if (!principal) throw new Error("BACKUP_EXIGE_BANCO_EM_ARQUIVO");
    const pastaBackup = join(dirname(principal), "backups-unificacao");
    await mkdir(pastaBackup, { recursive: true, mode: 0o700 });
    const destino = join(pastaBackup, `antes-valores-diferentes-${Date.now()}-${randomUUID()}.db`);
    // VACUUM INTO cria uma fotografia consistente, inclusive em modo WAL.
    await db.$executeRawUnsafe(`VACUUM INTO '${destino.replaceAll("'", "''")}'`);
    console.log(`Backup consistente criado: ${destino}`);
  }
  const resultado = await conferirValoresDiferentes(db, { aplicar });
  console.log(JSON.stringify(resultado, null, 2));
  console.log(aplicar
    ? "Conferência concluída. Atualize Contas a pagar ou Contas a receber. Nenhum título, pagamento ou movimento foi criado."
    : "Prévia somente leitura. Use --aplicar para registrar a conferência por valores diferentes, com backup automático.");
}
main().catch(e => {
  const codigo = e instanceof Error && /^[A-Z_]{3,80}$/.test(e.message) ? e.message : "FALHA_CONFERENCIA";
  console.error(`[${codigo}] A conferência não foi concluída. Verifique o ambiente e o schema; detalhes de clientes não são impressos.`);
  process.exitCode = 1;
}).finally(() => db.$disconnect());
