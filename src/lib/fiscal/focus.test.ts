import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chamarFocusFiscal, infraestruturaFiscal, normalizarRetornoFiscal, urlDocumentoFiscal } from "./focus";

const ref = "BRISAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const cnpj = "11222333000181";

describe("adaptador fiscal Focus", () => {
  beforeEach(() => { vi.stubEnv("FOCUS_NFSE_TOKEN_HOMOLOGACAO", "tokenficticio"); vi.stubEnv("FISCAL_EMISSAO_PRODUCAO", ""); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it("mapeia retorno documentado sem expor corpo bruto", () => {
    expect(normalizarRetornoFiscal({ ref, cnpj_prestador: cnpj, status:"autorizado", numero:"15", codigo_verificacao:"ABC", url:"https://www.nfse.gov.br/consultapublica/?chave=teste" }, ref, cnpj)).toMatchObject({ status:"AUTORIZADA", numero:"15", codigoVerificacao:"ABC" });
  });
  it("referência, CNPJ ou número incompleto impedem autorização falsa", () => {
    expect(normalizarRetornoFiscal({ ref:"outra", cnpj_prestador:cnpj, status:"autorizado", numero:"1" }, ref, cnpj).status).toBe("INCERTA");
    expect(normalizarRetornoFiscal({ ref, cnpj_prestador:"outro", status:"autorizado", numero:"1" }, ref, cnpj).status).toBe("INCERTA");
    expect(normalizarRetornoFiscal({ ref, status:"autorizado", numero:"1" }, ref, cnpj).status).toBe("INCERTA");
    expect(normalizarRetornoFiscal({ ref, cnpj_prestador:cnpj, status:"autorizado" }, ref, cnpj).status).toBe("INCERTA");
  });
  it("rejeição de DPS existente exige investigação e não reemissão", () => {
    expect(normalizarRetornoFiscal({ ref, status:"erro_autorizacao", erros:[{ codigo:"E0014", mensagem:"DPS já existe" }] },ref,cnpj)).toMatchObject({status:"INCERTA",erroCodigo:"DPS_EXISTENTE"});
  });
  it("não vaza mensagem bruta de rejeição", () => {
    const r = normalizarRetornoFiscal({ ref, status:"erro_autorizacao", erros:[{codigo:"E123",mensagem:"cpf ou segredo em mensagem remota"}] },ref,cnpj);
    expect(r.status).toBe("REJEITADA"); expect(JSON.stringify(r)).not.toContain("segredo");
  });
  it("aceita apenas links HTTPS em hosts fiscais conhecidos", () => {
    expect(urlDocumentoFiscal("https://focusnfe.s3.sa-east-1.amazonaws.com/teste.pdf")).toBeTruthy();
    for (const url of ["javascript:alert(1)","https://focusnfe.com.br.evil.example/a", "https://localhost/a","https://usuario:senha@www.nfse.gov.br/a","http://www.nfse.gov.br/a"]) expect(urlDocumentoFiscal(url)).toBeUndefined();
  });
  it("POST usa host fixo, Basic token com senha vazia, ref estável e não redireciona", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ref, status:"processando_autorizacao" }), { status:202 })); vi.stubGlobal("fetch",fetch);
    expect((await chamarFocusFiscal("EMITIR","HOMOLOGACAO",ref,cnpj,{valor_servico:1})).status).toBe("PROCESSANDO");
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`https://homologacao.focusnfe.com.br/v2/nfsen?ref=${ref}`, expect.objectContaining({ method:"POST",redirect:"error",headers:expect.objectContaining({Authorization:`Basic ${Buffer.from("tokenficticio:").toString("base64")}`}) }));
  });
  it("timeout é incerto e jamais repete o POST", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("timeout")); vi.stubGlobal("fetch",fetch);
    expect((await chamarFocusFiscal("EMITIR","HOMOLOGACAO",ref,cnpj,{})).status).toBe("INCERTA"); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("404 ao consultar não vira permissão de reemissão", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}",{status:404})); vi.stubGlobal("fetch",fetch);
    expect(await chamarFocusFiscal("CONSULTAR","HOMOLOGACAO",ref,cnpj)).toMatchObject({ status:"INCERTA",erroCodigo:"REFERENCIA_NAO_LOCALIZADA" });
  });
  it("não habilita produção só por possuir token", async () => {
    vi.stubEnv("FOCUS_NFSE_TOKEN_PRODUCAO","tokenficticio");
    const fetch = vi.fn(); vi.stubGlobal("fetch",fetch);
    expect(infraestruturaFiscal("PRODUCAO").producaoLiberada).toBe(false);
    await expect(chamarFocusFiscal("EMITIR","PRODUCAO",ref,cnpj,{})).rejects.toThrow("bloqueada"); expect(fetch).not.toHaveBeenCalled();
  });
  it("rejeita referência manipulada antes da rede", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch",fetch);
    await expect(chamarFocusFiscal("CONSULTAR","HOMOLOGACAO","../empresas",cnpj)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
});
