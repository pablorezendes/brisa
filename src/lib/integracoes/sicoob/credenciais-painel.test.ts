import { mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { lerCredenciaisPainelSicoob, salvarCredenciaisPainelSicoob, type CredenciaisPainelSicoob } from "./credenciais-painel";

it("persiste a credencial criptografada e recusa arquivo adulterado", () => {
  const pasta = mkdtempSync(join(tmpdir(), "brisa-certificado-teste-"));
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", SICOOB_CREDENCIAIS_DIR: pasta, AUTH_SECRET: "x".repeat(64) };
  const dados: CredenciaisPainelSicoob = {
    pfx: Buffer.from("certificado fictício"), senha: "senha exclusiva de teste",
    clientId: "identificador-teste", ambiente: "producao",
  };
  try {
    expect(lerCredenciaisPainelSicoob(env)).toBeNull();
    salvarCredenciaisPainelSicoob(dados, env);
    expect(lerCredenciaisPainelSicoob(env)).toEqual(dados);
    const caminho = join(pasta, "credenciais-v1.enc");
    const cifrado = readFileSync(caminho);
    expect(cifrado.includes(dados.pfx)).toBe(false);
    expect(cifrado.includes(dados.senha)).toBe(false);
    expect(cifrado.includes(dados.clientId)).toBe(false);
    cifrado[28] ^= 1;
    writeFileSync(caminho, cifrado);
    expect(() => lerCredenciaisPainelSicoob(env)).toThrow("Credenciais protegidas do Sicoob indisponíveis.");
  } finally {
    rmSync(join(pasta, "credenciais-v1.enc"), { force: true });
    rmdirSync(pasta);
  }
});
