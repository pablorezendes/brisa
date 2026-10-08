import Link from "next/link";
import type { ReactNode } from "react";
import { acessoAtual } from "@/lib/acesso/servidor";
import { carteiraIrrestrita, pode } from "@/lib/acesso/politica";
import type { TipoGovernanca } from "@/lib/governanca/tipos";
import { alvoExclusaoUnificado } from "@/lib/governanca/alvos-ui";
import type { FonteUnificacao } from "@/lib/unificacao/tipos";

/** Abre uma revisão; a exclusão só acontece depois de nova autorização e confirmação. */
export async function ExcluirRegistroLink({ tipo, origemId, className = "", children = "Excluir da plataforma" }: {
  tipo: TipoGovernanca;
  origemId: string;
  className?: string;
  children?: ReactNode;
}) {
  const acesso = await acessoAtual();
  if (acesso.perfil !== "ADMINISTRADOR" || !pode(acesso, "governanca.editar") || !carteiraIrrestrita(acesso)) return null;
  return <Link
    href={`/cadastros/governanca?${new URLSearchParams({ tipo, origemId, modo: "excluir" })}`}
    className={`inline-flex min-h-8 items-center rounded-md px-2 py-1 text-xs font-semibold text-erro underline-offset-4 hover:bg-erro/5 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 ${className}`}
    title="Revisar o impacto e confirmar a exclusão com histórico"
  >{children}</Link>;
}

export async function ExcluirUnificadoLink({ registro }: { registro: Pick<FonteUnificacao, "dominio" | "origem" | "origemId" | "chave" | "tituloChave"> }) {
  const alvo = alvoExclusaoUnificado(registro);
  if (!alvo) return null;
  return ExcluirRegistroLink({ tipo: alvo.tipo, origemId: alvo.origemId, children: alvo.rotulo });
}
