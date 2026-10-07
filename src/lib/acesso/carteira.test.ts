import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consultarCarteira, csvCarteira } from "./carteira";
import { lerOperacaoUnificada } from "../unificacao/servico";
import type { PoliticaAcesso, Regra } from "./politica";
import type { LinhaUnificada } from "../unificacao/tipos";
import { GET } from "@/app/(app)/carteira/exportar/route";

const ambiente = vi.hoisted(() => ({ db: null as PrismaClient | null, politica: null as PoliticaAcesso | null }));
vi.mock("server-only", () => ({}));
vi.mock("../unificacao/servico", () => ({ lerOperacaoUnificada: vi.fn() }));
vi.mock("./servidor", () => ({ acessoAtual: async () => ambiente.politica }));
vi.mock("../db", () => ({ get prisma() { return ambiente.db; } }));
let db: PrismaClient;
let diretorio: string;
let linhas: LinhaUnificada[];
const liberar = (tipo: string, recursoId: string): Regra => ({ tipo, recursoId, efeito: "PERMITIR" });
const bloquear = (tipo: string, recursoId: string): Regra => ({ tipo, recursoId, efeito: "BLOQUEAR" });
const politica = (regras: Regra[] = [liberar("EMPREENDIMENTO", "EA")], extras: Partial<PoliticaAcesso> = {}): PoliticaAcesso => ({ usuarioId: "leitor", perfil: "SOCIO", ativo: true, global: false, permissoes: ["carteira.ver", "cadastros.ver", "contratos.ver", "financeiro.ver"], regras, ...extras });
function titulo(id: string, contrato: string, imovel: string, origem: "BRISA" | "WIDESYS" = "BRISA"): LinhaUnificada {
  const chave = `${origem}:RECEBER:${id}`;
  return { chave, dominio: "RECEBER", origem, origemId: id, titulo: "Detalhe reservado que não pode sair", descricao: "Observação privada", href: "/recebimentos", hash: "hash-privado", qualidade: "OK", motivos: [], campos: { comissao: { rotulo: "Comissão", valor: 987654321 }, documento: { rotulo: "CPF", valor: "CPF_PRIVADO" } }, nomeNorm: "PESSOA", contratoChave: `${origem}:CONTRATO:${contrato}`, imovelChave: `${origem}:IMOVEL:${imovel}`, competencia: "2026-10", valor: 100_000, pago: 40_000, aberto: 60_000, vencimento: "2026-10-10", estado: "ATIVO", origens: [origem], fontes: [chave], versao: 1, candidatos: [{ chave: "WIDESYS:RECEBER:SEGREDO", motivos: ["DOCUMENTO_IGUAL"], titulo: "Outro cliente secreto", descricao: "Comissão privada" }], avisos: [], contabiliza: true, divergencias: [], proveniencia: { arquivo: "privado.xlsx" } };
}

