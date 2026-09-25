/** Smoke test somente leitura: nunca imprime cookies, nomes ou valores. */
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";

const db = new PrismaClient();
async function main() {
  const base = new URL(process.argv[2] ?? "http://127.0.0.1:3100");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.protocol !== "http:") throw new Error("Use somente um servidor local de teste.");
  const segredo = process.env.AUTH_SECRET;
  if (!segredo || segredo.length < 32) throw new Error("Carregue AUTH_SECRET do ambiente local.");
  const admin = await db.usuario.findFirst({ where: { perfil: "ADMINISTRADOR" }, select: { id: true } });
  if (!admin) throw new Error("A base de teste precisa de um administrador existente.");
  function cookie(sub: string) {
    const corpo = Buffer.from(JSON.stringify({ sub, nome: "Verificação técnica local", exp: Date.now() + 120000 })).toString("base64url");
    return `brisa_sessao=${corpo}.${createHmac("sha256", segredo!).update(corpo).digest("base64url")}`;
  }
  async function verificar(caminho: string, esperado: number, sessao?: string, marcador?: string, rotulo = caminho) {
    const resposta = await fetch(new URL(caminho, base), { redirect: "manual", headers: sessao ? { cookie: sessao } : undefined });
    const conteudo = await resposta.text();
    // Depois do loading, Next pode sinalizar notFound no stream já HTTP 200.
    // Aceita só essa negação explícita, nunca um 200 genérico ou exportação.
    const routeHandler = caminho.startsWith("/api/") || caminho.startsWith("/relatorios/exportar");
    const negacaoNoStream = esperado === 404 && !routeHandler && resposta.status === 200 &&
      conteudo.includes("NEXT_HTTP_ERROR_FALLBACK;404") &&
      /<meta\b(?=[^>]*name="robots")(?=[^>]*content="[^"]*noindex")[^>]*>/i.test(conteudo);
    const destinoLegado = caminho === "/relatorios/comissao?ano=2026" ? "/financeiro/comissoes?ano=2026" : null;
    const redirecionamentoNoStream = esperado === 307 && destinoLegado !== null && resposta.status === 200 &&
      conteudo.includes(`NEXT_REDIRECT;replace;${destinoLegado};307;`) &&
      [...conteudo.matchAll(/<meta\b[^>]*>/gi)].some(([tag]) => tag.includes('http-equiv="refresh"') && tag.includes(`url=${destinoLegado}`));
    const marcadoresRestritos = [
      "Atualizar conciliação", "Registro e origem", "Devido consolidado",
      "Comissão por empreendimento", "Mapa de calor da comissão",
      "Canais e mensagens", "Régua de cobrança", "Fila e histórico",
      "Um serviço. Uma referência. Um documento.", "Documentos e histórico",
      "1. Identificação do emitente", "CNPJ numérico do prestador",
      "Cadastre e valide os parâmetros fiscais antes de criar o primeiro rascunho.",
      'name="tomadorNome"',
    ];
    const vazamento = esperado === 404 && marcadoresRestritos.some(texto => conteudo.includes(texto));
    if ((resposta.status !== esperado && !negacaoNoStream && !redirecionamentoNoStream) || vazamento || (marcador && !conteudo.includes(marcador)) || conteudo.includes("Application error:") || /<template\b[^>]*data-dgst="\d+"/i.test(conteudo)) throw new Error(`Falha na rota ${rotulo}: HTTP ${resposta.status}.`);
    console.log(`OK ${rotulo}: HTTP ${resposta.status}${negacaoNoStream ? " · acesso negado no stream, sem conteúdo restrito" : redirecionamentoNoStream ? " · redirecionamento confirmado no stream" : ""}`);
  }
  const sessao = cookie(admin.id);
  for (const [rota, marcador] of [
    ["/financeiro", "Financeiro unificado"], ["/recebimentos", "Contas a receber"],
    ["/financeiro/contas-a-pagar", "Contas a pagar"], ["/caixa", "Movimentações"],
    ["/contratos", "Contratos"], ["/cadastros/pessoas", "Pessoas"],
    ["/cadastros/base-unificada?dominio=IMOVEL", "Imóveis"], ["/unificacao?estado=PENDENTE", "Resolver"],
    ["/recebimentos?visao=locacao&mes=2026-06", "Recebimentos"],
    ["/caixa?visao=livro&mes=2026-06", "Caixa"],
    ["/financeiro/contas-a-receber?mes=2026-06&vencidos=1", "Contas a receber"],
    ["/financeiro/migracao-widesys", "Auditoria financeira Widesys"],
    ["/executivo?mes=2026-06", "Brisa"], ["/financeiro/comissoes?ano=2026", "Comissões"],
    ["/relatorios/resultado?mes=2026-06", "Brisa"], ["/paineis/cobranca?mes=2026-06", "Brisa"],
    ["/paineis/caixa?ano=2026", "Brisa"], ["/temporada", "Brisa"],
    ["/financeiro/automacoes", "Automações de cobrança"],
    ["/financeiro/notas-fiscais", "NFS-e"],
    ["/financeiro/notas-fiscais/configuracao", "Goiânia"],
  ]) await verificar(rota, 200, sessao, marcador);
  const pendente = await db.unificacaoRegistro.findFirst({ where: { status: "PENDENTE", dominio: "RECEBER" }, select: { chave: true } });
  if (pendente) await verificar(`/unificacao/${encodeURIComponent(pendente.chave)}`, 200, sessao, "Como resolver", "/unificacao/[registro]");
  await verificar("/relatorios/comissao?ano=2026", 307, sessao, undefined, "atalho anterior de comissões");
  // Perfil inexistente usa a regra de menor privilégio do próprio app.
  await verificar("/unificacao", 404, cookie("teste-sem-permissao-unificacao"));
  await verificar("/financeiro/contas-a-pagar", 404, cookie("teste-sem-permissao-unificacao"));
  await verificar("/financeiro/comissoes", 404, cookie("teste-sem-permissao-unificacao"));
  for (const rota of ["/financeiro/automacoes", "/financeiro/notas-fiscais", "/financeiro/notas-fiscais/configuracao", "/financeiro/notas-fiscais/novo"]) {
    await verificar(rota, 404, cookie("teste-sem-permissao-unificacao"));
    await verificar(rota, 307);
  }
  const webhookMeta = await fetch(new URL("/api/integracoes/whatsapp/webhook", base), { method: "POST", body: "{}", redirect: "manual" });
  if (![403,503].includes(webhookMeta.status)) throw new Error("Webhook WhatsApp não bloqueou POST sem assinatura.");
  console.log("OK webhook WhatsApp: rejeita POST não autenticado.");
  await verificar("/relatorios/comissao", 404, cookie("teste-sem-permissao-unificacao"));
  await verificar("/relatorios/exportar?tipo=comissao&ano=2026", 404, cookie("teste-sem-permissao-unificacao"));
  const menuRestrito = await fetch(new URL("/financeiro", base), {
    headers: { cookie: cookie("teste-sem-permissao-unificacao") },
  });
  if (menuRestrito.status !== 200 || (await menuRestrito.text()).includes('href="/financeiro/comissoes"')) {
    throw new Error("Menu de comissões visível para perfil sem permissão.");
  }
  console.log("OK menu de comissões: oculto para perfil sem permissão.");
  for (const caminho of ["/", "/executivo", "/financeiro", "/recebimentos?visao=locacao", "/relatorios/resultado", "/paineis/empreendimentos", "/paineis/temporada", "/ajuda"]) {
    const resposta = await fetch(new URL(caminho, base), { headers: { cookie: cookie("teste-sem-permissao-unificacao") } });
    const html = await resposta.text();
    if (resposta.status !== 200 || /comiss(?:ã|a)o|comiss(?:õ|o)es|base de c[aá]lculo/i.test(html)) {
      throw new Error(`Informação reservada em tela geral: ${caminho} (HTTP ${resposta.status}).`);
    }
  }
  console.log("OK telas gerais: sem conteúdo de comissões para perfil sem permissão.");
  const exportacaoComissao = await fetch(new URL("/relatorios/exportar?tipo=comissao&ano=2026", base), {
    headers: { cookie: sessao },
  });
  if (exportacaoComissao.status !== 200) throw new Error(`Exportação de comissões: HTTP ${exportacaoComissao.status}.`);
  const livroComissao = new ExcelJS.Workbook();
  await livroComissao.xlsx.load(Buffer.from(await exportacaoComissao.arrayBuffer()) as unknown as Parameters<typeof livroComissao.xlsx.load>[0]);
  if (!livroComissao.getWorksheet("COMISSÃO")) throw new Error("Planilha de comissões indisponível ao administrador.");
  console.log("OK exportação de comissões: disponível ao administrador.");
  const resultado = await fetch(new URL("/relatorios/exportar?tipo=resultado&ano=2026", base), {
    headers: { cookie: cookie("teste-sem-permissao-unificacao") },
  });
  if (resultado.status !== 200) throw new Error(`Exportação operacional: HTTP ${resultado.status}.`);
  const livro = new ExcelJS.Workbook();
  await livro.xlsx.load(Buffer.from(await resultado.arrayBuffer()) as unknown as Parameters<typeof livro.xlsx.load>[0]);
  const cabecalhos = livro.getWorksheet("RESULTADO")?.getRow(1).values;
  if (!Array.isArray(cabecalhos) || cabecalhos.some((item) => /COMISS|BASE C[AÁ]LCULO/i.test(String(item)))) {
    throw new Error("Exportação operacional inclui coluna reservada.");
  }
  console.log("OK exportação operacional: somente colunas autorizadas.");
  await verificar("/unificacao", 307);
  console.log("Rotas unificadas, modos anteriores e restrições de acesso verificados.");
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Falha na verificação."); process.exitCode = 1; }).finally(() => db.$disconnect());
