import { PrismaClient } from "@prisma/client";
import { analisarUnificacao } from "../src/lib/unificacao/servico";

const db = new PrismaClient();
async function main() {
  const argumentos = process.argv.slice(2);
  if (argumentos.some(a => a !== "--dry-run")) throw new Error("Use apenas --dry-run para simular.");
  const resultado = await analisarUnificacao(db,"SISTEMA:CLI",argumentos.includes("--dry-run"));
  console.log(JSON.stringify(resultado,null,2));
}
main().catch(() => { console.error("Não foi possível concluir a unificação. Verifique o schema e execute novamente; nenhum dado de origem é removido."); process.exitCode = 1; }).finally(() => db.$disconnect());
