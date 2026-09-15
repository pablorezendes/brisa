"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { exigirSessao } from "@/lib/auth";
import { normalizar, normalizarCpfCnpj } from "@/lib/dominio/normalizacao";
import { TIPOS_UNIDADE } from "@/lib/consultas/locacao";

type Aviso = { ok?: string; erro?: string; editar?: string };

const ROTAS = {
  empreendimentos: "/cadastros/empreendimentos",
  unidades: "/cadastros/unidades",
  locatarios: "/cadastros/locatarios",
} as const;

function campo(formData: FormData, nome: string): string {
  const valor = formData.get(nome);
  return typeof valor === "string" ? valor.trim() : "";
}

function voltar(rota: string, aviso: Aviso): never {
  const params = new URLSearchParams();
  if (aviso.ok) params.set("ok", aviso.ok);
  if (aviso.erro) params.set("erro", aviso.erro);
  if (aviso.editar) params.set("editar", aviso.editar);
  redirect(`${rota}?${params.toString()}`);
}

function erroDeUnicidade(erro: unknown): boolean {
  return Boolean(
    erro &&
      typeof erro === "object" &&
      "code" in erro &&
      (erro as { code?: string }).code === "P2002",
  );
}

function revalidarCadastros(...rotasRelacionadas: string[]) {
  revalidatePath("/cadastros", "layout");
  for (const rota of rotasRelacionadas) revalidatePath(rota);
}

function nomeValido(valor: string, maximo: number): string | null {
  const limpo = valor.replace(/\s+/g, " ").trim();
  return limpo.length > 0 && limpo.length <= maximo ? limpo : null;
}

// ---------------------------------------------------------------------------
// Empreendimentos
// ---------------------------------------------------------------------------

export async function criarEmpreendimento(formData: FormData): Promise<void> {
  await exigirSessao();
  const nomeInformado = nomeValido(campo(formData, "nome"), 120);
  if (!nomeInformado) {
    voltar(ROTAS.empreendimentos, {
      erro: "Informe um nome de empreendimento com até 120 caracteres.",
    });
  }

  const nome = normalizar(nomeInformado);
  try {
    await prisma.empreendimento.create({ data: { nome } });
  } catch (erro) {
    voltar(ROTAS.empreendimentos, {
      erro: erroDeUnicidade(erro)
        ? "Já existe um empreendimento com esse nome."
        : "Não foi possível cadastrar o empreendimento.",
    });
  }

  revalidarCadastros("/contratos", "/paineis/empreendimentos", "/executivo");
  voltar(ROTAS.empreendimentos, { ok: "Empreendimento cadastrado." });
}

export async function atualizarEmpreendimento(formData: FormData): Promise<void> {
  await exigirSessao();
  const id = campo(formData, "id");
  const nomeInformado = nomeValido(campo(formData, "nome"), 120);
  if (!id || !nomeInformado) {
    voltar(ROTAS.empreendimentos, {
      erro: "Informe um empreendimento e um nome válido.",
      editar: id || undefined,
    });
  }

  const existente = await prisma.empreendimento.findUnique({ where: { id } });
  if (!existente) {
    voltar(ROTAS.empreendimentos, { erro: "Empreendimento não encontrado." });
  }

  try {
    await prisma.empreendimento.update({
      where: { id },
      data: { nome: normalizar(nomeInformado) },
    });
  } catch (erro) {
    voltar(ROTAS.empreendimentos, {
      erro: erroDeUnicidade(erro)
        ? "Já existe outro empreendimento com esse nome."
        : "Não foi possível atualizar o empreendimento.",
      editar: id,
    });
  }

  revalidarCadastros("/contratos", "/recebimentos", "/paineis/empreendimentos", "/executivo");
  voltar(ROTAS.empreendimentos, { ok: "Empreendimento atualizado." });
}

export async function definirStatusEmpreendimento(formData: FormData): Promise<void> {
  await exigirSessao();
  const id = campo(formData, "id");
  const ativo = campo(formData, "ativo");
  if (!id || (ativo !== "0" && ativo !== "1")) {
    voltar(ROTAS.empreendimentos, { erro: "Solicitação de status inválida." });
  }

  const existente = await prisma.empreendimento.findUnique({
    where: { id },
    include: {
      unidades: {
        where: { ativo: true },
        select: { id: true },
      },
    },
  });
  if (!existente) {
    voltar(ROTAS.empreendimentos, { erro: "Empreendimento não encontrado." });
  }

  const novoStatus = ativo === "1";
  if (!novoStatus && existente.unidades.length > 0) {
    voltar(ROTAS.empreendimentos, {
      erro: "Desative primeiro os imóveis sem uso. Empreendimentos com imóveis ativos precisam permanecer ativos para preservar os vínculos.",
    });
  }
  await prisma.empreendimento.update({ where: { id }, data: { ativo: novoStatus } });
  revalidarCadastros("/contratos", "/paineis/empreendimentos", "/executivo");
  voltar(ROTAS.empreendimentos, {
    ok: novoStatus ? "Empreendimento reativado." : "Empreendimento desativado.",
  });
}

