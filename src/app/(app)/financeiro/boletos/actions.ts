"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirPermissaoFinanceira } from "@/lib/autorizacao";
import { ErroApiSicoob } from "@/lib/integracoes/sicoob";
import {
  ErroOperacaoBoleto,
  emitirBoletoSicoob,
  liberarEmissaoInconclusivaSicoob,
  registrarWebhookDaConta,
  sincronizarBoletoSicoob,
  sincronizarCarteiraSicoob,
  vincularEmissaoInconclusivaSicoob,
} from "@/lib/servicos/boletos-sicoob";

const RE_ID = /^[0-9a-f-]{20,64}$/i;
const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const RE_DATA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function campo(formData: FormData, nome: string): string {
  const valor = formData.get(nome);
  return typeof valor === "string" ? valor.trim() : "";
}

function mensagemSegura(erro: unknown): string {
  if (erro instanceof ErroOperacaoBoleto || erro instanceof ErroApiSicoob) {
    return erro.message.slice(0, 260);
  }
  return "A operação bancária não pôde ser concluída. Consulte a conciliação.";
}

function voltar(
  mes: string,
  aviso: { ok?: string; erro?: string; boleto?: string },
): never {
  const params = new URLSearchParams();
  if (RE_MES.test(mes)) params.set("mes", mes);
  if (aviso.ok) params.set("ok", aviso.ok);
  if (aviso.erro) params.set("erro", aviso.erro);
  if (aviso.boleto) params.set("boleto", aviso.boleto);
  redirect(`/financeiro/boletos?${params.toString()}`);
}

function revalidarFinanceiro() {
  revalidatePath("/financeiro");
  revalidatePath("/financeiro/boletos");
  revalidatePath("/financeiro/contas-bancarias");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath("/recebimentos");
  revalidatePath("/executivo");
  revalidatePath("/paineis/cobranca");
}

export async function emitirBoleto(formData: FormData): Promise<void> {
  const sessao = await exigirPermissaoFinanceira("EMITIR_BOLETOS");
  const recebimentoId = campo(formData, "recebimentoId");
  const contaBancariaId = campo(formData, "contaBancariaId");
  const dataVencimento = campo(formData, "dataVencimento");
  const mes = campo(formData, "mes");
  if (!RE_ID.test(recebimentoId) || !RE_ID.test(contaBancariaId)) {
    voltar(mes, { erro: "Lançamento ou conta bancária inválidos." });
  }
  if (!RE_DATA.test(dataVencimento)) {
    voltar(mes, { erro: "Informe uma data de vencimento válida." });
  }
  let resultado;
  try {
    resultado = await emitirBoletoSicoob({
      recebimentoId,
      contaBancariaId,
      dataVencimento,
      usuarioId: sessao.sub,
    });
  } catch (erro) {
    revalidarFinanceiro();
    voltar(mes, { erro: mensagemSegura(erro) });
  }
  revalidarFinanceiro();
  voltar(mes, {
    ok: resultado.reutilizado
      ? "A emissão já existia e foi reutilizada sem duplicar o boleto."
      : "Boleto registrado no Sicoob.",
    boleto: resultado.boleto.id,
  });
}

export async function sincronizarBoleto(formData: FormData): Promise<void> {
  await exigirPermissaoFinanceira("SINCRONIZAR_BOLETOS");
  const boletoId = campo(formData, "boletoId");
  const mes = campo(formData, "mes");
  if (!RE_ID.test(boletoId)) voltar(mes, { erro: "Boleto inválido." });
  let boleto;
  try {
    boleto = await sincronizarBoletoSicoob(boletoId);
  } catch (erro) {
    revalidarFinanceiro();
    voltar(mes, { erro: mensagemSegura(erro), boleto: boletoId });
  }
  revalidarFinanceiro();
  voltar(mes, {
    ok:
      boleto.status === "LIQUIDADO"
        ? "Liquidação consultada; veja o resultado da conciliação."
        : "Situação atualizada diretamente no Sicoob.",
    boleto: boleto.id,
  });
}

