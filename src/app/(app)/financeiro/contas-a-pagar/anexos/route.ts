import { exigirPermissaoAcesso } from "@/lib/acesso/servidor";
import { prisma } from "@/lib/db";
import { LIMITE_ANEXO_DESPESA, lerAnexoDespesa, listarAnexosDespesa, salvarAnexoDespesa } from "@/lib/despesas/anexos";

const privado = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  const ator = await exigirPermissaoAcesso("despesas.ver", { global: true });
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id) {
      const anexo = await lerAnexoDespesa(prisma, id, ator.usuarioId);
      return new Response(new Uint8Array(anexo.conteudo), { headers: {
        ...privado, "Content-Type": anexo.mimeType,
        "Content-Disposition": `attachment; filename="anexo"; filename*=UTF-8''${encodeURIComponent(anexo.nomeOriginal).replaceAll("'", "%27")}`,
        "Content-Security-Policy": "sandbox; default-src 'none'",
      } });
    }
    return Response.json({ anexos: await listarAnexosDespesa(prisma, url.searchParams.get("despesaId") ?? "", ator.usuarioId) }, { headers: privado });
  } catch {
    return Response.json({ erro: "Anexos indisponíveis. Confira seu acesso e a situação da despesa." }, { status: 404, headers: privado });
  }
}

export async function POST(request: Request) {
  const ator = await exigirPermissaoAcesso("despesas.editar", { global: true });
  // Route handlers não recebem a proteção de Origin das Server Actions.
  const origem = request.headers.get("origin");
  const permitidas = [new URL(request.url).origin];
  if (process.env.APP_PUBLIC_URL) {
    try { permitidas.push(new URL(process.env.APP_PUBLIC_URL).origin); } catch { /* Configuração inválida não amplia a confiança. */ }
  }
  if (!origem || !permitidas.includes(origem)) return Response.json({ erro: "Origem não autorizada." }, { status: 403, headers: privado });
  const limite = LIMITE_ANEXO_DESPESA + 64 * 1024;
  if (Number(request.headers.get("content-length")) > limite) return Response.json({ erro: "Envie um arquivo de até 5 MB." }, { status: 413, headers: privado });
  try {
    // Limite real mesmo quando Content-Length falta ou é incorreto.
    const leitor = request.body?.getReader();
    if (!leitor) throw new Error("Selecione um arquivo.");
    const partes: Uint8Array[] = [];
    let tamanho = 0;
    while (true) {
      const { done, value } = await leitor.read();
      if (done) break;
      tamanho += value.byteLength;
      if (tamanho > limite) { await leitor.cancel(); return Response.json({ erro: "Envie um arquivo de até 5 MB." }, { status: 413, headers: privado }); }
      partes.push(value);
    }
    const corpo = Buffer.concat(partes);
    const form = await new Response(corpo, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File)) throw new Error("Selecione um PDF, JPEG ou PNG.");
    const anexo = await salvarAnexoDespesa(prisma, String(form.get("despesaId") ?? ""), ator.usuarioId, {
      nome: arquivo.name, mimeType: arquivo.type, conteudo: new Uint8Array(await arquivo.arrayBuffer()),
    });
    return Response.json({ anexo }, { headers: privado });
  } catch (erro) {
    const mensagens = ["Envie um arquivo de até 5 MB.", "Formato inválido. Use PDF, JPEG ou PNG.", "Informe o nome do arquivo.", "Selecione um arquivo.", "Selecione um PDF, JPEG ou PNG.", "Esta despesa já possui 10 anexos."];
    const mensagem = erro instanceof Error && mensagens.includes(erro.message) ? erro.message : "Não foi possível anexar. Confira seu acesso e a situação da despesa.";
    return Response.json({ erro: mensagem }, { status: 400, headers: privado });
  }
}
