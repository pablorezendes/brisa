import "server-only";

import type { Prisma } from "@prisma/client";

import { podeVerPiiCadastrosAtual } from "@/lib/autorizacao";
import { prisma } from "@/lib/db";
import { normalizar } from "@/lib/dominio/normalizacao";
import {
  mascararEmailCadastro,
  mascararTelefoneCadastro,
} from "@/lib/privacidade-cadastros";
import { ORIGEM_CADASTROS_WIDESYS } from "@/lib/widesys";

export const GRUPOS_PAPEIS_WIDESYS = {
  INTERESSADOS: ["PRECADASTRO", "INTERESSADO"],
  PROPRIETARIOS: ["PROPRIETARIO", "BENEFICIARIO"],
  FIADORES: ["FIADOR", "AVALISTA"],
  CORRETORES: ["CORRETOR", "FUNCIONARIO"],
} as const;

export type GrupoPapelWidesys = keyof typeof GRUPOS_PAPEIS_WIDESYS;
export type EstadoImovelLegado =
  | "todos"
  | "disponivel"
  | "alugado"
  | "publicado"
  | "nao-publicado";

function paginacao(pagina?: number, porPagina?: number): { pagina: number; porPagina: number } {
  return {
    pagina: Number.isSafeInteger(pagina) && pagina! > 0 ? pagina! : 1,
    porPagina:
      Number.isSafeInteger(porPagina) && porPagina! > 0
        ? Math.min(porPagina!, 100)
        : 25,
  };
}

function mascararDocumento(valor: string | null): string | null {
  if (!valor) return null;
  if (valor.length === 11) return `***.***.***-${valor.slice(-2)}`;
  if (valor.length === 14) return `**.***.***/****-${valor.slice(-2)}`;
  return null;
}

function papeisDoFiltro(papel?: string): string[] | null {
  if (!papel || papel.toLowerCase() === "todos") return null;
  const grupo = papel.toUpperCase() as GrupoPapelWidesys;
  if (grupo in GRUPOS_PAPEIS_WIDESYS) return [...GRUPOS_PAPEIS_WIDESYS[grupo]];
  const canonico = normalizar(papel).replace(/[^A-Z0-9]+/g, "_");
  return canonico ? [canonico] : null;
}

export async function listarPessoasWidesys(entrada: {
  q?: string;
  papel?: string;
  pagina?: number;
  porPagina?: number;
} = {}) {
  const podeVerPii = await podeVerPiiCadastrosAtual();
  const { pagina: paginaSolicitada, porPagina } = paginacao(entrada.pagina, entrada.porPagina);
  const busca = entrada.q?.trim().slice(0, 100) ?? "";
  const buscaNorm = normalizar(busca);
  const buscaDocumento = busca.replace(/\D/g, "");
  const papeis = papeisDoFiltro(entrada.papel);
  const where: Prisma.PessoaWhereInput = {
    origem: ORIGEM_CADASTROS_WIDESYS,
    ...(busca
      ? {
          OR: [
            { nomeNorm: { contains: buscaNorm } },
            { nomeFantasia: { contains: busca } },
            { cidade: { contains: busca } },
            { bairro: { contains: busca } },
            { uf: { contains: busca.toUpperCase() } },
            ...(podeVerPii && buscaDocumento.length >= 3
              ? [{ cpfCnpj: { contains: buscaDocumento } }]
              : []),
            ...(podeVerPii
              ? [{ emails: { some: { emailNorm: { contains: busca.toLowerCase() } } } }]
              : []),
            ...(podeVerPii && buscaDocumento.length >= 4
              ? [{ telefones: { some: { telefoneNorm: { contains: buscaDocumento } } } }]
              : []),
          ],
        }
      : {}),
    ...(papeis ? { papeis: { some: { papel: { in: papeis } } } } : {}),
  };

  const [total, papeisAgrupados, ...totaisGrupos] = await Promise.all([
    prisma.pessoa.count({ where }),
    prisma.pessoaPapel.groupBy({
      by: ["papel"],
      where: { origem: ORIGEM_CADASTROS_WIDESYS },
      _count: { _all: true },
    }),
    ...Object.values(GRUPOS_PAPEIS_WIDESYS).map((grupo) =>
      prisma.pessoa.count({
        where: {
          origem: ORIGEM_CADASTROS_WIDESYS,
          papeis: { some: { papel: { in: [...grupo] } } },
        },
      }),
    ),
  ]);
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const pagina = Math.min(paginaSolicitada, totalPaginas);
  const registros = await prisma.pessoa.findMany({
    where,
    orderBy: [{ nomeNorm: "asc" }, { legadoId: "asc" }],
    skip: (pagina - 1) * porPagina,
    take: porPagina,
    select: {
      id: true,
      nome: true,
      nomeFantasia: true,
      tipoPessoa: true,
      cpfCnpj: true,
      cidade: true,
      uf: true,
      atualizadoEm: true,
      papeis: { orderBy: { papel: "asc" }, select: { papel: true } },
      emails: {
        orderBy: [{ principal: "desc" }, { ordem: "asc" }],
        take: 1,
        select: { email: true },
      },
      telefones: {
        orderBy: [{ principal: "desc" }, { ordem: "asc" }],
        take: 1,
        select: { telefone: true },
      },
    },
  });

  return {
    itens: registros.map((pessoa) => ({
      id: pessoa.id,
      nome: pessoa.nome,
      nomeFantasia: pessoa.nomeFantasia,
      tipoPessoa: pessoa.tipoPessoa,
      cpfCnpjMascarado: mascararDocumento(pessoa.cpfCnpj),
      cidade: pessoa.cidade,
      uf: pessoa.uf,
      papeis: pessoa.papeis.map((papel) => papel.papel),
      emailPrincipal: podeVerPii
        ? pessoa.emails[0]?.email ?? null
        : mascararEmailCadastro(pessoa.emails[0]?.email),
      telefonePrincipal: podeVerPii
        ? pessoa.telefones[0]?.telefone ?? null
        : mascararTelefoneCadastro(pessoa.telefones[0]?.telefone),
      atualizadoEm: pessoa.atualizadoEm.toISOString(),
    })),
    total,
    pagina,
    porPagina,
    totalPaginas,
    totaisPorPapel: Object.fromEntries(
      papeisAgrupados.map((item) => [item.papel, item._count._all]),
    ) as Record<string, number>,
    totaisPorGrupo: Object.fromEntries(
      Object.keys(GRUPOS_PAPEIS_WIDESYS).map((grupo, indice) => [grupo, totaisGrupos[indice]]),
    ) as Record<GrupoPapelWidesys, number>,
  };
}

