import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EventoEnvioDialogo = Parameters<NonNullable<ComponentProps<"dialog">["onSubmitCapture"]>>[0];

const ambiente = vi.hoisted(() => ({
  refs: [] as Array<{ current: unknown }>, indice: 0, aviso: null as "rascunho" | "pendente" | null,
  substituir: vi.fn(), efeitos: vi.fn(),
}));
vi.mock("react", async () => ({
  ...await vi.importActual<typeof import("react")>("react"),
  useRef: (inicial: unknown) => ambiente.refs[ambiente.indice++] ?? (ambiente.refs[ambiente.indice - 1] = { current: inicial }),
  useState: () => [ambiente.aviso, (aviso: typeof ambiente.aviso) => { ambiente.aviso = aviso; }],
  useEffect: ambiente.efeitos,
  useTransition: () => [false, (continuar: () => void) => continuar()],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: ambiente.substituir }) }));

import { JanelaContextual } from "./janela-contextual";

class FormularioFalso {
  dataset: Record<string, string> = {};
  method = "get";
  action = "http://brisa.test/financeiro/contas-a-pagar";
  campos = new URLSearchParams();
  texto = "Justificativa preenchida";
  confirmado = true;
  reset = vi.fn(() => { this.texto = ""; this.confirmado = false; });
}
let pendente: FormularioFalso | null;
let formularios: FormularioFalso[];
const retorno = "/financeiro/contas-a-pagar?mes=2026-06&pagina=3";
function renderizar() {
  ambiente.indice = 0;
  const elemento = JanelaContextual({ titulo: "Conferir registro", retorno, children: <p>Conteúdo</p> });
  ambiente.refs[0].current = {
    querySelector: (seletor: string) => seletor.includes("aria-busy") ? pendente : formularios.find(form => form.dataset.alterado === "true") ?? null,
    querySelectorAll: () => formularios.filter(form => form.dataset.alterado === "true"),
  };
  return elemento as ReactElement<ComponentProps<"dialog">>;
}
function evento(form: FormularioFalso) {
  return { target: form, submitter: null, nativeEvent: { submitter: null }, preventDefault: vi.fn(), stopPropagation: vi.fn() };
}
function botao(no: ReactNode, texto: string): ReactElement<ComponentProps<"button">> | null {
  if (Array.isArray(no)) {
    for (const filho of no) { const achado = botao(filho, texto); if (achado) return achado; }
    return null;
  }
  if (!isValidElement<{ children?: ReactNode }>(no)) return null;
  if (no.type === "button" && no.props.children === texto) return no as ReactElement<ComponentProps<"button">>;
  return botao(no.props.children, texto);
}
function clicarDescarte() {
  const descarte = botao(renderizar(), "Descartar rascunho e continuar");
  expect(descarte).not.toBeNull();
  descarte!.props.onClick!({} as never);
}
beforeEach(() => {
  vi.clearAllMocks();
  ambiente.refs = []; ambiente.indice = 0; ambiente.aviso = null;
  pendente = null; formularios = [];
  vi.stubGlobal("HTMLFormElement", FormularioFalso);
  vi.stubGlobal("window", { location: { href: "http://brisa.test/financeiro/contas-a-pagar?mes=2026-06", origin: "http://brisa.test" } });
  vi.stubGlobal("FormData", class {
    constructor(private form: FormularioFalso) {}
    [Symbol.iterator]() { return this.form.campos.entries(); }
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("guardas da janela financeira sem DOM ou banco real", () => {
  it("permite buscar sem justificativa pendente e não altera o formulário", () => {
    const busca = new FormularioFalso();
    const e = evento(busca);
    renderizar().props.onSubmitCapture!(e as unknown as EventoEnvioDialogo);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(e.stopPropagation).not.toHaveBeenCalled();
    expect(ambiente.aviso).toBeNull();
    expect(busca.reset).not.toHaveBeenCalled();
  });

  it("segura next/form com rascunho; descarte limpa texto e ciência antes de buscar preservando filtros", () => {
    const decisao = new FormularioFalso(); decisao.dataset = { operacao: "contextual", alterado: "true" };
    formularios.push(decisao);
    const busca = new FormularioFalso();
    busca.campos = new URLSearchParams({ mes: "2026-06", pagina: "3", origem: "WIDESYS", registro: "WIDESYS:PAGAR:t1", painel: "detalhe", buscarDestino: "Pessoa & imóvel" });
    const e = evento(busca);
    renderizar().props.onSubmitCapture!(e as unknown as EventoEnvioDialogo);
    expect(e.preventDefault).toHaveBeenCalledOnce();
    expect(e.stopPropagation).toHaveBeenCalledOnce();
    expect(ambiente.aviso).toBe("rascunho");
    expect(ambiente.substituir).not.toHaveBeenCalled();
    expect(decisao.texto).toBe("Justificativa preenchida");
    clicarDescarte();
    expect(decisao.reset).toHaveBeenCalledOnce();
    expect(decisao.texto).toBe("");
    expect(decisao.confirmado).toBe(false);
    expect(decisao.dataset.alterado).toBe("false");
    expect(ambiente.aviso).toBeNull();
    const [href, opcoes] = ambiente.substituir.mock.calls[0];
    const destino = new URL(href, "http://brisa.test");
    expect(destino.pathname).toBe("/financeiro/contas-a-pagar");
    expect(Object.fromEntries(destino.searchParams)).toEqual(Object.fromEntries(busca.campos));
    expect(opcoes).toEqual({ scroll: false });
  });

  it("continuar editando conserva texto e não navega", () => {
    const decisao = new FormularioFalso(); decisao.dataset.alterado = "true"; formularios.push(decisao);
    renderizar().props.onSubmitCapture!(evento(new FormularioFalso()) as unknown as EventoEnvioDialogo);
    botao(renderizar(), "Continuar nesta janela")!.props.onClick!({} as never);
    expect(decisao.reset).not.toHaveBeenCalled();
    expect(decisao.texto).toBe("Justificativa preenchida");
    expect(ambiente.substituir).not.toHaveBeenCalled();
    expect(ambiente.aviso).toBeNull();
  });

  it.each(["busca", "decisao"])("impede envio de %s enquanto outra operação ainda está pendente", tipo => {
    pendente = new FormularioFalso();
    const form = new FormularioFalso();
    if (tipo === "decisao") form.dataset.operacao = "contextual";
    const e = evento(form);
    renderizar().props.onSubmitCapture!(e as unknown as EventoEnvioDialogo);
    expect(e.preventDefault).toHaveBeenCalledOnce();
    expect(e.stopPropagation).toHaveBeenCalledOnce();
    expect(ambiente.aviso).toBe("pendente");
    expect(ambiente.substituir).not.toHaveBeenCalled();
  });

  it("não confunde confirmação financeira com navegação e deixa sua action receber os dados", () => {
    const decisao = new FormularioFalso(); decisao.dataset = { operacao: "contextual", alterado: "true" };
    formularios.push(decisao);
    const e = evento(decisao);
    renderizar().props.onSubmitCapture!(e as unknown as EventoEnvioDialogo);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(e.stopPropagation).not.toHaveBeenCalled();
    expect(ambiente.aviso).toBeNull();
  });

  it("reconfere busy antes de descartar rascunho em uma confirmação já aberta", () => {
    const decisao = new FormularioFalso(); decisao.dataset.alterado = "true"; formularios.push(decisao);
    renderizar().props.onSubmitCapture!(evento(new FormularioFalso()) as unknown as EventoEnvioDialogo);
    pendente = decisao;
    clicarDescarte();
    expect(ambiente.aviso).toBe("pendente");
    expect(decisao.reset).not.toHaveBeenCalled();
    expect(ambiente.substituir).not.toHaveBeenCalled();
  });
});
