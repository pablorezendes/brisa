import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { criarSchemaSinteticoDespesas } from "./testes-banco";
import { LIMITE_ANEXO_DESPESA, lerAnexoDespesa, listarAnexosDespesa, salvarAnexoDespesa, validarArquivoDespesa } from "./anexos";

vi.mock("server-only", () => ({}));
let diretorio: string, contador = 0, db: PrismaClient;
const criarBanco = (arquivo: string) => new PrismaClient({ datasourceUrl: `file:${arquivo.replaceAll("\\", "/")}` });
const pdf = (sufixo = "fixture") => ({ nome: "nota.pdf", mimeType: "application/pdf", conteudo: new Uint8Array(Buffer.from(`%PDF-1.7\n${sufixo}\n%%EOF`)) });

beforeAll(async () => {
  diretorio = mkdtempSync(join(tmpdir(), "brisa-despesas-anexos-"));
  const modelo = criarBanco(join(diretorio, "modelo.db"));
  await criarSchemaSinteticoDespesas(modelo);
  await modelo.$disconnect();
}, 30000);
beforeEach(async () => {
  const arquivo = join(diretorio, `teste-${++contador}.db`);
  copyFileSync(join(diretorio, "modelo.db"), arquivo); db = criarBanco(arquivo);
  await db.usuario.createMany({ data: [
    { id: "admin", nome: "Administrador sintético", usuario: "admin", perfil: "ADMINISTRADOR", acessoGlobal: true },
    { id: "financeiro", nome: "Financeiro sintético", usuario: "fin", perfil: "FINANCEIRO", acessoGlobal: true, permissoesExtras: '["despesas.editar"]' },
    { id: "leitor", nome: "Financeiro leitor", usuario: "leitor", perfil: "FINANCEIRO", acessoGlobal: true },
    { id: "restrito", nome: "Financeiro restrito", usuario: "restrito", perfil: "FINANCEIRO", acessoGlobal: false, permissoesExtras: '["despesas.editar"]' },
    { id: "socio", nome: "Sócio sintético", usuario: "socio", perfil: "SOCIO", acessoGlobal: true, permissoesExtras: '["despesas.ver","despesas.editar"]' },
  ].map(u => ({ ...u, senhaHash: "nao-autenticavel" })) });
  await db.empreendimento.create({ data: { id: "e1", nome: "Prédio sintético" } });
  await db.despesaDocumento.create({ data: { id: "nota", fornecedorNome: "Fornecedor sintético", numero: "NF-42-TESTE", emissao: "2026-10-07", competencia: "2026-10", total: 256000, criadoPorId: "admin", atualizadoPorId: "admin",
    rateios: { create: [{ ordem: 0, empreendimentoId: "e1", descricao: "Manutenção elétrica", valor: 256000 }] },
  } });
});
afterEach(async () => { vi.restoreAllMocks(); await db.$disconnect(); });
afterAll(() => {
  const alvo = resolve(diretorio);
  if (!alvo.toLowerCase().startsWith(`${resolve(tmpdir())}${sep}`.toLowerCase()) || !basename(alvo).startsWith("brisa-despesas-anexos-")) throw new Error("Diretório fora do escopo temporário.");
  rmSync(alvo, { recursive: true, force: true });
});

