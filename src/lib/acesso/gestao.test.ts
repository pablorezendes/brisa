import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consultarGestaoAcessos, gerirAcesso, type ComandoGestao } from "./gestao";

vi.mock("server-only", () => ({}));
vi.mock("../auth", () => ({ gerarHashSenha: () => "hash-de-teste-nao-e-senha" }));
let db: PrismaClient;
let diretorio: string;
const ator = { usuarioId: "admin", sessaoVersao: 0 };
const confirmado = { confirmado: true, motivo: "Revisão fictícia de responsabilidade." };
const salvar = (dados: Partial<Extract<ComandoGestao, { acao: "SALVAR_USUARIO" }>> = {}): ComandoGestao => ({ ...confirmado, acao: "SALVAR_USUARIO", usuarioId: "alvo", versao: 1, nome: "Usuário teste", perfil: "FINANCEIRO", acessoGlobal: false, papelAcessoId: null, permissoesExtras: [], permissoesNegadas: [], ...dados });
const regra = (dados: Partial<Extract<ComandoGestao, { acao: "SALVAR_REGRA" }>> = {}): ComandoGestao => ({ ...confirmado, acao: "SALVAR_REGRA", usuarioId: "alvo", versao: 1, tipo: "EMPREENDIMENTO", recursoId: "empreendimento-1", efeito: "PERMITIR", ...dados });
const novaFuncao = (dados: Partial<Extract<ComandoGestao, { acao: "SALVAR_FUNCAO" }>> = {}): ComandoGestao => ({ ...confirmado, acao: "SALVAR_FUNCAO", papelId: null, versao: 0, nome: "Assistente de cobrança", descricao: "Função de teste", permissoes: ["financeiro.ver"], ativo: true, ...dados });

beforeEach(async () => {
  diretorio = mkdtempSync(join(tmpdir(), "brisa-gestao-acessos-"));
  db = new PrismaClient({ datasourceUrl: `file:${join(diretorio, "fixture.db").replaceAll("\\", "/")}` });
  for (const ddl of [
    `CREATE TABLE Usuario (id TEXT PRIMARY KEY, nome TEXT NOT NULL, usuario TEXT NOT NULL UNIQUE, senhaHash TEXT NOT NULL, perfil TEXT NOT NULL DEFAULT 'CONSULTA', ativo BOOLEAN NOT NULL DEFAULT 1, acessoGlobal BOOLEAN NOT NULL DEFAULT 0, papelAcessoId TEXT, permissoesExtras TEXT NOT NULL DEFAULT '[]', permissoesNegadas TEXT NOT NULL DEFAULT '[]', acessoVersao INTEGER NOT NULL DEFAULT 1, sessaoVersao INTEGER NOT NULL DEFAULT 0, criadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE PapelAcesso (id TEXT PRIMARY KEY, nome TEXT NOT NULL UNIQUE, descricao TEXT NOT NULL DEFAULT '', permissoes TEXT NOT NULL DEFAULT '[]', ativo BOOLEAN NOT NULL DEFAULT 1, versao INTEGER NOT NULL DEFAULT 1, criadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, atualizadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE RegraAcesso (id TEXT PRIMARY KEY, usuarioId TEXT NOT NULL, tipo TEXT NOT NULL, recursoId TEXT NOT NULL, efeito TEXT NOT NULL, UNIQUE(usuarioId,tipo,recursoId))`,
    `CREATE TABLE EventoAcesso (id TEXT PRIMARY KEY, autorId TEXT NOT NULL, usuarioAlvoId TEXT, tipo TEXT NOT NULL, antes TEXT NOT NULL DEFAULT '{}', depois TEXT NOT NULL DEFAULT '{}', motivo TEXT NOT NULL, criadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE Empreendimento (id TEXT PRIMARY KEY, nome TEXT NOT NULL, ativo BOOLEAN NOT NULL DEFAULT 1)`,
    `CREATE TABLE Unidade (id TEXT PRIMARY KEY, empreendimentoId TEXT NOT NULL, identificacao TEXT NOT NULL, tipo TEXT NOT NULL DEFAULT 'residencial', ativo BOOLEAN NOT NULL DEFAULT 1)`,
    `CREATE TABLE Locatario (id TEXT PRIMARY KEY, nome TEXT NOT NULL)`,
    `CREATE TABLE Pessoa (id TEXT PRIMARY KEY, nome TEXT NOT NULL, cpfCnpj TEXT)`,
    `CREATE TABLE ImovelLegado (id TEXT PRIMARY KEY, nome TEXT, referencia TEXT)`,
  ]) await db.$executeRawUnsafe(ddl);
  await db.usuario.createMany({ data: [{ id: "admin", nome: "Admin teste", usuario: "admin", perfil: "ADMINISTRADOR", acessoGlobal: true, senhaHash: "segredo-hash-exclusivo" }, { id: "alvo", nome: "Usuário teste", usuario: "alvo", perfil: "FINANCEIRO", senhaHash: "segredo-hash-exclusivo" }] });
  await db.empreendimento.create({ data: { id: "empreendimento-1", nome: "Empreendimento fictício" } });
});

