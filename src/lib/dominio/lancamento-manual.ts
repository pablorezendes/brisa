import { parseBRL } from "./dinheiro";

export function campoLancamento(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);
  return typeof valor === "string" ? valor.trim() : "";
}

export function dataLancamentoValida(data: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data < "1900-01-01" || data > "2199-12-31") return false;
  const instante = new Date(`${data}T12:00:00Z`);
  return Number.isFinite(instante.getTime()) && instante.toISOString().slice(0, 10) === data;
}

export function valorLancamento(texto: string): number | null {
  if (!/^(?:\d+(?:[,.]\d{1,2})?|\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?)$/.test(texto)) return null;
  const milharesSemDecimais = /^\d{1,3}(?:\.\d{3})+$/.test(texto);
  const valor = parseBRL(milharesSemDecimais ? texto.replaceAll(".", "") : texto);
  return valor !== null && valor > 0 && valor <= 2147483647 ? valor : null;
}

export function idLancamentoValido(id: string): boolean {
  return /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id);
}
