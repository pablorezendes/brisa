import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader, Sigilo, btnSecundario } from "@/components/ui";
import { IconeMenu } from "@/components/icones-menu";
import { obterPessoaWidesys } from "@/lib/consultas/cadastros-widesys";

export const metadata = { title: "Detalhe da pessoa — Cadastros — Brisa" };

const ROTULOS_PAPEL: Record<string, string> = {
  AVALISTA: "Avalista",
  BENEFICIARIO: "Beneficiário",
  COMPRADOR: "Comprador",
  CORRETOR: "Corretor",
  FIADOR: "Fiador",
  FORNECEDOR: "Fornecedor",
  FUNCIONARIO: "Funcionário",
  INQUILINO: "Inquilino",
  INTERESSADO: "Interessado",
  PRECADASTRO: "Interessado",
  PROPRIETARIO: "Proprietário",
};

function rotuloPapel(papel: string) {
  return ROTULOS_PAPEL[papel] ?? papel.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
}

function rotuloTipo(tipo: string) {
  if (tipo === "FISICA") return "Pessoa física";
  if (tipo === "JURIDICA") return "Pessoa jurídica";
  return "Tipo não informado";
}

function texto(valor: string | null | undefined) {
  return valor?.trim() || "Não informado";
}

function dataHora(valor: string | null | undefined) {
  if (!valor) return "data não informada";
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? valor : data.toLocaleDateString("pt-BR");
}

function DataField({
  rotulo,
  valor,
  sigiloso = false,
}: {
  rotulo: string;
  valor: string | null | undefined;
  sigiloso?: boolean;
}) {
  return (
    <div className="min-w-0 border-b border-contorno/60 py-3 last:border-b-0">
      <dt className="text-[9px] font-bold uppercase tracking-[0.1em] text-tinta-suave">{rotulo}</dt>
      <dd className="mt-1 break-words text-[12px] font-semibold text-tinta">
        {sigiloso ? <Sigilo>{texto(valor)}</Sigilo> : texto(valor)}
      </dd>
    </div>
  );
}

function CardTitle({ icone, children }: { icone: "pessoas" | "unidades" | "cadastros"; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-contorno px-4 py-3.5 sm:px-5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e8f1ee] text-oliva-escura">
        <IconeMenu nome={icone} tamanho={16} />
      </span>
      <h2 className="text-sm font-bold text-tinta">{children}</h2>
    </div>
  );
}

