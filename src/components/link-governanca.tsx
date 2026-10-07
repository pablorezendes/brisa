import Link from "next/link";
import { acessoAtual } from "@/lib/acesso/servidor";
import { carteiraIrrestrita, pode } from "@/lib/acesso/politica";
import type { TipoGovernanca } from "@/lib/governanca/tipos";

/** A navegação acompanha a permissão, mas a action repete a validação no servidor. */
export async function LinkGovernanca({ tipo, id, children = "Revisar e resolver" }: { tipo: TipoGovernanca; id: string; children?: React.ReactNode }) {
  const acesso = await acessoAtual();
  if (!pode(acesso, "governanca.editar") || !carteiraIrrestrita(acesso)) return null;
  return <Link href={`/cadastros/governanca?${new URLSearchParams({ tipo, origemId: id })}`} className="ml-3 inline-flex text-xs font-semibold text-oliva-escura underline-offset-4 hover:underline">{children}</Link>;
}
