import type { PrismaClient } from "@prisma/client";
import { conferirOrigemWidesys } from "../src/lib/unificacao/persistencia-confianca-widesys";

/** Também retoma a classificação quando a captura já havia sido importada. */
export async function concluirImportacaoWidesys(prisma: PrismaClient, relatorio: object) {
  try {
    const conferencia = await conferirOrigemWidesys(prisma, true);
    console.log(JSON.stringify({ ...relatorio, conferencia }, null, 2));
  } catch {
    console.log(JSON.stringify(relatorio, null, 2));
    console.error("Captura importada. Para retomar a conferência, execute npm run unificar:conferir-widesys -- --aplicar.");
    process.exitCode = 1;
  }
}
