import { Badge } from "@/components/ui";

/** Badge padrão de status de contrato: ativo=verde, acordo=âmbar, encerrado=slate. */
export function badgeStatus(status: string) {
  if (status === "ativo") return <Badge cor="verde">ativo</Badge>;
  if (status === "acordo") return <Badge cor="ambar">acordo</Badge>;
  return <Badge cor="slate">encerrado</Badge>;
}
