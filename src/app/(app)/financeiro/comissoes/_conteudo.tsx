import { Card, PageHeader } from "@/components/ui";

export default function ComissaoConteudo() {
  return (
    <>
      <PageHeader titulo="Comissões" descricao="Apuração restrita da administração." />
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Apuração indisponível para a base atual</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-tinta-suave">
          Os títulos importados do Widesys ainda não trazem a composição do aluguel, dos repasses e da taxa necessária para calcular as comissões.
        </p>
      </Card>
    </>
  );
}
