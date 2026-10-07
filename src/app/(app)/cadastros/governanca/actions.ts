"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { prisma } from "@/lib/db";
import { descartarTitulo, excluirRecurso, inativarConta, mesclarRecursos, restaurarRecurso } from "@/lib/governanca/servico";
import { ErroGovernanca } from "@/lib/governanca/tipos";

export async function executarGovernanca(form: FormData) {
  const acesso = await exigirPermissaoAcesso("governanca.editar", { global: true });
  const valor = (chave: string) => typeof form.get(chave) === "string" ? String(form.get(chave)).trim() : "";
  const tipo = valor("tipo"); const origemId = valor("origemId");
  const retorno = new URLSearchParams({ tipo, origemId });
  try {
    if (valor("confirmar") !== "sim") throw new ErroGovernanca("CONFIRMACAO", "Confirme que revisou a origem, o destino e os vínculos.");
    if (!/^[a-f0-9]{64}$/.test(valor("assinaturaPrevia"))) throw new ErroGovernanca("PREVIA_OBRIGATORIA", "Confira os vínculos antes de confirmar a operação.");
    const ator = { id: acesso.usuarioId, administrador: acesso.perfil === "ADMINISTRADOR", assinaturaPrevia: valor("assinaturaPrevia") };
    const acao = valor("acao"); const motivo = valor("motivo");
    if (tipo === "CONTA") await exigirPermissaoAcesso("contas.editar", { global: true });
    if (acao === "excluir") await excluirRecurso(prisma, tipo, origemId, motivo, ator);
    else if (acao === "mesclar") await mesclarRecursos(prisma, tipo, origemId, valor("destinoId"), motivo, ator);
    else if (acao === "descartar" && tipo === "TITULO") await descartarTitulo(prisma, origemId, valor("destinoId"), motivo, ator);
    else if (acao === "inativar" && tipo === "CONTA") await inativarConta(prisma, origemId, valor("confirmarAbertos") === "sim", motivo, ator);
    else if (acao === "restaurar") await restaurarRecurso(prisma, tipo, origemId, motivo, ator);
    else throw new ErroGovernanca("ACAO_INVALIDA", "Ação inválida para este registro.");
    retorno.set("ok", "Ação registrada com histórico. Nenhum registro foi apagado fisicamente.");
  } catch (erro) {
    if (!(erro instanceof ErroGovernanca)) throw erro;
    retorno.set("erro", erro.message);
  }
  revalidatePath("/", "layout");
  redirect(`/cadastros/governanca?${retorno.toString()}`);
}
