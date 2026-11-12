import type { PrismaClient } from "@prisma/client";
import { conferirOrigemWidesys } from "../src/lib/unificacao/persistencia-confianca-widesys";

/** Os dados financeiros entram pela identidade Widesys, sem comparação.
 * Cadastros ainda podem manter vínculos explícitos da carteira. */
export async function concluirImportacaoWidesys(prisma: PrismaClient, relatorio: object) {
  try {
    const conferencia = await conferirOrigemWidesys(prisma, true, true);
    console.log(JSON.stringify({ ...relatorio, conferencia }, null, 2));
  } catch {
    console.log(JSON.stringify(relatorio, null, 2));
    console.error("Captura importada. Para retomar a classificação cadastral, repita o comando de importação.");
    process.exitCode = 1;
  }
}