export async function obterPessoaWidesys(id: string) {
  const podeVerPii = await podeVerPiiCadastrosAtual();
  const pessoa = await prisma.pessoa.findFirst({
    where: { id, origem: ORIGEM_CADASTROS_WIDESYS },
    select: {
      id: true,
      origem: true,
      legadoId: true,
      tipoPessoa: true,
      tipoCadastroOrigem: true,
      categoriaOrigem: true,
      nome: true,
      nomeFantasia: true,
      apelido: true,
      cpfCnpj: true,
      rgIe: true,
      inscricaoMunicipal: true,
      nascimentoAbertura: true,
      sexo: true,
      estadoCivil: true,
      nacionalidade: true,
      naturalidade: true,
      profissao: true,
      nomeMae: true,
      nomePai: true,
      website: true,
      recados: true,
      observacoes: true,
      ativo: true,
      cep: true,
      endereco: true,
      numeroEndereco: true,
      complementoEndereco: true,
      bairro: true,
      cidade: true,
      uf: true,
      criadoPorOrigem: true,
      origemCriadoEm: true,
      origemAtualizadoEm: true,
      capturadoEm: true,
      atualizadoEm: true,
      papeis: { orderBy: { papel: "asc" }, select: { id: true, papel: true } },
      emails: {
        orderBy: [{ principal: "desc" }, { ordem: "asc" }],
        select: { id: true, email: true, principal: true, ordem: true },
      },
      telefones: {
        orderBy: [{ principal: "desc" }, { ordem: "asc" }],
        select: { id: true, telefone: true, principal: true, ordem: true },
      },
      locatario: { select: { id: true } },
      imoveisComoProprietario: {
        orderBy: [{ principal: "desc" }, { ordem: "asc" }],
        select: {
          id: true,
          porcentagem: true,
          principal: true,
          imovel: { select: { id: true, referencia: true, nome: true, tipo: true } },
        },
      },
    },
  });
  if (!pessoa) return null;
  const { cpfCnpj: documentoBruto, ...pessoaSegura } = pessoa;
  if (!podeVerPii) {
    return {
      id: pessoa.id,
      origem: pessoa.origem,
      legadoId: pessoa.legadoId,
      tipoPessoa: pessoa.tipoPessoa,
      tipoCadastroOrigem: pessoa.tipoCadastroOrigem,
      categoriaOrigem: pessoa.categoriaOrigem,
      nome: pessoa.nome,
      nomeFantasia: pessoa.nomeFantasia,
      apelido: null,
      cpfCnpjMascarado: mascararDocumento(documentoBruto),
      rgIe: null,
      inscricaoMunicipal: null,
      nascimentoAbertura: null,
      sexo: null,
      estadoCivil: null,
      nacionalidade: null,
      naturalidade: null,
      profissao: null,
      nomeMae: null,
      nomePai: null,
      website: null,
      recados: null,
      observacoes: null,
      ativo: pessoa.ativo,
      cep: null,
      endereco: null,
      numeroEndereco: null,
      complementoEndereco: null,
      bairro: pessoa.bairro,
      cidade: pessoa.cidade,
      uf: pessoa.uf,
      criadoPorOrigem: pessoa.criadoPorOrigem,
      origemCriadoEm: pessoa.origemCriadoEm,
      origemAtualizadoEm: pessoa.origemAtualizadoEm,
      capturadoEm: pessoa.capturadoEm?.toISOString() ?? null,
      atualizadoEm: pessoa.atualizadoEm.toISOString(),
      papeis: pessoa.papeis,
      emails: pessoa.emails.map((contato) => ({
        ...contato,
        email: mascararEmailCadastro(contato.email) ?? "***",
      })),
      telefones: pessoa.telefones.map((contato) => ({
        ...contato,
        telefone: mascararTelefoneCadastro(contato.telefone) ?? "***",
      })),
      locatario: pessoa.locatario,
      imoveisComoProprietario: pessoa.imoveisComoProprietario.map((vinculo) => ({
        ...vinculo,
        porcentagem: null,
      })),
    };
  }
  return {
    ...pessoaSegura,
    cpfCnpjMascarado: mascararDocumento(documentoBruto),
    capturadoEm: pessoa.capturadoEm?.toISOString() ?? null,
    atualizadoEm: pessoa.atualizadoEm.toISOString(),
  };
}

