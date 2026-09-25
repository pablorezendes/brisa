"use client";

import { RecuperacaoPagina, type ErroPaginaProps } from "../components/recuperacao-pagina";

/** Captura também uma falha no layout autenticado, acima do boundary (app). */
export default function ErroAplicacao(props: ErroPaginaProps) {
  return <main><RecuperacaoPagina {...props} global/></main>;
}
