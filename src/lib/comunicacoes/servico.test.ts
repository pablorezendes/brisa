import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { PrismaClient } from "@prisma/client";
import { beforeAll, beforeEach, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { lerOperacaoUnificada } from "../unificacao/servico";
import type { LinhaUnificada } from "../unificacao/tipos";
import { CONFIG_COBRANCA_PADRAO } from "./dominio";
import { salvarConfigComunicacoes, registrarContatoCobranca, prepararMensagemCobranca, processarComunicacoes, titulosComunicacao, revogarContatoCobranca } from "./servico";
import { receberRetornoMeta } from "./retornos";
import { decifrarSegredo } from "./segredos";

vi.mock("../unificacao/servico", () => ({ lerOperacaoUnificada: vi.fn() }));
let db: PrismaClient;
let diretorio: string;
let linhas: LinhaUnificada[];
const hoje = new Date().toISOString().slice(0,10);
const agora = new Date(`${hoje}T15:00:00Z`);
const emitente = "teste@exemplo.com";
const base = { ...CONFIG_COBRANCA_PADRAO, emailRemetente: emitente, emailAtivo: true, apenasDiasUteis: false };
const pessoa: LinhaUnificada = { chave: "BRISA:PESSOA:p1", dominio: "PESSOA", origem: "BRISA", origemId: "p1", titulo: "Pessoa de teste", nomeNorm: "PESSOA DE TESTE", descricao: "", href: null, hash: "p1", qualidade: "OK", motivos: [], campos: { email: { rotulo: "E-mail", valor: "pessoa@example.com" } }, estado: "ATIVO", origens: ["BRISA"], fontes: ["BRISA:PESSOA:p1"], versao: 1, candidatos: [], avisos: [], contabiliza: true, divergencias: [] };
const titulo: LinhaUnificada = { ...pessoa, chave: "BRISA:RECEBER:t1", dominio: "RECEBER", origemId: "t1", hash: "t1", fontes: ["BRISA:RECEBER:t1"], campos: {}, pessoaChave: pessoa.chave, vencimento: hoje, competencia: hoje.slice(0,7), aberto: 10000, valor: 10000, pago: 0 };

beforeAll(async () => {
  diretorio = mkdtempSync(join(tmpdir(), "brisa-comunicacoes-test-"));
  db = new PrismaClient({ datasourceUrl: `file:${join(diretorio,"fixture.db").replaceAll("\\","/")}` });
  const ddl = execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { encoding: "utf8", windowsHide: true });
  for (const sql of ddl.split(";").map(s => s.trim()).filter(Boolean)) await db.$executeRawUnsafe(sql);
}, 30000);
beforeEach(async () => {
  vi.stubEnv("AUTOMACOES_CHAVE", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("AUTOMACOES_ENVIO_HABILITADO", "1");
  for (const tabela of ["EventoComunicacao", "RetornoComunicacao", "MensagemCobranca", "ContatoCobranca", "ConfiguracaoComunicacao", "TravaAutomacao", "Usuario"]) await db.$executeRawUnsafe(`DELETE FROM "${tabela}"`);
  await db.usuario.create({ data: { id: "admin-teste", nome: "Admin teste", usuario: "admin-teste", senhaHash: "não autentica", perfil: "ADMINISTRADOR" } });
  linhas = [structuredClone(pessoa), structuredClone(titulo)];
  vi.mocked(lerOperacaoUnificada).mockImplementation(async () => ({ linhas, fontes: linhas, decisoes: [] }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
afterAll(async () => {
  await db?.$disconnect();
  const alvo = resolve(diretorio);
  if (alvo.toLowerCase().startsWith(`${resolve(tmpdir())}${sep}`.toLowerCase()) && basename(alvo).startsWith("brisa-comunicacoes-test-")) rmSync(alvo, { recursive: true, force: true });
});

async function preparar(canal: "EMAIL" | "WHATSAPP" = "EMAIL") {
  await salvarConfigComunicacoes(db, base, 0, { emailToken: "token-ficticio-de-testes" }, "admin-teste");
  await registrarContatoCobranca(db, { tituloChave: titulo.chave, canal, destino: canal === "EMAIL" ? "pessoa@example.com" : "62999998888", evidencia: "Autorização fictícia do titular para teste", autorizado: true }, "admin-teste");
  const resultado = await prepararMensagemCobranca(db, { tituloChave: titulo.chave, canal }, "admin-teste");
  await db.mensagemCobranca.update({ where: { id: resultado.id }, data: { proximoEnvio: agora } });
  return resultado;
}
const email = () => vi.fn(async () => ({ status: "ACEITO" as const, codigo: "ACEITO" as const, provedorId: "envio-ficticio" }));

describe("outbox de cobrança em banco isolado", () => {
  it("cifra token, protege edição concorrente e não admite operador", async () => {
    await salvarConfigComunicacoes(db, base, 0, { emailToken: "token-ficticio-de-testes" }, "admin-teste");
    const c = await db.configuracaoComunicacao.findUniqueOrThrow({ where: { id: "cobranca" } });
    expect(c.emailTokenCifrado).not.toContain("token-ficticio");
    await expect(salvarConfigComunicacoes(db, base, 0, {}, "admin-teste")).rejects.toMatchObject({ codigo: "CONFIG_DESATUALIZADA" });
    await db.usuario.update({ where: { id: "admin-teste" }, data: { perfil: "OPERADOR" } });
    await expect(salvarConfigComunicacoes(db, base, 1, {}, "admin-teste")).rejects.toMatchObject({ codigo: "ACESSO_NEGADO" });
  });
  it("repetir a preparação e executar o worker novamente não duplica", async () => {
    const m = await preparar();
    expect(await prepararMensagemCobranca(db, { tituloChave: titulo.chave, canal: "EMAIL" }, "admin-teste")).toEqual(m);
    const enviar = email();
    await processarComunicacoes(db, { agora, email: enviar });
    await processarComunicacoes(db, { agora, email: enviar });
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(await db.mensagemCobranca.count()).toBe(1);
    expect((await db.mensagemCobranca.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("ENVIADA");
  });
  it("pagamento ou mudança de saldo cancela a fila antes de enviar", async () => {
    await preparar(); linhas[1].aberto = 0;
    const enviar = email(); await processarComunicacoes(db, { agora, email: enviar });
    expect(enviar).not.toHaveBeenCalled();
    expect((await db.mensagemCobranca.findFirstOrThrow()).erroCodigo).toBe("SALDO_OU_ORIGEM_ALTERADO");
  });
  it("revogação do contato cancela até após o título sair da lista", async () => {
    await preparar(); const contato = await db.contatoCobranca.findFirstOrThrow(); linhas = [];
    await revogarContatoCobranca(db, contato.id, "admin-teste");
    expect((await db.mensagemCobranca.findFirstOrThrow()).status).toBe("CANCELADA");
  });
  it("pendências, duplicados e pessoa não conciliada não entram nas cobranças", async () => {
    linhas[1].estado = "PENDENTE"; expect(await titulosComunicacao(db)).toHaveLength(0);
    linhas[1].estado = "VINCULADO"; expect(await titulosComunicacao(db)).toHaveLength(0);
    linhas[1].estado = "ATIVO"; linhas[0].estado = "PENDENTE"; expect(await titulosComunicacao(db)).toHaveLength(0);
  });
  it("duas execuções respeitam reserva global sem enviar em paralelo", async () => {
    await preparar(); await db.travaAutomacao.create({ data: { id: "cobranca", token: "outro", expiraEm: new Date(Date.now() + 60000) } });
    const enviar = email(); expect((await processarComunicacoes(db, { agora, email: enviar })).estado).toBe("OCUPADO");
    expect(enviar).not.toHaveBeenCalled();
  });
  it("pausa global e horário impedem envio mesmo com mensagens prontas", async () => {
    await preparar(); const enviar = email(); vi.stubEnv("AUTOMACOES_ENVIO_HABILITADO", "0");
    expect((await processarComunicacoes(db, { agora, email: enviar })).estado).toBe("PAUSADO");
    vi.stubEnv("AUTOMACOES_ENVIO_HABILITADO", "1");
    expect((await processarComunicacoes(db, { agora: new Date(`${hoje}T05:00:00Z`), email: enviar })).estado).toBe("FORA_DA_JANELA");
    expect(enviar).not.toHaveBeenCalled();
  });
  it("processo interrompido não é reenviado sem confirmação", async () => {
    const m = await preparar();
    await db.mensagemCobranca.update({ where: { id: m.id }, data: { status: "ENVIANDO", reservadoEm: new Date(agora.getTime()-600000), tentativas: 1 } });
    const enviar = email(); await processarComunicacoes(db, { agora, email: enviar });
    expect(enviar).not.toHaveBeenCalled(); expect((await db.mensagemCobranca.findFirstOrThrow()).status).toBe("INCERTA");
  });
  it("snapshot enviado não inclui observações/comissões", async () => {
    linhas[1].campos = { taxa: { rotulo: "Sigiloso", valor: 999999 }, observacao: { rotulo: "Privado", valor: "SEGREDO_TESTE" } };
    await preparar(); const m = await db.mensagemCobranca.findFirstOrThrow();
    expect(m.conteudo).not.toMatch(/999999|SEGREDO_TESTE|comiss/i);
  });
  it("SAIR revoga o canal e cancela pendências, callback repetido é idempotente", async () => {
    await preparar("WHATSAPP");
    const c = await db.configuracaoComunicacao.findFirstOrThrow();
    await db.configuracaoComunicacao.update({ where: { id: c.id }, data: { dados: JSON.stringify({ ...base, whatsappPhoneNumberId: "123456789" }) } });
    const corpo = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "123456789" }, messages: [{ id: "msg_sair", from: "5562999998888", type: "text", text: { body: "SAIR" }, timestamp: String(Math.floor(Date.now()/1000)) }] } }] }] });
    await receberRetornoMeta(db, corpo); await receberRetornoMeta(db, corpo);
    expect((await db.contatoCobranca.findFirstOrThrow()).autorizado).toBe(false);
    expect((await db.mensagemCobranca.findFirstOrThrow()).erroCodigo).toBe("OPT_OUT");
    expect(await db.retornoComunicacao.count()).toBe(1);
  });
  it("credenciais são vinculadas criptograficamente ao canal", async () => {
    await preparar();
    const config = await db.configuracaoComunicacao.findFirstOrThrow();
    expect(decifrarSegredo(config.emailTokenCifrado!, "cobranca:email")).toBe("token-ficticio-de-testes");
    expect(() => decifrarSegredo(config.emailTokenCifrado!, "cobranca:whatsapp")).toThrow(/credencial protegida/);
    expect(() => decifrarSegredo(config.emailTokenCifrado!)).toThrow(/credencial protegida/);
  });
  it("remapear a chave canônica não duplica etapa já enviada de uma fonte", async () => {
    const m = await preparar();
    await processarComunicacoes(db, { agora, email: email() });
    linhas[1] = { ...linhas[1], chave: "BRISA:RECEBER:unificado", fontes: [titulo.chave, "BRISA:RECEBER:unificado"] };
    const nova = await prepararMensagemCobranca(db, { tituloChave: linhas[1].chave, canal: "EMAIL" }, "admin-teste");
    expect(nova).toEqual({ id: m.id, status: "ENVIADA" });
    expect(await db.mensagemCobranca.count()).toBe(1);
  });
  it("worker impede fila remapeada de repetir mesma origem mesmo após 24 horas", async () => {
    const m = await preparar();
    await processarComunicacoes(db, { agora, email: email() });
    const anterior = await db.mensagemCobranca.update({ where: { id: m.id }, data: { reservadoEm: new Date(agora.getTime() - 2 * 86_400_000) } });
    linhas[1] = { ...linhas[1], chave: "BRISA:RECEBER:unificado", fontes: [titulo.chave, "BRISA:RECEBER:unificado"] };
    const [novoTitulo] = await titulosComunicacao(db);
    await db.mensagemCobranca.create({ data: { ...anterior, id: "nova-fila", chave: "nova-chave", tituloChave: novoTitulo.chave, fontes: JSON.stringify(novoTitulo.fontes), fonteHash: novoTitulo.fonteHash, status: "AGENDADA", tentativas: 0, providerId: null, reservadoEm: null, enviadoEm: null, proximoEnvio: agora } });
    const enviar = email();
    await processarComunicacoes(db, { agora, email: enviar });
    expect(enviar).not.toHaveBeenCalled();
    expect((await db.mensagemCobranca.findUniqueOrThrow({ where: { id: "nova-fila" } })).erroCodigo).toBe("ETAPA_JA_TENTADA_NA_ORIGEM");
  });
  it("pausa durante geração automática não recria fila usando regra antiga", async () => {
    await preparar();
    const configuracao = { ...base, automacaoAtiva: true, diasRelativos: [0] };
    await salvarConfigComunicacoes(db, configuracao, 1, {}, "admin-teste");
    vi.mocked(lerOperacaoUnificada).mockImplementationOnce(async () => {
      await salvarConfigComunicacoes(db, { ...configuracao, automacaoAtiva: false }, 2, {}, "admin-teste");
      return { linhas, fontes: linhas, decisoes: [] };
    });
    const enviar = email();
    expect((await processarComunicacoes(db, { agora, email: enviar })).estado).toBe("CONFIG_ALTERADA");
    expect(enviar).not.toHaveBeenCalled();
    expect(await db.mensagemCobranca.count({ where: { status: "AGENDADA" } })).toBe(0);
  });
  it("reserva revalida revogação ocorrida depois da leitura inicial do contato", async () => {
    await preparar();
    vi.mocked(lerOperacaoUnificada).mockImplementationOnce(async () => {
      await db.contatoCobranca.updateMany({ data: { autorizado: false } });
      return { linhas, fontes: linhas, decisoes: [] };
    });
    const enviar = email();
    await processarComunicacoes(db, { agora, email: enviar });
    expect(enviar).not.toHaveBeenCalled();
    expect((await db.mensagemCobranca.findFirstOrThrow()).erroCodigo).toBe("CONTATO_REVOGADO");
  });
  it("reserva revalida configuração alterada depois da leitura inicial", async () => {
    await preparar();
    vi.mocked(lerOperacaoUnificada).mockImplementationOnce(async () => {
      await db.configuracaoComunicacao.update({ where: { id: "cobranca" }, data: { versao: { increment: 1 }, dados: JSON.stringify({ ...base, emailAtivo: false }) } });
      return { linhas, fontes: linhas, decisoes: [] };
    });
    const enviar = email();
    await processarComunicacoes(db, { agora, email: enviar });
    expect(enviar).not.toHaveBeenCalled();
    expect((await db.mensagemCobranca.findFirstOrThrow()).erroCodigo).toBe("CONFIG_ALTERADA");
  });
  it("webhook anterior à resposta fica no inbox e confirma entrega depois, sem regressão", async () => {
    await preparar("WHATSAPP");
    const configMeta = { ...base, whatsappAtivo: true, whatsappNumero: "62999990000", whatsappPhoneNumberId: "123456789", whatsappTemplate: "cobranca_teste", whatsappTemplateAprovado: true };
    await salvarConfigComunicacoes(db, configMeta, 1, { whatsappToken: "token-meta-ficticio" }, "admin-teste");
    const m = await prepararMensagemCobranca(db, { tituloChave: titulo.chave, canal: "WHATSAPP" }, "admin-teste");
    await db.mensagemCobranca.update({ where: { id: m.id }, data: { proximoEnvio: agora } });
    const retorno = (status: string) => JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "123456789" }, statuses: [{ id: "wamid.retorno-antecipado", status, timestamp: String(Math.floor(Date.now()/1000)) }] } }] }] });
    const whatsapp = vi.fn(async () => {
      await receberRetornoMeta(db, retorno("delivered"));
      expect((await db.mensagemCobranca.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("ENVIANDO");
      return { status: "ACEITO" as const, codigo: "ACEITO" as const, provedorId: "wamid.retorno-antecipado" };
    });
    await processarComunicacoes(db, { agora, whatsapp });
    expect((await db.mensagemCobranca.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("ENTREGUE");
    await receberRetornoMeta(db, retorno("read"));
    await receberRetornoMeta(db, retorno("sent"));
    await receberRetornoMeta(db, retorno("read"));
    expect((await db.mensagemCobranca.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("LIDA");
    expect(await db.retornoComunicacao.count()).toBe(3);
    expect(whatsapp).toHaveBeenCalledTimes(1);
  });
  it("retry seguro de e-mail conserva chave e corpo; não cria uma mensagem nova", async () => {
    const m = await preparar();
    const primeiro = vi.fn(async () => ({ status: "REPETIR" as const, codigo: "RESEND_REDE_OU_RESPOSTA" }));
    await processarComunicacoes(db, { agora, email: primeiro });
    await db.mensagemCobranca.update({ where: { id: m.id }, data: { proximoEnvio: agora } });
    const segundo = email();
    await processarComunicacoes(db, { agora, email: segundo });
    expect(primeiro.mock.calls).toHaveLength(1);
    expect(segundo.mock.calls).toHaveLength(1);
    expect(primeiro.mock.calls[0]).toEqual(segundo.mock.calls[0]);
    expect(await db.mensagemCobranca.count()).toBe(1);
    expect((await db.mensagemCobranca.findFirstOrThrow()).tentativas).toBe(2);
  }, 15000);
});
