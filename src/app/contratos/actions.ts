"use server";

/**
 * Server actions do módulo /contratos (cadastro do rent roll).
 * Contratos não são travados por fechamento — o travamento vale para
 * lançamentos de recebimento (módulo /recebimentos).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseBRL } from "@/lib/dominio/dinheiro";
import { normalizar, normalizarCpfCnpj } from "@/lib/dominio/normalizacao";
import { RE_DATA, STATUS_CONTRATO, TIPOS_UNIDADE } from "@/lib/consultas/locacao";

function campo(fd: FormData, nome: string): string {
  const v = fd.get(nome);
  return typeof v === "string" ? v.trim() : "";
}

function inteiroEntre(texto: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(texto)) return null;
  const n = Number(texto);
  return n >= min && n <= max ? n : null;
}

function dataOuNull(texto: string): string | null {
  return RE_DATA.test(texto) ? texto : null;
}

function revalidarContratos() {
  revalidatePath("/contratos", "layout");
  revalidatePath("/recebimentos");
}

/**
 * Resolve a unidade do formulário: nova unidade (identificação normalizada,
 * reaproveitando se já existir no empreendimento) tem prioridade sobre o select.
 */
async function resolverUnidade(fd: FormData): Promise<string | null> {
  const novaIdentificacao = normalizar(campo(fd, "novaUnidadeIdentificacao"));
  if (novaIdentificacao) {
    const empreendimentoId = campo(fd, "novaUnidadeEmpreendimentoId");
    if (!empreendimentoId) return null;
    const tipoInformado = campo(fd, "novaUnidadeTipo");
    const tipo = (TIPOS_UNIDADE as readonly string[]).includes(tipoInformado)
      ? tipoInformado
      : "residencial";
    const existente = await prisma.unidade.findUnique({
      where: {
        empreendimentoId_identificacao: {
          empreendimentoId,
          identificacao: novaIdentificacao,
        },
      },
    });
    if (existente) return existente.id;
    const criada = await prisma.unidade.create({
      data: { empreendimentoId, identificacao: novaIdentificacao, tipo },
    });
    return criada.id;
  }
  const unidadeId = campo(fd, "unidadeId");
  if (!unidadeId) return null;
  const unidade = await prisma.unidade.findUnique({ where: { id: unidadeId } });
  return unidade?.id ?? null;
}

/**
 * Resolve o locatário: novo locatário (se o nome foi preenchido) tem
 * prioridade; select vazio = desocupado (null).
 */
async function resolverLocatario(fd: FormData): Promise<string | null> {
  const novoNome = campo(fd, "novoLocatarioNome");
  if (novoNome) {
    const criado = await prisma.locatario.create({
      data: {
        nome: novoNome,
        nomeNorm: normalizar(novoNome),
        cpfCnpj: normalizarCpfCnpj(campo(fd, "novoLocatarioCpfCnpj")),
        contato: campo(fd, "novoLocatarioContato") || null,
      },
    });
    return criado.id;
  }
  return campo(fd, "locatarioId") || null;
}

function dadosComunsDoContrato(fd: FormData) {
  const statusInformado = campo(fd, "status");
  return {
    valorBase: parseBRL(campo(fd, "valorBase")) ?? 0,
    iptu: parseBRL(campo(fd, "iptu")) ?? 0,
    condominio: parseBRL(campo(fd, "condominio")) ?? 0,
    diaVencimento: inteiroEntre(campo(fd, "diaVencimento"), 1, 31),
    mesReajuste: inteiroEntre(campo(fd, "mesReajuste"), 1, 12),
    indiceReajuste: campo(fd, "indiceReajuste") || null,
    status: (STATUS_CONTRATO as readonly string[]).includes(statusInformado)
      ? statusInformado
      : "ativo",
    inicio: dataOuNull(campo(fd, "inicio")),
    fim: dataOuNull(campo(fd, "fim")),
    observacao: campo(fd, "observacao") || null,
  };
}

export async function criarContrato(formData: FormData): Promise<void> {
  const unidadeId = await resolverUnidade(formData);
  if (!unidadeId) {
    redirect(
      "/contratos/novo?erro=" +
        encodeURIComponent(
          "Selecione uma unidade existente ou informe empreendimento e identificação da nova unidade."
        )
    );
  }
  const locatarioId = await resolverLocatario(formData);
  const contrato = await prisma.contrato.create({
    data: { unidadeId, locatarioId, ...dadosComunsDoContrato(formData) },
  });
  revalidarContratos();
  redirect(`/contratos/${contrato.id}?ok=${encodeURIComponent("Contrato criado.")}`);
}

export async function atualizarContrato(formData: FormData): Promise<void> {
  const id = campo(formData, "id");
  const existente = id
    ? await prisma.contrato.findUnique({ where: { id } })
    : null;
  if (!existente) {
    redirect("/contratos?erro=" + encodeURIComponent("Contrato não encontrado."));
  }
  const unidadeId = await resolverUnidade(formData);
  if (!unidadeId) {
    redirect(
      `/contratos/${id}/editar?erro=` +
        encodeURIComponent("Selecione uma unidade válida para o contrato.")
    );
  }
  const locatarioId = await resolverLocatario(formData);
  await prisma.contrato.update({
    where: { id },
    data: { unidadeId, locatarioId, ...dadosComunsDoContrato(formData) },
  });
  revalidarContratos();
  redirect(`/contratos/${id}?ok=${encodeURIComponent("Contrato atualizado.")}`);
}

export async function encerrarContrato(formData: FormData): Promise<void> {
  const id = campo(formData, "id");
  const existente = id
    ? await prisma.contrato.findUnique({ where: { id } })
    : null;
  if (!existente) {
    redirect("/contratos?erro=" + encodeURIComponent("Contrato não encontrado."));
  }
  const fim = dataOuNull(campo(formData, "fim"));
  if (!fim) {
    redirect(
      `/contratos/${id}?encerrar=1&erro=` +
        encodeURIComponent("Informe a data de encerramento.")
    );
  }
  await prisma.contrato.update({
    where: { id },
    data: { status: "encerrado", fim },
  });
  revalidarContratos();
  redirect(`/contratos/${id}?ok=${encodeURIComponent("Contrato encerrado.")}`);
}