describe("arquivos privados de despesas", () => {
  it.each([
    ["application/pdf", Buffer.from("%PDF-1.7\nfixture")],
    ["image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])],
    ["image/jpeg", Buffer.from([255, 216, 255, 224, 0])],
  ])("valida assinatura e MIME %s", (mimeType, bytes) => {
    expect(validarArquivoDespesa("nota.bin", mimeType, bytes)).toMatchObject({ mimeType, tamanho: bytes.byteLength });
  });

  it("rejeita conteúdo disfarçado, MIME divergente, vazio e tamanho maior que 5 MB", () => {
    expect(() => validarArquivoDespesa("nota.pdf", "application/pdf", Buffer.from("<html>arquivo indevido</html>"))).toThrow("Formato inválido");
    expect(() => validarArquivoDespesa("nota.png", "image/png", pdf().conteudo)).toThrow("Formato inválido");
    expect(() => validarArquivoDespesa("nota.pdf", "application/pdf", new Uint8Array())).toThrow("5 MB");
    expect(() => validarArquivoDespesa("nota.pdf", "application/pdf", new Uint8Array(LIMITE_ANEXO_DESPESA + 1))).toThrow("5 MB");
    const limite = new Uint8Array(LIMITE_ANEXO_DESPESA); limite.set(Buffer.from("%PDF-"));
    expect(validarArquivoDespesa("nota.pdf", "application/pdf", limite).tamanho).toBe(LIMITE_ANEXO_DESPESA);
  });

  it("remove caminhos e caracteres de controle do nome", () => {
    expect(validarArquivoDespesa("C:\\privado\\subpasta\\no\u0000ta\r\n.pdf", "application/pdf", pdf().conteudo).nomeOriginal).toBe("nota.pdf");
    expect(() => validarArquivoDespesa("\r\n", "application/pdf", pdf().conteudo)).toThrow("nome");
  });

  it("salva bytes no banco privado, lista somente metadados e deduplica conteúdo renomeado", async () => {
    const salvo = await salvarAnexoDespesa(db, "nota", "admin", pdf());
    const repetido = await salvarAnexoDespesa(db, "nota", "admin", { ...pdf(), nome: "outra-copia.pdf" });
    expect(repetido).toEqual(salvo);
    expect(await db.despesaAnexo.count()).toBe(1);
    const lista = await listarAnexosDespesa(db, "nota", "financeiro");
    expect(lista).toEqual([salvo]);
    expect(Object.keys(lista[0]).sort()).toEqual(["id", "mimeType", "nomeOriginal", "tamanho"]);
    const lido = await lerAnexoDespesa(db, salvo.id, "leitor");
    expect(Buffer.from(lido.conteudo)).toEqual(Buffer.from(pdf().conteudo));
  });

  it("limita 10 anexos, mas repetir um dos dez continua idempotente", async () => {
    // Prepara nove registros em uma operação; testa a fronteira real no décimo
    // upload sem repetir dez transações de setup em disco no Windows.
    await db.despesaAnexo.createMany({ data: Array.from({ length: 9 }, (_, i) => {
      const arquivo = pdf(`fixture-${i}`);
      return { ...validarArquivoDespesa(arquivo.nome, arquivo.mimeType, arquivo.conteudo), despesaId: "nota", criadoPorId: "admin", conteudo: Buffer.from(arquivo.conteudo) };
    }) });
    await salvarAnexoDespesa(db, "nota", "admin", pdf("fixture-9"));
    await expect(salvarAnexoDespesa(db, "nota", "admin", pdf("fixture-11"))).rejects.toThrow("10 anexos");
    await expect(salvarAnexoDespesa(db, "nota", "admin", pdf("fixture-0"))).resolves.toMatchObject({ nomeOriginal: "nota.pdf" });
    expect(await db.despesaAnexo.count()).toBe(10);
  });

  it.each(["restrito", "socio"])("perfil %s não acessa documento completo nem com ID conhecido", async usuarioId => {
    const anexo = await salvarAnexoDespesa(db, "nota", "admin", pdf());
    await expect(listarAnexosDespesa(db, "nota", usuarioId)).rejects.toThrow("permissão");
    await expect(lerAnexoDespesa(db, anexo.id, usuarioId)).rejects.toThrow("permissão");
    await expect(salvarAnexoDespesa(db, "nota", usuarioId, pdf("novo"))).rejects.toThrow("permissão");
    expect(await db.despesaAnexo.count()).toBe(1);
  });

  it("falta de permissão de edição e bloqueio explícito impedem upload", async () => {
    await expect(salvarAnexoDespesa(db, "nota", "leitor", pdf())).rejects.toThrow("permissão");
    await db.regraAcesso.create({ data: { usuarioId: "financeiro", tipo: "EMPREENDIMENTO", recursoId: "e1", efeito: "BLOQUEAR" } });
    await expect(salvarAnexoDespesa(db, "nota", "financeiro", pdf())).rejects.toThrow("permissão");
    expect(await db.despesaAnexo.count()).toBe(0);
  });

  it("revalida usuário no banco na leitura e dentro da transação de gravação", async () => {
    const anexo = await salvarAnexoDespesa(db, "nota", "financeiro", pdf());
    await db.usuario.update({ where: { id: "financeiro" }, data: { ativo: false } });
    await expect(lerAnexoDespesa(db, anexo.id, "financeiro")).rejects.toThrow("permissão");
    await db.usuario.update({ where: { id: "financeiro" }, data: { ativo: true } });
    const transacao = db.$transaction.bind(db);
    vi.spyOn(db, "$transaction").mockImplementation((async (executar: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      await db.usuario.update({ where: { id: "financeiro" }, data: { permissoesNegadas: '["despesas.editar"]' } });
      return transacao(executar);
    }) as typeof db.$transaction);
    await expect(salvarAnexoDespesa(db, "nota", "financeiro", pdf("após-revogação"))).rejects.toThrow("permissão");
    expect(await db.despesaAnexo.count()).toBe(1);
  });

  it.each([null, "WIDESYS:PAGAR:legado"])("nota excluída nega todos os anexos, inclusive overlay %s", async origemChave => {
    await db.despesaDocumento.update({ where: { id: "nota" }, data: { origemChave } });
    const anexo = await salvarAnexoDespesa(db, "nota", "admin", pdf());
    await db.recursoGovernado.create({ data: { tipo: "TITULO", origemId: origemChave ?? "BRISA:PAGAR:nota", status: "EXCLUIDO", motivo: "Exclusão sintética", autorId: "admin" } });
    await expect(listarAnexosDespesa(db, "nota", "admin")).rejects.toThrow("lixeira");
    await expect(lerAnexoDespesa(db, anexo.id, "admin")).rejects.toThrow("lixeira");
    await expect(salvarAnexoDespesa(db, "nota", "admin", pdf("novo"))).rejects.toThrow("lixeira");
    expect(await db.despesaAnexo.count()).toBe(1);
  });

  it("documento com comissão não expõe anexo integral ao financeiro", async () => {
    const anexo = await salvarAnexoDespesa(db, "nota", "admin", pdf());
    await db.despesaRateio.updateMany({ where: { despesaId: "nota" }, data: { categoria: "Comissão" } });
    await expect(listarAnexosDespesa(db, "nota", "financeiro")).rejects.toThrow("restrit");
    await expect(lerAnexoDespesa(db, anexo.id, "financeiro")).rejects.toThrow("restrit");
    await expect(salvarAnexoDespesa(db, "nota", "financeiro", pdf("novo"))).rejects.toThrow("restrit");
    await expect(lerAnexoDespesa(db, anexo.id, "admin")).resolves.toMatchObject({ id: anexo.id });
  });
});