beforeEach(async () => {
  diretorio = mkdtempSync(join(tmpdir(), "brisa-isolamento-carteira-"));
  db = new PrismaClient({ datasourceUrl: `file:${join(diretorio, "fixture.db").replaceAll("\\", "/")}` });
  ambiente.db = db;
  ambiente.politica = politica();
  await db.$transaction([
    `CREATE TABLE RecursoGovernado (id TEXT PRIMARY KEY, tipo TEXT NOT NULL, origemId TEXT NOT NULL, status TEXT NOT NULL)`,
    `CREATE TABLE Empreendimento (id TEXT PRIMARY KEY, nome TEXT NOT NULL)`,
    `CREATE TABLE Unidade (id TEXT PRIMARY KEY, empreendimentoId TEXT NOT NULL, identificacao TEXT NOT NULL)`,
    `CREATE TABLE Locatario (id TEXT PRIMARY KEY, nome TEXT NOT NULL, pessoaId TEXT, cpfCnpj TEXT, email TEXT, telefone TEXT)`,
    `CREATE TABLE Pessoa (id TEXT PRIMARY KEY, nome TEXT NOT NULL, origem TEXT NOT NULL, legadoId TEXT NOT NULL, cpfCnpj TEXT)`,
    `CREATE TABLE PessoaEmail (id TEXT PRIMARY KEY, pessoaId TEXT NOT NULL, email TEXT NOT NULL)`,
    `CREATE TABLE Contrato (id TEXT PRIMARY KEY, unidadeId TEXT NOT NULL, locatarioId TEXT, status TEXT NOT NULL, inicio TEXT, fim TEXT)`,
    `CREATE TABLE Recebimento (id TEXT PRIMARY KEY, contratoId TEXT NOT NULL, competencia TEXT NOT NULL, origemAgregada BOOLEAN NOT NULL DEFAULT 0)`,
    `CREATE TABLE ImovelLegado (id TEXT PRIMARY KEY, origem TEXT NOT NULL, legadoId TEXT NOT NULL, nome TEXT, referencia TEXT)`,
    `CREATE TABLE ContratoLegado (id TEXT PRIMARY KEY, origem TEXT NOT NULL, legadoId TEXT NOT NULL, imovelLegadoId TEXT, situacaoOrigem TEXT, inicio TEXT, fim TEXT, statusImportacao TEXT NOT NULL DEFAULT 'STAGING')`,
    `CREATE TABLE ContratoParteLegado (id TEXT PRIMARY KEY, contratoId TEXT, origem TEXT NOT NULL, pessoaLegadoId TEXT, papel TEXT NOT NULL, statusImportacao TEXT NOT NULL DEFAULT 'STAGING')`,
    `CREATE TABLE TituloFinanceiroLegado (id TEXT PRIMARY KEY, origem TEXT NOT NULL, contratoLegadoId TEXT, pessoaLegadoId TEXT, natureza TEXT NOT NULL, planoContaRotulo TEXT, tipoCobrancaRotulo TEXT, competencia TEXT, vencimento TEXT)`,
  ].map(ddl => db.$executeRawUnsafe(ddl)));
  await db.$transaction([
    `INSERT INTO Empreendimento VALUES ('EA','Empreendimento A'),('EB','Empreendimento B')`,
    `INSERT INTO Unidade VALUES ('UA1','EA','Unidade A1'),('UA2','EA','Unidade A2'),('UB1','EB','Unidade B1'),('UB2','EB','Unidade B2')`,
    `INSERT INTO Pessoa VALUES ('P1','Cliente A','WIDESYS','11','DOC_P1'),('P2','Cliente A2','WIDESYS','22','DOC_P2'),('PB','Cliente B','WIDESYS','33','DOC_PB'),('PX','Cliente de outra origem','OUTRO','11','DOC_PX')`,
    `INSERT INTO PessoaEmail VALUES ('EM1','P1','privado-p1@example.test')`,
    `INSERT INTO Locatario VALUES ('LA','Cliente A','P1','DOC_LA','privado-la@example.test','TELEFONE_LA'),('LA2','Cliente A2','P2','DOC_LA2',NULL,NULL),('LB','Cliente B','PB','DOC_LB',NULL,NULL)`,
    `INSERT INTO Contrato VALUES ('CA1','UA1','LA','ativo','2026-01-01',NULL),('CA2','UA2','LA2','ativo',NULL,NULL),('CB1','UB1','LB','ativo',NULL,NULL),('CB2','UB2','LA','ativo',NULL,NULL)`,
    `INSERT INTO Recebimento VALUES ('RA1','CA1','2026-10',0),('RA2','CA2','2026-10',0),('RB1','CB1','2026-10',0),('RB2','CB2','2026-10',0),('AGREGADO','CA1','2026-10',1),('OUTROMES','CA1','2026-09',0)`,
    `INSERT INTO ImovelLegado VALUES ('IL1','WIDESYS','101','Imóvel legado A',NULL),('IL2','WIDESYS','102','Imóvel legado B',NULL),('ILX','OUTRO','101','Imóvel outra origem',NULL)`,
    `INSERT INTO ContratoLegado(id,origem,legadoId,imovelLegadoId,situacaoOrigem) VALUES ('CL1','WIDESYS','201','101','ativo'),('CL2','WIDESYS','202','102','ativo'),('CLX','OUTRO','201','101','ativo')`,
    `INSERT INTO ContratoParteLegado(id,contratoId,origem,pessoaLegadoId,papel) VALUES ('PARTE1','CL1','WIDESYS','11','INQUILINO'),('PARTE2','CL2','WIDESYS','33','INQUILINO'),('PARTEX','CLX','OUTRO','11','INQUILINO')`,
    `INSERT INTO TituloFinanceiroLegado VALUES ('TL1','WIDESYS','201','11','RECEBER','Aluguel',NULL,'2026-10',NULL),('TL2','WIDESYS','202','33','RECEBER','Aluguel',NULL,'2026-10',NULL),('TLX','OUTRO','201','11','RECEBER','Aluguel',NULL,'2026-10',NULL),('COMISSAO','WIDESYS','201','11','RECEBER','Taxa de administração',NULL,'2026-10',NULL)`,
  ].map(sql => db.$executeRawUnsafe(sql)));
  linhas = [titulo("RA1", "CA1", "UA1"), titulo("RA2", "CA2", "UA2"), titulo("RB1", "CB1", "UB1"), titulo("RB2", "CB2", "UB2"), titulo("AGREGADO", "CA1", "UA1"), titulo("TL1", "CL1", "IL1", "WIDESYS"), titulo("TL2", "CL2", "IL2", "WIDESYS"), titulo("TLX", "CLX", "ILX", "WIDESYS"), titulo("COMISSAO", "CL1", "IL1", "WIDESYS")];
  vi.mocked(lerOperacaoUnificada).mockImplementation(async () => ({ fontes: linhas, decisoes: [], linhas }));
}, 30000);

