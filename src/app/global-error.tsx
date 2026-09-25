"use client";

import { RecuperacaoPagina, type ErroPaginaProps } from "../components/recuperacao-pagina";

/** Substitui inclusive o layout raiz: sem fontes remotas, CSS ou providers. */
export default function ErroGlobal(props: ErroPaginaProps) {
  return <html lang="pt-BR"><head><title>Recuperar acesso · Brisa</title></head><body style={{ margin: 0, minHeight: "100vh", background: "#f3f6f7" }}><main><RecuperacaoPagina {...props} global/></main></body></html>;
}
