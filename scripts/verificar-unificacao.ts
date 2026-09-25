/** Smoke test somente leitura: nunca imprime cookies, nomes ou valores. */
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
async function main() {
  const base = new URL(process.argv[2] ?? "http://127.0.0.1:3100");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.protocol !== "http:") throw new Error("Use somente um servidor local de teste.");
  const segredo = process.env.AUTH_SECRET;
  if (!segredo || segredo.length < 32) throw new Error("Carregue AUTH_SECRET do ambiente local.");
  const admin = await db.usuario.findFirst({ where: { perfil: "ADMINISTRADOR" }, select: { id: true } });
  if (!admin) throw new Error("A base de teste precisa de um administrador existente.");
  function cookie(sub: string) {
    const corpo = Buffer.from(JSON.stringify({ sub, nome: "Verificação técnica local", exp: Date.now() + 120000 })).toString("base64url");
    return `brisa_sessao=${corpo}.${createHmac("sha256", segredo!).update(corpo).digest("base64url")}`;
  }
  async function verificar(caminho: string, esperado: number, sessao?: string, marcador?: string, rotulo = caminho) {
    const resposta = await fetch(new URL(caminho, base), { redirect: "manual", headers: sessao ? { cookie: sessao } : undefined });
    const conteudo = await resposta.text();
    if (resposta.status !== esperado || (marcador && !conteudo.includes(marcador)) || conteudo.includes("Application error:")) throw new Error(`Falha na rota ${rotulo}: HTTP ${resposta.status}.`);
    console.log(`OK ${rotulo}: HTTP ${resposta.status}`);
  }
  const sessao = cookie(admin.id);
  for (const [rota, marcador] of [
    ["/financeiro", "Financeiro unificado"], ["/recebimentos", "Contas a receber"],
    ["/financeiro/contas-a-pagar", "Contas a pagar"], ["/caixa", "Movimentações"],
    ["/contratos", "Contratos"], ["/cadastros/pessoas", "Pessoas"],
    ["/cadastros/base-unificada?dominio=IMOVEL", "Imóveis"], ["/unificacao?estado=PENDENTE", "Resolver"],
    ["/recebimentos?visao=locacao&mes=2026-06", "Recebimentos"],
    ["/caixa?visao=livro&mes=2026-06", "Caixa"],
    ["/financeiro/contas-a-receber?mes=2026-06&vencidos=1", "Contas a receber"],
    ["/financeiro/migracao-widesys", "Auditoria financeira Widesys"],
    ["/executivo?mes=2026-06", "Brisa"], ["/relatorios/comissao?ano=2026", "Brisa"],
    ["/relatorios/resultado?mes=2026-06", "Brisa"], ["/paineis/cobranca?mes=2026-06", "Brisa"],
    ["/paineis/caixa?ano=2026", "Brisa"], ["/temporada", "Brisa"],
  ]) await verificar(rota, 200, sessao, marcador);
  const pendente = await db.unificacaoRegistro.findFirst({ where: { status: "PENDENTE", dominio: "RECEBER" }, select: { chave: true } });
  if (pendente) await verificar(`/unificacao/${encodeURIComponent(pendente.chave)}`, 200, sessao, "Como resolver", "/unificacao/[registro]");
  // Perfil inexistente usa a regra de menor privilégio do próprio app.
  await verificar("/unificacao", 404, cookie("teste-sem-permissao-unificacao"));
  await verificar("/financeiro/contas-a-pagar", 404, cookie("teste-sem-permissao-unificacao"));
  await verificar("/unificacao", 307);
  console.log("Rotas unificadas, modos anteriores e restrições de acesso verificados.");
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Falha na verificação."); process.exitCode = 1; }).finally(() => db.$disconnect());
