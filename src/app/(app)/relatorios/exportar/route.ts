import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { perfilAtual, perfilPodeVerComissoes } from "@/lib/autorizacao";

export async function GET(request: Request) {
  await exigirPermissaoAcesso("relatorios.exportar", { global: true });
  const tipo = new URL(request.url).searchParams.get("tipo");
  const headers = { "Cache-Control": "no-store" };
  if (tipo !== "comissao" && tipo !== "resultado") {
    return Response.json({ erro: "Parâmetro tipo deve ser 'comissao' ou 'resultado'." }, { status: 400, headers });
  }
  if (tipo === "comissao" && !perfilPodeVerComissoes(await perfilAtual())) {
    return new Response(null, { status: 404, headers });
  }
  return Response.json({
    erro: "Este formato de exportação foi desativado na base Widesys.",
    consulta: tipo === "resultado" ? "/executivo" : "/financeiro/comissoes",
  }, { status: 410, headers });
}
