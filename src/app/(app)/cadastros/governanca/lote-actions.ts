"use server";

import { revalidatePath } from "next/cache";
import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { prisma } from "@/lib/db";
import { ErroGovernanca } from "@/lib/governanca/tipos";
import { excluirTitulosLote, previaExclusaoTitulosLote } from "@/lib/governanca/exclusao-titulos-lote";
import type { ResultadoExclusaoTitulos } from "@/lib/governanca/exclusao-titulos-lote-tipos";

const campo = (form: FormData, nome: string) => typeof form.get(nome) === "string" ? String(form.get(nome)).trim() : "";
function json(form: FormData, nome: string): unknown {
  const texto = campo(form, nome);
  if (!texto || texto.length > 40000) throw new ErroGovernanca("SELECAO_INVALIDA", "A seleção não é válida. Selecione novamente os registros.");
  try { return JSON.parse(texto); }
  catch { throw new ErroGovernanca("SELECAO_INVALIDA", "A seleção não é válida. Selecione novamente os registros."); }
}
function erroSeguro(erro: unknown): ResultadoExclusaoTitulos {
  if (erro instanceof ErroGovernanca) return { estado: "ERRO", codigo: erro.codigo, mensagem: erro.message };
  return { estado: "ERRO", codigo: "OPERACAO_INDISPONIVEL", mensagem: "Não foi possível concluir a operação. Atualize a prévia e tente novamente; nenhum sucesso foi confirmado." };
}

export async function prepararExclusaoTitulos(form: FormData): Promise<ResultadoExclusaoTitulos> {
  const acesso = await exigirPermissaoAcesso("governanca.editar", { global: true });
  if (acesso.perfil !== "ADMINISTRADOR") return { estado: "ERRO", codigo: "SEM_PERMISSAO", mensagem: "Somente um administrador pode excluir registros da plataforma." };
  try {
    const previa = await previaExclusaoTitulosLote(prisma, campo(form, "dominio"), json(form, "chaves"), { id: acesso.usuarioId });
    return { estado: "PRONTO", previa };
  } catch (erro) { return erroSeguro(erro); }
}

export async function excluirTitulosSelecionados(form: FormData): Promise<ResultadoExclusaoTitulos> {
  const acesso = await exigirPermissaoAcesso("governanca.editar", { global: true });
  if (acesso.perfil !== "ADMINISTRADOR") return { estado: "ERRO", codigo: "SEM_PERMISSAO", mensagem: "Somente um administrador pode excluir registros da plataforma." };
  let resultado;
  try {
    if (campo(form, "confirmar") !== "sim" || campo(form, "cienciaExclusao") !== "sim") {
      throw new ErroGovernanca("CONFIRMACAO", "Confirme a seleção e que a exclusão é somente no Brisa, sem cancelar ou estornar operações externas.");
    }
    resultado = await excluirTitulosLote(prisma, campo(form, "dominio"), json(form, "itens"), campo(form, "motivo"), { id: acesso.usuarioId });
  } catch (erro) { return erroSeguro(erro); }
  if (resultado.excluidos.length) revalidatePath("/", "layout");
  return {
    estado: "CONCLUIDO", ...resultado,
    mensagem: resultado.excluidos.length
      ? `${resultado.excluidos.length} registro(s) excluído(s) da plataforma. O histórico foi preservado e é possível restaurar pela lixeira.`
      : "Os registros selecionados já estavam excluídos. Nenhuma exclusão foi repetida.",
  };
}