export async function listarImoveisLegado(entrada: {
  q?: string;
  pagina?: number;
  porPagina?: number;
  estado?: EstadoImovelLegado;
  finalidade?: string;
} = {}) {
  const podeVerPii = await podeVerPiiCadastrosAtual();
  const { pagina: paginaSolicitada, porPagina } = paginacao(entrada.pagina, entrada.porPagina);
  const busca = entrada.q?.trim().slice(0, 100) ?? "";
  const buscaNorm = normalizar(busca);
  const estado = entrada.estado ?? "todos";
  const finalidadeNorm = normalizar(entrada.finalidade);
  const finalidade = finalidadeNorm === "RESIDENCIAL"
    ? "Residencial"
    : finalidadeNorm === "COMERCIAL"
      ? "Comercial"
      : null;
  const where: Prisma.ImovelLegadoWhereInput = {
    origem: ORIGEM_CADASTROS_WIDESYS,
    ...(busca
      ? {
          OR: [
            { nomeNorm: { contains: buscaNorm } },
            { referencia: { contains: busca } },
            { bairro: { contains: busca } },
            ...(podeVerPii ? [{ endereco: { contains: busca } }] : []),
          ],
        }
      : {}),
    ...(finalidade ? { finalidade } : {}),
    ...(estado === "disponivel"
      ? { disponivel: true }
      : estado === "alugado"
        ? { disponivel: false }
        : estado === "publicado"
          ? { publicado: true }
          : estado === "nao-publicado"
            ? { publicado: false }
            : {}),
  };
  const base = { origem: ORIGEM_CADASTROS_WIDESYS };
  const [total, disponiveis, alugados, publicados, naoPublicados, finalidades] =
    await Promise.all([
      prisma.imovelLegado.count({ where }),
      prisma.imovelLegado.count({ where: { ...base, disponivel: true } }),
      prisma.imovelLegado.count({ where: { ...base, disponivel: false } }),
      prisma.imovelLegado.count({ where: { ...base, publicado: true } }),
      prisma.imovelLegado.count({ where: { ...base, publicado: false } }),
      prisma.imovelLegado.groupBy({
        by: ["finalidade"],
        where: base,
        _count: { _all: true },
      }),
    ]);
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const pagina = Math.min(paginaSolicitada, totalPaginas);
  const registros = await prisma.imovelLegado.findMany({
    where,
    orderBy: [{ referencia: "asc" }, { legadoId: "asc" }],
    skip: (pagina - 1) * porPagina,
    take: porPagina,
    select: {
      id: true,
      referencia: true,
      nome: true,
      tipo: true,
      finalidade: true,
      statusComercial: true,
      publicado: true,
      disponivel: true,
      bairro: true,
      cidade: true,
      valorLocacao: true,
      valorVenda: true,
      quartos: true,
      garagens: true,
      atualizadoEm: true,
      proprietarios: {
        orderBy: [{ principal: "desc" }, { ordem: "asc" }],
        take: 1,
        select: { pessoa: { select: { id: true, nome: true } } },
      },
    },
  });
  return {
    itens: registros.map((imovel) => ({
      id: imovel.id,
      referencia: imovel.referencia,
      nome: imovel.nome,
      tipo: imovel.tipo,
      finalidade: imovel.finalidade,
      status: imovel.statusComercial,
      publicado: imovel.publicado,
      disponivel: imovel.disponivel,
      bairro: imovel.bairro,
      cidade: imovel.cidade,
      valorLocacao: podeVerPii ? imovel.valorLocacao : null,
      valorVenda: podeVerPii ? imovel.valorVenda : null,
      quartos: imovel.quartos,
      garagens: imovel.garagens,
      proprietarioPrincipal: imovel.proprietarios[0]?.pessoa ?? null,
      atualizadoEm: imovel.atualizadoEm.toISOString(),
    })),
    total,
    pagina,
    porPagina,
    totalPaginas,
    totaisEstado: {
      todos: disponiveis + alugados,
      disponivel: disponiveis,
      alugado: alugados,
      publicado: publicados,
      "nao-publicado": naoPublicados,
    },
    totaisFinalidade: Object.fromEntries(
      finalidades.map((item) => [item.finalidade ?? "Sem finalidade", item._count._all]),
    ) as Record<string, number>,
  };
}

