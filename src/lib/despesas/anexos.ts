import "server-only";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { carteiraIrrestrita, montarPolitica, perfilSomenteLeitura, pode, type PoliticaAcesso } from "../acesso/politica";

export const LIMITE_ANEXO_DESPESA = 5 * 1024 * 1024;
const MAX_ANEXOS = 10;
type Banco = PrismaClient | Prisma.TransactionClient;
const metadados = { id: true, nomeOriginal: true, mimeType: true, tamanho: true } as const;

/** Arquivos ficam no SQLite privado/backup, nunca em public/ nem no repositório. */
export function validarArquivoDespesa(nome: string, mimeType: string, conteudo: Uint8Array) {
  if (!conteudo.byteLength || conteudo.byteLength > LIMITE_ANEXO_DESPESA) throw new Error("Envie um arquivo de até 5 MB.");
  const inicio = Buffer.from(conteudo.subarray(0, 16));
  const tipo = inicio.subarray(0, 5).toString("ascii") === "%PDF-" ? "application/pdf"
    : inicio.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
    : inicio[0] === 255 && inicio[1] === 216 && inicio[2] === 255 ? "image/jpeg" : null;
  if (!tipo || tipo !== mimeType) throw new Error("Formato inválido. Use PDF, JPEG ou PNG.");
  const nomeOriginal = nome.replaceAll("\\", "/").split("/").pop()!.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160).trim();
  if (!nomeOriginal) throw new Error("Informe o nome do arquivo.");
  return { nomeOriginal, mimeType: tipo, tamanho: conteudo.byteLength, hash: createHash("sha256").update(conteudo).digest("hex") };
}

async function autorizar(db: Banco, usuarioId: string, escrita: boolean) {
  const usuario = await db.usuario.findUnique({ where: { id: usuarioId }, select: {
    id: true, perfil: true, ativo: true, acessoGlobal: true, permissoesExtras: true, permissoesNegadas: true,
    papelAcesso: { select: { ativo: true, permissoes: true } }, regrasAcesso: { select: { tipo: true, recursoId: true, efeito: true } },
  } });
  const politica = usuario && montarPolitica(usuario);
  if (!politica || !carteiraIrrestrita(politica) || perfilSomenteLeitura(politica) || !pode(politica, "despesas.ver") || (escrita && !pode(politica, "despesas.editar"))) throw new Error("Sem permissão para acessar documentos completos de despesas.");
  return politica;
}

async function exigirDocumento(db: Banco, despesaId: string, politica: PoliticaAcesso) {
  if (!despesaId || despesaId.length > 100) throw new Error("Despesa não encontrada.");
  const despesa = await db.despesaDocumento.findUnique({ where: { id: despesaId }, select: { id: true, origemChave: true, restrita: true,
    rateios: { select: { categoria: true, descricao: true } } } });
  if (!despesa) throw new Error("Despesa não encontrada.");
  const chave = despesa.origemChave ?? `BRISA:PAGAR:${despesa.id}`;
  const excluido = await db.recursoGovernado.findFirst({ where: { tipo: "TITULO", origemId: chave, status: { not: "ATIVO" } }, select: { id: true } });
  if (excluido) throw new Error("Restaure a despesa na lixeira antes de acessar seus anexos.");
  // Um PDF integral pode revelar todas as parcelas. Não basta esconder a
  // comissão no agregado da carteira e deixar o documento aberto por outro ID.
  if (!pode(politica, "comissoes.ver")) {
    const origemId = despesa.origemChave && /^WIDESYS:PAGAR:([^:]+)$/.exec(despesa.origemChave)?.[1];
    const fonte = origemId ? await db.tituloFinanceiroLegado.findUnique({ where: { id: origemId }, select: { planoContaRotulo: true, tipoCobrancaRotulo: true } }) : null;
    const restrito = /comiss|corretagem|honor[aá]rio|taxa de administra/i;
    if (despesa.restrita || despesa.rateios.some(r => restrito.test(`${r.categoria ?? ""} ${r.descricao}`)) || restrito.test(`${fonte?.planoContaRotulo ?? ""} ${fonte?.tipoCobrancaRotulo ?? ""}`)) throw new Error("Este documento contém informação restrita ao administrador.");
  }
}

export async function listarAnexosDespesa(db: Banco, despesaId: string, usuarioId: string) {
  const politica = await autorizar(db, usuarioId, false);
  await exigirDocumento(db, despesaId, politica);
  return db.despesaAnexo.findMany({ where: { despesaId }, select: metadados, orderBy: { criadoEm: "asc" }, take: MAX_ANEXOS });
}

export async function lerAnexoDespesa(db: Banco, id: string, usuarioId: string) {
  const politica = await autorizar(db, usuarioId, false);
  if (!id || id.length > 100) throw new Error("Anexo não encontrado.");
  const meta = await db.despesaAnexo.findUnique({ where: { id }, select: { despesaId: true } });
  if (!meta) throw new Error("Anexo não encontrado.");
  await exigirDocumento(db, meta.despesaId, politica);
  return db.despesaAnexo.findUniqueOrThrow({ where: { id }, select: { ...metadados, conteudo: true } });
}

export async function salvarAnexoDespesa(db: PrismaClient, despesaId: string, usuarioId: string, arquivo: { nome: string; mimeType: string; conteudo: Uint8Array }) {
  await autorizar(db, usuarioId, true);
  const dados = validarArquivoDespesa(arquivo.nome, arquivo.mimeType, arquivo.conteudo);
  return db.$transaction(async tx => {
    const politica = await autorizar(tx, usuarioId, true);
    await exigirDocumento(tx, despesaId, politica);
    const existente = await tx.despesaAnexo.findUnique({ where: { despesaId_hash: { despesaId, hash: dados.hash } }, select: metadados });
    if (existente) return existente;
    if (await tx.despesaAnexo.count({ where: { despesaId } }) >= MAX_ANEXOS) throw new Error("Esta despesa já possui 10 anexos.");
    return tx.despesaAnexo.create({ data: { ...dados, despesaId, criadoPorId: usuarioId, conteudo: Buffer.from(arquivo.conteudo) }, select: metadados });
  });
}
