import { acessoAtual } from "@/lib/acesso/servidor";
import { pode } from "@/lib/acesso/politica";
import { consultarCarteira, csvCarteira } from "@/lib/acesso/carteira";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const acesso = await acessoAtual();
  if (!["carteira.ver", "financeiro.ver", "relatorios.exportar"].every(p => pode(acesso, p))) return new Response("Acesso não autorizado.", { status: 403 });
  const mes = new URL(request.url).searchParams.get("mes") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return new Response("Competência inválida.", { status: 400 });
  const dados = await consultarCarteira(prisma, acesso, mes);
  return new Response(csvCarteira(dados.titulos), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="carteira-${mes}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
