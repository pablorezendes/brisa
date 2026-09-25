import "server-only";

import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, btnSecundario } from "@/components/ui";
import { perfilAtual } from "@/lib/autorizacao";
import { prisma } from "@/lib/db";
import { lerPainelComunicacoes } from "@/lib/comunicacoes/servico";
import { PainelAutomacoesClient } from "./painel";
import type { PainelAutomacoes } from "./tipos";

export const dynamic = "force-dynamic";
export const metadata = { title: "Automações de cobrança — Financeiro — Brisa" };

export default async function PaginaAutomacoes() {
  // Autoriza antes de consultar títulos, destinatários ou configurações.
  if ((await perfilAtual()) !== "ADMINISTRADOR") notFound();
  const dados = await lerPainelComunicacoes(prisma);
  const painel: PainelAutomacoes = {
    config: dados.config,
    versao: dados.versao,
    segredos: dados.segredos,
    titulos: dados.titulos.map((item) => ({
      chave: item.chave, pessoaChave: item.pessoaChave, nome: item.nome,
      documento: item.documento, vencimento: item.vencimento, aberto: item.aberto,
      email: item.email, telefone: item.telefone,
    })),
    contatos: dados.contatos.map((item) => ({
      id: item.id, pessoaChave: item.pessoaChave, canal: item.canal,
      destino: item.destino, autorizado: item.autorizado, evidencia: item.evidencia,
    })),
    mensagens: dados.mensagens.map((item) => ({
      ...item, criadoEm: item.criadoEm.toISOString(), enviadoEm: item.enviadoEm?.toISOString() ?? null,
    })),
    eventos: dados.eventos.map((item) => ({ id: item.id, tipo: item.tipo, codigo: item.codigo, criadoEm: item.criadoEm.toISOString() })),
  };

  return <div>
    <PageHeader titulo="Automações de cobrança" descricao="E-mail e WhatsApp oficial, integrados à base financeira unificada. Configuração, autorização do destinatário e acompanhamento em um só lugar." acoes={<Link href="/financeiro" className={btnSecundario}>Voltar ao financeiro</Link>} />
    <PainelAutomacoesClient painel={painel} />
  </div>;
}
