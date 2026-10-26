import type { DecisaoUnificacao, FonteUnificacao } from "./tipos";

/** O sigilo acompanha o grupo nos dois sentidos, inclusive vínculos antigos. */
export function chavesRestritasUnificacao(fontes: FonteUnificacao[], decisoes: Array<Pick<DecisaoUnificacao, "chave" | "destinoChave">>) {
  const restritas = new Set(fontes.filter(f => f.restrito).map(f => f.chave));
  const adjacentes = new Map<string, string[]>();
  for (const d of decisoes) if (d.destinoChave) {
    adjacentes.set(d.chave, [...(adjacentes.get(d.chave) ?? []), d.destinoChave]);
    adjacentes.set(d.destinoChave, [...(adjacentes.get(d.destinoChave) ?? []), d.chave]);
  }
  const fila = [...restritas];
  for (let i = 0; i < fila.length; i++) for (const chave of adjacentes.get(fila[i]) ?? []) {
    if (!restritas.has(chave)) { restritas.add(chave); fila.push(chave); }
  }
  return restritas;
}