export default async function PaginaDetalhePessoa({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pessoa = await obterPessoaWidesys(id);
  if (!pessoa) notFound();

  const endereco = [pessoa.endereco, pessoa.numeroEndereco, pessoa.complementoEndereco]
    .filter(Boolean)
    .join(", ");
  const localidade = [pessoa.bairro, pessoa.cidade, pessoa.uf].filter(Boolean).join(" · ");
  const cadastroCompleto = Boolean(
    pessoa.cpfCnpjMascarado &&
      (pessoa.emails.length > 0 || pessoa.telefones.length > 0) &&
      pessoa.cidade &&
      pessoa.uf,
  );

  return (
    <div>
      <PageHeader
        titulo={pessoa.nome}
        descricao="Detalhes cadastrais preservados da origem, organizados para consulta e conferência."
        acoes={
          <Link href="/cadastros/pessoas" className={btnSecundario}>
            ← Voltar às pessoas
          </Link>
        }
      />

      <Card className="mb-5 overflow-hidden">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#e8f1ee] text-oliva-escura">
              <IconeMenu nome="pessoas" tamanho={21} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge cor="azul">Widesys</Badge>
                <Badge cor={pessoa.ativo ? "verde" : "slate"}>{pessoa.ativo ? "Ativo na origem" : "Inativo na origem"}</Badge>
                <Badge cor={cadastroCompleto ? "verde" : "ambar"}>{cadastroCompleto ? "Cadastro completo" : "Revisar cadastro"}</Badge>
              </div>
              <p className="mt-2 text-[11px] text-tinta-suave">
                {rotuloTipo(pessoa.tipoPessoa)} · atualizado no Brisa em {dataHora(pessoa.atualizadoEm)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {pessoa.papeis.map((papel) => <Badge key={papel.id}>{rotuloPapel(papel.papel)}</Badge>)}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card className="overflow-hidden">
          <CardTitle icone="cadastros">Identificação</CardTitle>
          <dl className="grid px-4 sm:grid-cols-2 sm:gap-x-6 sm:px-5">
            <DataField rotulo="Nome completo / razão social" valor={pessoa.nome} />
            <DataField rotulo="Nome fantasia / apelido" valor={pessoa.nomeFantasia ?? pessoa.apelido} />
            <DataField rotulo="CPF / CNPJ" valor={pessoa.cpfCnpjMascarado} sigiloso />
            <DataField rotulo="RG / inscrição estadual" valor={pessoa.rgIe} sigiloso />
            <DataField rotulo="Inscrição municipal" valor={pessoa.inscricaoMunicipal} sigiloso />
            <DataField rotulo="Nascimento / abertura" valor={pessoa.nascimentoAbertura} sigiloso />
            <DataField rotulo="Profissão" valor={pessoa.profissao} />
            <DataField rotulo="Estado civil" valor={pessoa.estadoCivil} />
          </dl>
        </Card>

        <Card className="overflow-hidden">
          <CardTitle icone="pessoas">Contatos</CardTitle>
          <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
            <section>
              <h3 className="text-[9px] font-bold uppercase tracking-[0.1em] text-tinta-suave">E-mails</h3>
              {pessoa.emails.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {pessoa.emails.map((contato) => (
                    <li key={contato.id} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-contorno bg-[#fafbfb] px-3 py-2 text-[11px] font-semibold text-tinta">
                      <span className="min-w-0 truncate"><Sigilo>{contato.email}</Sigilo></span>
                      {contato.principal ? <Badge cor="verde">Principal</Badge> : null}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-[11px] text-tinta-suave">Nenhum e-mail informado.</p>}
            </section>
            <section>
              <h3 className="text-[9px] font-bold uppercase tracking-[0.1em] text-tinta-suave">Telefones</h3>
              {pessoa.telefones.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {pessoa.telefones.map((contato) => (
                    <li key={contato.id} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-contorno bg-[#fafbfb] px-3 py-2 text-[11px] font-semibold text-tinta">
                      <span><Sigilo>{contato.telefone}</Sigilo></span>
                      {contato.principal ? <Badge cor="verde">Principal</Badge> : null}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-[11px] text-tinta-suave">Nenhum telefone informado.</p>}
            </section>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardTitle icone="unidades">Endereço</CardTitle>
          <dl className="grid px-4 sm:grid-cols-2 sm:gap-x-6 sm:px-5">
            <DataField rotulo="Logradouro" valor={endereco} sigiloso />
            <DataField rotulo="Bairro · cidade · UF" valor={localidade} sigiloso />
            <DataField rotulo="CEP" valor={pessoa.cep} sigiloso />
            <DataField rotulo="Nacionalidade" valor={pessoa.nacionalidade} />
            <DataField rotulo="Naturalidade" valor={pessoa.naturalidade} />
          </dl>
        </Card>

        <Card className="overflow-hidden">
          <CardTitle icone="cadastros">Proveniência</CardTitle>
          <div className="p-4 sm:p-5">
            <div className="rounded-lg border border-azul/20 bg-azul/5 p-3 text-[11px] leading-relaxed text-tinta-suave">
              Este cadastro veio do Widesys e permanece identificado pela chave da origem. O Brisa não exibe o snapshot técnico, dados bancários nem chaves PIX nesta página.
            </div>
            <dl className="mt-3 grid sm:grid-cols-2 sm:gap-x-6">
              <DataField rotulo="Criado na origem" valor={pessoa.origemCriadoEm} />
              <DataField rotulo="Atualizado na origem" valor={pessoa.origemAtualizadoEm} />
              <DataField rotulo="Criado por" valor={pessoa.criadoPorOrigem} />
              <DataField rotulo="Website" valor={pessoa.website} />
            </dl>
          </div>
        </Card>
      </div>
    </div>
  );
}
