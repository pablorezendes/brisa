"use server";

import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { exigirPermissaoFinanceira } from "@/lib/autorizacao";
import { revalidatePath } from "next/cache";
import { ClienteSicoob } from "@/lib/integracoes/sicoob/cliente";
import { carregarConfiguracaoSicoob, ErroConfiguracaoSicoob } from "@/lib/integracoes/sicoob/configuracao";
import {
  clientIdPainelValido,
  lerCredenciaisPainelSicoob,
  LIMITE_CERTIFICADO_SICOOB,
  salvarCredenciaisPainelSicoob,
  type CredenciaisPainelSicoob,
} from "@/lib/integracoes/sicoob/credenciais-painel";
import { diagnosticarAutenticacaoSicoob } from "@/lib/integracoes/sicoob/diagnostico";
import { ErroApiSicoob } from "@/lib/integracoes/sicoob/http";
import type { EstadoCertificadoSicoob, EstadoTesteSicoob } from "./tipos";

// Proteção contra cliques repetidos no processo atual. A autorização é sempre
// reavaliada; nenhum resultado, token ou credencial é guardado nesta estrutura.
const tentativas = new Map<string, number>();
const INTERVALO_MS = 60_000;

export async function enviarCertificadoSicoob(
  _anterior: EstadoCertificadoSicoob,
  form: FormData,
): Promise<EstadoCertificadoSicoob> {
  await exigirPermissaoAcesso("integracoes.gerenciar", { global: true });
  await exigirPermissaoAcesso("boletos.configurar", { global: true });
  await exigirPermissaoAcesso("contas.editar", { global: true });
  await exigirPermissaoFinanceira("GERENCIAR_CONTAS");

  const arquivo = form.get("certificado");
  const senha = form.get("senhaCertificado");
  if (!(arquivo instanceof File) || !/\.(pfx|p12)$/i.test(arquivo.name) ||
      !arquivo.size || arquivo.size > LIMITE_CERTIFICADO_SICOOB) {
    return { erro: "Selecione um certificado A1 em formato .pfx ou .p12 de até 512 KB." };
  }
  if (typeof senha !== "string" || !senha || Buffer.byteLength(senha) > 512) {
    return { erro: "Informe a senha do certificado." };
  }

  const env = process.env;
  let atuais: CredenciaisPainelSicoob | null = null;
  try {
    atuais = lerCredenciaisPainelSicoob(env);
  } catch {
    // Uma nova credencial validada permite recuperar um arquivo inacessível.
  }
  const clientIdInstalado = atuais?.clientId || env.SICOOB_CLIENT_ID?.trim();
  const clientIdInformado = form.get("clientId");
  const clientId = clientIdInstalado || (typeof clientIdInformado === "string" ? clientIdInformado.trim() : "");
  if (!clientIdPainelValido(clientId)) {
    return { erro: "Informe o Client ID da aplicação autorizada no Portal Developers Sicoob." };
  }
  const ambienteInstalado = env.SICOOB_AMBIENTE?.trim().toLowerCase() === "producao" ? "producao" : "sandbox";
  const ambiente = atuais?.ambiente ?? (clientIdInstalado ? ambienteInstalado : form.get("ambiente"));
  if (ambiente !== "producao" && ambiente !== "sandbox") {
    return { erro: "Selecione o ambiente da aplicação Sicoob." };
  }

  let pfx: Buffer | undefined;
  try {
    pfx = Buffer.from(await arquivo.arrayBuffer());
    const proposta: CredenciaisPainelSicoob = { pfx, senha, clientId, ambiente };
    const cliente = new ClienteSicoob(carregarConfiguracaoSicoob(env, proposta));
    await cliente.testarAutenticacao();
    salvarCredenciaisPainelSicoob(proposta, env);
  } catch (erro) {
    if (erro instanceof ErroConfiguracaoSicoob && erro.pendencias.includes("Certificado ou senha inválidos")) {
      return { erro: "Confira o arquivo do certificado e a senha." };
    }
    if (erro instanceof ErroApiSicoob) {
      const recusado = erro.status === 400 || erro.status === 401 || erro.status === 403;
      return { erro: recusado
        ? "O Sicoob recusou a autenticação. Confira a autorização da aplicação, os escopos e o certificado no portal do banco."
        : "O Sicoob não confirmou a autenticação. Tente novamente em instantes." };
    }
    return { erro: "Não foi possível concluir a configuração do certificado." };
  } finally {
    pfx?.fill(0);
  }
  revalidatePath("/integracoes/sicoob");
  return { sucesso: "Certificado salvo e autenticado no Sicoob." };
}

export async function testarAutenticacaoSicoob(
  _anterior: EstadoTesteSicoob,
  form: FormData,
): Promise<EstadoTesteSicoob> {
  await exigirPermissaoAcesso("integracoes.gerenciar", { global: true });
  await exigirPermissaoAcesso("boletos.configurar", { global: true });
  const sessao = await exigirPermissaoFinanceira("GERENCIAR_CONTAS");
  if (form.get("confirmarTeste") !== "on") {
    return { erro: "Confirme o teste de autenticação com o Sicoob. Ele não emite boletos nem altera pagamentos." };
  }
  const agora = Date.now();
  for (const [id, instante] of tentativas) {
    if (agora - instante >= INTERVALO_MS) tentativas.delete(id);
  }
  if (tentativas.has(sessao.sub)) {
    return { erro: "Aguarde um minuto entre os testes de autenticação." };
  }
  tentativas.set(sessao.sub, agora);
  try {
    // Não recebe ambiente/URL/credenciais do navegador. Somente a configuração
    // instalada no servidor é utilizada, e somente um DTO sanitizado retorna.
    return { resultado: await diagnosticarAutenticacaoSicoob() };
  } catch {
    return { erro: "Não foi possível concluir o diagnóstico. Verifique a configuração privada do servidor e tente novamente." };
  }
}
