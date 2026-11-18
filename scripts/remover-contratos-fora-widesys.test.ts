import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error A versão de @types/node do projeto antecede o SQLite do Node 24.
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { removerContratosForaWidesys } from "./remover-contratos-fora-widesys.mjs";

const pastas: string[] = [];
afterEach(() => {
  for (const pasta of pastas.splice(0)) rmSync(pasta, { recursive: true, force: true });
});

function bancoTeste() {
  const pasta = mkdtempSync(join(tmpdir(), "brisa-contratos-origem-"));
  pastas.push(pasta);
  const caminho = join(pasta, "teste.db");
  const db = new DatabaseSync(caminho);
  db.exec(`
    CREATE TABLE Contrato (id TEXT PRIMARY KEY, status TEXT);
    INSERT INTO Contrato VALUES ('brisa-1', 'ativo'), ('brisa-2', 'ativo');
    CREATE TABLE ContratoLegado (id TEXT PRIMARY KEY, origem TEXT, legadoId TEXT);
    INSERT INTO ContratoLegado VALUES ('widesys-1', 'WIDESYS', '42');
    CREATE TABLE RecursoGovernado (
      id TEXT PRIMARY KEY, tipo TEXT, origemId TEXT, status TEXT, destinoId TEXT, motivo TEXT, autorId TEXT,
      versao INTEGER DEFAULT 1, estadoAnterior TEXT, criadoEm INTEGER, atualizadoEm INTEGER,
      UNIQUE(tipo, origemId)
    );
    CREATE TABLE EventoGovernanca (
      id TEXT PRIMARY KEY, recursoId TEXT REFERENCES RecursoGovernado(id), acao TEXT, estadoAnterior TEXT,
      estadoNovo TEXT, autorId TEXT, motivo TEXT, criadoEm INTEGER
    );
  `);
  for (const tabela of ["ContratoParteLegado", "Recebimento", "TituloFinanceiroLegado", "BaixaFinanceiraLegado", "MovimentoFinanceiroLegado", "RecebimentoWidesysLocal", "LancamentoCaixa", "PagamentoRecebimento", "Boleto", "ContaBancaria"]) {
    db.exec(`CREATE TABLE "${tabela}" (id TEXT PRIMARY KEY, valor INTEGER); INSERT INTO "${tabela}" VALUES ('original', 1000)`);
  }
  db.close();
  return caminho;
}

describe("remoção pontual dos contratos fora do Widesys", () => {
  it("faz backup e exclui só da operação, preserva vínculos e não repete a auditoria", () => {
    const caminho = bancoTeste();
    const arquivoAntes = readFileSync(caminho);
    const previa = removerContratosForaWidesys(caminho);
    expect(previa).toMatchObject({ contratosBrisaParaRemover: 2, contratosWidesysDisponiveis: 1, backup: null });
    expect(readFileSync(caminho)).toEqual(arquivoAntes);

    const aplicado = removerContratosForaWidesys(caminho, true);
    expect(aplicado).toMatchObject({ contratosBrisaRemovidos: 2, contratosWidesysDisponiveis: 1, dadosFinanceirosEContratosPreservados: true });
    const db = new DatabaseSync(caminho, { readOnly: true });
    const copia = new DatabaseSync(aplicado.backup, { readOnly: true });
    try {
      expect(db.prepare("SELECT COUNT(*) n FROM RecursoGovernado WHERE tipo='CONTRATO' AND status='EXCLUIDO'").get()?.n).toBe(2);
      expect(db.prepare("SELECT COUNT(*) n FROM Contrato").get()?.n).toBe(2);
      expect(db.prepare("SELECT valor FROM Recebimento").get()?.valor).toBe(1000);
      expect(copia.prepare("SELECT COUNT(*) n FROM RecursoGovernado").get()?.n).toBe(0);
    } finally { db.close(); copia.close(); }

    expect(removerContratosForaWidesys(caminho, true)).toMatchObject({ contratosBrisaRemovidos: 0, backup: null });
    const conferido = new DatabaseSync(caminho, { readOnly: true });
    try { expect(conferido.prepare("SELECT COUNT(*) n FROM EventoGovernanca").get()?.n).toBe(2); }
    finally { conferido.close(); }
  });

  it("reverte toda a limpeza quando um gatilho altera um recebimento", () => {
    const caminho = bancoTeste();
    const db = new DatabaseSync(caminho);
    db.exec("CREATE TRIGGER alterar_recebimento AFTER INSERT ON RecursoGovernado BEGIN UPDATE Recebimento SET valor=999; END");
    db.close();
    expect(() => removerContratosForaWidesys(caminho, true)).toThrow("DADOS_FINANCEIROS_OU_CONTRATOS_DIVERGENTES");
    const conferido = new DatabaseSync(caminho, { readOnly: true });
    try {
      expect(conferido.prepare("SELECT COUNT(*) n FROM RecursoGovernado").get()?.n).toBe(0);
      expect(conferido.prepare("SELECT valor FROM Recebimento").get()?.valor).toBe(1000);
    } finally { conferido.close(); }
  });
});