afterEach(async () => {
  vi.clearAllMocks();
  await db.$disconnect();
  const alvo = resolve(diretorio);
  if (alvo.toLowerCase().startsWith(`${resolve(tmpdir())}${sep}`.toLowerCase()) && basename(alvo).startsWith("brisa-isolamento-carteira-")) rmSync(alvo, { recursive: true, force: true });
});

describe("carteira: isolamento por vínculos comprovados", () => {
  it("empreendimento A não revela contratos, títulos ou clientes exclusivos de B", async () => {
    const dados = await consultarCarteira(db, politica(), "2026-10");
    expect(dados.imoveis.map(x => x.id)).toEqual(["BRISA:UA1", "BRISA:UA2"]);
    expect(dados.empreendimentos.map(x => x.id)).toEqual(["EA"]);
    expect(dados.contratos.map(x => x.id)).toEqual(["BRISA:CA1", "BRISA:CA2"]);
    expect(dados.titulos.map(x => x.id)).toEqual(["BRISA:RECEBER:RA1", "BRISA:RECEBER:RA2"]);
    expect(JSON.stringify(dados)).not.toMatch(/Cliente B|Unidade B|BRISA:CB|BRISA:RB/);
  });
  it("bloqueio explícito da unidade prevalece sobre o empreendimento permitido", async () => {
    const dados = await consultarCarteira(db, politica([liberar("EMPREENDIMENTO", "EA"), liberar("UNIDADE", "UA2"), bloquear("UNIDADE", "UA2")]), "2026-10");
    expect(dados.imoveis.map(x => x.id)).toEqual(["BRISA:UA1"]);
    expect(dados.contratos.map(x => x.id)).toEqual(["BRISA:CA1"]);
    expect(dados.clientes.map(x => x.id)).toEqual(["BRISA:LA"]);
  });
  it("empreendimento negado prevalece sobre unidade permitida", async () => {
    const dados = await consultarCarteira(db, politica([liberar("UNIDADE", "UA1"), bloquear("EMPREENDIMENTO", "EA")]), "2026-10");
    expect(dados.imoveis).toEqual([]);
    expect(dados.titulos).toEqual([]);
  });
  it("empreendimento explicitamente permitido aparece mesmo antes de cadastrar unidades", async () => {
    await db.$executeRaw`INSERT INTO Empreendimento VALUES ('VAZIO','Empreendimento novo')`;
    const dados = await consultarCarteira(db, politica([liberar("EMPREENDIMENTO", "VAZIO")]), "2026-10");
    expect(dados.empreendimentos.map(x => x.id)).toEqual(["VAZIO"]);
    expect(dados.imoveis).toEqual([]);
  });
  it.each([{ regras: [liberar("LOCATARIO", "LA")] }, { regras: [liberar("PESSOA", "P1")] }])("conhecer um cliente não concede seus imóveis, contratos ou títulos", async ({ regras }) => {
    const dados = await consultarCarteira(db, politica(regras), "2026-10");
    expect(dados.clientes.map(x => x.id)).toEqual(["BRISA:LA"]);
    expect(dados.imoveis).toEqual([]);
    expect(dados.contratos).toEqual([]);
    expect(dados.titulos).toEqual([]);
  });
  it("Pessoa bloqueada retira locatário e os contratos/títulos vinculados nas duas origens", async () => {
    const dados = await consultarCarteira(db, politica([bloquear("PESSOA", "P1")], { global: true }), "2026-10");
    expect(dados.clientes.some(x => x.id === "BRISA:LA" || x.id === "WIDESYS:P1")).toBe(false);
    expect(dados.contratos.some(x => ["BRISA:CA1", "BRISA:CB2", "WIDESYS:CL1"].includes(x.id))).toBe(false);
    expect(dados.titulos.some(x => ["BRISA:RECEBER:RA1", "BRISA:RECEBER:RB2", "WIDESYS:RECEBER:TL1"].includes(x.id))).toBe(false);
    expect(dados.contratos.some(x => x.id === "WIDESYS:CLX")).toBe(true);
  });
  it("Locatário bloqueado também retira Pessoa vinculada e seus contratos legados", async () => {
    const dados = await consultarCarteira(db, politica([bloquear("LOCATARIO", "LA")], { global: true }), "2026-10");
    expect(dados.clientes.some(x => x.id === "BRISA:LA" || x.id === "WIDESYS:P1")).toBe(false);
    expect(dados.contratos.some(x => ["BRISA:CA1", "BRISA:CB2", "WIDESYS:CL1"].includes(x.id))).toBe(false);
    expect(dados.titulos.some(x => ["BRISA:RECEBER:RA1", "BRISA:RECEBER:RB2", "WIDESYS:RECEBER:TL1"].includes(x.id))).toBe(false);
  });
  it("global continua respeitando empreendimento e imóvel negados", async () => {
    const dados = await consultarCarteira(db, politica([bloquear("EMPREENDIMENTO", "EB"), bloquear("IMOVEL_LEGADO", "IL2")], { global: true }), "2026-10");
    expect(dados.imoveis.some(x => ["BRISA:UB1", "BRISA:UB2", "WIDESYS:IL2"].includes(x.id))).toBe(false);
    expect(dados.contratos.some(x => ["BRISA:CB1", "BRISA:CB2", "WIDESYS:CL2"].includes(x.id))).toBe(false);
  });
  it("não compartilha PII sem permissão específica nem campos internos com ela", async () => {
    const dados = await consultarCarteira(db, politica(), "2026-10");
    expect(JSON.stringify(dados)).not.toMatch(/DOC_|privado-la|TELEFONE|documento|contato|comissao|candidatos|privado.xlsx|Observação privada/);
    const sensivel = await consultarCarteira(db, politica([], { global: true, permissoes: [...politica().permissoes, "cadastros.sensiveis"] }), "2026-10");
    expect(sensivel.clientes.find(x => x.id === "BRISA:LA")).toMatchObject({ documento: "DOC_LA", contato: "privado-la@example.test" });
    expect(JSON.stringify(sensivel)).not.toMatch(/comissao|candidatos|987654321|hash-privado|privado.xlsx/);
  });
  it("permissões de módulos omitidas não reaparecem em outras abas", async () => {
    const dados = await consultarCarteira(db, politica(undefined, { permissoes: ["carteira.ver", "financeiro.ver", "cadastros.sensiveis"] }), "2026-10");
    expect(dados.clientes).toEqual([]);
    expect(dados.imoveis).toEqual([]);
    expect(dados.contratos).toEqual([]);
    expect(dados.titulos.every(t => t.cliente === "Cliente restrito")).toBe(true);
    expect(JSON.stringify(dados)).not.toContain("DOC_");
  });
  it("apenas cadastro legado liberado e origem externa exata geram contratos e títulos", async () => {
    const dados = await consultarCarteira(db, politica([liberar("IMOVEL_LEGADO", "IL1")]), "2026-10");
    expect(dados.contratos.map(x => x.id)).toEqual(["WIDESYS:CL1"]);
    expect(dados.titulos.map(x => x.id)).toEqual(["WIDESYS:RECEBER:TL1"]);
    expect(dados.clientes.map(x => x.id)).toEqual(["WIDESYS:P1"]);
    expect(JSON.stringify(dados)).not.toMatch(/OUTRO|outra origem|COMISSAO|TLX/);
  });
  it("parte de contrato com origem divergente não concede acesso por coincidência do ID", async () => {
    await db.$executeRaw`UPDATE ContratoParteLegado SET origem='OUTRO' WHERE id='PARTE1'`;
    const dados = await consultarCarteira(db, politica([liberar("IMOVEL_LEGADO", "IL1")]), "2026-10");
    expect(dados.contratos).toEqual([]);
    expect(dados.titulos).toEqual([]);
  });
  it("nunca exporta comissão rotulada, origem agregada ou título de outro mês", async () => {
    const dados = await consultarCarteira(db, politica([], { global: true }), "2026-10");
    expect(dados.titulos.some(x => /COMISSAO|AGREGADO|OUTROMES/.test(x.id))).toBe(false);
  });
  it("não compartilha título legado sem classificação comprovada", async () => {
    await db.$executeRaw`UPDATE TituloFinanceiroLegado SET planoContaRotulo=NULL,tipoCobrancaRotulo=NULL WHERE id='TL1'`;
    const dados = await consultarCarteira(db, politica([liberar("IMOVEL_LEGADO", "IL1")]), "2026-10");
    expect(dados.titulos).toEqual([]);
  });
  it("fontes vinculadas fora da carteira bloqueiam a linha inteira", async () => {
    linhas[0].fontes.push("BRISA:RECEBER:RB1");
    const dados = await consultarCarteira(db, politica(), "2026-10");
    expect(dados.titulos.map(x => x.id)).toEqual(["BRISA:RECEBER:RA2"]);
  });
  it("vínculo alterado entre leitura do cadastro e projeção é negado", async () => {
    linhas[0].contratoChave = "BRISA:CONTRATO:CB1";
    const dados = await consultarCarteira(db, politica(), "2026-10");
    expect(dados.titulos.map(x => x.id)).toEqual(["BRISA:RECEBER:RA2"]);
  });
  it("confere vínculo de todas as fontes, não apenas da linha canônica", async () => {
    const fontes = linhas.map(l => ({ ...l }));
    fontes[1].imovelChave = "BRISA:IMOVEL:UB1";
    linhas[0].fontes.push("BRISA:RECEBER:RA2");
    vi.mocked(lerOperacaoUnificada).mockResolvedValue({ fontes, linhas, decisoes: [] });
    const dados = await consultarCarteira(db, politica(), "2026-10");
    expect(dados.titulos).toEqual([]);
  });
  it("fora dos totais, cancelado e sem fontes não aparecem", async () => {
    linhas[0].contabiliza = false;
    linhas[1].cancelado = true;
    linhas[2].fontes = [];
    const dados = await consultarCarteira(db, politica([], { global: true }), "2026-10");
    expect(dados.titulos.some(x => ["BRISA:RECEBER:RA1", "BRISA:RECEBER:RA2", "BRISA:RECEBER:RB1"].includes(x.id))).toBe(false);
  });
  it("governança lógica prevalece sobre permissão de cadastro", async () => {
    await db.$executeRaw`INSERT INTO RecursoGovernado VALUES ('g1','UNIDADE','UA1','EXCLUIDO')`;
    const dados = await consultarCarteira(db, politica(), "2026-10");
    expect(dados.imoveis.map(x => x.id)).toEqual(["BRISA:UA2"]);
    expect(dados.titulos.map(x => x.id)).toEqual(["BRISA:RECEBER:RA2"]);
  });
  it("sem carteira.ver ou usuário inativo não lê banco nem unificação", async () => {
    const spy = vi.spyOn(db.recursoGovernado, "findMany");
    const vazio = { imoveis: [], empreendimentos: [], clientes: [], contratos: [], titulos: [] };
    expect(await consultarCarteira(db, politica([], { permissoes: [] }), "2026-10")).toEqual(vazio);
    expect(await consultarCarteira(db, politica([], { ativo: false }), "2026-10")).toEqual(vazio);
    expect(spy).not.toHaveBeenCalled();
    expect(lerOperacaoUnificada).not.toHaveBeenCalled();
  });
  it("competência inválida é rejeitada", async () => {
    await expect(consultarCarteira(db, politica(), "2026-99")).rejects.toThrow("Competência inválida");
  });
  it("CSV neutraliza fórmulas, inclusive com espaços ou controle no início", () => {
    for (const cliente of ["=HYPERLINK(1)", " +cmd", "\t@formula", "\r=1", "\n-10"]) {
      const csv = csvCarteira([{ id: "1", origem: "Brisa", natureza: "RECEBER", imovel: "Imóvel", cliente, competencia: "2026-10", vencimento: null, devido: 10000, pago: 2000, aberto: 8000 }]);
      expect(csv).toContain(`"'${cliente}"`);
      expect(csv).toContain('"100.00";"20.00";"80.00"');
    }
  });
  it("exportação nega chamada direta sem as três permissões necessárias", async () => {
    for (const falta of ["carteira.ver", "financeiro.ver", "relatorios.exportar"]) {
      ambiente.politica = politica(undefined, { permissoes: ["carteira.ver", "financeiro.ver", "relatorios.exportar"].filter(p => p !== falta) as PoliticaAcesso["permissoes"] });
      const resposta = await GET(new Request("http://localhost/carteira/exportar?mes=2026-10"));
      expect(resposta.status).toBe(403);
    }
    expect(lerOperacaoUnificada).not.toHaveBeenCalled();
  });
  it("exportação valida mês e usa exatamente o mesmo filtro de carteira sem cache", async () => {
    ambiente.politica = politica(undefined, { permissoes: [...politica().permissoes, "relatorios.exportar"] });
    const invalido = await GET(new Request("http://localhost/carteira/exportar?mes=2026-99"));
    expect(invalido.status).toBe(400);
    const resposta = await GET(new Request("http://localhost/carteira/exportar?mes=2026-10"));
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("Cache-Control")).toBe("private, no-store");
    expect(resposta.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(resposta.headers.get("Content-Disposition")).toContain("carteira-2026-10.csv");
    const csv = await resposta.text();
    expect(csv).toContain("Unidade A1");
    expect(csv).not.toMatch(/Unidade B|Cliente B|DOC_|comissao|privado.xlsx/);
  });
});
