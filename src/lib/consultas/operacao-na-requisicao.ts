import "server-only";
import { cache } from "react";
import { prisma } from "../db";
import { lerOperacaoUnificada } from "../unificacao/servico";

/**
 * Uma fotografia por renderização, compartilhada entre listas e apurações.
 * Não é cache entre usuários/requisições e não autoriza acesso: cada consumidor
 * mantém sua checagem de perfil. Mutações e workers usam o serviço fresco.
 */
export const operacaoNaRequisicao = cache(() => lerOperacaoUnificada(prisma));