// ---------------------------------------------------------------------------
// Unidades / imóveis
// ---------------------------------------------------------------------------

function tipoUnidadeValido(valor: string): valor is (typeof TIPOS_UNIDADE)[number] {
  return (TIPOS_UNIDADE as readonly string[]).includes(valor);
}

async function validarDadosUnidade(
  formData: FormData,
  empreendimentoAtualId?: string,
): Promise<
  | { empreendimentoId: string; identificacao: string; tipo: string }
  | { erro: string }
> {
  const empreendimentoId = campo(formData, "empreendimentoId");
  const identificacaoInformada = nomeValido(campo(formData, "identificacao"), 120);
  const tipo = campo(formData, "tipo");
  if (!empreendimentoId) return { erro: "Selecione o empreendimento." };
  if (!identificacaoInformada) {
    return { erro: "Informe uma identificação com até 120 caracteres." };
  }
  if (!tipoUnidadeValido(tipo)) return { erro: "Selecione um tipo de imóvel válido." };

  const empreendimento = await prisma.empreendimento.findUnique({
    where: { id: empreendimentoId },
    select: { id: true, ativo: true },
  });
  if (!empreendimento) return { erro: "Empreendimento não encontrado." };
  if (!empreendimento.ativo && empreendimento.id !== empreendimentoAtualId) {
    return { erro: "Selecione um empreendimento ativo para o imóvel." };
  }

  return {
    empreendimentoId,
    identificacao: normalizar(identificacaoInformada),
    tipo,
  };
}

export async function criarUnidade(formData: FormData): Promise<void> {
  await exigirSessao();
  const validacao = await validarDadosUnidade(formData);
  if ("erro" in validacao) voltar(ROTAS.unidades, { erro: validacao.erro });

  try {
    await prisma.unidade.create({ data: validacao });
  } catch (erro) {
    voltar(ROTAS.unidades, {
      erro: erroDeUnicidade(erro)
        ? "Essa identificação já existe no empreendimento selecionado."
        : "Não foi possível cadastrar o imóvel.",
    });
  }

  revalidarCadastros("/contratos", "/paineis/empreendimentos", "/executivo");
  voltar(ROTAS.unidades, { ok: "Imóvel cadastrado." });
}

export async function atualizarUnidade(formData: FormData): Promise<void> {
  await exigirSessao();
  const id = campo(formData, "id");
  if (!id) voltar(ROTAS.unidades, { erro: "Imóvel não informado." });

  const existente = await prisma.unidade.findUnique({
    where: { id },
    include: { _count: { select: { contratos: true } } },
  });
  if (!existente) voltar(ROTAS.unidades, { erro: "Imóvel não encontrado." });

  const validacao = await validarDadosUnidade(formData, existente.empreendimentoId);
  if ("erro" in validacao) {
    voltar(ROTAS.unidades, { erro: validacao.erro, editar: id });
  }
  if (
    existente.empreendimentoId !== validacao.empreendimentoId &&
    existente._count.contratos > 0
  ) {
    voltar(ROTAS.unidades, {
      erro: "Um imóvel com contratos não pode ser movido para outro empreendimento. Crie um novo cadastro para preservar o histórico.",
      editar: id,
    });
  }

  try {
    await prisma.unidade.update({ where: { id }, data: validacao });
  } catch (erro) {
    voltar(ROTAS.unidades, {
      erro: erroDeUnicidade(erro)
        ? "Essa identificação já existe no empreendimento selecionado."
        : "Não foi possível atualizar o imóvel.",
      editar: id,
    });
  }

  revalidarCadastros("/contratos", "/recebimentos", "/paineis/empreendimentos", "/executivo");
  voltar(ROTAS.unidades, { ok: "Imóvel atualizado." });
}

