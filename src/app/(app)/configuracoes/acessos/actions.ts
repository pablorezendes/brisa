"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exigirSessao } from "@/lib/auth";
import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { prisma } from "@/lib/db";
import { ErroGestaoAcesso, gerirAcesso, type ComandoGestao } from "@/lib/acesso/gestao";

const campo = (dados: FormData, chave: string) => typeof dados.get(chave) === "string" ? String(dados.get(chave)) : "";
const lista = (dados: FormData, chave: string) => dados.getAll(chave).filter((v): v is string => typeof v === "string");

/** Único endpoint de gestão; toda decisão é reautorizada novamente na transação. */
export async function salvarAcesso(dados: FormData) {
  await exigirPermissaoAcesso("acessos.gerenciar", { global: true });
  const sessao = await exigirSessao();
  const comum = { confirmado: campo(dados, "confirmado") === "sim", motivo: campo(dados, "motivo") };
  const usuario = { usuarioId: campo(dados, "usuarioId"), versao: Number(campo(dados, "versao")) };
  const acao = campo(dados, "acao");
  let comando: ComandoGestao;
  switch (acao) {
    case "CRIAR_USUARIO": comando = { ...comum, acao, nome: campo(dados, "nome"), login: campo(dados, "login"), senha: campo(dados, "senha"), perfil: campo(dados, "perfil") }; break;
    case "SALVAR_USUARIO": comando = { ...comum, ...usuario, acao, nome: campo(dados, "nome"), perfil: campo(dados, "perfil"), acessoGlobal: campo(dados, "acessoGlobal") === "sim", papelAcessoId: campo(dados, "papelAcessoId") || null, permissoesExtras: lista(dados, "permissoesExtras"), permissoesNegadas: lista(dados, "permissoesNegadas") }; break;
    case "ALTERAR_STATUS": comando = { ...comum, ...usuario, acao, ativo: campo(dados, "ativo") === "sim" }; break;
    case "REDEFINIR_SENHA": comando = { ...comum, ...usuario, acao, senha: campo(dados, "senha") }; break;
    case "SALVAR_FUNCAO": comando = { ...comum, acao, papelId: campo(dados, "papelId") || null, versao: Number(campo(dados, "versao")), nome: campo(dados, "nome"), descricao: campo(dados, "descricao"), permissoes: lista(dados, "permissoes"), ativo: campo(dados, "ativo") === "sim" }; break;
    case "SALVAR_REGRA": comando = { ...comum, ...usuario, acao, tipo: campo(dados, "tipo"), recursoId: campo(dados, "recursoId"), efeito: campo(dados, "efeito") }; break;
    case "REMOVER_REGRA": comando = { ...comum, ...usuario, acao, regraId: campo(dados, "regraId") }; break;
    default: redirect("/configuracoes/acessos?erro=Operação+inválida");
  }
  let destino = "/configuracoes/acessos";
  try {
    const resultado = await gerirAcesso(prisma, { usuarioId: sessao.sub, sessaoVersao: sessao.sv ?? 0 }, comando);
    const qs = new URLSearchParams({ ok: "Acesso atualizado. As sessões afetadas foram encerradas; será necessário entrar novamente." });
    if (resultado.usuarioId) qs.set("editar", resultado.usuarioId);
    if (resultado.papelId) qs.set("funcao", resultado.papelId);
    destino += `?${qs}`;
  } catch (erro) {
    const qs = new URLSearchParams({ erro: erro instanceof ErroGestaoAcesso ? erro.message : "Não foi possível salvar. Recarregue e confira se o login ou nome da função já está em uso." });
    if (usuario.usuarioId) qs.set("editar", usuario.usuarioId);
    destino += `?${qs}`;
  }
  revalidatePath("/configuracoes/acessos");
  revalidatePath("/", "layout");
  redirect(destino);
}
