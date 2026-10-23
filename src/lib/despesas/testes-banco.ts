import { Prisma, type PrismaClient } from "@prisma/client";

/** Somente testes: cliente deve apontar para um arquivo sintético isolado.
 * Nunca copia ou abre a base operacional. Usa o schema gerado, inclusive Bytes.
 */
export async function criarSchemaSinteticoDespesas(db: PrismaClient) {
  for (const m of Prisma.dmmf.datamodel.models) {
    const colunas = m.fields.filter(f => f.kind !== "object").map(f => {
      const tipo = ["Int", "BigInt", "Boolean"].includes(f.type) ? "INTEGER" : f.type === "Float" ? "REAL" : f.type === "DateTime" ? "DATETIME" : f.type === "Bytes" ? "BLOB" : "TEXT";
      const d = f.default;
      const padrao = typeof d === "boolean" ? ` DEFAULT ${d ? 1 : 0}` : typeof d === "number" ? ` DEFAULT ${d}` : typeof d === "string" ? ` DEFAULT '${d.replaceAll("'", "''")}'` : f.type === "DateTime" ? " DEFAULT CURRENT_TIMESTAMP" : "";
      return `"${f.name}" ${tipo}${f.isId ? " PRIMARY KEY" : ""}${f.isRequired ? " NOT NULL" : ""}${f.isUnique ? " UNIQUE" : ""}${padrao}`;
    });
    for (const campos of m.uniqueFields) colunas.push(`UNIQUE (${campos.map(c => `"${c}"`).join(",")})`);
    await db.$executeRawUnsafe(`CREATE TABLE "${m.name}" (${colunas.join(",")})`);
  }
}
