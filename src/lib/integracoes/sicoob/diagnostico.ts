import "server-only";

import { ClienteSicoob } from "./cliente";
import {
  carregarConfiguracaoSicoob,
  ErroConfiguracaoSicoob,
  obterEstadoConfiguracaoSicoob,
} from "./configuracao";
import { ErroApiSicoob } from "./http";
import type { AmbienteSicoob } from "./tipos";

export type DiagnosticoAutenticacaoSicoob = {
  status:
    | "CONFIGURACAO_PENDENTE"
    | "SANDBOX_NAO_TESTADO"
    | "AUTENTICADO"
    | "FALHA_AUTENTICACAO";
  ambiente: AmbienteSicoob;
  verificadoEm: string;
  configuracaoLocalValida: boolean;
  autenticacaoValidada: boolean;
  convenioValidado: false;
  mensagem: string;
  pendencias: string[];
};

function mensagemFalhaAutenticacao(erro: unknown): string {
  if (erro instanceof ErroApiSicoob) {
    if (erro.status === 400 || erro.status === 401 || erro.status === 403) {
      return "O Sicoob recusou a autenticação. Confira a autorização da aplicação, os escopos e o certificado no portal do banco.";
    }
    if (erro.codigo === "SICOOB_TIMEOUT" || erro.codigo === "SICOOB_REDE") {
      return "Não foi possível concluir a comunicação segura com o Sicoob. Confira a rede e a vigência do certificado antes de tentar novamente.";
    }
  }
  return "A autenticação não foi confirmada. Nenhum boleto foi emitido, consultado ou alterado. Confira a configuração com o responsável pela integração.";
}

/**
 * Chamado apenas por uma action autorizada, mediante pedido explícito do admin.
 * Não grava dados, não habilita contas e nunca retorna tokens, IDs ou erros brutos.
 */
export async function diagnosticarAutenticacaoSicoob(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DiagnosticoAutenticacaoSicoob> {
  const estado = obterEstadoConfiguracaoSicoob(env);
  const base = {
    ambiente: estado.ambiente,
    verificadoEm: new Date().toISOString(),
    configuracaoLocalValida: estado.configurado,
    autenticacaoValidada: false,
    convenioValidado: false as const,
    pendencias: estado.pendencias,
  };

  if (!estado.configurado) {
    return {
      ...base,
      status: "CONFIGURACAO_PENDENTE",
      mensagem: "A configuração local ainda tem pendências. Nenhuma conexão com o Sicoob foi iniciada.",
    };
  }
  if (estado.autenticacao === "token_estatico") {
    return {
      ...base,
      status: "SANDBOX_NAO_TESTADO",
      mensagem: "O token estático do sandbox está presente, mas sua validade não foi testada. Este diagnóstico não consulta nem emite boletos de teste.",
    };
  }

  try {
    // Carrega novamente para não reutilizar material alterado durante a inspeção.
    await new ClienteSicoob(carregarConfiguracaoSicoob(env)).testarAutenticacao();
    return {
      ...base,
      status: "AUTENTICADO",
      autenticacaoValidada: true,
      verificadoEm: new Date().toISOString(),
      mensagem: "Autenticação OAuth e comunicação mTLS confirmadas. O convênio, a autorização de emissão e o retorno de pagamentos ainda precisam de validação própria; nenhuma cobrança foi movimentada.",
    };
  } catch (erro) {
    if (erro instanceof ErroConfiguracaoSicoob) {
      return {
        ...base,
        status: "CONFIGURACAO_PENDENTE",
        configuracaoLocalValida: false,
        pendencias: erro.pendencias,
        mensagem: "A configuração mudou durante a conferência e precisa ser revisada. Nenhuma cobrança foi movimentada.",
      };
    }
    return {
      ...base,
      status: "FALHA_AUTENTICACAO",
      verificadoEm: new Date().toISOString(),
      mensagem: mensagemFalhaAutenticacao(erro),
    };
  }
}
