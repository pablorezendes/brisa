const PERFIS_COM_PII_CADASTRAL = new Set(["ADMINISTRADOR", "FINANCEIRO"]);

/**
 * Política central de leitura de dados cadastrais sensíveis. A decisão final
 * continua sendo tomada no servidor a partir do perfil atual do usuário.
 */
export function perfilPodeVerPiiCadastros(perfil: string): boolean {
  return PERFIS_COM_PII_CADASTRAL.has(perfil.toUpperCase());
}

export function mascararEmailCadastro(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const separador = valor.lastIndexOf("@");
  if (separador <= 0 || separador === valor.length - 1) return "***";

  const dominio = valor.slice(separador + 1);
  const ultimoPonto = dominio.lastIndexOf(".");
  const sufixo = ultimoPonto > 0 ? dominio.slice(ultimoPonto) : "";
  return `${valor[0]}***@${dominio[0]}***${sufixo}`;
}

export function mascararTelefoneCadastro(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const digitos = valor.replace(/\D/g, "");
  if (!digitos) return "***";
  return `***-***-${digitos.slice(-4).padStart(4, "*")}`;
}
