import { PrismaClient } from "@prisma/client";
import { processarComunicacoes } from "../src/lib/comunicacoes/servico";

const db = new PrismaClient();
async function main() {
  if (!process.argv.includes("--executar")) {
    console.log("Simulação: nenhum envio realizado. Use --executar somente após configurar e autorizar os canais. AUTOMACOES_ENVIO_HABILITADO=1 também é obrigatório.");
    return;
  }
  const resultado = await processarComunicacoes(db);
  // Apenas contagens e códigos; nunca destinatários, texto, tokens ou valores.
  console.log(JSON.stringify(resultado));
}
main().catch(() => { console.error("Falha no worker de comunicação. Consulte a configuração e o histórico restrito."); process.exitCode = 1; }).finally(() => db.$disconnect());
