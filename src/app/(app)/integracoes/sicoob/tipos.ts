import type { DiagnosticoAutenticacaoSicoob } from "@/lib/integracoes/sicoob/diagnostico";

export type EstadoTesteSicoob = {
  erro?: string;
  resultado?: DiagnosticoAutenticacaoSicoob;
};
