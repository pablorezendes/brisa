"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirPermissaoFinanceira } from "@/lib/autorizacao";
import { ErroApiSicoob } from "@/lib/integracoes/sicoob";
import {
  ErroOperacaoBoleto,
  ignorarLiquidacaoExternaSicoob,
  reprocessarConciliacaoSicoob,
} from "@/lib/servicos/boletos-sicoob";

const RE_ID = /^[0-9a-f-]{20,64}$/i;

function voltar(aviso: { ok?: string; erro?: string }): never {
  const params = new URLSearchParams();
  if (aviso.ok) params.set("ok", aviso.ok);
  if (aviso.erro) params.set("erro", aviso.erro);
  redirect(`/financeiro/conciliacao?${params.toString()}`);
}

export async function reprocessarConciliacao(formData: FormData): Promise<void> {
  const sessao = await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
  const bruto = formData.get("pagamentoId");
  const pagamentoId = typeof bruto === "string" ? bruto.trim() : "";
  if (!RE_ID.test(pagamentoId)) voltar({ erro: "Pagamento inválido." });
  let estado: "PROCESSADO" | "ERRO";
  try {
    estado = await reprocessarConciliacaoSicoob(pagamentoId, sessao.sub);
  } catch (erro) {
    voltar({
      erro:
        erro instanceof ErroOperacaoBoleto || erro instanceof ErroApiSicoob
          ? erro.message.slice(0, 240)
          : "Não foi possível reprocessar a conciliação.",
    });
  }
  revalidatePath("/financeiro/conciliacao");
  revalidatePath("/financeiro/boletos");
  revalidatePath("/recebimentos");
  voltar({
    ok:
      estado === "PROCESSADO"
        ? "Liquidação reavaliada e conciliação atualizada."
        : "Liquidação reavaliada; a divergência ainda exige correção.",
  });
}

export async function ignorarLiquidacaoExterna(formData: FormData): Promise<void> {
  const sessao = await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
  const bruto = formData.get("eventoId");
  const eventoId = typeof bruto === "string" ? bruto.trim() : "";
  if (!RE_ID.test(eventoId)) voltar({ erro: "Evento bancário inválido." });
  if (formData.get("confirmacao") !== "on") {
    voltar({ erro: "Confirme que a liquidação pertence a um título externo ao Brisa." });
  }
  try {
    await ignorarLiquidacaoExternaSicoob(eventoId, sessao.sub);
  } catch (erro) {
    voltar({
      erro:
        erro instanceof ErroOperacaoBoleto || erro instanceof ErroApiSicoob
          ? erro.message.slice(0, 240)
          : "Não foi possível ignorar a liquidação externa.",
    });
  }
  revalidatePath("/financeiro/conciliacao");
  voltar({
    ok: "Liquidação externa ignorada com auditoria; a janela poderá avançar na próxima sincronização.",
  });
}
