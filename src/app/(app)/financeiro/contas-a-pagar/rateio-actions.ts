"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { prisma } from "@/lib/db";
import { obterEditorDespesa, salvarDespesa } from "@/lib/despesas/servico";
import { ErroDespesa, type DespesaEditor, type SalvarDespesaEntrada, type ResultadoSalvarDespesa } from "@/lib/despesas/tipos";
import { idLancamentoValido } from "@/lib/dominio/lancamento-manual";

type Falha = { ok: false; mensagem: string };
function falha(erro: unknown): Falha {
  return { ok: false, mensagem: erro instanceof ErroDespesa ? erro.message : "Não foi possível concluir. Confira sua conexão e tente novamente; nenhum sucesso foi confirmado." };
}

async function despesaManualAtiva(id?: string) {
  if (!id || typeof id !== "string" || !idLancamentoValido(id)) return false;
  return Boolean(await prisma.despesaDocumento.findFirst({
    where: { id, origemChave: null, criadoManualBrisa: true }, select: { id: true },
  }));
}

export async function carregarRateioDespesa(selecao: { id?: string; origemChave?: string }): Promise<{ ok: true; editor: DespesaEditor } | Falha> {
  const acesso = await exigirPermissaoAcesso("despesas.ver", { global: true });
  const widesys = typeof selecao?.origemChave === "string" && /^WIDESYS:PAGAR:[^\s:]+$/.test(selecao.origemChave);
  if (!widesys && (selecao?.origemChave || !await despesaManualAtiva(selecao?.id))) return { ok: false, mensagem: "Selecione uma conta a pagar disponível." };
  try { return { ok: true, editor: await obterEditorDespesa(prisma, selecao, { id: acesso.usuarioId }) }; }
  catch (erro) { return falha(erro); }
}

export async function salvarRateioDespesa(entrada: SalvarDespesaEntrada): Promise<{ ok: true; resultado: ResultadoSalvarDespesa } | Falha> {
  const acesso = await exigirPermissaoAcesso("despesas.editar", { global: true });
  const widesys = typeof entrada?.origemChave === "string" && /^WIDESYS:PAGAR:[^\s:]+$/.test(entrada.origemChave);
  const modo = entrada?.pagamento?.modo;
  const permitido = widesys ? modo === "MANTER"
    : !entrada?.origemChave && (modo === "MANTER" || modo === "REGISTRAR") && await despesaManualAtiva(entrada?.id);
  if (!permitido) {
    return { ok: false, mensagem: "Selecione uma conta a pagar disponível para esta alteração." };
  }
  let resultado: ResultadoSalvarDespesa;
  try { resultado = await salvarDespesa(prisma, entrada, { id: acesso.usuarioId }); }
  catch (erro) { return falha(erro); }
  revalidatePath("/", "layout");
  return { ok: true, resultado };
}
