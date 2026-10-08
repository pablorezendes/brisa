"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { prisma } from "@/lib/db";
import { descartarTitulo, excluirAdministrativamente, excluirRecurso, inativarConta, mesclarRecursos, restaurarRecurso } from "@/lib/governanca/servico";
import { ErroGovernanca } from "@/lib/governanca/tipos";
import type { ResultadoNaTela } from "@/lib/interface/resultado-na-tela";

export async function executarGovernanca(form: FormData) {
  const acesso = await exigirPermissaoAcesso("governanca.editar", { global: true });
  const resultado = await processarGovernanca(form, acesso);
  const retorno = new URLSearchParams({ tipo: String(form.get("tipo") ?? "").trim(), origemId: String(form.get("origemId") ?? "").trim(), ...resultado });
  if (String(form.get("modo") ?? "").trim() === "excluir") retorno.set("modo", "excluir");
  redirect(`/cadastros/governanca?${retorno.toString()}`);
}

export async function executarGovernancaNaTela(_estado: ResultadoNaTela, form: FormData): Promise<ResultadoNaTela> {
  const acesso = await exigirPermissaoAcesso("governanca.editar", { global: true });
  return processarGovernanca(form, acesso);
}

async function processarGovernanca(form: FormData, acesso: Awaited<ReturnType<typeof exigirPermissaoAcesso>>): Promise<ResultadoNaTela> {
  const valor = (chave: string) => typeof form.get(chave) === "string" ? String(form.get(chave)).trim() : "";
  const tipo = valor("tipo"); const origemId = valor("origemId");
  let resultado: ResultadoNaTela;
  try {
    if (valor("confirmar") !== "sim") throw new ErroGovernanca("CONFIRMACAO", "Confirme que revisou a origem, o destino e os vínculos.");
    if (!/^[a-f0-9]{64}$/.test(valor("assinaturaPrevia"))) throw new ErroGovernanca("PREVIA_OBRIGATORIA", "Confira os vínculos antes de confirmar a operação.");
    const ator = { id: acesso.usuarioId, administrador: acesso.perfil === "ADMINISTRADOR", assinaturaPrevia: valor("assinaturaPrevia") };
    const acao = valor("acao"); const motivo = valor("motivo");
    if (acao === "restaurar" && valor("modo") === "excluir" && valor("cienciaExclusao") !== "sim") throw new ErroGovernanca("CONFIRMACAO", "Confirme a ciência antes de restaurar este registro.");
    if (tipo === "CONTA") await exigirPermissaoAcesso("contas.editar", { global: true });
    if (acao === "excluir-plataforma") {
      if (valor("cienciaExclusao") !== "sim") throw new ErroGovernanca("CONFIRMACAO", "Confirme que a exclusão é somente na plataforma e não cancela nem estorna operações externas.");
      await excluirAdministrativamente(prisma, tipo, origemId, motivo, ator);
    }
    else if (acao === "excluir") await excluirRecurso(prisma, tipo, origemId, motivo, ator);
    else if (acao === "mesclar") await mesclarRecursos(prisma, tipo, origemId, valor("destinoId"), motivo, ator);
    else if (acao === "descartar" && tipo === "TITULO") await descartarTitulo(prisma, origemId, valor("destinoId"), motivo, ator);
    else if (acao === "inativar" && tipo === "CONTA") await inativarConta(prisma, origemId, valor("confirmarAbertos") === "sim", motivo, ator);
    else if (acao === "restaurar") await restaurarRecurso(prisma, tipo, origemId, motivo, ator);
    else throw new ErroGovernanca("ACAO_INVALIDA", "Ação inválida para este registro.");
    resultado = { ok: "Ação registrada com histórico. A lista foi atualizada; nenhum registro foi apagado fisicamente." };
  } catch (erro) {
    if (!(erro instanceof ErroGovernanca)) throw erro;
    resultado = { erro: erro.message };
  }
  revalidatePath("/", "layout");
  return resultado;
}
