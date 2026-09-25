"use client";

import { RecuperacaoPagina, type ErroPaginaProps } from "../../components/recuperacao-pagina";

/** Mantém a navegação do shell disponível quando apenas o conteúdo falha. */
export default function ErroConteudo(props: ErroPaginaProps) {
  return <RecuperacaoPagina {...props}/>;
}
