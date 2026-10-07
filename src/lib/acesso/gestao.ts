import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { gerarHashSenha } from "../auth";
import { montarPolitica, PERMISSOES_ACESSO, PERFIS_ACESSO, TIPOS_ESCOPO, type PermissaoAcesso, type TipoEscopo } from "./politica";

export class ErroGestaoAcesso extends Error {
  constructor(public readonly codigo: string, mensagem: string) { super(mensagem); }
}
export type AtorGestao = { usuarioId: string; sessaoVersao: number };
type Confirmacao = { confirmado: boolean; motivo: string };
export type ComandoGestao = Confirmacao & (
  | { acao: "CRIAR_USUARIO"; nome: string; login: string; senha: string; perfil: string }
  | { acao: "SALVAR_USUARIO"; usuarioId: string; versao: number; nome: string; perfil: string; acessoGlobal: boolean; papelAcessoId: string | null; permissoesExtras: string[]; permissoesNegadas: string[] }
  | { acao: "ALTERAR_STATUS"; usuarioId: string; versao: number; ativo: boolean }
  | { acao: "REDEFINIR_SENHA"; usuarioId: string; versao: number; senha: string }
  | { acao: "SALVAR_FUNCAO"; papelId: string | null; versao: number; nome: string; descricao: string; permissoes: string[]; ativo: boolean }
  | { acao: "SALVAR_REGRA"; usuarioId: string; versao: number; tipo: string; recursoId: string; efeito: string }
  | { acao: "REMOVER_REGRA"; usuarioId: string; versao: number; regraId: string }
);

const selecaoUsuario = {
  id: true, nome: true, usuario: true, perfil: true, ativo: true, acessoGlobal: true,
  papelAcessoId: true, permissoesExtras: true, permissoesNegadas: true, acessoVersao: true, sessaoVersao: true,
} as const;
function negar(codigo: string, mensagem: string): never { throw new ErroGestaoAcesso(codigo, mensagem); }
const texto = (valor: string, minimo: number, maximo: number, campo: string) => {
  if (typeof valor !== "string" || valor.trim().length < minimo || valor.trim().length > maximo) negar("CAMPO_INVALIDO", `${campo}: informe de ${minimo} a ${maximo} caracteres.`);
  return valor.trim();
};
function perfilValido(perfil: string) {
  if (!(PERFIS_ACESSO as readonly string[]).includes(perfil)) negar("PERFIL_INVALIDO", "Escolha uma função-base válida.");
  return perfil;
}
function senhaValida(senha: string) {
  if (typeof senha !== "string" || senha.length < 12 || senha.length > 128) negar("SENHA_INVALIDA", "A senha deve ter entre 12 e 128 caracteres.");
  return senha;
}
function permissoesValidas(permissoes: string[], perfil?: string): PermissaoAcesso[] {
  if (!Array.isArray(permissoes) || permissoes.length > 100 || permissoes.some(p => typeof p !== "string" || !Object.hasOwn(PERMISSOES_ACESSO, p))) negar("PERMISSAO_INVALIDA", "Há uma permissão desconhecida na configuração.");
  if (permissoes.some(p => ["comissoes.ver", "acessos.gerenciar"].includes(p))) negar("PERMISSAO_RESTRITA", "Comissões e gestão de acessos são exclusivas de administradores.");
  if (perfil && ["SOCIO", "CONTABILIDADE", "CONSULTA"].includes(perfil) && permissoes.some(p => !p.endsWith(".ver") && p !== "relatorios.exportar" && p !== "cadastros.sensiveis")) negar("SOMENTE_LEITURA", "Sócios, contabilidade e consulta não podem receber permissões de alteração.");
  return [...new Set(permissoes)].sort() as PermissaoAcesso[];
}
async function exigirAdministrador(tx: Prisma.TransactionClient, ator: AtorGestao) {
  const atual = await tx.usuario.findUnique({ where: { id: ator.usuarioId }, select: { id: true, perfil: true, ativo: true, sessaoVersao: true } });
  if (!atual?.ativo || atual.perfil !== "ADMINISTRADOR" || atual.sessaoVersao !== ator.sessaoVersao) negar("SEM_PERMISSAO", "Sua sessão não pode administrar acessos. Entre novamente com uma conta autorizada.");
}
async function usuarioAlvo(tx: Prisma.TransactionClient, ator: AtorGestao, id: string, versao: number) {
  if (id === ator.usuarioId) negar("PROPRIO_ACESSO", "Outro administrador deve revisar seu acesso. Esta tela não altera o próprio usuário.");
  const usuario = await tx.usuario.findUnique({ where: { id }, select: selecaoUsuario });
  if (!usuario) negar("USUARIO_AUSENTE", "Usuário não encontrado.");
  if (!Number.isSafeInteger(versao) || usuario.acessoVersao !== versao) negar("VERSAO_ALTERADA", "O acesso foi alterado por outra operação. Recarregue antes de salvar.");
  return usuario;
}
async function atualizarUsuario(tx: Prisma.TransactionClient, id: string, versao: number, dados: Prisma.UsuarioUpdateManyMutationInput) {
  const atualizado = await tx.usuario.updateMany({ where: { id, acessoVersao: versao }, data: { ...dados, acessoVersao: { increment: 1 }, sessaoVersao: { increment: 1 } } });
  if (atualizado.count !== 1) negar("VERSAO_ALTERADA", "O acesso mudou. Recarregue a página antes de salvar.");
}
async function protegerUltimoAdmin(tx: Prisma.TransactionClient, perfilAnterior: string, perdeAdmin: boolean) {
  if (perfilAnterior === "ADMINISTRADOR" && perdeAdmin && await tx.usuario.count({ where: { perfil: "ADMINISTRADOR", ativo: true } }) <= 1) negar("ULTIMO_ADMIN", "É necessário manter pelo menos um administrador ativo.");
}
async function recursoExiste(tx: Prisma.TransactionClient, tipo: TipoEscopo, id: string) {
  const where = { id }; const select = { id: true } as const;
  switch (tipo) {
    case "EMPREENDIMENTO": return !!await tx.empreendimento.findUnique({ where, select });
    case "UNIDADE": return !!await tx.unidade.findUnique({ where, select });
    case "LOCATARIO": return !!await tx.locatario.findUnique({ where, select });
    case "PESSOA": return !!await tx.pessoa.findUnique({ where, select });
    case "IMOVEL_LEGADO": return !!await tx.imovelLegado.findUnique({ where, select });
  }
}

