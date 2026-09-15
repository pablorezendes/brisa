import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import {
  ErroOperacaoBoleto,
  registrarNotificacaoWebhookSicoob,
  sincronizarBoletoSicoob,
} from "@/lib/servicos/boletos-sicoob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LIMITE_BYTES = 64 * 1024;
const MAXIMO_POR_MINUTO = 120;
let inicioJanela = Date.now();
let recebidosNaJanela = 0;

function excedeuLimite(): boolean {
  const agora = Date.now();
  if (agora - inicioJanela >= 60_000) {
    inicioJanela = agora;
    recebidosNaJanela = 0;
  }
  recebidosNaJanela += 1;
  return recebidosNaJanela > MAXIMO_POR_MINUTO;
}

function segredoValido(informado: string): boolean {
  const esperado = process.env.SICOOB_WEBHOOK_SECRET?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(esperado)) return false;
  const a = Buffer.from(informado, "utf8");
  const b = Buffer.from(esperado, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function lerJsonLimitado(request: Request): Promise<unknown> {
  const declarado = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declarado) && declarado > LIMITE_BYTES) {
    throw new RangeError("payload_grande");
  }
  if (!request.body) throw new SyntaxError("payload_vazio");
  const leitor = request.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const trecho = await leitor.read();
    if (trecho.done) break;
    total += trecho.value.byteLength;
    if (total > LIMITE_BYTES) {
      await leitor.cancel();
      throw new RangeError("payload_grande");
    }
    partes.push(trecho.value);
  }
  const bytes = new Uint8Array(total);
  let posicao = 0;
  for (const parte of partes) {
    bytes.set(parte, posicao);
    posicao += parte.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export async function POST(
  request: Request,
  contexto: { params: Promise<{ segredo: string }> },
) {
  const { segredo } = await contexto.params;
  if (!segredoValido(segredo)) {
    // 404 reduz a capacidade de distinguir uma rota existente de um token ruim.
    return new Response(null, { status: 404 });
  }
  if (excedeuLimite()) {
    return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
  }
  const tipo = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!tipo.includes("application/json")) {
    return new Response(null, { status: 415 });
  }
  let payload: unknown;
  try {
    payload = await lerJsonLimitado(request);
  } catch (erro) {
    return new Response(null, { status: erro instanceof RangeError ? 413 : 400 });
  }
  if (payload === null || typeof payload !== "object") {
    return new Response(null, { status: 400 });
  }
  try {
    // O 204 só sai depois da gravação durável. O evento tipo 7 é intermediário
    // e nunca altera Recebimento.recebido nesta rota pública.
    const resultado = await registrarNotificacaoWebhookSicoob(payload);
    if (resultado.boletoId && !resultado.validacao && !resultado.duplicado) {
      const boletoId = resultado.boletoId;
      after(async () => {
        try {
          await sincronizarBoletoSicoob(boletoId);
        } catch {
          // O evento durável continua na fila e a tela permite nova consulta.
        }
      });
    }
    return new Response(null, { status: 204 });
  } catch (erro) {
    if (erro instanceof ErroOperacaoBoleto && erro.codigo === "WEBHOOK_PAYLOAD_INVALIDO") {
      return new Response(null, { status: 400 });
    }
    // O Sicoob deve repetir quando nem a gravação idempotente foi possível.
    return new Response(null, { status: 503 });
  }
}