export async function definirStatusUnidade(formData: FormData): Promise<void> {
  await exigirSessao();
  const id = campo(formData, "id");
  const ativo = campo(formData, "ativo");
  if (!id || (ativo !== "0" && ativo !== "1")) {
    voltar(ROTAS.unidades, { erro: "Solicitação de status inválida." });
  }

  const existente = await prisma.unidade.findUnique({
    where: { id },
    include: { _count: { select: { contratos: true } } },
  });
  if (!existente) voltar(ROTAS.unidades, { erro: "Imóvel não encontrado." });

  const novoStatus = ativo === "1";
  if (!novoStatus && existente._count.contratos > 0) {
    voltar(ROTAS.unidades, {
      erro: "Este imóvel possui histórico de contratos e não pode ser desativado. Corrija o contrato ou mantenha o cadastro ativo.",
    });
  }
  await prisma.unidade.update({ where: { id }, data: { ativo: novoStatus } });
  revalidarCadastros("/contratos", "/paineis/empreendimentos", "/executivo");
  voltar(ROTAS.unidades, {
    ok: novoStatus ? "Imóvel reativado." : "Imóvel desativado para novos vínculos.",
  });
}

// ---------------------------------------------------------------------------
// Locatários
// ---------------------------------------------------------------------------

function validarCpfCnpj(valor: string): { valor: string | null; erro?: string } {
  const normalizado = normalizarCpfCnpj(valor);
  if (normalizado && normalizado.length !== 11 && normalizado.length !== 14) {
    return { valor: normalizado, erro: "CPF deve ter 11 dígitos e CNPJ, 14 dígitos." };
  }
  return { valor: normalizado };
}

async function cpfJaUsado(cpfCnpj: string, ignorarId?: string): Promise<boolean> {
  const existente = await prisma.locatario.findFirst({
    where: {
      cpfCnpj,
      ...(ignorarId ? { id: { not: ignorarId } } : {}),
    },
    select: { id: true },
  });
  return existente !== null;
}

export async function criarLocatario(formData: FormData): Promise<void> {
  await exigirSessao();
  const nome = nomeValido(campo(formData, "nome"), 160);
  const contato = nomeValido(campo(formData, "contato"), 200);
  const cpf = validarCpfCnpj(campo(formData, "cpfCnpj"));

  if (!nome) {
    voltar(ROTAS.locatarios, { erro: "Informe o nome do inquilino com até 160 caracteres." });
  }
  if (campo(formData, "contato") && !contato) {
    voltar(ROTAS.locatarios, { erro: "O contato deve ter até 200 caracteres." });
  }
  if (cpf.erro) voltar(ROTAS.locatarios, { erro: cpf.erro });
  if (cpf.valor && (await cpfJaUsado(cpf.valor))) {
    voltar(ROTAS.locatarios, { erro: "Já existe um inquilino com esse CPF/CNPJ." });
  }

  try {
    await prisma.locatario.create({
      data: {
        nome,
        nomeNorm: normalizar(nome),
        cpfCnpj: cpf.valor,
        contato,
      },
    });
  } catch {
    voltar(ROTAS.locatarios, { erro: "Não foi possível cadastrar o inquilino." });
  }

  revalidarCadastros("/contratos", "/recebimentos", "/paineis/empreendimentos");
  voltar(ROTAS.locatarios, { ok: "Inquilino cadastrado." });
}

export async function atualizarLocatario(formData: FormData): Promise<void> {
  await exigirSessao();
  const id = campo(formData, "id");
  const nome = nomeValido(campo(formData, "nome"), 160);
  const contatoInformado = campo(formData, "contato");
  const contato = nomeValido(contatoInformado, 200);
  const cpf = validarCpfCnpj(campo(formData, "cpfCnpj"));

  if (!id || !nome) {
    voltar(ROTAS.locatarios, {
      erro: "Informe o inquilino e um nome válido.",
      editar: id || undefined,
    });
  }
  if (contatoInformado && !contato) {
    voltar(ROTAS.locatarios, { erro: "O contato deve ter até 200 caracteres.", editar: id });
  }
  if (cpf.erro) voltar(ROTAS.locatarios, { erro: cpf.erro, editar: id });

  const existente = await prisma.locatario.findUnique({ where: { id } });
  if (!existente) voltar(ROTAS.locatarios, { erro: "Inquilino não encontrado." });
  if (cpf.valor && (await cpfJaUsado(cpf.valor, id))) {
    voltar(ROTAS.locatarios, {
      erro: "Já existe outro inquilino com esse CPF/CNPJ.",
      editar: id,
    });
  }

  try {
    await prisma.locatario.update({
      where: { id },
      data: {
        nome,
        nomeNorm: normalizar(nome),
        cpfCnpj: cpf.valor,
        contato,
      },
    });
  } catch {
    voltar(ROTAS.locatarios, {
      erro: "Não foi possível atualizar o inquilino.",
      editar: id,
    });
  }

  revalidarCadastros("/contratos", "/recebimentos", "/paineis/empreendimentos", "/executivo");
  voltar(ROTAS.locatarios, { ok: "Inquilino atualizado." });
}