/** Cada decisão é atômica, revisada com a sessão atual e registrada sem segredo. */
export async function gerirAcesso(db: PrismaClient, ator: AtorGestao, comando: ComandoGestao) {
  if (!comando.confirmado) negar("CONFIRMACAO_OBRIGATORIA", "Confirme que revisou esta alteração de acesso.");
  const motivo = texto(comando.motivo, 5, 500, "Justificativa");
  return db.$transaction(async tx => {
    await exigirAdministrador(tx, ator);
    const registrar = (tipo: string, usuarioAlvoId: string | null, antes: unknown, depois: unknown) => tx.eventoAcesso.create({ data: { autorId: ator.usuarioId, usuarioAlvoId, tipo, antes: JSON.stringify(antes), depois: JSON.stringify(depois), motivo }, select: { id: true } });
    if (comando.acao === "CRIAR_USUARIO") {
      const nome = texto(comando.nome, 2, 100, "Nome");
      const login = texto(comando.login, 3, 80, "Login").toLowerCase();
      if (!/^[a-z0-9][a-z0-9._@-]+$/.test(login)) negar("LOGIN_INVALIDO", "Use letras sem acento, números, ponto, hífen, @ ou sublinhado no login.");
      const perfil = perfilValido(comando.perfil);
      if (await tx.usuario.findUnique({ where: { usuario: login }, select: { id: true } })) negar("LOGIN_EXISTENTE", "Este login já está em uso. Escolha outro ou edite o usuário existente.");
      const novo = await tx.usuario.create({ data: { nome, usuario: login, senhaHash: gerarHashSenha(senhaValida(comando.senha)), perfil, acessoGlobal: perfil === "ADMINISTRADOR" }, select: selecaoUsuario });
      await registrar(comando.acao, novo.id, {}, novo);
      return { usuarioId: novo.id };
    }
    if (comando.acao === "SALVAR_FUNCAO") {
      const nome = texto(comando.nome, 2, 80, "Nome da função");
      const descricao = texto(comando.descricao, 0, 400, "Descrição");
      const permissoes = permissoesValidas(comando.permissoes);
      if (typeof comando.ativo !== "boolean") negar("CAMPO_INVALIDO", "Informe o estado da função.");
      const anterior = comando.papelId ? await tx.papelAcesso.findUnique({ where: { id: comando.papelId } }) : null;
      if (comando.papelId && (!anterior || anterior.versao !== comando.versao)) negar("VERSAO_ALTERADA", "A função mudou ou não existe mais. Recarregue antes de salvar.");
      const duplicado = await tx.papelAcesso.findUnique({ where: { nome }, select: { id: true } });
      if (duplicado && duplicado.id !== comando.papelId) negar("FUNCAO_EXISTENTE", "Já existe uma função com este nome.");
      const usuarios = anterior ? await tx.usuario.findMany({ where: { papelAcessoId: anterior.id }, select: { id: true, perfil: true } }) : [];
      for (const usuario of usuarios) {
        if (usuario.id === ator.usuarioId) negar("PROPRIO_ACESSO", "Outro administrador deve alterar uma função atribuída ao seu próprio usuário.");
        permissoesValidas(permissoes, usuario.perfil);
      }
      const dados = { nome, descricao, permissoes: JSON.stringify(permissoes), ativo: comando.ativo };
      let papelId: string;
      if (anterior) {
        const atualizado = await tx.papelAcesso.updateMany({ where: { id: anterior.id, versao: comando.versao }, data: { ...dados, versao: { increment: 1 } } });
        if (atualizado.count !== 1) negar("VERSAO_ALTERADA", "A função foi alterada por outra operação.");
        papelId = anterior.id;
        await tx.usuario.updateMany({ where: { papelAcessoId: papelId }, data: { acessoVersao: { increment: 1 }, sessaoVersao: { increment: 1 } } });
      } else papelId = (await tx.papelAcesso.create({ data: dados, select: { id: true } })).id;
      await registrar(comando.acao, null, anterior ?? {}, { id: papelId, ...dados, usuariosAfetados: usuarios.map(u => u.id) });
      return { papelId };
    }
    const anterior = await usuarioAlvo(tx, ator, comando.usuarioId, comando.versao);
    if (comando.acao === "SALVAR_USUARIO") {
      const nome = texto(comando.nome, 2, 100, "Nome");
      const perfil = perfilValido(comando.perfil);
      if (typeof comando.acessoGlobal !== "boolean") negar("CAMPO_INVALIDO", "Informe a abrangência.");
      await protegerUltimoAdmin(tx, anterior.perfil, perfil !== "ADMINISTRADOR");
      if (perfil === "ADMINISTRADOR" && (comando.papelAcessoId || comando.permissoesExtras.length || comando.permissoesNegadas.length || !comando.acessoGlobal)) negar("ADMIN_GLOBAL", "Administrador tem acesso global e integral. Não atribua função personalizada, exceções ou carteira restrita.");
      const extras = permissoesValidas(comando.permissoesExtras, perfil);
      const negadas = permissoesValidas(comando.permissoesNegadas);
      if (extras.some(p => negadas.includes(p))) negar("PERMISSOES_CONFLITANTES", "Uma permissão não pode ser liberada e bloqueada simultaneamente.");
      if (comando.papelAcessoId) {
        const papel = await tx.papelAcesso.findUnique({ where: { id: comando.papelAcessoId } });
        if (!papel?.ativo) negar("FUNCAO_INATIVA", "Escolha uma função personalizada ativa.");
        permissoesValidas(JSON.parse(papel.permissoes), perfil);
      }
      if (perfil === "ADMINISTRADOR" && await tx.regraAcesso.count({ where: { usuarioId: anterior.id } })) negar("ADMIN_COM_REGRAS", "Remova as regras de carteira antes de promover a administrador global.");
      const depois = { nome, perfil, acessoGlobal: comando.acessoGlobal, papelAcessoId: comando.papelAcessoId, permissoesExtras: JSON.stringify(extras), permissoesNegadas: JSON.stringify(negadas) };
      await atualizarUsuario(tx, anterior.id, comando.versao, depois);
      await registrar(comando.acao, anterior.id, anterior, depois);
    } else if (comando.acao === "ALTERAR_STATUS") {
      if (typeof comando.ativo !== "boolean") negar("CAMPO_INVALIDO", "Informe o estado do usuário.");
      if (anterior.ativo === comando.ativo) negar("ESTADO_IGUAL", "O usuário já está nesse estado.");
      await protegerUltimoAdmin(tx, anterior.perfil, !comando.ativo);
      await atualizarUsuario(tx, anterior.id, comando.versao, { ativo: comando.ativo });
      await registrar(comando.acao, anterior.id, { ativo: anterior.ativo }, { ativo: comando.ativo });
    } else if (comando.acao === "REDEFINIR_SENHA") {
      await atualizarUsuario(tx, anterior.id, comando.versao, { senhaHash: gerarHashSenha(senhaValida(comando.senha)) });
      await registrar(comando.acao, anterior.id, { sessaoVersao: anterior.sessaoVersao }, { senhaRedefinida: true, sessoesRevogadas: true });
    } else if (comando.acao === "SALVAR_REGRA") {
      if (anterior.perfil === "ADMINISTRADOR") negar("ADMIN_GLOBAL", "Administradores têm acesso global. Regras de carteira não se aplicam a eles.");
      if (!(TIPOS_ESCOPO as readonly string[]).includes(comando.tipo) || !["PERMITIR", "BLOQUEAR"].includes(comando.efeito)) negar("REGRA_INVALIDA", "Escolha um tipo e efeito válidos.");
      const recursoId = texto(comando.recursoId, 1, 150, "Cadastro");
      if (!await recursoExiste(tx, comando.tipo as TipoEscopo, recursoId)) negar("RECURSO_AUSENTE", "O cadastro selecionado não existe nesse tipo. Pesquise e selecione novamente.");
      const where = { usuarioId_tipo_recursoId: { usuarioId: anterior.id, tipo: comando.tipo, recursoId } };
      const regraAnterior = await tx.regraAcesso.findUnique({ where });
      if (!regraAnterior && await tx.regraAcesso.count({ where: { usuarioId: anterior.id } }) >= 200) negar("LIMITE_REGRAS", "Limite de 200 regras por usuário. Prefira liberar empreendimentos e bloquear exceções.");
      const regra = await tx.regraAcesso.upsert({ where, create: { usuarioId: anterior.id, tipo: comando.tipo, recursoId, efeito: comando.efeito }, update: { efeito: comando.efeito } });
      await atualizarUsuario(tx, anterior.id, comando.versao, {});
      await registrar(comando.acao, anterior.id, regraAnterior ?? {}, regra);
    } else if (comando.acao === "REMOVER_REGRA") {
      const regra = await tx.regraAcesso.findFirst({ where: { id: comando.regraId, usuarioId: anterior.id } });
      if (!regra) negar("REGRA_AUSENTE", "A regra não existe mais para este usuário.");
      // Remove somente uma regra de autorização; cadastros e histórico permanecem.
      await tx.regraAcesso.delete({ where: { id: regra.id } });
      await atualizarUsuario(tx, anterior.id, comando.versao, {});
      await registrar(comando.acao, anterior.id, regra, { removida: true });
    }
    return { usuarioId: anterior.id };
  }, { maxWait: 10000, timeout: 30000 });
}

