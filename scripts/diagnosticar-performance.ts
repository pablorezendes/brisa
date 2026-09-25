/** Benchmark HTTP somente leitura, limitado ao preview local. Nunca imprime sessão ou dados financeiros. */
import { createHmac } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const rotas = [
  ["/financeiro", "Financeiro unificado"],
  ["/recebimentos", "Contas a receber"],
  ["/financeiro/contas-a-pagar", "Contas a pagar"],
  ["/caixa", "Movimentações"],
  ["/executivo?mes=2026-06", "Painel"],
  ["/financeiro/automacoes", "Automações de cobrança"],
] as const;

async function main() {
  const base = new URL(process.argv[2] ?? "http://127.0.0.1:3100");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.protocol !== "http:" || base.username || base.password) {
    throw new Error("Use somente um servidor HTTP local de teste.");
  }
  const segredo = process.env.AUTH_SECRET;
  if (!segredo || segredo.length < 32) throw new Error("Carregue AUTH_SECRET do ambiente local.");
  const admin = await db.usuario.findFirst({ where: { perfil: "ADMINISTRADOR" }, select: { id: true } });
  if (!admin) throw new Error("A base de teste precisa de um administrador existente.");
  const corpo = Buffer.from(JSON.stringify({ sub: admin.id, nome: "Diagnóstico local", exp: Date.now() + 600_000 })).toString("base64url");
  const cookie = `brisa_sessao=${corpo}.${createHmac("sha256", segredo).update(corpo).digest("base64url")}`;
  const resultados: { fase: string; rota: string; status: number; ms: number; ttfbMs: number; kib: number; ok: boolean }[] = [];
  async function medir(rota: typeof rotas[number], fase: string) {
    const inicio = performance.now();
    try {
      const r = await fetch(new URL(rota[0], base), { headers: { cookie }, redirect: "manual", signal: AbortSignal.timeout(90_000) });
      const ttfbMs = Math.round(performance.now() - inicio);
      const html = await r.text();
      // Um erro depois do início do streaming pode manter HTTP 200.
      const erroRender = /This page couldn.t load|Application error:|Não foi possível carregar esta página|NEXT_HTTP_ERROR_FALLBACK;|:E\{\\?"digest\\?":/.test(html);
      const ok = r.status === 200 && html.includes(rota[1]) && !erroRender;
      const medida = { fase, rota: rota[0], status: r.status, ms: Math.round(performance.now() - inicio), ttfbMs, kib: Math.round(Buffer.byteLength(html) / 1024), ok };
      resultados.push(medida);
      console.log(JSON.stringify(medida));
    } catch {
      const medida = { fase, rota: rota[0], status: 0, ms: Math.round(performance.now() - inicio), ttfbMs: 0, kib: 0, ok: false };
      resultados.push(medida);
      console.log(JSON.stringify(medida));
    }
  }
  // Aquece o processo separadamente da comparação; sem chamadas a provedores ou mutações.
  for (const rota of rotas) await medir(rota, "aquecimento");
  for (let i = 0; i < 2; i++) for (const rota of rotas) await medir(rota, "sequencial");
  // Quatro navegações simultâneas, duas rodadas; não é teste de estresse da produção.
  for (let i = 0; i < 2; i++) await Promise.all(rotas.slice(0, 4).map(rota => medir(rota, "concorrente-4")));
  for (const fase of ["sequencial", "concorrente-4"]) {
    const medidas = resultados.filter(r => r.fase === fase);
    const tempos = medidas.map(r => r.ms).sort((a, b) => a - b);
    console.log(JSON.stringify({ resumo: fase, amostras: tempos.length, medianaMs: tempos[Math.floor(tempos.length / 2)], p95Ms: tempos[Math.ceil(tempos.length * .95) - 1], falhas: medidas.filter(r => !r.ok).length }));
  }
  if (resultados.some(r => !r.ok)) process.exitCode = 1;
}

main().catch(() => { console.error("Diagnóstico indisponível. Confira preview, banco e ambiente locais; nenhum segredo foi registrado."); process.exitCode = 1; }).finally(() => db.$disconnect());
