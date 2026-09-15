import { timingSafeEqual } from "node:crypto";
import { sincronizarCarteiraSicoob } from "@/lib/servicos/boletos-sicoob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function autorizado(request: Request): boolean {
  const esperado = process.env.SICOOB_SYNC_SECRET?.trim() ?? "";
  const cabecalho = request.headers.get("authorization") ?? "";
  const informado = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7).trim() : "";
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(esperado)) return false;
  const a = Buffer.from(informado, "utf8");
  const b = Buffer.from(esperado, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!autorizado(request)) return Response.json({ erro: "não encontrado" }, { status: 404 });
  try {
    const resultado = await sincronizarCarteiraSicoob(12);
    const totalErros = resultado.boletos.erros + resultado.liquidacoes.erros;
    return Response.json(resultado, {
      // O agendador observa apenas o status HTTP. Qualquer baixa pendente ou
      // divergente precisa, portanto, tornar a execução visivelmente falha.
      status: totalErros > 0 ? 503 : 200,
    });
  } catch {
    return Response.json({ erro: "sincronização indisponível" }, { status: 503 });
  }
}