export const NOMES_TIPO: Record<TipoEscopo, string> = { EMPREENDIMENTO: "Empreendimento", UNIDADE: "Imóvel / unidade", LOCATARIO: "Locatário", PESSOA: "Pessoa / empresa", IMOVEL_LEGADO: "Imóvel do legado" };
async function opcoesRecursos(tx: Prisma.TransactionClient, tipo: TipoEscopo, q: string, ids?: string[]) {
  const filtroIds = ids ? { id: { in: ids } } : {};
  const take = ids ? 200 : 50;
  if (tipo === "EMPREENDIMENTO") return tx.empreendimento.findMany({ where: { ...filtroIds, nome: { contains: q } }, select: { id: true, nome: true }, orderBy: { nome: "asc" }, take });
  if (tipo === "LOCATARIO") return tx.locatario.findMany({ where: { ...filtroIds, nome: { contains: q } }, select: { id: true, nome: true }, orderBy: { nome: "asc" }, take });
  if (tipo === "PESSOA") return tx.pessoa.findMany({ where: { ...filtroIds, nome: { contains: q } }, select: { id: true, nome: true }, orderBy: { nome: "asc" }, take });
  if (tipo === "UNIDADE") {
    const xs = await tx.unidade.findMany({ where: { ...filtroIds, identificacao: { contains: q } }, select: { id: true, identificacao: true, empreendimento: { select: { nome: true } } }, orderBy: { identificacao: "asc" }, take });
    return xs.map(x => ({ id: x.id, nome: `${x.empreendimento.nome} · ${x.identificacao}` }));
  }
  const xs = await tx.imovelLegado.findMany({ where: { ...filtroIds, OR: [{ nome: { contains: q } }, { referencia: { contains: q } }] }, select: { id: true, nome: true, referencia: true }, orderBy: { referencia: "asc" }, take });
  return xs.map(x => ({ id: x.id, nome: [x.referencia, x.nome].filter(Boolean).join(" · ") || "Imóvel sem nome" }));
}

