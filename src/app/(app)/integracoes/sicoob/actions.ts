"use server";

import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { exigirPermissaoFinanceira } from "@/lib/autorizacao";
import { diagnosticarAutenticacaoSicoob } from "@/lib/integracoes/sicoob/diagnostico";
import type { EstadoTesteSicoob } from "./tipos";

// Proteção contra cliques repetidos no processo atual. A autorização é sempre
// reavaliada; nenhum resultado, token ou credencial é guardado nesta estrutura.
const tentativas = new Map<string, number>();
const INTERVALO_MS = 60_000;

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
