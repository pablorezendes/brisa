import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Dinheiro, PageHeader, Sigilo, btnSecundario } from "@/components/ui";
import { IconeMenu } from "@/components/icones-menu";
import { obterImovelLegado } from "@/lib/consultas/cadastros-widesys";

export const metadata = { title: "Detalhe do imóvel legado — Cadastros — Brisa" };

function texto(valor: string | null | undefined) {
  return valor?.trim() || "Não informado";
}

function dataHora(valor: string | null | undefined) {
  if (!valor) return "data não informada";
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? valor : data.toLocaleDateString("pt-BR");
}

function formatarPorcentagem(valor: string) {
  const numero = Number(valor.replace(",", "."));
  return Number.isFinite(numero)
    ? `${numero.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
    : `${valor}%`;
}

function DataField({
  rotulo,
  valor,
  sigiloso = false,
}: {
  rotulo: string;
  valor: React.ReactNode;
  sigiloso?: boolean;
}) {
  const conteudo = valor === null || valor === undefined || valor === "" ? "Não informado" : valor;
  return (
    <div className="min-w-0 border-b border-contorno/60 py-3 last:border-b-0">
      <dt className="text-[9px] font-bold uppercase tracking-[0.1em] text-tinta-suave">{rotulo}</dt>
      <dd className="mt-1 break-words text-[12px] font-semibold text-tinta">
        {sigiloso ? <Sigilo>{conteudo}</Sigilo> : conteudo}
      </dd>
    </div>
  );
}

function CardTitle({ icone, children }: { icone: "imoveis-legado" | "unidades" | "pessoas" | "financeiro"; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-contorno px-4 py-3.5 sm:px-5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e8f1ee] text-oliva-escura">
        <IconeMenu nome={icone} tamanho={16} />
      </span>
      <h2 className="text-sm font-bold text-tinta">{children}</h2>
    </div>
  );
}

export default async function PaginaDetalheImovelLegado({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const imovel = await obterImovelLegado(id);
  if (!imovel) notFound();

  const nome = imovel.nome || (imovel.referencia ? `Imóvel ${imovel.referencia}` : "Imóvel sem nome");
  const endereco = [imovel.endereco, imovel.numeroEndereco, imovel.complementoEndereco]
    .filter(Boolean)
    .join(", ");
  const localidade = [imovel.bairro, imovel.cidade, imovel.uf].filter(Boolean).join(" · ");
  const estado = imovel.disponivel === true
    ? { rotulo: "Disponível", cor: "verde" as const }
    : imovel.disponivel === false
      ? { rotulo: "Alugado", cor: "azul" as const }
      : { rotulo: "Situação a confirmar", cor: "ambar" as const };

  return (
    <div>
      <PageHeader
        titulo={nome}
        descricao="Retrato cadastral do imóvel no sistema anterior, separado da base operacional do Brisa."
        acoes={
          <Link href="/cadastros/imoveis-legado" className={btnSecundario}>
            ← Voltar à carteira
          </Link>
        }
      />

      <Card className="mb-5 overflow-hidden">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#e8f1ee] text-oliva-escura">
              <IconeMenu nome="imoveis-legado" tamanho={21} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge cor="azul">Widesys</Badge>
                <Badge cor={estado.cor}>{estado.rotulo}</Badge>
                <Badge cor={imovel.publicado ? "verde" : "slate"}>{imovel.publicado ? "Publicado" : "Não publicado"}</Badge>
              </div>
              <p className="mt-2 font-mono text-[10px] text-tinta-suave">
                {imovel.referencia ?? "Sem referência"} · atualizado no Brisa em {dataHora(imovel.atualizadoEm)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {imovel.tipo ? <Badge>{imovel.tipo}</Badge> : null}
            {imovel.finalidade ? <Badge cor="azul">{imovel.finalidade}</Badge> : null}
            {imovel.categoria ? <Badge>{imovel.categoria}</Badge> : null}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardTitle icone="imoveis-legado">Identificação e situação</CardTitle>
          <dl className="grid px-4 sm:grid-cols-2 sm:gap-x-6 sm:px-5">
            <DataField rotulo="Nome" valor={imovel.nome} />
            <DataField rotulo="Referência" valor={imovel.referencia} />
            <DataField rotulo="Apelido" valor={imovel.apelido} />
            <DataField rotulo="Empreendimento" valor={imovel.empreendimentoNome} />
            <DataField rotulo="Status comercial" valor={imovel.statusComercial} />
            <DataField rotulo="Finalidade" valor={imovel.finalidade} />
          </dl>
        </Card>

        <Card className="overflow-hidden">
          <CardTitle icone="unidades">Endereço</CardTitle>
          <dl className="grid px-4 sm:grid-cols-2 sm:gap-x-6 sm:px-5">
            <DataField rotulo="Logradouro" valor={texto(endereco)} sigiloso />
            <DataField rotulo="Bairro · cidade · UF" valor={texto(localidade)} sigiloso />
            <DataField rotulo="CEP" valor={imovel.cep} sigiloso />
          </dl>
        </Card>

        <Card className="overflow-hidden">
          <CardTitle icone="financeiro">Valores da origem</CardTitle>
          <dl className="grid px-4 sm:grid-cols-2 sm:gap-x-6 sm:px-5">
            <DataField rotulo="Locação" valor={<Dinheiro centavos={imovel.valorLocacao} />} sigiloso />
            <DataField rotulo="Venda" valor={<Dinheiro centavos={imovel.valorVenda} />} sigiloso />
            <DataField rotulo="Condomínio" valor={<Dinheiro centavos={imovel.valorCondominio} />} sigiloso />
            <DataField rotulo="IPTU" valor={<Dinheiro centavos={imovel.valorIptu} />} sigiloso />
          </dl>
          <p className="border-t border-contorno bg-[#fafbfb] px-4 py-3 text-[10px] leading-relaxed text-tinta-suave sm:px-5">
            Estes valores são apenas o retrato importado e não geram cobranças automaticamente.
          </p>
        </Card>

        <Card className="overflow-hidden">
          <CardTitle icone="unidades">Características</CardTitle>
          <dl className="grid grid-cols-2 px-4 sm:grid-cols-3 sm:gap-x-6 sm:px-5">
            <DataField rotulo="Quartos" valor={imovel.quartos} />
            <DataField rotulo="Suítes" valor={imovel.suites} />
            <DataField rotulo="Banheiros" valor={imovel.banheiros} />
            <DataField rotulo="Garagens" valor={imovel.garagens} />
            <DataField rotulo="Área total" valor={imovel.areaTotal ? `${imovel.areaTotal} m²` : null} />
          </dl>
        </Card>

        <Card className="overflow-hidden xl:col-span-2">
          <CardTitle icone="pessoas">Proprietários identificados</CardTitle>
          {imovel.proprietarios.length > 0 ? (
            <div className="divide-y divide-contorno">
              {imovel.proprietarios.map((vinculo) => (
                <div key={vinculo.id} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="min-w-0">
                    {vinculo.pessoa ? (
                      <Link href={`/cadastros/pessoas/${vinculo.pessoa.id}`} className="text-[12px] font-bold text-tinta hover:text-oliva-escura hover:underline">
                        {vinculo.pessoa.nome}
                      </Link>
                    ) : (
                      <span className="text-[12px] font-bold text-tinta">Proprietário ainda não conciliado</span>
                    )}
                    <p className="mt-0.5 text-[10px] text-tinta-suave">Vínculo preservado da origem</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {vinculo.principal ? <Badge cor="verde">Principal</Badge> : null}
                    {vinculo.porcentagem ? <Badge>{formatarPorcentagem(vinculo.porcentagem)}</Badge> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-8 text-center text-[11px] text-tinta-suave">
              Nenhum vínculo de proprietário foi informado neste cadastro da origem.
            </div>
          )}
        </Card>
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-tinta-suave">
        A página não mostra contas bancárias, dados de repasse, PIX nem o snapshot técnico do Widesys. Esses dados permanecem fora da camada de apresentação.
      </p>
    </div>
  );
}