/** DTO administrativo mínimo: nunca entrega hash de senha, documentos ou saldos. */
export async function consultarGestaoAcessos(db: PrismaClient, ator: AtorGestao, filtros: { usuarioId?: string; busca?: string; tipo?: string; buscaRecurso?: string; papelId?: string } = {}) {
  return db.$transaction(async tx => {
    await exigirAdministrador(tx, ator);
    const tipo = (TIPOS_ESCOPO as readonly string[]).includes(filtros.tipo ?? "") ? filtros.tipo as TipoEscopo : "EMPREENDIMENTO";
    const q = (filtros.busca ?? "").trim().slice(0, 100);
    const usuarios = await tx.usuario.findMany({ where: q ? { OR: [{ nome: { contains: q } }, { usuario: { contains: q } }] } : {}, select: selecaoUsuario, orderBy: [{ ativo: "desc" }, { nome: "asc" }], take: 100 });
    const usuario = filtros.usuarioId ? await tx.usuario.findUnique({ where: { id: filtros.usuarioId }, select: { ...selecaoUsuario, papelAcesso: true, regrasAcesso: { orderBy: [{ tipo: "asc" }, { recursoId: "asc" }] } } }) : null;
    const papeis = await tx.papelAcesso.findMany({ orderBy: { nome: "asc" }, take: 100 });
    const papel = filtros.papelId ? await tx.papelAcesso.findUnique({ where: { id: filtros.papelId } }) : null;
    const opcoes = usuario && usuario.perfil !== "ADMINISTRADOR" ? await opcoesRecursos(tx, tipo, (filtros.buscaRecurso ?? "").slice(0, 100)) : [];
    const rotulos = new Map<string, string>();
    for (const t of TIPOS_ESCOPO) {
      const ids = usuario?.regrasAcesso.filter(r => r.tipo === t).map(r => r.recursoId) ?? [];
      if (ids.length) for (const opcao of await opcoesRecursos(tx, t, "", ids)) rotulos.set(`${t}:${opcao.id}`, opcao.nome);
    }
    const eventos = await tx.eventoAcesso.findMany({ where: usuario ? { usuarioAlvoId: usuario.id } : {}, select: { id: true, autorId: true, usuarioAlvoId: true, tipo: true, motivo: true, criadoEm: true }, orderBy: { criadoEm: "desc" }, take: 20 });
    const nomes = await tx.usuario.findMany({ where: { id: { in: [...new Set(eventos.map(e => e.autorId))] } }, select: { id: true, nome: true } });
    return { usuarios, usuario, papeis, papel, tipo, opcoes, regras: usuario?.regrasAcesso.map(r => ({ ...r, rotulo: rotulos.get(`${r.tipo}:${r.recursoId}`) ?? "Cadastro removido ou indisponível — remova esta regra" })) ?? [], politica: usuario ? montarPolitica(usuario) : null, eventos: eventos.map(e => ({ ...e, autorNome: nomes.find(n => n.id === e.autorId)?.nome ?? "Administrador" })) };
  }, { maxWait: 10000, timeout: 30000 });
}
