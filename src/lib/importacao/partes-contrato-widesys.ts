export type PapelParteContratoWidesys =
  | "INQUILINO"
  | "PROPRIETARIO"
  | "BENEFICIARIO"
  | "FIADOR"
  | "AVALISTA"
  | "CORRETOR";

export type CampoParteContratoWidesys = {
  checked?: boolean;
  name: string;
  type?: string;
  value: string | string[];
};

export type ParteContratoWidesys = {
  flags?: Record<string, string | string[]>;
  ordem?: number;
  papel: PapelParteContratoWidesys;
  percentual?: string;
  pessoaLegadoId: string;
  valor?: string;
  vinculoId?: string;
};

const PAPEL_POR_CAMPO_PESSOA = {
  avalista_id: "AVALISTA",
  beneficiario_id: "BENEFICIARIO",
  corretor_id: "CORRETOR",
  fiador_id: "FIADOR",
  inquilino_id: "INQUILINO",
  locatario_id: "INQUILINO",
  proprietario_id: "PROPRIETARIO",
} as const satisfies Record<string, PapelParteContratoWidesys>;

function normalizarSegmento(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function segmentosCampo(nome: string): string[] {
  if (!nome.includes("[")) return [normalizarSegmento(nome)].filter(Boolean);
  return [...nome.matchAll(/([^\[\]]+)/g)]
    .map((match) => normalizarSegmento(match[1] ?? ""))
    .filter(Boolean);
}

function valoresCampo(campos: CampoParteContratoWidesys[]): string[] {
  const radios = campos.filter((campo) => (campo.type ?? "").toLowerCase() === "radio");
  const checkboxes = campos.filter((campo) => (campo.type ?? "").toLowerCase() === "checkbox");
  const fonte =
    radios.length > 0
      ? radios.filter((campo) => campo.checked === true)
      : checkboxes.length > 0
        ? (() => {
            const marcados = checkboxes.filter((campo) => campo.checked === true);
            return marcados.length > 0
              ? marcados
              : campos.filter(
                  (campo) => !["checkbox", "radio"].includes((campo.type ?? "").toLowerCase()),
                );
          })()
        : campos;
  return [
    ...new Set(
      fonte
        .flatMap((campo) => (Array.isArray(campo.value) ? campo.value : [campo.value]))
        .map((valor) => valor.trim())
        .filter(Boolean),
    ),
  ];
}

function primeiroValor(campos: CampoParteContratoWidesys[]): string | undefined {
  return valoresCampo(campos)[0];
}

function valorPersistivel(campos: CampoParteContratoWidesys[]): string | string[] | undefined {
  const valores = valoresCampo(campos);
  if (valores.length === 0) return undefined;
  return valores.length === 1 ? valores[0] : valores;
}

function identificadorValido(valor: string | undefined): valor is string {
  return Boolean(valor && valor !== "0" && /^[a-z0-9][a-z0-9._:-]{0,199}$/i.test(valor));
}

function ordemDoCaminho(prefixo: string[]): number | undefined {
  for (const segmento of [...prefixo].reverse()) {
    const match = segmento.match(/(?:^|[^0-9])(\d+)$/);
    if (!match?.[1]) continue;
    const ordem = Number.parseInt(match[1], 10);
    if (Number.isSafeInteger(ordem) && ordem >= 0) return ordem;
  }
  return undefined;
}

function ehFlagRelevante(nome: string, campos: CampoParteContratoWidesys[]): boolean {
  if (campos.some((campo) => ["checkbox", "radio"].includes((campo.type ?? "").toLowerCase()))) {
    return true;
  }
  return /(?:^|_)(?:ativo|principal|titular|responsavel|repasse|repassar|recebe|paga|administrador|procurador|solidario|assinante)(?:_|$)/.test(
    nome,
  );
}

/**
 * Extrai participantes exclusivamente de campos que identificam semanticamente
 * uma pessoa. O `id` genérico da linha Joomla identifica o vínculo, nunca a
 * pessoa relacionada ao contrato.
 */
export function extrairPartesContratoWidesys(
  campos: readonly CampoParteContratoWidesys[],
): ParteContratoWidesys[] {
  const grupos = new Map<
    string,
    {
      campos: Map<string, CampoParteContratoWidesys[]>;
      prefixo: string[];
    }
  >();

  for (const campo of campos) {
    const segmentos = segmentosCampo(campo.name);
    if (segmentos.length === 0) continue;
    const nome = segmentos.at(-1) as string;
    const prefixo = segmentos.slice(0, -1);
    const chaveGrupo = prefixo.join("\u0000");
    const grupo = grupos.get(chaveGrupo) ?? { campos: new Map(), prefixo };
    const existentes = grupo.campos.get(nome) ?? [];
    existentes.push(campo);
    grupo.campos.set(nome, existentes);
    grupos.set(chaveGrupo, grupo);
  }

  const partes = new Map<string, ParteContratoWidesys>();
  for (const grupo of grupos.values()) {
    for (const [campoPessoa, papel] of Object.entries(PAPEL_POR_CAMPO_PESSOA)) {
      const controlesPessoa = grupo.campos.get(campoPessoa) ?? [];
      for (const pessoaLegadoId of valoresCampo(controlesPessoa)) {
        if (!identificadorValido(pessoaLegadoId)) continue;

        // Um `jform[id]` na raiz é o ID do contrato. O vínculo genérico só é
        // confiável dentro de uma linha aninhada de participantes.
        const ordemInferida = ordemDoCaminho(grupo.prefixo);
        const grupoAninhado = grupo.prefixo.length >= 3 || ordemInferida !== undefined;
        const vinculoCandidato = grupoAninhado
          ? primeiroValor(grupo.campos.get("id") ?? [])
          : undefined;
        const vinculoId = identificadorValido(vinculoCandidato) ? vinculoCandidato : undefined;

        const ordemInformada = primeiroValor([
          ...(grupo.campos.get("ordem") ?? []),
          ...(grupo.campos.get("ordering") ?? []),
        ]);
        const ordemNumero = ordemInformada === undefined ? Number.NaN : Number.parseInt(ordemInformada, 10);
        const ordem = Number.isSafeInteger(ordemNumero) && ordemNumero >= 0 ? ordemNumero : ordemInferida;

        const percentual = primeiroValor([
          ...(grupo.campos.get("percentual") ?? []),
          ...(grupo.campos.get("porcentagem") ?? []),
          ...(grupo.campos.get("participacao") ?? []),
        ]);
        const valor = primeiroValor(grupo.campos.get("valor") ?? []);
        const flags: Record<string, string | string[]> = {};
        for (const [nome, controles] of grupo.campos) {
          if (
            nome === "id" ||
            nome === campoPessoa ||
            ["ordem", "ordering", "percentual", "porcentagem", "participacao", "valor"].includes(nome) ||
            !ehFlagRelevante(nome, controles)
          ) {
            continue;
          }
          const flag = valorPersistivel(controles);
          if (flag !== undefined) flags[nome] = flag;
        }

        const parte: ParteContratoWidesys = {
          papel,
          pessoaLegadoId,
          ...(vinculoId ? { vinculoId } : {}),
          ...(ordem !== undefined ? { ordem } : {}),
          ...(percentual ? { percentual } : {}),
          ...(valor ? { valor } : {}),
          ...(Object.keys(flags).length > 0 ? { flags } : {}),
        };
        const chave = `${papel}\u0000${pessoaLegadoId}\u0000${vinculoId ?? ""}\u0000${ordem ?? ""}`;
        partes.set(chave, parte);
      }
    }
  }

  return [...partes.values()];
}
