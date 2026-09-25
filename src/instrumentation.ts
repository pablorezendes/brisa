import type { Instrumentation } from "next";
import { diagnosticoRequisicao } from "./lib/diagnostico-seguro";

/** Somente metadados técnicos; sem mensagem, stack, headers, query ou payload. */
export const onRequestError: Instrumentation.onRequestError = (erro, request, context) => {
  console.error(JSON.stringify(diagnosticoRequisicao(erro, request, context)));
};
