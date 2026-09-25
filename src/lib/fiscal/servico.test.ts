import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashConfiguracaoFiscal, hashFiscal, type ParametrosFiscais } from "./dominio";

const mocks = vi.hoisted(() => {
  const db = {
    $transaction: vi.fn(),
    usuario: { findUnique: vi.fn() },
    configuracaoFiscal: { findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    notaFiscalServico: { findUnique: vi.fn(), count: vi.fn(), updateMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    eventoFiscal: { create: vi.fn() },
  };
  return { db, autorizar: vi.fn(), chamar: vi.fn(), infraestrutura: vi.fn() };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: mocks.db }));
vi.mock("./acesso", () => ({ exigirAcessoFiscal: mocks.autorizar }));
vi.mock("./focus", () => ({ chamarFocusFiscal: mocks.chamar, infraestruturaFiscal: mocks.infraestrutura }));

import { aprovarNotaFiscal, consultarNotaFiscal, salvarConfiguracaoFiscal, salvarRascunhoFiscal, transmitirNotaFiscal } from "./servico";

const p: ParametrosFiscais = { codigoTributacaoNacional:"010701", codigoTributacaoMunicipal:"001", codigoNbs:"115022000", opcaoSimples:"1", regimeApuracao:"", regimeEspecial:"0", codigoIndicadorOperacao:"100301", cstIbsCbs:"000", classificacaoIbsCbs:"000001", tributosModo:"NAO_INFORMAR", tributosFederal:"", tributosEstadual:"", tributosMunicipal:"", tributosSimples:"", serieDps:"1", proximoDps:"10" };
const config = { id:"goiania", ambiente:"HOMOLOGACAO", emitenteCnpj:"11222333000181", inscricaoMunicipal:"123", razaoSocial:"FICTICIO", codigoMunicipio:"5208707", parametros:JSON.stringify(p), habilitada:true, homologacaoValidada:false, atualizadoEm:new Date("2026-09-20T12:00:00Z") };
const payload = { data_emissao:"2026-09-20T12:00:00Z", valor_servico:1, numero_dps:1,serie_dps:1 };
const nota = { id:"fiscal-1", status:"APROVADA", payloadHash:hashFiscal(payload), configHash:hashConfiguracaoFiscal(config), payload:JSON.stringify(payload), referencia:"BRISAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", emitenteCnpj:config.emitenteCnpj, ambiente:"HOMOLOGACAO", lockEm:null as Date | null, consultadoEm:null as Date | null, atualizadoEm:new Date(), tentativas:0 };

describe("orquestração fiscal protegida", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.autorizar.mockResolvedValue({ sub:"admin-ficticio" });
    mocks.db.$transaction.mockImplementation(async (callback) => callback(mocks.db));
    mocks.db.usuario.findUnique.mockResolvedValue({ perfil:"ADMINISTRADOR" });
    mocks.db.configuracaoFiscal.findUnique.mockResolvedValue({ ...config });
    mocks.db.configuracaoFiscal.updateMany.mockResolvedValue({ count:1 });
    mocks.db.notaFiscalServico.findUnique.mockResolvedValue({ ...nota });
    mocks.db.notaFiscalServico.updateMany.mockResolvedValue({ count:1 });
    mocks.db.notaFiscalServico.count.mockResolvedValue(0);
    mocks.infraestrutura.mockReturnValue({ token:true,producaoLiberada:true });
    mocks.chamar.mockResolvedValue({status:"PROCESSANDO"});
  });
  it("nega efeitos antes de acesso administrativo", async () => {
    mocks.autorizar.mockRejectedValue(new Error("NOT_FOUND"));
    await expect(transmitirNotaFiscal(nota.id,nota.payloadHash,true)).rejects.toThrow("NOT_FOUND");
    expect(mocks.db.$transaction).not.toHaveBeenCalled(); expect(mocks.chamar).not.toHaveBeenCalled();
  });
  it("exige confirmação explícita mesmo aprovado", async () => {
    await expect(transmitirNotaFiscal(nota.id,nota.payloadHash,false)).rejects.toThrow("Confirme"); expect(mocks.chamar).not.toHaveBeenCalled();
  });
  it("revogação antes da reserva transacional bloqueia efeito externo", async () => {
    mocks.db.usuario.findUnique.mockResolvedValue({ perfil:"FINANCEIRO" });
    await expect(transmitirNotaFiscal(nota.id,nota.payloadHash,true)).rejects.toThrow("revogada"); expect(mocks.chamar).not.toHaveBeenCalled();
  });
  it("compare-and-set bloqueia segundo POST concorrente", async () => {
    mocks.db.notaFiscalServico.updateMany.mockResolvedValue({count:0});
    await expect(transmitirNotaFiscal(nota.id,nota.payloadHash,true)).rejects.toThrow("Outro processo"); expect(mocks.chamar).not.toHaveBeenCalled();
  });
  it("estado incerto nunca pode voltar direto à emissão", async () => {
    mocks.db.notaFiscalServico.findUnique.mockResolvedValue({...nota,status:"INCERTA"});
    await expect(transmitirNotaFiscal(nota.id,nota.payloadHash,true)).rejects.toThrow("não está aprovado"); expect(mocks.chamar).not.toHaveBeenCalled();
  });
  it("snapshot alterado ou configuração nova bloqueiam transmissão", async () => {
    mocks.db.notaFiscalServico.findUnique.mockResolvedValue({...nota,payload:'{"valor_servico":999}'});
    await expect(transmitirNotaFiscal(nota.id,nota.payloadHash,true)).rejects.toThrow("Integridade");
    mocks.db.notaFiscalServico.findUnique.mockResolvedValue({...nota,configHash:"hashantigo"});
    await expect(transmitirNotaFiscal(nota.id,nota.payloadHash,true)).rejects.toThrow("Configuração modificada"); expect(mocks.chamar).not.toHaveBeenCalled();
  });
  it("aprovação não chama rede e exige versão atual", async () => {
    mocks.db.notaFiscalServico.findUnique.mockResolvedValue({...nota,status:"RASCUNHO"});
    await aprovarNotaFiscal(nota.id,nota.payloadHash,true); expect(mocks.chamar).not.toHaveBeenCalled();
    expect(mocks.db.notaFiscalServico.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({status:"RASCUNHO",payloadHash:nota.payloadHash}),data:expect.objectContaining({status:"APROVADA"})}));
  });
  it("produção requer nota homologada com os mesmos parâmetros", async () => {
    await expect(salvarConfiguracaoFiscal({...config,ambiente:"PRODUCAO",homologacaoValidada:true,confirmarProducao:true,versao:config.atualizadoEm.toISOString()})).rejects.toThrow("mesmos parâmetros");
    expect(mocks.db.notaFiscalServico.count).toHaveBeenCalledWith({where:expect.objectContaining({status:"AUTORIZADA",ambiente:"HOMOLOGACAO",configHash:hashConfiguracaoFiscal(config)})}); expect(mocks.db.configuracaoFiscal.upsert).not.toHaveBeenCalled();
  });
  it("identidade da prestação existente não cria nova nota", async () => {
    await expect(salvarRascunhoFiscal({origemChave:"SERVICO-1",competencia:"2026-09-20",tomadorNome:"FICTICIO",tomadorDocumento:"52998224725",valorServico:"1",descricao:"Teste",municipioTomador:"5208707",cepTomador:"74000000",logradouroTomador:"Rua",numeroTomador:"1",bairroTomador:"Centro",complementoTomador:"",consumidorFinal:"0"})).rejects.toThrow("já tem um documento");
    expect(mocks.db.notaFiscalServico.create).not.toHaveBeenCalled();
  });
  it("consulta inconclusiva não apaga autorização anterior", async () => {
    let lock: Date | null = null;
    mocks.db.notaFiscalServico.findUnique.mockImplementation(async () => ({...nota,status:"AUTORIZADA",lockEm:lock}));
    mocks.db.notaFiscalServico.updateMany.mockImplementation(async (args) => {lock = args.data.lockEm;return {count:1};});
    mocks.chamar.mockResolvedValue({status:"INCERTA",erroCodigo:"HTTP_404"});
    await consultarNotaFiscal(nota.id);
    expect(mocks.db.notaFiscalServico.update).toHaveBeenCalledWith({where:{id:nota.id},data:expect.not.objectContaining({status:expect.anything()})});
  });
  it("crash com lock fresco exige esperar; lock expirado recupera por GET", async () => {
    mocks.db.notaFiscalServico.findUnique.mockResolvedValue({...nota,status:"TRANSMITINDO",lockEm:new Date()});
    await expect(consultarNotaFiscal(nota.id)).rejects.toThrow("dois minutos"); expect(mocks.chamar).not.toHaveBeenCalled();
    mocks.db.notaFiscalServico.findUnique.mockResolvedValue({...nota,status:"TRANSMITINDO",lockEm:new Date(Date.now()-180000)});
    await consultarNotaFiscal(nota.id); expect(mocks.chamar).toHaveBeenCalledWith("CONSULTAR",nota.ambiente,nota.referencia,nota.emitenteCnpj);
  });
});