export async function obterImovelLegado(id: string) {
  const podeVerPii = await podeVerPiiCadastrosAtual();
  const imovel = await prisma.imovelLegado.findFirst({
    where: { id, origem: ORIGEM_CADASTROS_WIDESYS },
    select: {
      id: true,
      origem: true,
      legadoId: true,
      referencia: true,
      nome: true,
      apelido: true,
      tipo: true,
      categoria: true,
      finalidade: true,
      statusComercial: true,
      publicado: true,
      disponivel: true,
      empreendimentoLegadoId: true,
      empreendimentoNome: true,
      cep: true,
      endereco: true,
      numeroEndereco: true,
      complementoEndereco: true,
      bairro: true,
      cidade: true,
      uf: true,
      valorLocacao: true,
      valorVenda: true,
      valorCondominio: true,
      valorIptu: true,
      quartos: true,
      suites: true,
      banheiros: true,
      garagens: true,
      areaTotal: true,
      latitude: true,
      longitude: true,
      descricao: true,
      observacoes: true,
      origemCriadoEm: true,
      origemAtualizadoEm: true,
      capturadoEm: true,
      atualizadoEm: true,
      proprietarios: {
        orderBy: [{ principal: "desc" }, { ordem: "asc" }],
        select: {
          id: true,
          proprietarioLegadoId: true,
          porcentagem: true,
          principal: true,
          ordem: true,
          pessoa: {
            select: { id: true, nome: true, tipoPessoa: true, cpfCnpj: true },
          },
        },
      },
    },
  });
  if (!imovel) return null;
  const proprietariosSeguros = imovel.proprietarios.map((proprietario) => ({
    ...proprietario,
    porcentagem: podeVerPii ? proprietario.porcentagem : null,
    pessoa: proprietario.pessoa
      ? (() => {
          const { cpfCnpj: documentoBruto, ...pessoaSegura } = proprietario.pessoa;
          return {
            ...pessoaSegura,
            cpfCnpjMascarado: mascararDocumento(documentoBruto),
          };
        })()
      : null,
  }));

  if (!podeVerPii) {
    return {
      id: imovel.id,
      origem: imovel.origem,
      legadoId: imovel.legadoId,
      referencia: imovel.referencia,
      nome: imovel.nome,
      apelido: imovel.apelido,
      tipo: imovel.tipo,
      categoria: imovel.categoria,
      finalidade: imovel.finalidade,
      statusComercial: imovel.statusComercial,
      publicado: imovel.publicado,
      disponivel: imovel.disponivel,
      empreendimentoLegadoId: imovel.empreendimentoLegadoId,
      empreendimentoNome: imovel.empreendimentoNome,
      cep: null,
      endereco: null,
      numeroEndereco: null,
      complementoEndereco: null,
      bairro: imovel.bairro,
      cidade: imovel.cidade,
      uf: imovel.uf,
      valorLocacao: null,
      valorVenda: null,
      valorCondominio: null,
      valorIptu: null,
      quartos: imovel.quartos,
      suites: imovel.suites,
      banheiros: imovel.banheiros,
      garagens: imovel.garagens,
      areaTotal: imovel.areaTotal,
      latitude: null,
      longitude: null,
      descricao: null,
      observacoes: null,
      origemCriadoEm: imovel.origemCriadoEm,
      origemAtualizadoEm: imovel.origemAtualizadoEm,
      capturadoEm: imovel.capturadoEm?.toISOString() ?? null,
      atualizadoEm: imovel.atualizadoEm.toISOString(),
      proprietarios: proprietariosSeguros,
    };
  }
  return {
    ...imovel,
    capturadoEm: imovel.capturadoEm?.toISOString() ?? null,
    atualizadoEm: imovel.atualizadoEm.toISOString(),
    proprietarios: proprietariosSeguros,
  };
}
