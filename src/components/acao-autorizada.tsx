import type { ReactNode } from "react";
import { acessoAtual } from "@/lib/acesso/servidor";
import { carteiraIrrestrita, pode, type PermissaoAcesso, type PoliticaAcesso } from "@/lib/acesso/politica";

type RequisitosAcao = {
  permissao: PermissaoAcesso | readonly PermissaoAcesso[];
  perfis?: readonly string[];
};

/** A interface acompanha as mesmas capacidades efetivas das actions; não substitui suas guardas. */
export function podeExibirAcao(acesso: PoliticaAcesso, { permissao, perfis }: RequisitosAcao) {
  const permissoes = typeof permissao === "string" ? [permissao] : permissao;
  return carteiraIrrestrita(acesso) && permissoes.length > 0
    && permissoes.every((codigo) => pode(acesso, codigo))
    && (!perfis || perfis.includes(acesso.perfil));
}

/** Server Component: controles negados não são enviados no HTML/RSC. */
export async function AcaoAutorizada({ children, ...requisitos }: RequisitosAcao & { children: ReactNode }) {
  return podeExibirAcao(await acessoAtual(), requisitos) ? <>{children}</> : null;
}
