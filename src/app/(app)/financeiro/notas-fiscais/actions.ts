"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirAcessoFiscal } from "@/lib/fiscal/acesso";
import { ErroFiscal, PARAMETROS_VAZIOS, ROTA_FISCAL, type ParametrosFiscais, type RascunhoFiscal } from "@/lib/fiscal/dominio";
import { aprovarNotaFiscal, consultarNotaFiscal, devolverRascunhoFiscal, salvarConfiguracaoFiscal, salvarRascunhoFiscal, transmitirNotaFiscal } from "@/lib/fiscal/servico";

function campo(form: FormData, nome: string) { const valor = form.get(nome); return typeof valor === "string" ? valor.trim() : ""; }
function sim(form: FormData, nome: string) { return campo(form, nome) === "on"; }
function idFiscal(form: FormData) {
  const id = campo(form, "id");
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new ErroFiscal("Documento fiscal inválido.");
  return id;
}

export async function salvarConfiguracao(form: FormData) {
  await exigirAcessoFiscal();
  let erro = "";
  try {
    const parametros = Object.fromEntries(Object.keys(PARAMETROS_VAZIOS).map((key) => [key, campo(form, key)])) as ParametrosFiscais;
    await salvarConfiguracaoFiscal({ ambiente: campo(form, "ambiente"), emitenteCnpj: campo(form, "emitenteCnpj"), inscricaoMunicipal: campo(form, "inscricaoMunicipal"), razaoSocial: campo(form, "razaoSocial"), codigoMunicipio: "5208707", parametros: JSON.stringify(parametros), habilitada: sim(form, "habilitada"), homologacaoValidada: sim(form, "homologacaoValidada"), confirmarProducao: sim(form, "confirmarProducao"), versao: campo(form, "versao") });
  } catch (e) { erro = e instanceof ErroFiscal ? e.message : "Não foi possível salvar. Atualize a página e tente novamente."; }
  revalidatePath(ROTA_FISCAL);
  redirect(`${ROTA_FISCAL}/configuracao?${new URLSearchParams(erro ? { erro } : { ok: "Configuração salva. Nenhuma nota foi emitida." })}`);
}

export async function salvarRascunho(form: FormData) {
  await exigirAcessoFiscal();
  let erro = "";
  let id = "";
  const existente = campo(form, "id");
  try {
    if (!sim(form, "escopoConfirmado")) throw new ErroFiscal("Confirme o enquadramento e a revisão dos valores de serviços.");
    const campos: (keyof RascunhoFiscal)[] = ["origemChave", "competencia", "tomadorNome", "tomadorDocumento", "valorServico", "descricao", "municipioTomador", "cepTomador", "logradouroTomador", "numeroTomador", "bairroTomador", "complementoTomador", "consumidorFinal"];
    const dados = Object.fromEntries(campos.map((key) => [key, campo(form, key)])) as RascunhoFiscal;
    id = await salvarRascunhoFiscal(dados, existente ? idFiscal(form) : undefined, campo(form, "payloadHash"));
  } catch (e) { erro = e instanceof ErroFiscal ? e.message : "Não foi possível salvar. Atualize a tela; uma reserva concorrente não cria outra nota."; }
  revalidatePath(ROTA_FISCAL);
  const destino = id || (/^[a-f0-9-]{36}$/.test(existente) ? existente : "novo");
  redirect(`${ROTA_FISCAL}/${destino}?${new URLSearchParams(erro ? { erro } : { ok: "Rascunho salvo. Nenhuma transmissão realizada." })}`);
}

export async function executarAcaoFiscal(form: FormData) {
  await exigirAcessoFiscal();
  let erro = "";
  let id = "";
  try {
    id = idFiscal(form);
    const acao = campo(form, "acao");
    if (acao === "aprovar") await aprovarNotaFiscal(id, campo(form, "payloadHash"), sim(form, "confirmar"));
    else if (acao === "transmitir") await transmitirNotaFiscal(id, campo(form, "payloadHash"), sim(form, "confirmar"));
    else if (acao === "consultar") await consultarNotaFiscal(id);
    else if (acao === "revisar") await devolverRascunhoFiscal(id, campo(form, "payloadHash"));
    else throw new ErroFiscal("Operação fiscal inválida.");
  } catch (e) { erro = e instanceof ErroFiscal ? e.message : "Operação interrompida. Consulte o histórico antes de tentar novamente."; }
  revalidatePath(ROTA_FISCAL);
  redirect(`${ROTA_FISCAL}${id ? `/${id}` : ""}?${new URLSearchParams(erro ? { erro } : { ok: "Operação registrada. Confira a situação atual abaixo." })}`);
}
