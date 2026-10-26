import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { carteiraIrrestrita, montarPolitica, perfilSomenteLeitura, pode } from "../acesso/politica";
import { CATEGORIAS_DESPESA } from "./categorias";
import { ErroDespesa } from "./tipos";
import type { CategoriaDespesaCatalogo, SalvarCategoriaDespesaEntrada } from "./tipos-catalogo";

type Tx = Prisma.TransactionClient;
type Ator = { id: string };
export const normalizarCategoriaDespesa = (valor: string) => valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, " ").trim().toUpperCase();
const nomeRestrito = (valor: string) => /comiss|corretagem|honorario|taxa\s+de\s+administra/i.test(normalizarCategoriaDespesa(valor));

/** Consulta interna. A política é aplicada pelo serviço chamador antes de
 * serializar o catálogo; nenhuma escrita ocorre ao abrir uma tela. */
export async function carregarCatalogoDespesas(tx: Pick<Tx, "categoriaDespesa">): Promise<CategoriaDespesaCatalogo[]> {
  const registros = await tx.categoriaDespesa.findMany({ select: { codigo: true, rotulo: true, restrita: true, ativa: true, versao: true } });
  const catalogo = new Map<string, CategoriaDespesaCatalogo>(CATEGORIAS_DESPESA.map(categoria => [categoria.codigo, { ...categoria, ativa: true, versao: 0, padrao: true }]));
  for (const registro of registros) catalogo.set(registro.codigo, { ...registro, restrita: registro.restrita || !!catalogo.get(registro.codigo)?.restrita || nomeRestrito(registro.rotulo), padrao: catalogo.has(registro.codigo) });
  return [...catalogo.values()].sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}

async function autorizar(tx: Tx, ator: Ator, gerenciar = false) {
  const usuario = await tx.usuario.findUnique({ where: { id: ator.id }, select: {
    id: true, perfil: true, ativo: true, acessoGlobal: true, permissoesExtras: true, permissoesNegadas: true,
    papelAcesso: { select: { ativo: true, permissoes: true } }, regrasAcesso: { select: { tipo: true, recursoId: true, efeito: true } },
  } });
  const politica = usuario ? montarPolitica(usuario) : null;
  if (!politica || !carteiraIrrestrita(politica) || perfilSomenteLeitura(politica) || !pode(politica, "despesas.ver") || (gerenciar && politica.perfil !== "ADMINISTRADOR")) {
    throw new ErroDespesa("SEM_PERMISSAO", gerenciar ? "Somente o administrador pode criar ou alterar categorias." : "Você não tem permissão para consultar categorias de despesas.");
  }
  return politica;
}

export async function listarCategoriasDespesas(db: PrismaClient, ator: Ator, opcoes: { incluirInativas?: boolean } = {}) {
  return db.$transaction(async tx => {
    const politica = await autorizar(tx, ator);
    const categorias = (await carregarCatalogoDespesas(tx)).filter(categoria => (!categoria.restrita || pode(politica, "comissoes.ver")) && (opcoes.incluirInativas || categoria.ativa));
    return { categorias, gerenciavel: politica.perfil === "ADMINISTRADOR" };
  });
}

export async function salvarCategoriaDespesa(db: PrismaClient, entrada: SalvarCategoriaDespesaEntrada, ator: Ator): Promise<CategoriaDespesaCatalogo> {
  if (!entrada || typeof entrada.rotulo !== "string" || !entrada.rotulo.trim() || entrada.rotulo.trim().length > 120 || typeof entrada.ativa !== "boolean" || typeof entrada.restrita !== "boolean"
    || (entrada.codigo !== undefined && (typeof entrada.codigo !== "string" || !/^[A-Z0-9_-]{1,60}$/.test(entrada.codigo)))) throw new ErroDespesa("CATEGORIA_INVALIDA", "Informe um nome de categoria com até 120 caracteres.");
  const rotulo = entrada.rotulo.trim().replace(/\s+/g, " ");
  const rotuloNorm = normalizarCategoriaDespesa(rotulo);
  if (!rotuloNorm) throw new ErroDespesa("CATEGORIA_INVALIDA", "O nome da categoria deve conter letras ou números.");
  try {
    return await db.$transaction(async tx => {
      await autorizar(tx, ator, true);
      const catalogo = await carregarCatalogoDespesas(tx);
      const atual = entrada.codigo ? catalogo.find(categoria => categoria.codigo === entrada.codigo) : null;
      if (entrada.codigo && !atual) throw new ErroDespesa("CATEGORIA_INVALIDA", "A categoria não foi encontrada. Atualize a lista.");
      if (atual && entrada.versao !== atual.versao) throw new ErroDespesa("VERSAO_DESATUALIZADA", "Esta categoria foi alterada por outra pessoa. Atualize a lista antes de salvar.");
      if (catalogo.some(categoria => categoria.codigo !== atual?.codigo && normalizarCategoriaDespesa(categoria.rotulo) === rotuloNorm)) throw new ErroDespesa("CATEGORIA_DUPLICADA", "Já existe uma categoria com este nome, inclusive entre as inativas. Use ou reative a categoria existente.");
      const codigo = atual?.codigo ?? `CAT_${randomUUID().replaceAll("-", "").toUpperCase()}`;
      const restrita = !!atual?.restrita || entrada.restrita || nomeRestrito(rotulo);
      const dados = { rotulo, rotuloNorm, ativa: entrada.ativa, restrita, versao: (atual?.versao ?? 0) + 1, atualizadoPorId: ator.id };
      if (atual && atual.versao > 0) {
        const alterada = await tx.categoriaDespesa.updateMany({ where: { codigo, versao: atual.versao }, data: dados });
        if (alterada.count !== 1) throw new ErroDespesa("VERSAO_DESATUALIZADA", "Esta categoria foi alterada. Atualize a lista antes de salvar.");
      } else await tx.categoriaDespesa.create({ data: { codigo, ...dados, criadoPorId: ator.id } });
      // Uma classificação reservada protege também despesas antigas e seus
      // anexos/pagamentos vinculados. Nunca retira uma proteção anterior.
      if (restrita) await tx.despesaDocumento.updateMany({ where: { categoriaCodigo: codigo, restrita: false }, data: { restrita: true, versao: { increment: 1 }, atualizadoPorId: ator.id } });
      return { codigo, rotulo, ativa: entrada.ativa, restrita, versao: dados.versao, padrao: atual?.padrao ?? false };
    }, { maxWait: 5000, timeout: 15000 });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") throw new ErroDespesa("CATEGORIA_DUPLICADA", "Esta categoria já existe ou foi alterada durante o cadastro. Atualize a lista.");
    throw erro;
  }
}
