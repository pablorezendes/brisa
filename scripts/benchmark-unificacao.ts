/** Somente CPU e dados sintéticos: não conecta ao banco, arquivos de clientes ou provedores. */
import { performance } from "node:perf_hooks";
import { deepStrictEqual } from "node:assert";
import { candidatosPara } from "../src/lib/unificacao/reconciliacao";
import { criarIndiceCandidatos } from "../src/lib/unificacao/candidatos-indice";
import type { FonteUnificacao } from "../src/lib/unificacao/tipos";

const quantidade = Number(process.argv[2] ?? 5000);
if (!Number.isSafeInteger(quantidade) || quantidade < 1 || quantidade > 15000) throw new Error("Use entre 1 e 15000 registros sintéticos.");
const fontes: FonteUnificacao[] = Array.from({ length: quantidade }, (_, i) => ({
  chave: `BRISA:RECEBER:${i}`, dominio: "RECEBER", origem: "BRISA", origemId: String(i),
  titulo: `Título sintético ${i}`, descricao: "Exclusivamente benchmark", href: null,
  hash: `hash-sintetico-${i}`, nomeNorm: `SINTETICO ${i}`, qualidade: "OK", motivos: [], campos: {},
  competencia: "2026-01", valor: 10000 + i, pessoaChave: `PESSOA:${i}`,
}));
const destinos = new Map<string, string>();
const inicio = performance.now();
const referencia = fontes.map(f => candidatosPara(f, fontes, destinos));
const fimReferencia = performance.now();
const indice = criarIndiceCandidatos(fontes, destinos);
const subconjuntos = fontes.map(f => indice.para(f));
const resultado = fontes.map((f, i) => candidatosPara(f, subconjuntos[i], destinos));
const fimIndice = performance.now();
deepStrictEqual(resultado, referencia);
console.log(JSON.stringify({
  tipo: "benchmark CPU sintético — não mede servidor/HTTP/SQL",
  registros: quantidade, resultadosIdenticos: true,
  comparacoesAntes: quantidade ** 2, comparacoesDepois: subconjuntos.reduce((total, itens) => total + itens.length, 0),
  anteriorMs: Math.round(fimReferencia - inicio), indexadoMs: Math.round(fimIndice - fimReferencia),
  aceleracao: Number(((fimReferencia - inicio) / (fimIndice - fimReferencia)).toFixed(1)),
}, null, 2));