afterEach(async () => {
  await db.$disconnect();
  const alvo = resolve(diretorio);
  if (alvo.toLowerCase().startsWith(`${resolve(tmpdir())}${sep}`.toLowerCase()) && basename(alvo).startsWith("brisa-gestao-acessos-")) rmSync(alvo, { recursive: true, force: true });
});

describe("gestão transacional de acessos", () => {
  it("cria usuário sem carteira liberada e sem segredo no evento", async () => {
    const senha = "Senha-de-teste-super-secreta";
    const criado = await gerirAcesso(db, ator, { ...confirmado, acao: "CRIAR_USUARIO", nome: "Nova pessoa", login: "Pessoa.Teste", senha, perfil: "CONSULTA" });
    const usuario = await db.usuario.findUniqueOrThrow({ where: { id: criado.usuarioId } });
    expect(usuario).toMatchObject({ usuario: "pessoa.teste", ativo: true, acessoGlobal: false, perfil: "CONSULTA" });
    const eventos = JSON.stringify(await db.eventoAcesso.findMany());
    expect(eventos).not.toContain(senha);
    expect(eventos).not.toContain("senhaHash");
    expect(eventos).not.toContain("hash-de-teste");
  });

  it("rejeita login duplicado e senha fraca sem escrita", async () => {
    const comando = { ...confirmado, acao: "CRIAR_USUARIO" as const, nome: "Nova pessoa", login: "alvo", senha: "Senha-teste-longa", perfil: "CONSULTA" };
    await expect(gerirAcesso(db, ator, comando)).rejects.toMatchObject({ codigo: "LOGIN_EXISTENTE" });
    await expect(gerirAcesso(db, ator, { ...comando, login: "novo", senha: "curta" })).rejects.toMatchObject({ codigo: "SENHA_INVALIDA" });
    expect(await db.usuario.count()).toBe(2);
    expect(await db.eventoAcesso.count()).toBe(0);
  });

  it("confirmação e justificativa são obrigatórias", async () => {
    await expect(gerirAcesso(db, ator, salvar({ confirmado: false }))).rejects.toMatchObject({ codigo: "CONFIRMACAO_OBRIGATORIA" });
    await expect(gerirAcesso(db, ator, salvar({ motivo: "" }))).rejects.toMatchObject({ codigo: "CAMPO_INVALIDO" });
  });

  it.each([{ usuarioId: "alvo", sessaoVersao: 0 }, { usuarioId: "admin", sessaoVersao: 5 }, { usuarioId: "inexistente", sessaoVersao: 0 }])("revalida administrador e sessão dentro da transação: %j", async autor => {
    await expect(gerirAcesso(db, autor, salvar())).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    expect(await db.eventoAcesso.count()).toBe(0);
  });

  it("administrador desativado não consegue efetuar nova alteração", async () => {
    await db.usuario.update({ where: { id: "admin" }, data: { ativo: false } });
    await expect(gerirAcesso(db, ator, salvar())).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
  });

  it("não permite alterar próprio perfil, status ou senha", async () => {
    const comandos: ComandoGestao[] = [salvar({ usuarioId: "admin" }), { ...confirmado, acao: "ALTERAR_STATUS", usuarioId: "admin", versao: 1, ativo: false }, { ...confirmado, acao: "REDEFINIR_SENHA", usuarioId: "admin", versao: 1, senha: "Senha-longa-teste" }];
    for (const comando of comandos) await expect(gerirAcesso(db, ator, comando)).rejects.toMatchObject({ codigo: "PROPRIO_ACESSO" });
    expect(await db.usuario.count({ where: { perfil: "ADMINISTRADOR", ativo: true } })).toBe(1);
  });

  it("mudança revoga sessões, audita e impede salvar versão antiga", async () => {
    await gerirAcesso(db, ator, salvar({ permissoesExtras: ["recebimentos.editar"] }));
    const u = await db.usuario.findUniqueOrThrow({ where: { id: "alvo" } });
    expect(u).toMatchObject({ acessoVersao: 2, sessaoVersao: 1 });
    expect(JSON.parse(u.permissoesExtras)).toEqual(["recebimentos.editar"]);
    await expect(gerirAcesso(db, ator, salvar())).rejects.toMatchObject({ codigo: "VERSAO_ALTERADA" });
    expect(await db.eventoAcesso.count()).toBe(1);
  });

  it.each(["SOCIO", "CONTABILIDADE", "CONSULTA"])("%s nunca recebe edição direta", async perfil => {
    await expect(gerirAcesso(db, ator, salvar({ perfil, permissoesExtras: ["caixa.editar"] }))).rejects.toMatchObject({ codigo: "SOMENTE_LEITURA" });
  });

  it("não aceita permissões reservadas, desconhecidas ou conflitantes", async () => {
    await expect(gerirAcesso(db, ator, salvar({ permissoesExtras: ["comissoes.ver"] }))).rejects.toMatchObject({ codigo: "PERMISSAO_RESTRITA" });
    await expect(gerirAcesso(db, ator, salvar({ permissoesExtras: ["tudo.admin"] }))).rejects.toMatchObject({ codigo: "PERMISSAO_INVALIDA" });
    await expect(gerirAcesso(db, ator, salvar({ permissoesExtras: ["financeiro.ver"], permissoesNegadas: ["financeiro.ver"] }))).rejects.toMatchObject({ codigo: "PERMISSOES_CONFLITANTES" });
  });

  it("administrador não ganha configuração restritiva ilusória", async () => {
    await expect(gerirAcesso(db, ator, salvar({ perfil: "ADMINISTRADOR", acessoGlobal: false }))).rejects.toMatchObject({ codigo: "ADMIN_GLOBAL" });
    await gerirAcesso(db, ator, salvar({ perfil: "ADMINISTRADOR", acessoGlobal: true }));
    await expect(gerirAcesso(db, ator, regra({ versao: 2 }))).rejects.toMatchObject({ codigo: "ADMIN_GLOBAL" });
  });

  it("regra valida tipo e cadastro, respeita versão e mantém trilha ao remover", async () => {
    await expect(gerirAcesso(db, ator, regra({ tipo: "UNIDADE" }))).rejects.toMatchObject({ codigo: "RECURSO_AUSENTE" });
    await expect(gerirAcesso(db, ator, regra({ tipo: "QUALQUER" }))).rejects.toMatchObject({ codigo: "REGRA_INVALIDA" });
    await gerirAcesso(db, ator, regra());
    await gerirAcesso(db, ator, regra({ versao: 2, efeito: "BLOQUEAR" }));
    expect(await db.regraAcesso.count()).toBe(1);
    const atual = await db.regraAcesso.findFirstOrThrow();
    expect(atual.efeito).toBe("BLOQUEAR");
    await gerirAcesso(db, ator, { ...confirmado, acao: "REMOVER_REGRA", usuarioId: "alvo", versao: 3, regraId: atual.id });
    expect(await db.regraAcesso.count()).toBe(0);
    expect(await db.empreendimento.count()).toBe(1);
    expect(await db.eventoAcesso.count()).toBe(3);
  });

  it("não remove regra de outro usuário nem promove admin ignorando carteira existente", async () => {
    await gerirAcesso(db, ator, regra());
    await expect(gerirAcesso(db, ator, salvar({ versao: 2, perfil: "ADMINISTRADOR", acessoGlobal: true }))).rejects.toMatchObject({ codigo: "ADMIN_COM_REGRAS" });
    await expect(gerirAcesso(db, ator, { ...confirmado, acao: "REMOVER_REGRA", usuarioId: "alvo", versao: 2, regraId: "outra" })).rejects.toMatchObject({ codigo: "REGRA_AUSENTE" });
    expect(await db.regraAcesso.count()).toBe(1);
  });

  it("inativação e reativação preservam usuário e encerram sessões", async () => {
    await gerirAcesso(db, ator, { ...confirmado, acao: "ALTERAR_STATUS", usuarioId: "alvo", versao: 1, ativo: false });
    await expect(gerirAcesso(db, ator, { ...confirmado, acao: "ALTERAR_STATUS", usuarioId: "alvo", versao: 2, ativo: false })).rejects.toMatchObject({ codigo: "ESTADO_IGUAL" });
    await gerirAcesso(db, ator, { ...confirmado, acao: "ALTERAR_STATUS", usuarioId: "alvo", versao: 2, ativo: true });
    expect(await db.usuario.findUniqueOrThrow({ where: { id: "alvo" } })).toMatchObject({ ativo: true, acessoVersao: 3, sessaoVersao: 2 });
    expect(await db.usuario.count()).toBe(2);
  });

  it("reset nunca inclui a senha nem hash no histórico", async () => {
    const senha = "Senha-que-nao-pode-ir-para-log";
    await gerirAcesso(db, ator, { ...confirmado, acao: "REDEFINIR_SENHA", usuarioId: "alvo", versao: 1, senha });
    const audit = JSON.stringify(await db.eventoAcesso.findMany());
    expect(audit).not.toContain(senha);
    expect(audit).not.toContain("hash-de-teste");
    expect(audit).not.toContain("senhaHash");
    expect(await db.usuario.findUniqueOrThrow({ where: { id: "alvo" } })).toMatchObject({ acessoVersao: 2, sessaoVersao: 1 });
  });

  it("função é única e alterações revogam sessões dos associados", async () => {
    const resultado = await gerirAcesso(db, ator, novaFuncao());
    await gerirAcesso(db, ator, salvar({ papelAcessoId: resultado.papelId! }));
    await gerirAcesso(db, ator, novaFuncao({ papelId: resultado.papelId!, versao: 1, ativo: false }));
    const u = await db.usuario.findUniqueOrThrow({ where: { id: "alvo" } });
    expect(u).toMatchObject({ acessoVersao: 3, sessaoVersao: 2, papelAcessoId: resultado.papelId });
    await expect(gerirAcesso(db, ator, novaFuncao({ papelId: resultado.papelId!, versao: 1 }))).rejects.toMatchObject({ codigo: "VERSAO_ALTERADA" });
    await expect(gerirAcesso(db, ator, salvar({ versao: 3, papelAcessoId: resultado.papelId! }))).rejects.toMatchObject({ codigo: "FUNCAO_INATIVA" });
  });

  it("função não contorna perfil contabilidade, nem ao editar usuários já associados", async () => {
    const resultado = await gerirAcesso(db, ator, novaFuncao());
    await gerirAcesso(db, ator, salvar({ perfil: "CONTABILIDADE", papelAcessoId: resultado.papelId! }));
    await expect(gerirAcesso(db, ator, novaFuncao({ papelId: resultado.papelId!, versao: 1, permissoes: ["caixa.editar"] }))).rejects.toMatchObject({ codigo: "SOMENTE_LEITURA" });
    expect(await db.papelAcesso.findUniqueOrThrow({ where: { id: resultado.papelId! } })).toMatchObject({ versao: 1, permissoes: '["financeiro.ver"]' });
  });

  it("consulta administrativa exige admin e não entrega senha/hash nem dados financeiros", async () => {
    await expect(consultarGestaoAcessos(db, { usuarioId: "alvo", sessaoVersao: 0 })).rejects.toMatchObject({ codigo: "SEM_PERMISSAO" });
    await gerirAcesso(db, ator, regra());
    const dto = await consultarGestaoAcessos(db, ator, { usuarioId: "alvo" });
    expect(dto.opcoes).toEqual([{ id: "empreendimento-1", nome: "Empreendimento fictício" }]);
    expect(dto.regras[0].rotulo).toBe("Empreendimento fictício");
    expect(JSON.stringify(dto)).not.toMatch(/senhaHash|segredo-hash-exclusivo|cpfCnpj/);
  });
});
