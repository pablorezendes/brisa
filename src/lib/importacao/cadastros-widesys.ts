import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { Prisma, PrismaClient } from "@prisma/client";

import { normalizar } from "../dominio/normalizacao";
import { ORIGEM_CADASTROS_WIDESYS } from "../widesys";

export { ORIGEM_CADASTROS_WIDESYS } from "../widesys";

const ARQUIVOS_API_OBRIGATORIOS = [
  "clientes-lista.json",
  "clientes-detalhes.json",
  "produtos-listas.json",
  "produtos-detalhes.json",
] as const;
const MAXIMO_BYTES_ARQUIVO = 20 * 1024 * 1024;
const MAXIMO_ARQUIVOS_API = 100;
const MAXIMO_REGISTROS_UI = 10_000;
const BASE_ORIGIN_WIDESYS = "https://brisaazul.app2.widesys.com.br";
const CAMPOS_CONTAGENS_API = [
  "clientes",
  "clientesDetalhes",
  "produtosNaoPublicados",
  "produtosPublicados",
  "produtosUnicos",
  "produtosDetalhes",
] as const;
const MODULOS_UI = [
  "precadastros",
  "produtos",
  "empreendimentos",
  "proprietarios",
  "inquilinos",
  "compradors",
  "fiadors",
  "corretors",
  "outros",
] as const;

type Registro = Record<string, unknown>;

export type PapelPessoaWidesys =
  | "INTERESSADO"
  | "PRECADASTRO"
  | "PROPRIETARIO"
  | "BENEFICIARIO"
  | "INQUILINO"
  | "COMPRADOR"
  | "FIADOR"
  | "AVALISTA"
  | "CORRETOR"
  | "FUNCIONARIO"
  | "FORNECEDOR"
  | "OUTRO";

type SnapshotComHash = { snapshot: string; snapshotHash: string };

export type PessoaPlanejadaWidesys = SnapshotComHash & {
  origem: string;
  legadoId: string;
  tipoPessoa: "FISICA" | "JURIDICA" | "DESCONHECIDA";
  tipoCadastroOrigem: string | null;
  categoriaOrigem: string | null;
  nome: string;
  nomeNorm: string;
  nomeFantasia: string | null;
  apelido: string | null;
  cpfCnpj: string | null;
  rgIe: string | null;
  inscricaoMunicipal: string | null;
  nascimentoAbertura: string | null;
  sexo: string | null;
  estadoCivil: string | null;
  nacionalidade: string | null;
  naturalidade: string | null;
  profissao: string | null;
  nomeMae: string | null;
  nomePai: string | null;
  website: string | null;
  recados: string | null;
  observacoes: string | null;
  ativo: boolean;
  cep: string | null;
  endereco: string | null;
  numeroEndereco: string | null;
  complementoEndereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  criadoPorOrigem: string | null;
  origemCriadoEm: string | null;
  origemAtualizadoEm: string | null;
  capturadoEm: Date | null;
  papeis: Array<SnapshotComHash & { papel: PapelPessoaWidesys }>;
  emails: Array<
    SnapshotComHash & {
      ordem: number;
      email: string;
      emailNorm: string;
      principal: boolean;
    }
  >;
  telefones: Array<
    SnapshotComHash & {
      ordem: number;
      telefone: string;
      telefoneNorm: string;
      principal: boolean;
    }
  >;
};

export type ProprietarioPlanejadoWidesys = SnapshotComHash & {
  legadoId: string;
  proprietarioLegadoId: string;
  pessoaLegadoId: string | null;
  porcentagem: string | null;
  contaLegadoId: string | null;
  principal: boolean;
  ordem: number;
};

export type ImovelPlanejadoWidesys = SnapshotComHash & {
  origem: string;
  legadoId: string;
  referencia: string | null;
  nome: string | null;
  nomeNorm: string | null;
  apelido: string | null;
  tipo: string | null;
  categoria: string | null;
  finalidade: string | null;
  statusComercial: string | null;
  publicado: boolean;
  disponivel: boolean | null;
  empreendimentoLegadoId: string | null;
  empreendimentoNome: string | null;
  cep: string | null;
  endereco: string | null;
  numeroEndereco: string | null;
  complementoEndereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  valorLocacao: number | null;
  valorVenda: number | null;
  valorCondominio: number | null;
  valorIptu: number | null;
  quartos: number | null;
  suites: number | null;
  banheiros: number | null;
  garagens: number | null;
  areaTotal: string | null;
  latitude: string | null;
  longitude: string | null;
  descricao: string | null;
  observacoes: string | null;
  origemCriadoEm: string | null;
  origemAtualizadoEm: string | null;
  capturadoEm: Date | null;
  proprietarios: ProprietarioPlanejadoWidesys[];
};

export type AvisoImportacaoWidesys = { codigo: string; quantidade: number };

export type PlanoCadastrosWidesys = {
  origem: string;
  capturadoEm: Date | null;
  pessoas: PessoaPlanejadaWidesys[];
  imoveis: ImovelPlanejadoWidesys[];
  avisos: AvisoImportacaoWidesys[];
};

export type RelatorioImportacaoCadastrosWidesys = {
  modo: "DRY_RUN" | "APLICADO";
  origem: string;
  previstos: {
    pessoas: number;
    papeis: number;
    emails: number;
    telefones: number;
    imoveis: number;
    proprietarios: number;
  };
  alteracoes: {
    pessoas: ContadoresAlteracao;
    papeis: ContadoresAlteracao;
    emails: ContadoresAlteracao;
    telefones: ContadoresAlteracao;
    imoveis: ContadoresAlteracao;
    proprietarios: ContadoresAlteracao;
  } | null;
  vinculosLocatario: {
    vinculados: number;
    jaVinculados: number;
    semCpfCnpj: number;
    semCorrespondencia: number;
    ambiguos: number;
    conflitos: number;
  } | null;
  avisos: AvisoImportacaoWidesys[];
};

type ContadoresAlteracao = { criados: number; atualizados: number; inalterados: number };

export class ErroImportacaoCadastrosWidesys extends Error {
  readonly codigo: string;

  constructor(codigo: string, mensagem: string) {
    super(mensagem);
    this.name = "ErroImportacaoCadastrosWidesys";
    this.codigo = codigo;
  }
}

type RegistroUi = {
  fetchedAt: string | null;
  id: string;
  module: string;
  sourceUrl: string | null;
  raw: {
    title: string;
    text: string;
    fields: Array<{
      name: string;
      type: string;
      value: string | string[];
      checked?: boolean;
      label?: string;
    }>;
    tables: Array<{ headers: string[]; rows: string[][] }>;
  };
};

export type ArtefatosCadastrosWidesys = {
  clientesLista: unknown;
  clientesDetalhes: unknown;
  produtosListas: unknown;
  produtosDetalhes: unknown;
  capturadoEm?: string | null;
  uiRegistros?: RegistroUi[];
};

function objeto(valor: unknown): Registro | null {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Registro)
    : null;
}

function array(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : [];
}

function texto(valor: unknown, maximo = 20_000): string | null {
  if (typeof valor !== "string" && typeof valor !== "number") return null;
  const limpo = String(valor).trim();
  if (!limpo || limpo === "[REDACTED]") return null;
  return limpo.slice(0, maximo);
}

function identificador(valor: unknown): string | null {
  const candidato = texto(valor, 100);
  return candidato && /^[\w.-]+$/u.test(candidato) ? candidato : null;
}

function dataCaptura(valor: unknown): Date | null {
  if (typeof valor !== "string") return null;
  const instante = Date.parse(valor);
  return Number.isFinite(instante) ? new Date(instante) : null;
}

function inteiroNaoNegativo(valor: unknown): number | null {
  const numero = typeof valor === "number" ? valor : Number(texto(valor));
  return Number.isSafeInteger(numero) && numero >= 0 ? numero : null;
}

function booleano(valor: unknown, padrao = false): boolean {
  if (typeof valor === "boolean") return valor;
  if (typeof valor === "number") return valor !== 0;
  const candidato = normalizar(texto(valor));
  if (["1", "SIM", "TRUE", "ATIVO", "PUBLICADO"].includes(candidato)) return true;
  if (["0", "NAO", "FALSE", "INATIVO", "NAO PUBLICADO"].includes(candidato)) return false;
  return padrao;
}

function cpfCnpj(valor: unknown): string | null {
  const digitos = texto(valor)?.replace(/\D/g, "") ?? "";
  return /^(?:\d{11}|\d{14})$/.test(digitos) ? digitos : null;
}

