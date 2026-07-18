# data/

Esta pasta recebe o `dataset.json` gerado pelo extrator
(`gestao-imoveis-brisa/scripts/extrair_dados.py`) a partir das planilhas
originais, e o `excecoes-importacao.json` gravado pelo seed.

**Os JSONs NÃO são versionados** — contêm dados reais (nomes, CPF/CNPJ,
valores). Em produção, envie o `dataset.json` por `scp` (ver `DEPLOY.md`)
antes de rodar `npm run db:seed`.