export async function sincronizarTodosBoletos(formData: FormData): Promise<void> {
  const sessao = await exigirPermissaoFinanceira("SINCRONIZAR_BOLETOS");
  const mes = campo(formData, "mes");
  let resultado;
  try {
    resultado = await sincronizarCarteiraSicoob(12, sessao.sub);
  } catch (erro) {
    revalidarFinanceiro();
    voltar(mes, { erro: mensagemSegura(erro) });
  }
  revalidarFinanceiro();
  voltar(mes, {
    ok:
      resultado.boletos.consultados === 0 && resultado.liquidacoes.solicitadas === 0
        ? "Carteira conferida; não havia novos títulos nem retorno para solicitar."
        : `${resultado.boletos.consultados} título(s) consultado(s); ${resultado.liquidacoes.processadas} liquidação(ões) confirmada(s); ${resultado.boletos.erros + resultado.liquidacoes.erros} item(ns) exigem atenção.`,
  });
}

export async function liberarEmissaoInconclusiva(formData: FormData): Promise<void> {
  const sessao = await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
  const boletoId = campo(formData, "boletoId");
  const mes = campo(formData, "mes");
  if (!RE_ID.test(boletoId)) voltar(mes, { erro: "Boleto inválido." });
  if (campo(formData, "confirmacao") !== "on") {
    voltar(mes, {
      erro: "Confirme que o título foi procurado no Sicoob e não existe antes de liberar.",
      boleto: boletoId,
    });
  }
  try {
    await liberarEmissaoInconclusivaSicoob(boletoId, sessao.sub);
  } catch (erro) {
    revalidarFinanceiro();
    voltar(mes, { erro: mensagemSegura(erro), boleto: boletoId });
  }
  revalidarFinanceiro();
  voltar(mes, {
    ok: "Reserva liberada com auditoria. O lançamento pode receber uma nova emissão.",
    boleto: boletoId,
  });
}

export async function vincularEmissaoInconclusiva(formData: FormData): Promise<void> {
  const sessao = await exigirPermissaoFinanceira("CONCILIAR_PAGAMENTOS");
  const boletoId = campo(formData, "boletoId");
  const nossoNumero = campo(formData, "nossoNumero");
  const mes = campo(formData, "mes");
  if (!RE_ID.test(boletoId)) voltar(mes, { erro: "Boleto inválido." });
  if (!/^\d{1,30}$/.test(nossoNumero)) {
    voltar(mes, { erro: "Informe o nosso número com apenas dígitos.", boleto: boletoId });
  }
  try {
    await vincularEmissaoInconclusivaSicoob(
      boletoId,
      nossoNumero,
      sessao.sub,
    );
  } catch (erro) {
    revalidarFinanceiro();
    voltar(mes, { erro: mensagemSegura(erro), boleto: boletoId });
  }
  revalidarFinanceiro();
  voltar(mes, {
    ok: "Título localizado no Sicoob, conferido e vinculado ao lançamento.",
    boleto: boletoId,
  });
}

export async function registrarWebhook(formData: FormData): Promise<void> {
  const sessao = await exigirPermissaoFinanceira("GERENCIAR_CONTAS");
  const contaId = campo(formData, "contaBancariaId");
  if (!RE_ID.test(contaId)) voltar("", { erro: "Conta bancária inválida." });
  try {
    await registrarWebhookDaConta(contaId, sessao.sub);
  } catch (erro) {
    redirect(`/financeiro/contas-bancarias?erro=${encodeURIComponent(mensagemSegura(erro))}`);
  }
  revalidarFinanceiro();
  redirect("/financeiro/contas-bancarias?ok=Webhook+cadastrado.+Aguarde+a+valida%C3%A7%C3%A3o+do+Sicoob.");
}
