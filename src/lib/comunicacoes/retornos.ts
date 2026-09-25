import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { lerEventosMeta, lerOptOutsMeta, podeAvancarStatus } from "./webhook";
import { validarConfigCobranca } from "./dominio";

const estadoMeta: Record<string, string> = { ENVIADA: "ACEITO", ENTREGUE: "ENTREGUE", LIDA: "LIDO", FALHOU: "FALHA", INCERTA: "INCERTO" };
const estadoLocal: Record<string, string> = { ENVIADO: "ENVIADA", ENTREGUE: "ENTREGUE", LIDO: "LIDA", FALHA: "FALHOU" };
export async function aplicarRetornos(db: PrismaClient, providerId: string) {
  const eventos = await db.retornoComunicacao.findMany({ where: { providerId }, orderBy: { ocorridoEm: "asc" } });
  for (const e of eventos) {
    if (!Object.hasOwn(estadoLocal, e.status)) continue;
    await db.$transaction(async tx => {
      const m = await tx.mensagemCobranca.findUnique({ where: { providerId } });
      if (!m || m.canal !== "WHATSAPP" || !podeAvancarStatus(estadoMeta[m.status] ?? m.status, e.status as "ENVIADO" | "ENTREGUE" | "LIDO" | "FALHA")) return;
      if (estadoLocal[e.status] === m.status) return;
      await tx.mensagemCobranca.update({ where: { id: m.id }, data: { status: estadoLocal[e.status], erroCodigo: e.codigo } });
      await tx.eventoComunicacao.create({ data: { mensagemId: m.id, tipo: estadoLocal[e.status], codigo: e.codigo } });
    });
  }
}

/** Somente o Route Handler autenticado com HMAC pode chamar esta função. */
export async function receberRetornoMeta(db: PrismaClient, corpo: string) {
  const salva = await db.configuracaoComunicacao.findUnique({ where: { id: "cobranca" } });
  if (!salva) return;
  const config = validarConfigCobranca(JSON.parse(salva.dados));
  const eventos = lerEventosMeta(corpo);
  for (const e of eventos) {
    if (e.phoneNumberId !== config.whatsappPhoneNumberId || e.ocorridoEm.getTime() > Date.now() + 300_000) continue;
    const chave = createHash("sha256").update(`${e.provedorId}:${e.status}`).digest("hex");
    await db.retornoComunicacao.upsert({ where: { chave }, create: { chave, providerId: e.provedorId, phoneNumberId: e.phoneNumberId, status: e.status, codigo: e.codigoErro, ocorridoEm: e.ocorridoEm }, update: {} });
    await aplicarRetornos(db, e.provedorId);
  }
  for (const e of lerOptOutsMeta(corpo)) {
    if (e.phoneNumberId !== config.whatsappPhoneNumberId || e.ocorridoEm.getTime() > Date.now() + 300_000) continue;
    await db.$transaction(async tx => {
      const chave = createHash("sha256").update(`${e.provedorId}:SAIR`).digest("hex");
      if (await tx.retornoComunicacao.findUnique({ where: { chave } })) return;
      await tx.retornoComunicacao.create({ data: { chave, providerId: e.provedorId, phoneNumberId: e.phoneNumberId, status: "SAIR", ocorridoEm: e.ocorridoEm } });
      const contatos = await tx.contatoCobranca.findMany({ where: { canal: "WHATSAPP", destino: e.destinatario, autorizado: true, atualizadoEm: { lte: new Date(e.ocorridoEm.getTime() + 1000) } }, select: { id: true } });
      const ids = contatos.map(c => c.id);
      await tx.contatoCobranca.updateMany({ where: { id: { in: ids } }, data: { autorizado: false, evidencia: "Revogado pelo titular via WhatsApp (SAIR/PARAR/CANCELAR).", revisadoPor: "WEBHOOK_META" } });
      await tx.mensagemCobranca.updateMany({ where: { contatoId: { in: ids }, status: "AGENDADA" }, data: { status: "CANCELADA", erroCodigo: "OPT_OUT" } });
      if (ids.length) await tx.eventoComunicacao.create({ data: { tipo: "OPT_OUT_WHATSAPP" } });
    });
  }
}
