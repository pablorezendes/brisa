import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const usuario = process.env.WIDESYS_USUARIO?.trim();
const senha = process.env.WIDESYS_SENHA;
const origemConfigurada = new URL(
  process.env.WIDESYS_BASE_URL ?? "https://brisaazul.app2.widesys.com.br",
);

if (
  origemConfigurada.protocol !== "https:" ||
  origemConfigurada.username ||
  origemConfigurada.password
) {
  throw new Error("WIDESYS_BASE_URL precisa ser uma origem HTTPS sem credenciais embutidas.");
}

const origem = origemConfigurada.origin;

if (!usuario || !senha) {
  throw new Error("Defina WIDESYS_USUARIO e WIDESYS_SENHA somente no processo de captura.");
}

const raiz = dirname(fileURLToPath(import.meta.url));
const destino = join(raiz, "..", "data", "legacy-widesys");
const baseApi = `${origem}/api/index.php/v1/widesys`;
const autorizacao = `Basic ${Buffer.from(`${usuario}:${senha}`, "utf8").toString("base64")}`;
const capturadoEm = new Date().toISOString();

async function esperar(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function obterJson(caminho, tentativa = 1) {
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), 30_000);
  try {
    const resposta = await fetch(`${baseApi}${caminho}`, {
      headers: {
        Accept: "application/vnd.api+json",
        Authorization: autorizacao,
      },
      signal: controlador.signal,
    });

    if (!resposta.ok) {
      const corpo = (await resposta.text()).slice(0, 500);
      const erro = new Error(`GET ${caminho}: HTTP ${resposta.status} ${corpo}`);
      erro.status = resposta.status;
      throw erro;
    }
    return await resposta.json();
  } catch (erro) {
    const status = Number(erro?.status ?? 0);
    const repetivel = erro?.name === "AbortError" || status === 429 || status >= 500;
    if (repetivel && tentativa < 4) {
      await esperar(500 * 2 ** (tentativa - 1));
      return obterJson(caminho, tentativa + 1);
    }
    throw erro;
  } finally {
    clearTimeout(timeout);
  }
}

async function mapearComLimite(itens, limite, tarefa) {
  const saida = new Array(itens.length);
  let proximo = 0;

  async function trabalhador() {
    while (true) {
      const indice = proximo++;
      if (indice >= itens.length) return;
      saida[indice] = await tarefa(itens[indice], indice);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return saida;
}

function dadosDaLista(resposta, rotulo) {
  if (!Array.isArray(resposta?.data)) {
    throw new Error(`${rotulo}: resposta sem array data.`);
  }
  const total = Number(resposta?.meta?.["total-items"] ?? resposta.data.length);
  if (total !== resposta.data.length) {
    throw new Error(`${rotulo}: vieram ${resposta.data.length} de ${total} registros.`);
  }
  return resposta.data;
}

async function gravarJson(nome, valor) {
  const caminho = join(destino, nome);
  const temporario = `${caminho}.tmp`;
  const conteudo = `${JSON.stringify(valor, null, 2)}\n`;
  await writeFile(temporario, conteudo, { encoding: "utf8", mode: 0o600 });
  await rename(temporario, caminho);
  return {
    arquivo: nome,
    bytes: Buffer.byteLength(conteudo),
    sha256: createHash("sha256").update(conteudo).digest("hex"),
  };
}

await mkdir(destino, { recursive: true, mode: 0o700 });

const clientesLista = await obterJson("/clientes?page%5Blimit%5D=500");
const clientes = dadosDaLista(clientesLista, "clientes");
const clientesDetalhes = await mapearComLimite(clientes, 4, async (cliente, indice) => {
  if ((indice + 1) % 25 === 0 || indice + 1 === clientes.length) {
    process.stdout.write(`clientes ${indice + 1}/${clientes.length}\n`);
  }
  return obterJson(`/clientes/${encodeURIComponent(cliente.id)}`);
});

const produtosInativos = await obterJson(
  "/produtos?page%5Blimit%5D=500&filter%5Bprodutos.published%5D=0",
);
const produtosPublicados = await obterJson(
  "/produtos?page%5Blimit%5D=500&filter%5Bprodutos.published%5D=1",
);
const produtos = [
  ...dadosDaLista(produtosInativos, "produtos não publicados"),
  ...dadosDaLista(produtosPublicados, "produtos publicados"),
];
const produtosUnicos = [...new Map(produtos.map((produto) => [String(produto.id), produto])).values()];
const produtosDetalhes = await mapearComLimite(produtosUnicos, 4, async (produto, indice) => {
  if ((indice + 1) % 10 === 0 || indice + 1 === produtosUnicos.length) {
    process.stdout.write(`imóveis ${indice + 1}/${produtosUnicos.length}\n`);
  }
  return obterJson(`/produtos/${encodeURIComponent(produto.id)}`);
});
const produtosFiltros = await obterJson("/produtos/filters");

const arquivos = [];
arquivos.push(await gravarJson("clientes-lista.json", clientesLista));
arquivos.push(
  await gravarJson("clientes-detalhes.json", {
    capturadoEm,
    total: clientesDetalhes.length,
    respostas: clientesDetalhes,
  }),
);
arquivos.push(
  await gravarJson("produtos-listas.json", {
    capturadoEm,
    naoPublicados: produtosInativos,
    publicados: produtosPublicados,
  }),
);
arquivos.push(
  await gravarJson("produtos-detalhes.json", {
    capturadoEm,
    total: produtosDetalhes.length,
    respostas: produtosDetalhes,
  }),
);
arquivos.push(await gravarJson("produtos-filtros.json", produtosFiltros));

const manifesto = {
  formato: 1,
  origem,
  capturadoEm,
  autenticacaoPersistida: false,
  contagens: {
    clientes: clientes.length,
    clientesDetalhes: clientesDetalhes.length,
    produtosNaoPublicados: produtosInativos.data.length,
    produtosPublicados: produtosPublicados.data.length,
    produtosUnicos: produtosUnicos.length,
    produtosDetalhes: produtosDetalhes.length,
  },
  arquivos,
};
await gravarJson("manifesto.json", manifesto);

process.stdout.write(`${JSON.stringify(manifesto.contagens, null, 2)}\n`);