function cep(valor: unknown): string | null {
  const digitos = texto(valor)?.replace(/\D/g, "") ?? "";
  return /^\d{8}$/.test(digitos) ? digitos : null;
}

function uf(valor: unknown): string | null {
  const candidato = normalizar(texto(valor));
  if (/^[A-Z]{2}$/.test(candidato)) return candidato;
  return UFS_POR_NOME[candidato] ?? null;
}

const UFS_POR_NOME: Record<string, string> = {
  ACRE: "AC",
  ALAGOAS: "AL",
  AMAPA: "AP",
  AMAZONAS: "AM",
  BAHIA: "BA",
  CEARA: "CE",
  "DISTRITO FEDERAL": "DF",
  "ESPIRITO SANTO": "ES",
  GOIAS: "GO",
  MARANHAO: "MA",
  "MATO GROSSO": "MT",
  "MATO GROSSO DO SUL": "MS",
  "MINAS GERAIS": "MG",
  PARA: "PA",
  PARAIBA: "PB",
  PARANA: "PR",
  PERNAMBUCO: "PE",
  PIAUI: "PI",
  "RIO DE JANEIRO": "RJ",
  "RIO GRANDE DO NORTE": "RN",
  "RIO GRANDE DO SUL": "RS",
  RONDONIA: "RO",
  RORAIMA: "RR",
  "SANTA CATARINA": "SC",
  "SAO PAULO": "SP",
  SERGIPE: "SE",
  TOCANTINS: "TO",
};

function valorCentavos(valor: unknown): number | null {
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) return null;
    const centavos = Math.round(valor * 100);
    return Number.isSafeInteger(centavos) ? centavos : null;
  }
  let candidato = texto(valor)?.replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!candidato) return null;
  if (candidato.includes(",")) candidato = candidato.replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(candidato)) return null;
  const [inteiro, fracao = ""] = candidato.split(".");
  try {
    const negativo = inteiro.startsWith("-");
    const reais = BigInt(inteiro.replace("-", ""));
    const total = reais * BigInt(100) + BigInt(fracao.padEnd(2, "0"));
    const numero = Number(negativo ? -total : total);
    return Number.isSafeInteger(numero) ? numero : null;
  } catch {
    return null;
  }
}

