import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { carteiraIrrestrita, montarPolitica, perfilSomenteLeitura, pode } from "../acesso/politica";
import { normalizar } from "../dominio/normalizacao";
import { filtroGovernanca, recursoEstaAtivo } from "../governanca/filtros";
import { ErroFornecedor, type FiltrosFornecedores, type FornecedorCadastro, type FornecedorResumo, type ListaFornecedores, type SalvarFornecedorEntrada } from "./tipos";

type Tx = Prisma.TransactionClient;
type Ator = { id: string };
const resumo = { id: true, nome: true, cpfCnpj: true, origem: true, ativo: true } satisfies Prisma.PessoaSelect;
const cadastro = { ...resumo, atualizadoEm: true, emails: { orderBy: [{ principal: "desc" as const }, { ordem: "asc" as const }], take: 1, select: { email: true } }, telefones: { orderBy: [{ principal: "desc" as const }, { ordem: "asc" as const }], take: 1, select: { telefone: true } } } satisfies Prisma.PessoaSelect;
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const serializar = (p: Prisma.PessoaGetPayload<{ select: typeof cadastro }>): FornecedorCadastro => ({ id: p.id, nome: p.nome, cpfCnpj: p.cpfCnpj, origem: p.origem, ativo: p.ativo, email: p.emails[0]?.email ?? null, telefone: p.telefones[0]?.telefone ?? null, atualizadoEm: p.atualizadoEm.toISOString(), editavel: p.origem === "BRISA" });
async function autorizar(tx: Tx, ator: Ator, editar = false) {
  const u = await tx.usuario.findUnique({ where: { id: ator.id }, select: { id: true, perfil: true, ativo: true, acessoGlobal: true, permissoesExtras: true, permissoesNegadas: true, papelAcesso: { select: { ativo: true, permissoes: true } }, regrasAcesso: { select: { tipo: true, recursoId: true, efeito: true } } } });
  const p = u ? montarPolitica(u) : null;
  if (!p || !carteiraIrrestrita(p) || perfilSomenteLeitura(p) || !pode(p, "cadastros.ver") || !pode(p, "cadastros.sensiveis") || (editar && !pode(p, "cadastros.editar"))) throw new ErroFornecedor("SEM_PERMISSAO", "Você não tem permissão para acessar este cadastro de fornecedores.");
  return p;
}
function texto(v: unknown, max: number, obrigatorio = false) {
  if (v == null && !obrigatorio) return null;
  if (typeof v !== "string" || v.trim().length > max || (obrigatorio && !v.trim())) throw new ErroFornecedor("CAMPO_INVALIDO", "Confira os campos informados.");
  return v.trim() || null;
}
function documento(v: unknown) {
  const t = texto(v, 30); if (!t) return null;
  const d = t.replace(/\D/g, "");
  if (!/^[\d.\-/\s]+$/.test(t) || ![11, 14].includes(d.length)) throw new ErroFornecedor("DOCUMENTO_INVALIDO", "Informe o CPF com 11 dígitos ou o CNPJ com 14 dígitos.");
  return d;
}
async function termoWhere(tx: Tx, termo?: string): Promise<Prisma.PessoaWhereInput> {
  const t = texto(termo, 120); if (!t) return {};
  const digitos = t.replace(/\D/g, "");
  const documentos = digitos.length >= 3 ? await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM Pessoa WHERE REPLACE(REPLACE(REPLACE(REPLACE(cpfCnpj, '.', ''), '-', ''), '/', ''), ' ', '') LIKE ${`%${digitos}%`}`) : [];
  return { OR: [{ nomeNorm: { contains: normalizar(t) } }, ...(documentos.length ? [{ id: { in: documentos.map(p => p.id) } }] : [])] };
}
async function duplicadas(tx: Tx, cpfCnpj: string, ignorar?: string): Promise<FornecedorResumo[]> {
  // Também compara os documentos formatados das capturas mais antigas.
  return tx.$queryRaw<FornecedorResumo[]>(Prisma.sql`SELECT id, nome, cpfCnpj, origem, ativo FROM Pessoa WHERE REPLACE(REPLACE(REPLACE(REPLACE(cpfCnpj, '.', ''), '-', ''), '/', ''), ' ', '') = ${cpfCnpj} AND id <> ${ignorar ?? ""} LIMIT 10`);
}
async function conferirDuplicadas(tx: Tx, cpfCnpj: string | null, ignorar?: string) {
  if (!cpfCnpj) return;
  const mesmas = await duplicadas(tx, cpfCnpj, ignorar);
  if (!mesmas.length) return;
  const visiveis = [];
  for (const p of mesmas) if (p.ativo && await recursoEstaAtivo(tx, "PESSOA", p.id)) visiveis.push({ ...p, ativo: Boolean(p.ativo) });
  throw new ErroFornecedor("DOCUMENTO_EXISTENTE", visiveis.length ? "Esse CPF/CNPJ já está cadastrado. Selecione a pessoa existente para usá-la como fornecedor, sem duplicar." : "Esse CPF/CNPJ pertence a um cadastro inativo ou excluído. Confira o cadastro ou a lixeira antes de continuar.", visiveis);
}

export async function listarFornecedores(db: PrismaClient, filtro: FiltrosFornecedores, ator: Ator): Promise<ListaFornecedores> {
  return db.$transaction(async tx => {
    const p = await autorizar(tx, ator);
    const where: Prisma.PessoaWhereInput = { ...await filtroGovernanca(tx, "PESSOA"), ...await termoWhere(tx, filtro.termo), papeis: { some: { papel: "FORNECEDOR" } }, ...(filtro.situacao === "TODOS" ? {} : { ativo: filtro.situacao !== "INATIVOS" }) };
    const total = await tx.pessoa.count({ where }); const paginas = Math.max(1, Math.ceil(total / 25));
    const pagina = Math.min(paginas, Math.max(1, Number.isSafeInteger(filtro.pagina) ? filtro.pagina! : 1));
    const itens = await tx.pessoa.findMany({ where, select: cadastro, orderBy: [{ nomeNorm: "asc" }, { id: "asc" }], take: 25, skip: (pagina - 1) * 25 });
    return { itens: itens.map(serializar), total, pagina, paginas, permiteEditar: pode(p, "cadastros.editar") };
  });
}
export async function buscaFornecedores(db: PrismaClient, filtro: { termo?: string; limite?: number; todasPessoas?: boolean }, ator: Ator): Promise<FornecedorResumo[]> {
  return db.$transaction(async tx => {
    await autorizar(tx, ator);
    const limite = Math.min(30, Math.max(1, Number.isSafeInteger(filtro.limite) ? filtro.limite! : 20));
    if (filtro.todasPessoas && !texto(filtro.termo, 120)) return [];
    return tx.pessoa.findMany({ where: { ...await filtroGovernanca(tx, "PESSOA"), ...await termoWhere(tx, filtro.termo), ativo: true, ...(filtro.todasPessoas ? {} : { papeis: { some: { papel: "FORNECEDOR" } } }) }, select: resumo, orderBy: [{ nomeNorm: "asc" }, { id: "asc" }], take: limite });
  });
}
/** Chamado pela transação de despesa após a autorização da própria despesa. */
export async function resolverFornecedorDespesa(tx: Tx, id: string): Promise<FornecedorResumo> {
  texto(id, 100, true);
  const p = await tx.pessoa.findFirst({ where: { id, ativo: true, papeis: { some: { papel: "FORNECEDOR" } } }, select: resumo });
  if (!p || !await recursoEstaAtivo(tx, "PESSOA", id)) throw new ErroFornecedor("FORNECEDOR_INDISPONIVEL", "Selecione um fornecedor ativo e disponível no cadastro.");
  return p;
}
export async function salvarFornecedor(db: PrismaClient, input: SalvarFornecedorEntrada, ator: Ator): Promise<FornecedorCadastro> {
  if (!input || !/^[a-zA-Z0-9_-]{16,100}$/.test(input.requestId)) throw new ErroFornecedor("REQUISICAO_INVALIDA", "Reabra o cadastro e tente novamente.");
  const nome = texto(input.nome, 250, true)!; const cpfCnpj = documento(input.cpfCnpj); const email = texto(input.email, 200)?.toLowerCase() ?? null;
  const telefone = texto(input.telefone, 40); const telefoneNorm = telefone?.replace(/\D/g, "") ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErroFornecedor("EMAIL_INVALIDO", "Confira o e-mail do fornecedor.");
  if (telefone && (!telefoneNorm || telefoneNorm.length < 8 || telefoneNorm.length > 15 || !/^[+()\d\s.-]+$/.test(telefone))) throw new ErroFornecedor("TELEFONE_INVALIDO", "Confira o telefone do fornecedor.");
  const id = input.id ? texto(input.id, 100, true)! : `fornecedor-${input.requestId}`;
  const dados = { nome, cpfCnpj, email, telefone };
  try {
    return await db.$transaction(async tx => {
      await autorizar(tx, ator, true);
      const atual = await tx.pessoa.findUnique({ where: { id } });
      if (input.id && !atual) throw new ErroFornecedor("NAO_ENCONTRADO", "O fornecedor não foi encontrado.");
      if (atual && !await recursoEstaAtivo(tx, "PESSOA", id)) throw new ErroFornecedor("INATIVO", "O cadastro foi excluído ou mesclado. Confira a lixeira.");
      if (atual?.origem !== "BRISA" && atual) throw new ErroFornecedor("ORIGEM_PROTEGIDA", "Os dados importados são preservados. Use o cadastro de origem para conferir este fornecedor.");
      if (atual && !input.id) {
        if (atual.snapshot !== JSON.stringify(dados)) throw new ErroFornecedor("REQUISICAO_REUTILIZADA", "Esta solicitação já foi usada. Reabra o cadastro.");
        return serializar(await tx.pessoa.findUniqueOrThrow({ where: { id }, select: cadastro }));
      }
      if (atual && (atual.atualizadoEm.toISOString() !== input.atualizadoEm || !await tx.pessoaPapel.count({ where: { pessoaId: id, papel: "FORNECEDOR" } }))) throw new ErroFornecedor("VERSAO_DESATUALIZADA", "O cadastro mudou. Atualize a lista antes de editar novamente.");
      await conferirDuplicadas(tx, cpfCnpj, id);
      const info = { nome, nomeNorm: normalizar(nome), cpfCnpj, tipoPessoa: cpfCnpj?.length === 14 ? "JURIDICA" : cpfCnpj?.length === 11 ? "FISICA" : "DESCONHECIDA", snapshot: JSON.stringify(dados), snapshotHash: hash(dados) };
      if (atual) await tx.pessoa.update({ where: { id }, data: { ...info, legadoId: cpfCnpj ? `DOCUMENTO:${cpfCnpj}` : id } });
      else {
        await tx.pessoa.create({ data: { id, origem: "BRISA", legadoId: cpfCnpj ? `DOCUMENTO:${cpfCnpj}` : id, ...info, criadoPorOrigem: ator.id } });
        const papel = { papel: "FORNECEDOR" };
        await tx.pessoaPapel.create({ data: { pessoaId: id, origem: "BRISA", legadoId: id, papel: "FORNECEDOR", snapshot: JSON.stringify(papel), snapshotHash: hash(papel) } });
      }
      await tx.pessoaEmail.deleteMany({ where: { pessoaId: id, origem: "BRISA", legadoId: id } });
      await tx.pessoaTelefone.deleteMany({ where: { pessoaId: id, origem: "BRISA", legadoId: id } });
      if (email) await tx.pessoaEmail.create({ data: { pessoaId: id, origem: "BRISA", legadoId: id, email, emailNorm: email, principal: true, snapshot: JSON.stringify({ email }), snapshotHash: hash({ email }) } });
      if (telefone && telefoneNorm) await tx.pessoaTelefone.create({ data: { pessoaId: id, origem: "BRISA", legadoId: id, telefone, telefoneNorm, principal: true, snapshot: JSON.stringify({ telefone }), snapshotHash: hash({ telefone }) } });
      return serializar(await tx.pessoa.findUniqueOrThrow({ where: { id }, select: cadastro }));
    }, { maxWait: 5000, timeout: 15000 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ErroFornecedor("DOCUMENTO_EXISTENTE", "Este fornecedor já foi cadastrado. Busque o cadastro existente antes de continuar.");
    throw e;
  }
}
export async function vincularPessoaFornecedor(db: PrismaClient, id: string, ator: Ator): Promise<FornecedorResumo> {
  texto(id, 100, true);
  return db.$transaction(async tx => {
    await autorizar(tx, ator, true);
    const p = await tx.pessoa.findUnique({ where: { id }, select: resumo });
    if (!p?.ativo || !await recursoEstaAtivo(tx, "PESSOA", id)) throw new ErroFornecedor("INATIVO", "Escolha um cadastro ativo e disponível.");
    const papel = { papel: "FORNECEDOR", autorId: ator.id };
    await tx.pessoaPapel.upsert({ where: { pessoaId_papel: { pessoaId: id, papel: "FORNECEDOR" } }, create: { pessoaId: id, origem: "BRISA", legadoId: id, papel: "FORNECEDOR", snapshot: JSON.stringify(papel), snapshotHash: hash(papel) }, update: {} });
    return p;
  });
}
export async function alterarSituacaoFornecedor(db: PrismaClient, input: { id: string; ativo: boolean; atualizadoEm: string }, ator: Ator): Promise<FornecedorCadastro> {
  texto(input.id, 100, true);
  if (typeof input.ativo !== "boolean") throw new ErroFornecedor("SITUACAO_INVALIDA", "Escolha a situação do fornecedor.");
  return db.$transaction(async tx => {
    await autorizar(tx, ator, true);
    const p = await tx.pessoa.findUnique({ where: { id: input.id }, select: { origem: true, atualizadoEm: true, papeis: { select: { papel: true } } } });
    if (!p || !p.papeis.some(papel => papel.papel === "FORNECEDOR")) throw new ErroFornecedor("NAO_ENCONTRADO", "O fornecedor não foi encontrado.");
    if (!input.ativo && (p.papeis.some(papel => papel.papel !== "FORNECEDOR") || await tx.locatario.count({ where: { pessoaId: input.id } }))) throw new ErroFornecedor("OUTROS_PAPEIS", "Este cadastro também é usado em outros papéis. Revise os vínculos antes de inativar a pessoa.");
    if (p.origem !== "BRISA") throw new ErroFornecedor("ORIGEM_PROTEGIDA", "O estado do cadastro importado é preservado. A exclusão e a restauração podem ser feitas em Revisar cadastros.");
    if (!await recursoEstaAtivo(tx, "PESSOA", input.id)) throw new ErroFornecedor("INATIVO", "Confira a lixeira antes de alterar este cadastro.");
    if (p.atualizadoEm.toISOString() !== input.atualizadoEm) throw new ErroFornecedor("VERSAO_DESATUALIZADA", "O cadastro mudou. Atualize a lista antes de continuar.");
    return serializar(await tx.pessoa.update({ where: { id: input.id }, data: { ativo: input.ativo }, select: cadastro }));
  });
}
