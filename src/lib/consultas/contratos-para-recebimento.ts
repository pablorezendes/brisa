import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizar } from "@/lib/dominio/normalizacao";
import { idsGovernadosInativos, recursoEstaAtivo } from "@/lib/governanca/filtros";

type Banco = PrismaClient | Prisma.TransactionClient;
const STATUS_IMPORTACAO_INVALIDOS = ["QUARENTENA", "AUSENTE_NA_FONTE"];

function contratoWidesysVigente(situacao: string | null) {
  const valor = normalizar(situacao).replace(/^[^A-Z0-9]+/, "");
  return ["VIGENTE", "ATIVO", "EM VIGOR"].includes(valor);
}

export async function buscarContratoWidesysParaRecebimento(db: Banco, id: string) {
  const contrato = await db.contratoLegado.findFirst({
    where: { id, origem: "WIDESYS", statusImportacao: { notIn: STATUS_IMPORTACAO_INVALIDOS } },
    select: { id: true, legadoId: true, numeroContrato: true, imovelLegadoId: true, situacaoOrigem: true },
  });
  if (!contrato || !contratoWidesysVigente(contrato.situacaoOrigem)
    || !await recursoEstaAtivo(db, "CONTRATO_LEGADO", contrato.id)) return null;

  if (contrato.imovelLegadoId) {
    const imovel = await db.imovelLegado.findUnique({
      where: { origem_legadoId: { origem: "WIDESYS", legadoId: contrato.imovelLegadoId } },
      select: { id: true },
    });
    if (imovel && !await recursoEstaAtivo(db, "IMOVEL_LEGADO", imovel.id)) return null;
  }
  return contrato;
}

export async function listarContratosParaRecebimento(db: Banco): Promise<Array<{ valor: string; rotulo: string }>> {
  const [contratosInativos, unidadesInativas, empreendimentosInativos, legadosInativos, imoveisInativos] = await Promise.all([
    idsGovernadosInativos(db, "CONTRATO"), idsGovernadosInativos(db, "UNIDADE"),
    idsGovernadosInativos(db, "EMPREENDIMENTO"), idsGovernadosInativos(db, "CONTRATO_LEGADO"),
    idsGovernadosInativos(db, "IMOVEL_LEGADO"),
  ]);
  const [nativos, importados] = await Promise.all([
    db.contrato.findMany({
      where: {
        id: { notIn: contratosInativos }, status: { in: ["ativo", "acordo"] },
        unidade: { ativo: true, id: { notIn: unidadesInativas }, empreendimento: { ativo: true, id: { notIn: empreendimentosInativos } } },
      },
      select: { id: true, locatario: { select: { nome: true } }, unidade: { select: { identificacao: true, empreendimento: { select: { nome: true } } } } },
      orderBy: [{ unidade: { empreendimento: { nome: "asc" } } }, { unidade: { identificacao: "asc" } }],
    }),
    db.contratoLegado.findMany({
      where: { origem: "WIDESYS", id: { notIn: legadosInativos }, statusImportacao: { notIn: STATUS_IMPORTACAO_INVALIDOS } },
      select: {
        id: true, legadoId: true, numeroContrato: true, imovelLegadoId: true, situacaoOrigem: true,
        partes: { where: { papel: "INQUILINO", statusImportacao: { notIn: STATUS_IMPORTACAO_INVALIDOS } }, orderBy: { ordem: "asc" }, select: { pessoaLegadoId: true } },
      },
      orderBy: [{ numeroContrato: "asc" }, { legadoId: "asc" }],
    }),
  ]);
  const vigentes = importados.filter(contrato => contratoWidesysVigente(contrato.situacaoOrigem));
  const [imoveis, pessoas] = await Promise.all([
    db.imovelLegado.findMany({
      where: { origem: "WIDESYS", legadoId: { in: vigentes.flatMap(contrato => contrato.imovelLegadoId ? [contrato.imovelLegadoId] : []) } },
      select: { id: true, legadoId: true, nome: true, referencia: true, empreendimentoNome: true },
    }),
    db.pessoa.findMany({
      where: { origem: "WIDESYS", legadoId: { in: vigentes.flatMap(contrato => contrato.partes.flatMap(parte => parte.pessoaLegadoId ? [parte.pessoaLegadoId] : [])) } },
      select: { legadoId: true, nome: true },
    }),
  ]);
  const imovelPorLegado = new Map(imoveis.map(imovel => [imovel.legadoId, imovel]));
  const pessoaPorLegado = new Map(pessoas.map(pessoa => [pessoa.legadoId, pessoa.nome]));
  const bloqueados = new Set(imoveisInativos);
  return [
    ...vigentes.filter(contrato => {
      const imovel = imovelPorLegado.get(contrato.imovelLegadoId ?? "");
      return !imovel || !bloqueados.has(imovel.id);
    }).map(contrato => {
      const imovel = imovelPorLegado.get(contrato.imovelLegadoId ?? "");
      const inquilino = contrato.partes.map(parte => pessoaPorLegado.get(parte.pessoaLegadoId ?? "")).filter(Boolean).join(", ");
      return {
        valor: `WIDESYS:${contrato.id}`,
        rotulo: [`Contrato ${contrato.numeroContrato ?? contrato.legadoId}`, imovel?.empreendimentoNome,
          imovel?.nome ?? imovel?.referencia, inquilino].filter(Boolean).join(" · "),
      };
    }),
    ...nativos.map(contrato => ({
      valor: contrato.id,
      rotulo: `${contrato.unidade.empreendimento.nome} · ${contrato.unidade.identificacao} · ${contrato.locatario?.nome ?? "Sem inquilino"}`,
    })),
  ];
}