function chaveNormalizada(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function valorSeguroSnapshot(chave: string, valor: unknown): unknown {
  if (/(?:^|_)(?:senha|password|passwd|secret|token|csrf|cookie|authorization)(?:_|$)/i.test(chave)) {
    return "[REDACTED]";
  }
  if (Array.isArray(valor)) return valor.map((item) => valorSeguroSnapshot("", item));
  const item = objeto(valor);
  if (!item) return valor;
  const seguro: Registro = Object.create(null) as Registro;
  const nomeCampoFormulario = typeof item.name === "string" ? chaveNormalizada(item.name) : "";
  const campoFormularioSensivel =
    /(?:^|_)(?:senha|password|passwd|secret|token|csrf|cookie|authorization)(?:_|$)/i.test(
      nomeCampoFormulario,
    );
  for (const [nome, conteudo] of Object.entries(item)) {
    seguro[nome] = campoFormularioSensivel && nome === "value"
      ? "[REDACTED]"
      : valorSeguroSnapshot(nome, conteudo);
  }
  return seguro;
}

function jsonCanonico(valor: unknown): string {
  if (valor === null) return "null";
  if (typeof valor === "string" || typeof valor === "boolean") return JSON.stringify(valor);
  if (typeof valor === "number") return Number.isFinite(valor) ? JSON.stringify(valor) : "null";
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(",")}]`;
  const item = objeto(valor);
  if (!item) return "null";
  return `{${Object.keys(item)
    .filter((chave) => item[chave] !== undefined)
    .sort()
    .map((chave) => `${JSON.stringify(chave)}:${jsonCanonico(item[chave])}`)
    .join(",")}}`;
}

function snapshotComHash(valor: unknown): SnapshotComHash {
  const snapshot = jsonCanonico(valorSeguroSnapshot("", valor));
  return {
    snapshot,
    snapshotHash: createHash("sha256").update(snapshot).digest("hex"),
  };
}

function hashConteudoOrigem(valor: unknown): string | null {
  return valor === undefined ? null : snapshotComHash(valor).snapshotHash;
}

function provenienciaNormalizada(
  lista: Registro | undefined,
  detalhe: Registro | undefined,
  ui: RegistroUi[],
): Registro {
  return {
    apiListaHash: hashConteudoOrigem(lista),
    apiDetalheHash: hashConteudoOrigem(detalhe),
    ui: ui.map((registro) => ({
      modulo: registro.module,
      legadoId: registro.id,
      conteudoHash: hashConteudoOrigem(registro.raw),
      sourceUrlHash: hashConteudoOrigem(registro.sourceUrl),
    })),
  };
}

function registrarAviso(avisos: Map<string, number>, codigo: string): void {
  avisos.set(codigo, (avisos.get(codigo) ?? 0) + 1);
}

function recursosLista(valor: unknown, caminho: string[]): Registro[] {
  let atual: unknown = valor;
  for (const parte of caminho) atual = objeto(atual)?.[parte];
  return array(atual).map(objeto).filter((item): item is Registro => item !== null);
}

function recursosDetalhes(valor: unknown): Registro[] {
  return array(objeto(valor)?.respostas)
    .map((resposta) => objeto(objeto(resposta)?.data))
    .filter((item): item is Registro => item !== null);
}

function mapaRecursos(
  recursos: Registro[],
  avisos: Map<string, number>,
  codigoDuplicado: string,
): Map<string, Registro> {
  const mapa = new Map<string, Registro>();
  for (const recurso of recursos) {
    const id = identificador(recurso.id);
    if (!id) {
      registrarAviso(avisos, "registro_sem_id");
      continue;
    }
    if (mapa.has(id)) registrarAviso(avisos, codigoDuplicado);
    mapa.set(id, recurso);
  }
  return mapa;
}

const PAPEL_POR_ROTULO: Record<string, PapelPessoaWidesys> = {
  INTERESSADO: "INTERESSADO",
  PRECADASTRO: "PRECADASTRO",
  PROPRIETARIO: "PROPRIETARIO",
  BENEFICIARIO: "BENEFICIARIO",
  INQUILINO: "INQUILINO",
  COMPRADOR: "COMPRADOR",
  FIADOR: "FIADOR",
  AVALISTA: "AVALISTA",
  CORRETOR: "CORRETOR",
  FUNCIONARIO: "FUNCIONARIO",
  FORNECEDOR: "FORNECEDOR",
  OUTRO: "OUTRO",
};

const PAPEL_POR_MODULO_UI: Record<string, PapelPessoaWidesys | undefined> = {
  precadastros: "PRECADASTRO",
  proprietarios: "PROPRIETARIO",
  inquilinos: "INQUILINO",
  compradors: "COMPRADOR",
  fiadors: "FIADOR",
  corretors: "CORRETOR",
  // No Widesys, a rota historicamente chamada `outros` é o cadastro de
  // fornecedores. A API confirma esse papel; não crie um segundo papel OUTRO.
  outros: "FORNECEDOR",
};

function papeisDoCadastro(valor: unknown): Set<PapelPessoaWidesys> {
  const papeis = new Set<PapelPessoaWidesys>();
  for (const parte of texto(valor)?.split(",") ?? []) {
    const mapeado = PAPEL_POR_ROTULO[normalizar(parte).replace(/[^A-Z0-9]+/g, "_")];
    if (mapeado) papeis.add(mapeado);
  }
  return papeis;
}

function valoresCamposUi(registros: RegistroUi[], padrao: RegExp): Array<{
  valor: string;
  fonte: RegistroUi;
  nomeCampo: string;
  indice: number;
}> {
  const resultados: Array<{
    valor: string;
    fonte: RegistroUi;
    nomeCampo: string;
    indice: number;
  }> = [];
  for (const fonte of registros) {
    fonte.raw.fields.forEach((campo, indice) => {
      const nomeBusca = `${chaveNormalizada(campo.name)} ${chaveNormalizada(campo.label ?? "")}`.trim();
      if (!padrao.test(nomeBusca)) return;
      const valores = Array.isArray(campo.value) ? campo.value : [campo.value];
      for (const item of valores) {
        const valor = texto(item, 20_000);
        if (valor) resultados.push({ valor, fonte, nomeCampo: campo.name, indice });
      }
    });
  }
  return resultados;
}

function primeiroCampoUi(registros: RegistroUi[], nomes: string[]): string | null {
  const desejados = nomes.map(chaveNormalizada);
  for (const registro of registros) {
    for (const campo of registro.raw.fields) {
      const nomeCampo = chaveNormalizada(campo.name);
      if (!desejados.some((nome) => nomeCampo === nome || nomeCampo.endsWith(`_${nome}`))) {
        continue;
      }
      const valor = Array.isArray(campo.value) ? campo.value[0] : campo.value;
      const encontrado = texto(valor);
      if (encontrado) return encontrado;
    }
  }
  return null;
}

function contatosPessoa(
  atributos: Registro,
  ui: RegistroUi[],
): Pick<PessoaPlanejadaWidesys, "emails" | "telefones"> {
  const emails = new Map<string, PessoaPlanejadaWidesys["emails"][number]>();
  const telefones = new Map<string, PessoaPlanejadaWidesys["telefones"][number]>();
  const candidatosEmail: Array<{ valor: string; fonte: unknown }> = [];
  const emailApi = texto(atributos.email, 254);
  if (emailApi) candidatosEmail.push({ valor: emailApi, fonte: { fonte: "API", campo: "email", valor: emailApi } });
  for (const item of valoresCamposUi(ui, /(?:^|_)(?:e_?mail|email)(?:_|$)/)) {
    for (const valor of item.valor.split(/[;,\r\n]+/)) {
      candidatosEmail.push({
        valor,
        fonte: {
          fonte: "UI",
          modulo: item.fonte.module,
          campo: item.nomeCampo,
          indice: item.indice,
          valor,
        },
      });
    }
  }
  for (const candidato of candidatosEmail) {
    const original = candidato.valor.trim();
    const normalizado = original.toLowerCase();
    if (
      normalizado.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizado) ||
      emails.has(normalizado)
    ) continue;
    const snapshot = snapshotComHash(candidato.fonte);
    emails.set(normalizado, {
      ordem: emails.size,
      email: original,
      emailNorm: normalizado,
      principal: emails.size === 0,
      ...snapshot,
    });
  }

  const candidatosTelefone: Array<{ valor: string; fonte: unknown }> = [];
  const telefoneApi = texto(atributos.telefone, 50);
  if (telefoneApi) {
    candidatosTelefone.push({
      valor: telefoneApi,
      fonte: { fonte: "API", campo: "telefone", valor: telefoneApi },
    });
  }
  for (const item of valoresCamposUi(ui, /(?:telefone|celular|whatsapp|fone)/)) {
    candidatosTelefone.push({
      valor: item.valor,
      fonte: {
        fonte: "UI",
        modulo: item.fonte.module,
        campo: item.nomeCampo,
        indice: item.indice,
        valor: item.valor,
      },
    });
  }
  for (const candidato of candidatosTelefone) {
    const original = candidato.valor.trim().slice(0, 50);
    const normalizado = original.replace(/\D/g, "");
    if (!/^\d{8,15}$/.test(normalizado) || telefones.has(normalizado)) continue;
    const snapshot = snapshotComHash(candidato.fonte);
    telefones.set(normalizado, {
      ordem: telefones.size,
      telefone: original,
      telefoneNorm: normalizado,
      principal: telefones.size === 0,
      ...snapshot,
    });
  }
  return { emails: [...emails.values()], telefones: [...telefones.values()] };
}

function tipoPessoa(atributos: Registro): PessoaPlanejadaWidesys["tipoPessoa"] {
  const rotulo = normalizar(texto(atributos.tipo_pessoa_catid_label));
  if (rotulo.includes("JURIDICA")) return "JURIDICA";
  if (rotulo.includes("FISICA")) return "FISICA";
  return "DESCONHECIDA";
}

function tituloCatalogo(valor: unknown): string | null {
  const item = objeto(valor);
  if (item) return texto(item.title, 200);
  const itens = array(valor)
    .map(objeto)
    .map((registro) => texto(registro?.title, 200))
    .filter((item): item is string => item !== null);
  return itens.length ? itens.join(", ") : texto(valor, 200);
}

function construirPessoa(
  legadoId: string,
  lista: Registro | undefined,
  detalhe: Registro | undefined,
  ui: RegistroUi[],
  capturadoEm: Date | null,
  avisos: Map<string, number>,
): PessoaPlanejadaWidesys | null {
  const atributosLista = objeto(lista?.attributes) ?? {};
  const atributosDetalhe = objeto(detalhe?.attributes) ?? {};
  const atributos = { ...atributosLista, ...atributosDetalhe };
  const nome = texto(atributos.nome, 500);
  if (!nome) {
    registrarAviso(avisos, "pessoa_sem_nome");
    return null;
  }
  const tipoCadastroOrigem = texto(atributos.tipo_cadastro, 500);
  const papeis = papeisDoCadastro(tipoCadastroOrigem);
  for (const registro of ui) {
    const papel = PAPEL_POR_MODULO_UI[registro.module];
    if (papel) papeis.add(papel);
  }
  const contatos = contatosPessoa(atributos, ui);
  const dados = {
    origem: ORIGEM_CADASTROS_WIDESYS,
    legadoId,
    tipoPessoa: tipoPessoa(atributos),
    tipoCadastroOrigem,
    categoriaOrigem: primeiroCampoUi(ui, ["categoria", "tipo_cadastro"]),
    nome,
    nomeNorm: normalizar(nome),
    nomeFantasia: primeiroCampoUi(ui, ["nome_fantasia", "fantasia"]),
    apelido: primeiroCampoUi(ui, ["apelido"]),
    cpfCnpj: cpfCnpj(atributos.cpf_cnpj),
    rgIe: texto(atributos.rg_ie, 100),
    inscricaoMunicipal: texto(atributos.im, 100),
    nascimentoAbertura: texto(atributos.nascimento_abertura, 50),
    sexo: texto(atributos.sexo_label ?? atributos.sexo, 100),
    estadoCivil: texto(atributos.estado_civil_catid_label, 100),
    nacionalidade: texto(atributos.nacionalidade_catid_label, 100),
    naturalidade: texto(atributos.naturalidade, 200),
    profissao: texto(atributos.profissao, 200),
    nomeMae: texto(atributos.nome_mae, 500),
    nomePai: texto(atributos.nome_pai, 500),
    website: primeiroCampoUi(ui, ["website", "site", "url"]),
    recados: primeiroCampoUi(ui, ["recado", "recados"]),
    observacoes: primeiroCampoUi(ui, ["observacao", "observacoes"]),
    ativo: booleano(
      atributos.published ?? atributos.ativo ?? primeiroCampoUi(ui, ["published", "ativo"]),
      true,
    ),
    cep: cep(atributos.cep),
    endereco: texto(atributos.endereco, 500),
    numeroEndereco: texto(atributos.endereco_num, 100),
    complementoEndereco: texto(atributos.complemento, 300),
    bairro: texto(atributos.endereco_bid_label, 200),
    cidade: texto(atributos.endereco_cid_label, 200),
    uf: uf(atributos.endereco_eid_sigla),
    criadoPorOrigem: texto(atributos.criado_por_nome, 200),
    origemCriadoEm: texto(atributos.criado, 50),
    origemAtualizadoEm: texto(atributos.modificado, 50),
  };
  const papeisPlanejados = [...papeis].sort().map((papel) => ({
    papel,
    ...snapshotComHash({ papel, tipoCadastroOrigem, modulosUi: ui.map((item) => item.module).sort() }),
  }));
  const snapshot = snapshotComHash({
    versao: 1,
    entidade: "PESSOA",
    dados,
    proveniencia: provenienciaNormalizada(lista, detalhe, ui),
  });
  return {
    ...dados,
    capturadoEm,
    papeis: papeisPlanejados,
    ...contatos,
    ...snapshot,
  };
}

function construirProprietarios(
  atributos: Registro,
  avisos: Map<string, number>,
): ProprietarioPlanejadoWidesys[] {
  const resultado: ProprietarioPlanejadoWidesys[] = [];
  for (const valor of array(atributos.proprietarios)) {
    const item = objeto(valor);
    const legadoId = identificador(item?.id);
    const proprietarioLegadoId = identificador(item?.proprietario_id);
    if (!item || !legadoId || !proprietarioLegadoId) {
      registrarAviso(avisos, "vinculo_proprietario_incompleto");
      continue;
    }
    const dados = {
      legadoId,
      proprietarioLegadoId,
      pessoaLegadoId: identificador(item.pessoa_id ?? item.proprietario_id),
      porcentagem: texto(item.porcentagem, 30),
      contaLegadoId: identificador(item.conta_id),
      principal: booleano(item.idefault),
      ordem: inteiroNaoNegativo(item.ordering) ?? resultado.length,
    };
    resultado.push({
      ...dados,
      ...snapshotComHash({
        versao: 1,
        entidade: "IMOVEL_PROPRIETARIO",
        dados,
        proveniencia: { apiHash: hashConteudoOrigem(item) },
      }),
    });
  }
  return resultado;
}

function construirImovel(
  legadoId: string,
  lista: Registro | undefined,
  detalhe: Registro | undefined,
  ui: RegistroUi[],
  capturadoEm: Date | null,
  avisos: Map<string, number>,
): ImovelPlanejadoWidesys {
  const atributosDetalhe = objeto(detalhe?.attributes) ?? {};
  const atributosLista = objeto(lista?.attributes) ?? {};
  const atributos = { ...atributosDetalhe, ...atributosLista };
  const nome = texto(atributos.nome, 500);
  const statusComercial = texto(atributos.nome_status ?? atributos.nome_status_comercial, 200);
  const statusNorm = normalizar(statusComercial);
  const dados = {
    origem: ORIGEM_CADASTROS_WIDESYS,
    legadoId,
    referencia: texto(atributos.referencia, 200),
    nome,
    nomeNorm: nome ? normalizar(nome) : null,
    apelido: texto(atributos.apelido, 300),
    tipo: texto(atributos.nome_tipo, 200) ?? tituloCatalogo(atributos.tipo_imovel),
    categoria: tituloCatalogo(atributos.categorias),
    finalidade: texto(atributos.finalidade, 100),
    statusComercial,
    publicado: booleano(atributos.published),
    disponivel: statusNorm ? statusNorm === "DISPONIVEL" : null,
    empreendimentoLegadoId: identificador(atributos.empreendimento_catid),
    empreendimentoNome: texto(atributos.nome_empreendimento, 300),
    cep: cep(atributos.cep),
    endereco: texto(atributos.endereco_completo ?? atributos.endereco, 500),
    numeroEndereco: texto(atributos.endereco_num, 100),
    complementoEndereco: texto(atributos.complemento, 300),
    bairro: texto(atributos.nome_bairro, 200),
    cidade: texto(atributos.nome_cidade, 200),
    uf: uf(atributos.nome_estado),
    valorLocacao: valorCentavos(atributos.valor_locacao),
    valorVenda: valorCentavos(atributos.valor_venda),
    valorCondominio: valorCentavos(atributos.valor_condominio),
    valorIptu: valorCentavos(atributos.valor_iptu),
    quartos: inteiroNaoNegativo(atributos.quartos),
    suites: inteiroNaoNegativo(atributos.suites),
    banheiros: inteiroNaoNegativo(atributos.banheiros),
    garagens: inteiroNaoNegativo(atributos.garagens),
    areaTotal: texto(atributos.area_total, 100),
    latitude: texto(atributos.lat, 100),
    longitude: texto(atributos.lng, 100),
    descricao: texto(atributos.descricao),
    observacoes: texto(atributos.observacoes),
    origemCriadoEm: texto(atributos.criado, 50),
    origemAtualizadoEm: texto(atributos.modificado, 50),
  };
  const snapshot = snapshotComHash({
    versao: 1,
    entidade: "IMOVEL",
    dados,
    proveniencia: provenienciaNormalizada(lista, detalhe, ui),
  });
  return {
    ...dados,
    capturadoEm,
    proprietarios: construirProprietarios(atributos, avisos),
    ...snapshot,
  };
}

function uiPorEntidade(registros: RegistroUi[]): {
  pessoas: Map<string, RegistroUi[]>;
  imoveis: Map<string, RegistroUi[]>;
} {
  const pessoas = new Map<string, RegistroUi[]>();
  const imoveis = new Map<string, RegistroUi[]>();
  for (const registro of registros) {
    const destino = registro.module === "produtos"
      ? imoveis
      : PAPEL_POR_MODULO_UI[registro.module]
        ? pessoas
        : null;
    // Empreendimentos são validados no manifesto, mas não são pessoas. O
    // modelo atual não os normaliza, portanto não os associe por coincidência
    // de ID a um cadastro de pessoa.
    if (!destino) continue;
    const lista = destino.get(registro.id) ?? [];
    lista.push(registro);
    destino.set(registro.id, lista);
  }
  for (const mapa of [pessoas, imoveis]) {
    for (const itens of mapa.values()) {
      itens.sort((a, b) => `${a.module}:${a.sourceUrl ?? ""}`.localeCompare(`${b.module}:${b.sourceUrl ?? ""}`));
    }
  }
  return { pessoas, imoveis };
}

export function construirPlanoCadastrosWidesys(
  artefatos: ArtefatosCadastrosWidesys,
): PlanoCadastrosWidesys {
  const avisos = new Map<string, number>();
  const capturadoEm = dataCaptura(artefatos.capturadoEm);
  const clientesLista = mapaRecursos(
    recursosLista(artefatos.clientesLista, ["data"]),
    avisos,
    "cliente_duplicado_lista",
  );
  const clientesDetalhes = mapaRecursos(
    recursosDetalhes(artefatos.clientesDetalhes),
    avisos,
    "cliente_duplicado_detalhe",
  );
  const produtosLista = mapaRecursos(
    [
      ...recursosLista(artefatos.produtosListas, ["naoPublicados", "data"]),
      ...recursosLista(artefatos.produtosListas, ["publicados", "data"]),
    ],
    avisos,
    "imovel_duplicado_lista",
  );
  const produtosDetalhes = mapaRecursos(
    recursosDetalhes(artefatos.produtosDetalhes),
    avisos,
    "imovel_duplicado_detalhe",
  );
  if (clientesLista.size === 0 && clientesDetalhes.size === 0) {
    throw new ErroImportacaoCadastrosWidesys(
      "WIDESYS_CLIENTES_VAZIO",
      "Snapshots de clientes não contêm registros válidos.",
    );
  }
  const ui = uiPorEntidade(artefatos.uiRegistros ?? []);
  const pessoas: PessoaPlanejadaWidesys[] = [];
  const idsPessoas = new Set([...clientesLista.keys(), ...clientesDetalhes.keys()]);
  for (const legadoId of [...idsPessoas].sort()) {
    const pessoa = construirPessoa(
      legadoId,
      clientesLista.get(legadoId),
      clientesDetalhes.get(legadoId),
      ui.pessoas.get(legadoId) ?? [],
      capturadoEm,
      avisos,
    );
    if (pessoa) pessoas.push(pessoa);
  }

  const imoveis: ImovelPlanejadoWidesys[] = [];
  const idsImoveis = new Set([...produtosLista.keys(), ...produtosDetalhes.keys()]);
  for (const legadoId of [...idsImoveis].sort()) {
    imoveis.push(
      construirImovel(
        legadoId,
        produtosLista.get(legadoId),
        produtosDetalhes.get(legadoId),
        ui.imoveis.get(legadoId) ?? [],
        capturadoEm,
        avisos,
      ),
    );
  }

  // O vínculo explícito pessoa_id/proprietario_id é evidência de papel; não há
  // matching por nome. Ele pode complementar tipo_cadastro sem substituí-lo.
  const pessoasPorId = new Map(pessoas.map((pessoa) => [pessoa.legadoId, pessoa]));
  for (const imovel of imoveis) {
    for (const proprietario of imovel.proprietarios) {
      if (!proprietario.pessoaLegadoId) continue;
      const pessoa = pessoasPorId.get(proprietario.pessoaLegadoId);
      if (!pessoa) {
        registrarAviso(avisos, "proprietario_sem_pessoa_resolvida");
        continue;
      }
      if (!pessoa.papeis.some((item) => item.papel === "PROPRIETARIO")) {
        pessoa.papeis.push({
          papel: "PROPRIETARIO",
          ...snapshotComHash({
            papel: "PROPRIETARIO",
            fonte: "vinculo_imovel",
            pessoaLegadoId: proprietario.pessoaLegadoId,
          }),
        });
        pessoa.papeis.sort((a, b) => a.papel.localeCompare(b.papel));
      }
    }
  }

  return {
    origem: ORIGEM_CADASTROS_WIDESYS,
    capturadoEm,
    pessoas,
    imoveis,
    avisos: [...avisos.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([codigo, quantidade]) => ({ codigo, quantidade })),
  };
}

function lerJsonSeguro(caminho: string): unknown {
  const tamanho = statSync(caminho).size;
  if (tamanho <= 0 || tamanho > MAXIMO_BYTES_ARQUIVO) {
    throw new ErroImportacaoCadastrosWidesys(
      "WIDESYS_ARQUIVO_TAMANHO_INVALIDO",
      "Um snapshot possui tamanho fora do limite permitido.",
    );
  }
  try {
    return JSON.parse(readFileSync(caminho, "utf8")) as unknown;
  } catch {
    throw new ErroImportacaoCadastrosWidesys(
      "WIDESYS_JSON_INVALIDO",
      "Um snapshot obrigatório não contém JSON válido.",
    );
  }
}

function erroManifestoApi(codigo: string): never {
  throw new ErroImportacaoCadastrosWidesys(
    codigo,
    "A captura da API Widesys está incompleta ou não passou na verificação de integridade.",
  );
}

function instanteIsoValido(valor: unknown): valor is string {
  if (
    typeof valor !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(valor)
  ) {
    return false;
  }
  const instante = Date.parse(valor);
  return Number.isFinite(instante) && new Date(instante).toISOString() === valor;
}

type ContagensManifestoApi = Record<(typeof CAMPOS_CONTAGENS_API)[number], number>;

function validarCabecalhoManifestoApi(manifesto: Registro): {
  capturadoEm: string;
  contagens: ContagensManifestoApi;
} {
  if (manifesto.formato !== 1) {
    erroManifestoApi("WIDESYS_MANIFESTO_FORMATO_INVALIDO");
  }
  if (manifesto.origem !== BASE_ORIGIN_WIDESYS) {
    erroManifestoApi("WIDESYS_MANIFESTO_ORIGEM_INVALIDA");
  }
  if (!instanteIsoValido(manifesto.capturadoEm)) {
    erroManifestoApi("WIDESYS_MANIFESTO_DATA_INVALIDA");
  }
  if (manifesto.autenticacaoPersistida !== false) {
    erroManifestoApi("WIDESYS_MANIFESTO_AUTENTICACAO_INVALIDA");
  }
  const contagensBrutas = objeto(manifesto.contagens);
  if (!contagensBrutas) {
    erroManifestoApi("WIDESYS_MANIFESTO_CONTAGENS_INVALIDAS");
  }
  const contagens = Object.create(null) as ContagensManifestoApi;
  for (const campo of CAMPOS_CONTAGENS_API) {
    const valor = contagensBrutas[campo];
    if (typeof valor !== "number" || !Number.isSafeInteger(valor) || valor < 0) {
      erroManifestoApi("WIDESYS_MANIFESTO_CONTAGENS_INVALIDAS");
    }
    contagens[campo] = valor;
  }
  return { capturadoEm: manifesto.capturadoEm, contagens };
}

function idsListaApi(valor: unknown): string[] {
  const raiz = objeto(valor);
  if (!raiz || !Array.isArray(raiz.data)) {
    erroManifestoApi("WIDESYS_SNAPSHOT_ESTRUTURA_INVALIDA");
  }
  const ids: string[] = [];
  const vistos = new Set<string>();
  for (const bruto of raiz.data) {
    const id = identificador(objeto(bruto)?.id);
    if (!id || vistos.has(id)) {
      erroManifestoApi("WIDESYS_SNAPSHOT_IDS_INVALIDOS");
    }
    vistos.add(id);
    ids.push(id);
  }
  const totalApi = objeto(raiz.meta)?.["total-items"];
  if (typeof totalApi !== "number" || !Number.isSafeInteger(totalApi) || totalApi !== ids.length) {
    erroManifestoApi("WIDESYS_SNAPSHOT_CONTAGEM_DIVERGENTE");
  }
  return ids;
}

function idsDetalhesApi(valor: unknown, capturadoEm: string): string[] {
  const raiz = objeto(valor);
  if (!raiz || !Array.isArray(raiz.respostas)) {
    erroManifestoApi("WIDESYS_SNAPSHOT_ESTRUTURA_INVALIDA");
  }
  if (raiz.capturadoEm !== capturadoEm) {
    erroManifestoApi("WIDESYS_SNAPSHOT_DATA_DIVERGENTE");
  }
  const total = raiz.total;
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total !== raiz.respostas.length) {
    erroManifestoApi("WIDESYS_SNAPSHOT_CONTAGEM_DIVERGENTE");
  }
  const ids: string[] = [];
  const vistos = new Set<string>();
  for (const bruto of raiz.respostas) {
    const id = identificador(objeto(objeto(bruto)?.data)?.id);
    if (!id || vistos.has(id)) {
      erroManifestoApi("WIDESYS_SNAPSHOT_IDS_INVALIDOS");
    }
    vistos.add(id);
    ids.push(id);
  }
  return ids;
}

function mesmosIds(esquerda: string[], direita: string[]): boolean {
  if (esquerda.length !== direita.length) return false;
  const esperados = new Set(esquerda);
  return direita.every((id) => esperados.has(id));
}

function validarCompletudeSnapshotsApi(
  carregados: Map<string, unknown>,
  capturadoEm: string,
  contagens: ContagensManifestoApi,
): void {
  const clientesLista = idsListaApi(carregados.get("clientes-lista.json"));
  const clientesDetalhes = idsDetalhesApi(
    carregados.get("clientes-detalhes.json"),
    capturadoEm,
  );
  const produtosListas = objeto(carregados.get("produtos-listas.json"));
  if (!produtosListas || produtosListas.capturadoEm !== capturadoEm) {
    erroManifestoApi("WIDESYS_SNAPSHOT_DATA_DIVERGENTE");
  }
  const produtosNaoPublicados = idsListaApi(produtosListas.naoPublicados);
  const produtosPublicados = idsListaApi(produtosListas.publicados);
  const produtosComDuplicidade = [...produtosNaoPublicados, ...produtosPublicados];
  const produtosUnicos = [...new Set(produtosComDuplicidade)];
  if (produtosUnicos.length !== produtosComDuplicidade.length) {
    erroManifestoApi("WIDESYS_SNAPSHOT_IDS_INVALIDOS");
  }
  const produtosDetalhes = idsDetalhesApi(
    carregados.get("produtos-detalhes.json"),
    capturadoEm,
  );

  if (
    contagens.clientes !== clientesLista.length ||
    contagens.clientesDetalhes !== clientesDetalhes.length ||
    contagens.produtosNaoPublicados !== produtosNaoPublicados.length ||
    contagens.produtosPublicados !== produtosPublicados.length ||
    contagens.produtosUnicos !== produtosUnicos.length ||
    contagens.produtosDetalhes !== produtosDetalhes.length
  ) {
    erroManifestoApi("WIDESYS_SNAPSHOT_CONTAGEM_DIVERGENTE");
  }
  if (
    contagens.clientes !== contagens.clientesDetalhes ||
    contagens.produtosUnicos !== contagens.produtosDetalhes ||
    !mesmosIds(clientesLista, clientesDetalhes) ||
    !mesmosIds(produtosUnicos, produtosDetalhes)
  ) {
    erroManifestoApi("WIDESYS_SNAPSHOT_IDS_DIVERGENTES");
  }
}

function validarRegistroUi(valor: unknown): RegistroUi | null {
  const item = objeto(valor);
  const raw = objeto(item?.raw);
  const id = identificador(item?.id);
  const modulo = texto(item?.module, 50)?.toLowerCase();
  if (!item || !raw || !id || !modulo) return null;
  const fields = array(raw.fields)
    .map(objeto)
    .map((campo) => {
      const name = texto(campo?.name, 200);
      const type = texto(campo?.type, 50) ?? "text";
      const value = campo?.value;
      if (!name || (typeof value !== "string" && !Array.isArray(value))) return null;
      const valores = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 20_000))
        : value.slice(0, 20_000);
      return {
        name,
        type,
        value: valores,
        ...(typeof campo?.checked === "boolean" ? { checked: campo.checked } : {}),
        ...(texto(campo?.label, 500) ? { label: texto(campo?.label, 500)! } : {}),
      };
    })
    .filter((campo): campo is NonNullable<typeof campo> => campo !== null);
  const tables = array(raw.tables)
    .map(objeto)
    .map((tabela) => ({
      headers: array(tabela?.headers).filter((item): item is string => typeof item === "string"),
      rows: array(tabela?.rows)
        .filter(Array.isArray)
        .map((linha) => linha.filter((item): item is string => typeof item === "string")),
    }));
  return {
    fetchedAt: texto(item.fetchedAt, 50),
    id,
    module: modulo,
    sourceUrl: texto(item.sourceUrl, 2_000),
    raw: {
      title: texto(raw.title) ?? "",
      text: texto(raw.text) ?? "",
      fields,
      tables,
    },
  };
}

type ResultadoCargaUi = { registros: RegistroUi[]; ausente: boolean };

function erroManifestoUi(codigo: string): never {
  throw new ErroImportacaoCadastrosWidesys(
    codigo,
    "A captura complementar da UI está incompleta ou não passou na verificação de integridade.",
  );
}

function caminhoUiSeguro(diretorio: string, caminhoRelativo: string): string {
  const caminho = resolve(diretorio, caminhoRelativo);
  const relativo = relative(diretorio, caminho);
  if (
    !relativo ||
    relativo === ".." ||
    relativo.startsWith(`..${sep}`) ||
    isAbsolute(relativo)
  ) {
    erroManifestoUi("WIDESYS_UI_CAMINHO_INVALIDO");
  }
  return caminho;
}

function carregarRegistrosUi(diretorio: string): ResultadoCargaUi {
  const caminhoManifesto = join(diretorio, "manifest.json");
  if (!existsSync(caminhoManifesto)) return { registros: [], ausente: true };

  const manifesto = objeto(lerJsonSeguro(caminhoManifesto));
  if (!manifesto || manifesto.version !== 1) {
    erroManifestoUi("WIDESYS_UI_MANIFESTO_VERSAO_INVALIDA");
  }
  try {
    const base = new URL(String(manifesto.baseOrigin));
    if (base.toString().replace(/\/$/, "") !== BASE_ORIGIN_WIDESYS) {
      erroManifestoUi("WIDESYS_UI_ORIGEM_INVALIDA");
    }
  } catch (erro) {
    if (erro instanceof ErroImportacaoCadastrosWidesys) throw erro;
    erroManifestoUi("WIDESYS_UI_ORIGEM_INVALIDA");
  }
  if (!Array.isArray(manifesto.errors) || manifesto.errors.length !== 0) {
    erroManifestoUi("WIDESYS_UI_CAPTURA_COM_ERROS");
  }

  const modulos = objeto(manifesto.modules);
  if (!modulos) erroManifestoUi("WIDESYS_UI_MODULOS_INVALIDOS");
  const esperadosPorModulo = new Map<string, number>();
  for (const modulo of MODULOS_UI) {
    const estado = objeto(modulos[modulo]);
    const descobertos = inteiroNaoNegativo(estado?.recordsDiscovered);
    const salvos = inteiroNaoNegativo(estado?.recordsSaved);
    const ignorados = inteiroNaoNegativo(estado?.recordsSkipped);
    const errosDetalhe = inteiroNaoNegativo(estado?.detailErrors);
    if (
      !estado ||
      estado.completed !== true ||
      descobertos === null ||
      salvos === null ||
      ignorados === null ||
      errosDetalhe !== 0 ||
      descobertos !== salvos + ignorados
    ) {
      erroManifestoUi("WIDESYS_UI_MODULO_INCOMPLETO");
    }
    esperadosPorModulo.set(modulo, descobertos);
  }

  if (!Array.isArray(manifesto.artifacts)) {
    erroManifestoUi("WIDESYS_UI_ARTEFATOS_INVALIDOS");
  }
  const artefatos = manifesto.artifacts
    .map(objeto)
    .filter((item): item is Registro => item?.kind === "detail-json");
  if (artefatos.length > MAXIMO_REGISTROS_UI) {
    throw new ErroImportacaoCadastrosWidesys(
      "WIDESYS_UI_LIMITE_EXCEDIDO",
      "Artefatos opcionais de UI excedem o limite permitido.",
    );
  }

  const registros: RegistroUi[] = [];
  const contagemPorModulo = new Map<string, number>();
  const caminhosVistos = new Set<string>();
  for (const artefato of artefatos) {
    const modulo = texto(artefato.module, 50)?.toLowerCase();
    const caminhoRelativo = texto(artefato.path, 1_000);
    const esperado = texto(artefato.sha256, 64)?.toLowerCase();
    const tamanhoEsperado = inteiroNaoNegativo(artefato.bytes);
    if (
      !modulo ||
      !MODULOS_UI.includes(modulo as (typeof MODULOS_UI)[number]) ||
      !caminhoRelativo ||
      !esperado ||
      !/^[a-f0-9]{64}$/.test(esperado) ||
      tamanhoEsperado === null ||
      tamanhoEsperado <= 0 ||
      tamanhoEsperado > MAXIMO_BYTES_ARQUIVO
    ) {
      erroManifestoUi("WIDESYS_UI_ARTEFATO_INVALIDO");
    }
    const caminhoNormalizado = caminhoRelativo.replace(/\\/g, "/");
    if (
      !caminhoNormalizado.startsWith(`${modulo}/records/`) ||
      caminhoNormalizado.slice(`${modulo}/records/`.length).includes("/") ||
      !caminhoNormalizado.endsWith(".json")
    ) {
      erroManifestoUi("WIDESYS_UI_CAMINHO_INVALIDO");
    }
    const caminho = caminhoUiSeguro(diretorio, caminhoRelativo);
    const chaveCaminho = caminho.toLowerCase();
    if (caminhosVistos.has(chaveCaminho) || !existsSync(caminho)) {
      erroManifestoUi("WIDESYS_UI_ARTEFATO_AUSENTE_OU_DUPLICADO");
    }
    caminhosVistos.add(chaveCaminho);
    const estadoArquivo = statSync(caminho);
    if (!estadoArquivo.isFile() || estadoArquivo.size !== tamanhoEsperado) {
      erroManifestoUi("WIDESYS_UI_TAMANHO_DIVERGENTE");
    }
    const buffer = readFileSync(caminho);
    const hash = createHash("sha256").update(buffer).digest("hex");
    if (hash !== esperado) erroManifestoUi("WIDESYS_UI_HASH_DIVERGENTE");

    let bruto: unknown;
    try {
      bruto = JSON.parse(buffer.toString("utf8")) as unknown;
    } catch {
      erroManifestoUi("WIDESYS_UI_JSON_INVALIDO");
    }
    const registro = validarRegistroUi(bruto);
    if (!registro || registro.module !== modulo) {
      erroManifestoUi("WIDESYS_UI_REGISTRO_INVALIDO");
    }
    registros.push(registro);
    contagemPorModulo.set(modulo, (contagemPorModulo.get(modulo) ?? 0) + 1);
  }

  for (const modulo of MODULOS_UI) {
    if ((contagemPorModulo.get(modulo) ?? 0) !== esperadosPorModulo.get(modulo)) {
      erroManifestoUi("WIDESYS_UI_CONTAGEM_DIVERGENTE");
    }
  }
  return { registros, ausente: false };
}

export function carregarPlanoCadastrosWidesys(
  diretorioInformado = join(process.cwd(), "data", "legacy-widesys"),
): PlanoCadastrosWidesys {
  const diretorio = resolve(diretorioInformado);
  const manifestoCaminho = join(diretorio, "manifesto.json");
  if (!existsSync(manifestoCaminho)) {
    throw new ErroImportacaoCadastrosWidesys(
      "WIDESYS_MANIFESTO_AUSENTE",
      "Manifesto dos snapshots Widesys não foi encontrado.",
    );
  }
  const manifesto = objeto(lerJsonSeguro(manifestoCaminho));
  if (!manifesto) {
    throw new ErroImportacaoCadastrosWidesys(
      "WIDESYS_MANIFESTO_INVALIDO",
      "Manifesto dos snapshots Widesys é inválido.",
    );
  }
  const { capturadoEm, contagens } = validarCabecalhoManifestoApi(manifesto);
  if (
    !Array.isArray(manifesto.arquivos) ||
    manifesto.arquivos.length < ARQUIVOS_API_OBRIGATORIOS.length ||
    manifesto.arquivos.length > MAXIMO_ARQUIVOS_API
  ) {
    erroManifestoApi("WIDESYS_MANIFESTO_ARQUIVOS_INVALIDOS");
  }
  const hashes = new Map<string, string>();
  const tamanhos = new Map<string, number>();
  for (const valor of manifesto.arquivos) {
    const item = objeto(valor);
    const arquivo = texto(item?.arquivo, 200);
    const hash = texto(item?.sha256, 64)?.toLowerCase();
    const bytes = item?.bytes;
    if (
      !arquivo ||
      basename(arquivo) !== arquivo ||
      !/^[a-f0-9]{64}$/.test(hash ?? "") ||
      typeof bytes !== "number" ||
      !Number.isSafeInteger(bytes) ||
      bytes <= 0 ||
      bytes > MAXIMO_BYTES_ARQUIVO ||
      hashes.has(arquivo)
    ) {
      erroManifestoApi("WIDESYS_MANIFESTO_ARQUIVOS_INVALIDOS");
    }
    hashes.set(arquivo, hash!);
    tamanhos.set(arquivo, bytes);
  }
  const carregados = new Map<string, unknown>();
  for (const [arquivo, esperado] of hashes) {
    const caminho = join(diretorio, arquivo);
    if (!existsSync(caminho)) {
      throw new ErroImportacaoCadastrosWidesys(
        "WIDESYS_SNAPSHOT_AUSENTE",
        "Manifesto ou snapshot obrigatório está incompleto.",
      );
    }
    const buffer = readFileSync(caminho);
    if (buffer.byteLength !== tamanhos.get(arquivo)) {
      erroManifestoApi("WIDESYS_SNAPSHOT_TAMANHO_DIVERGENTE");
    }
    const atual = createHash("sha256").update(buffer).digest("hex");
    if (atual !== esperado) {
      throw new ErroImportacaoCadastrosWidesys(
        "WIDESYS_SNAPSHOT_HASH_DIVERGENTE",
        "Integridade de um snapshot obrigatório não confere com o manifesto.",
      );
    }
    if ((ARQUIVOS_API_OBRIGATORIOS as readonly string[]).includes(arquivo)) {
      carregados.set(arquivo, lerJsonSeguro(caminho));
    }
  }
  for (const arquivo of ARQUIVOS_API_OBRIGATORIOS) {
    if (!carregados.has(arquivo)) {
      throw new ErroImportacaoCadastrosWidesys(
        "WIDESYS_SNAPSHOT_AUSENTE",
        "Manifesto ou snapshot obrigatório está incompleto.",
      );
    }
  }
  validarCompletudeSnapshotsApi(carregados, capturadoEm, contagens);
  const ui = carregarRegistrosUi(diretorio);
  const plano = construirPlanoCadastrosWidesys({
    clientesLista: carregados.get("clientes-lista.json"),
    clientesDetalhes: carregados.get("clientes-detalhes.json"),
    produtosListas: carregados.get("produtos-listas.json"),
    produtosDetalhes: carregados.get("produtos-detalhes.json"),
    capturadoEm,
    uiRegistros: ui.registros,
  });
  if (ui.ausente) {
    plano.avisos.push({ codigo: "ui_nao_capturada", quantidade: 1 });
    plano.avisos.sort((a, b) => a.codigo.localeCompare(b.codigo));
  }
  return plano;
}

function contadores(): ContadoresAlteracao {
  return { criados: 0, atualizados: 0, inalterados: 0 };
}

function classificar(
  contador: ContadoresAlteracao,
  existente: { snapshotHash: string } | undefined,
  novoHash: string,
  forcarAtualizacao = false,
): "CRIAR" | "ATUALIZAR" | "MANTER" {
  if (!existente) {
    contador.criados += 1;
    return "CRIAR";
  }
  if (!forcarAtualizacao && existente.snapshotHash === novoHash) {
    contador.inalterados += 1;
    return "MANTER";
  }
  contador.atualizados += 1;
  return "ATUALIZAR";
}

function mesmaData(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

function resumoPrevisto(plano: PlanoCadastrosWidesys): RelatorioImportacaoCadastrosWidesys["previstos"] {
  return {
    pessoas: plano.pessoas.length,
    papeis: plano.pessoas.reduce((total, pessoa) => total + pessoa.papeis.length, 0),
    emails: plano.pessoas.reduce((total, pessoa) => total + pessoa.emails.length, 0),
    telefones: plano.pessoas.reduce((total, pessoa) => total + pessoa.telefones.length, 0),
    imoveis: plano.imoveis.length,
    proprietarios: plano.imoveis.reduce((total, imovel) => total + imovel.proprietarios.length, 0),
  };
}

export function criarRelatorioDryRunCadastrosWidesys(
  plano: PlanoCadastrosWidesys,
): RelatorioImportacaoCadastrosWidesys {
  return {
    modo: "DRY_RUN",
    origem: plano.origem,
    previstos: resumoPrevisto(plano),
    alteracoes: null,
    vinculosLocatario: null,
    avisos: plano.avisos,
  };
}

function dadosPessoa(pessoa: PessoaPlanejadaWidesys): Prisma.PessoaUncheckedCreateInput {
  const { papeis: _papeis, emails: _emails, telefones: _telefones, ...dados } = pessoa;
  void _papeis;
  void _emails;
  void _telefones;
  return dados;
}

function dadosImovel(imovel: ImovelPlanejadoWidesys): Prisma.ImovelLegadoUncheckedCreateInput {
  const { proprietarios: _proprietarios, ...dados } = imovel;
  void _proprietarios;
  return dados;
}

export async function importarPlanoCadastrosWidesys(
  prisma: PrismaClient,
  plano: PlanoCadastrosWidesys,
): Promise<RelatorioImportacaoCadastrosWidesys> {
  const avisos = new Map(plano.avisos.map((aviso) => [aviso.codigo, aviso.quantidade]));
  const alteracoes = {
    pessoas: contadores(),
    papeis: contadores(),
    emails: contadores(),
    telefones: contadores(),
    imoveis: contadores(),
    proprietarios: contadores(),
  };
  const vinculosLocatario = {
    vinculados: 0,
    jaVinculados: 0,
    semCpfCnpj: 0,
    semCorrespondencia: 0,
    ambiguos: 0,
    conflitos: 0,
  };

  await prisma.$transaction(
    async (tx) => {
      const [pessoasExistentes, papeisExistentes, emailsExistentes, telefonesExistentes] =
        await Promise.all([
          tx.pessoa.findMany({
            where: { origem: plano.origem },
            select: { id: true, legadoId: true, snapshotHash: true, capturadoEm: true },
          }),
          tx.pessoaPapel.findMany({ where: { origem: plano.origem }, select: { legadoId: true, papel: true, snapshotHash: true } }),
          tx.pessoaEmail.findMany({ where: { origem: plano.origem }, select: { legadoId: true, emailNorm: true, snapshotHash: true } }),
          tx.pessoaTelefone.findMany({ where: { origem: plano.origem }, select: { legadoId: true, telefoneNorm: true, snapshotHash: true } }),
        ]);
      const pessoasPorLegado = new Map(pessoasExistentes.map((item) => [item.legadoId, item]));
      const papeisPorChave = new Map(papeisExistentes.map((item) => [`${item.legadoId}|${item.papel}`, item]));
      const emailsPorChave = new Map(emailsExistentes.map((item) => [`${item.legadoId}|${item.emailNorm}`, item]));
      const telefonesPorChave = new Map(telefonesExistentes.map((item) => [`${item.legadoId}|${item.telefoneNorm}`, item]));
      const idsPessoasPlano = new Set(plano.pessoas.map((pessoa) => pessoa.legadoId));
      const papeisPlano = new Set(
        plano.pessoas.flatMap((pessoa) =>
          pessoa.papeis.map((papel) => `${pessoa.legadoId}|${papel.papel}`),
        ),
      );
      const emailsPlano = new Set(
        plano.pessoas.flatMap((pessoa) =>
          pessoa.emails.map((email) => `${pessoa.legadoId}|${email.emailNorm}`),
        ),
      );
      const telefonesPlano = new Set(
        plano.pessoas.flatMap((pessoa) =>
          pessoa.telefones.map((telefone) => `${pessoa.legadoId}|${telefone.telefoneNorm}`),
        ),
      );
      for (const existente of pessoasExistentes) {
        if (!idsPessoasPlano.has(existente.legadoId)) registrarAviso(avisos, "pessoa_ausente_na_origem");
      }
      for (const existente of papeisExistentes) {
        if (!papeisPlano.has(`${existente.legadoId}|${existente.papel}`)) {
          registrarAviso(avisos, "papel_ausente_na_origem");
        }
      }
      for (const existente of emailsExistentes) {
        if (!emailsPlano.has(`${existente.legadoId}|${existente.emailNorm}`)) {
          registrarAviso(avisos, "email_ausente_na_origem");
        }
      }
      for (const existente of telefonesExistentes) {
        if (!telefonesPlano.has(`${existente.legadoId}|${existente.telefoneNorm}`)) {
          registrarAviso(avisos, "telefone_ausente_na_origem");
        }
      }
      const idsPessoa = new Map<string, string>();

      for (const pessoa of plano.pessoas) {
        const existente = pessoasPorLegado.get(pessoa.legadoId);
        const acao = classificar(alteracoes.pessoas, existente, pessoa.snapshotHash);
        let pessoaId = existente?.id;
        if (acao === "CRIAR") {
          pessoaId = (await tx.pessoa.create({ data: dadosPessoa(pessoa) })).id;
        } else if (acao === "ATUALIZAR") {
          await tx.pessoa.update({
            where: { origem_legadoId: { origem: plano.origem, legadoId: pessoa.legadoId } },
            data: dadosPessoa(pessoa),
          });
        } else if (existente && !mesmaData(existente.capturadoEm, pessoa.capturadoEm)) {
          await tx.pessoa.update({
            where: { origem_legadoId: { origem: plano.origem, legadoId: pessoa.legadoId } },
            data: { capturadoEm: pessoa.capturadoEm },
          });
        }
        if (!pessoaId) throw new Error("Pessoa importada sem identidade interna.");
        idsPessoa.set(pessoa.legadoId, pessoaId);

        for (const papel of pessoa.papeis) {
          const chave = `${pessoa.legadoId}|${papel.papel}`;
          const acaoPapel = classificar(alteracoes.papeis, papeisPorChave.get(chave), papel.snapshotHash);
          const data = {
            pessoaId,
            papel: papel.papel,
            origem: plano.origem,
            legadoId: pessoa.legadoId,
            snapshot: papel.snapshot,
            snapshotHash: papel.snapshotHash,
          };
          if (acaoPapel === "CRIAR") await tx.pessoaPapel.create({ data });
          else if (acaoPapel === "ATUALIZAR") {
            await tx.pessoaPapel.update({
              where: { origem_legadoId_papel: { origem: plano.origem, legadoId: pessoa.legadoId, papel: papel.papel } },
              data,
            });
          }
        }
        for (const email of pessoa.emails) {
          const chave = `${pessoa.legadoId}|${email.emailNorm}`;
          const acaoEmail = classificar(alteracoes.emails, emailsPorChave.get(chave), email.snapshotHash);
          const data = { pessoaId, origem: plano.origem, legadoId: pessoa.legadoId, ...email };
          if (acaoEmail === "CRIAR") await tx.pessoaEmail.create({ data });
          else if (acaoEmail === "ATUALIZAR") {
            await tx.pessoaEmail.update({
              where: { origem_legadoId_emailNorm: { origem: plano.origem, legadoId: pessoa.legadoId, emailNorm: email.emailNorm } },
              data,
            });
          }
        }
        for (const telefone of pessoa.telefones) {
          const chave = `${pessoa.legadoId}|${telefone.telefoneNorm}`;
          const acaoTelefone = classificar(alteracoes.telefones, telefonesPorChave.get(chave), telefone.snapshotHash);
          const data = { pessoaId, origem: plano.origem, legadoId: pessoa.legadoId, ...telefone };
          if (acaoTelefone === "CRIAR") await tx.pessoaTelefone.create({ data });
          else if (acaoTelefone === "ATUALIZAR") {
            await tx.pessoaTelefone.update({
              where: { origem_legadoId_telefoneNorm: { origem: plano.origem, legadoId: pessoa.legadoId, telefoneNorm: telefone.telefoneNorm } },
              data,
            });
          }
        }
      }

      const [imoveisExistentes, proprietariosExistentes] = await Promise.all([
        tx.imovelLegado.findMany({
          where: { origem: plano.origem },
          select: { id: true, legadoId: true, snapshotHash: true, capturadoEm: true },
        }),
        tx.imovelProprietarioLegado.findMany({
          where: { origem: plano.origem },
          select: { legadoId: true, snapshotHash: true, pessoaId: true },
        }),
      ]);
      const imoveisPorLegado = new Map(imoveisExistentes.map((item) => [item.legadoId, item]));
      const proprietariosPorLegado = new Map(proprietariosExistentes.map((item) => [item.legadoId, item]));
      const idsImoveisPlano = new Set(plano.imoveis.map((imovel) => imovel.legadoId));
      const idsProprietariosPlano = new Set(
        plano.imoveis.flatMap((imovel) => imovel.proprietarios.map((proprietario) => proprietario.legadoId)),
      );
      for (const existente of imoveisExistentes) {
        if (!idsImoveisPlano.has(existente.legadoId)) registrarAviso(avisos, "imovel_ausente_na_origem");
      }
      for (const existente of proprietariosExistentes) {
        if (!idsProprietariosPlano.has(existente.legadoId)) {
          registrarAviso(avisos, "proprietario_ausente_na_origem");
        }
      }
      for (const imovel of plano.imoveis) {
        const existente = imoveisPorLegado.get(imovel.legadoId);
        const acao = classificar(alteracoes.imoveis, existente, imovel.snapshotHash);
        let imovelId = existente?.id;
        if (acao === "CRIAR") imovelId = (await tx.imovelLegado.create({ data: dadosImovel(imovel) })).id;
        else if (acao === "ATUALIZAR") {
          await tx.imovelLegado.update({
            where: { origem_legadoId: { origem: plano.origem, legadoId: imovel.legadoId } },
            data: dadosImovel(imovel),
          });
        } else if (existente && !mesmaData(existente.capturadoEm, imovel.capturadoEm)) {
          await tx.imovelLegado.update({
            where: { origem_legadoId: { origem: plano.origem, legadoId: imovel.legadoId } },
            data: { capturadoEm: imovel.capturadoEm },
          });
        }
        if (!imovelId) throw new Error("Imóvel importado sem identidade interna.");
        for (const proprietario of imovel.proprietarios) {
          const existenteProprietario = proprietariosPorLegado.get(proprietario.legadoId);
          const pessoaId = proprietario.pessoaLegadoId
            ? idsPessoa.get(proprietario.pessoaLegadoId) ?? null
            : null;
          const acaoProprietario = classificar(
            alteracoes.proprietarios,
            existenteProprietario,
            proprietario.snapshotHash,
            Boolean(existenteProprietario && existenteProprietario.pessoaId !== pessoaId),
          );
          const data = {
            imovelId,
            pessoaId,
            origem: plano.origem,
            legadoId: proprietario.legadoId,
            proprietarioLegadoId: proprietario.proprietarioLegadoId,
            porcentagem: proprietario.porcentagem,
            contaLegadoId: proprietario.contaLegadoId,
            principal: proprietario.principal,
            ordem: proprietario.ordem,
            snapshot: proprietario.snapshot,
            snapshotHash: proprietario.snapshotHash,
          };
          if (acaoProprietario === "CRIAR") await tx.imovelProprietarioLegado.create({ data });
          else if (acaoProprietario === "ATUALIZAR") {
            await tx.imovelProprietarioLegado.update({
              where: { origem_legadoId: { origem: plano.origem, legadoId: proprietario.legadoId } },
              data,
            });
          }
        }
      }

      const inquilinos = plano.pessoas.filter((pessoa) =>
        pessoa.papeis.some((papel) => papel.papel === "INQUILINO"),
      );
      const idsInternos = inquilinos
        .map((pessoa) => idsPessoa.get(pessoa.legadoId))
        .filter((id): id is string => Boolean(id));
      const documentos = inquilinos
        .map((pessoa) => pessoa.cpfCnpj)
        .filter((documento): documento is string => Boolean(documento));
      const locatarios = await tx.locatario.findMany({
        where: {
          OR: [
            ...(idsInternos.length ? [{ pessoaId: { in: idsInternos } }] : []),
            ...(documentos.length ? [{ cpfCnpj: { in: documentos } }] : []),
          ],
        },
        select: { id: true, pessoaId: true, cpfCnpj: true },
      });
      for (const pessoa of inquilinos) {
        const pessoaId = idsPessoa.get(pessoa.legadoId)!;
        if (locatarios.some((locatario) => locatario.pessoaId === pessoaId)) {
          vinculosLocatario.jaVinculados += 1;
          continue;
        }
        if (!pessoa.cpfCnpj) {
          vinculosLocatario.semCpfCnpj += 1;
          continue;
        }
        const candidatos = locatarios.filter((locatario) => locatario.cpfCnpj === pessoa.cpfCnpj);
        if (candidatos.length === 0) {
          vinculosLocatario.semCorrespondencia += 1;
          continue;
        }
        if (candidatos.length > 1) {
          vinculosLocatario.ambiguos += 1;
          continue;
        }
        if (candidatos[0].pessoaId && candidatos[0].pessoaId !== pessoaId) {
          vinculosLocatario.conflitos += 1;
          continue;
        }
        await tx.locatario.update({ where: { id: candidatos[0].id }, data: { pessoaId } });
        vinculosLocatario.vinculados += 1;
      }
    },
    { maxWait: 10_000, timeout: 120_000 },
  );

  return {
    modo: "APLICADO",
    origem: plano.origem,
    previstos: resumoPrevisto(plano),
    alteracoes,
    vinculosLocatario,
    avisos: [...avisos.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([codigo, quantidade]) => ({ codigo, quantidade })),
  };
}
