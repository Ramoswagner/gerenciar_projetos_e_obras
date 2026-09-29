# CLAUDE.md

Gestão de Projetos e Obras do Hospital da Baleia: web app em Google Apps Script, com uma planilha Google como banco.
O dono é o PMO (Wagner). Tudo na interface e na documentação é em português.

## Antes de começar

1. Leia `docs/CONTINUACAO.md` (onde o trabalho parou, desvios, próximos passos) e `docs/PLANO.md` (plano completo, roteiro de 12 etapas).
2. Rode `npm test` — precisa estar verde antes e depois de qualquer mudança.
3. Trabalhe na etapa seguinte do roteiro; ao terminar uma etapa, atualize a coluna Status em `docs/PLANO.md`
   e a tabela de situação em `docs/CONTINUACAO.md`, e faça um commit por etapa (ou por parte de etapa).

## Critérios de aceite de toda entrega

- Velocidade: cada tela abre em até 2 s em 4G; medir idas à planilha com `npm run bench` (não piorar).
- Celular: funciona em 360 px sem rolagem lateral; conferir com `npm run preview` (capturas em `tests/capturas/`).
- Visual no padrão do sistema de eventos (paleta em `Estilos.html`), sem remendos.

## Regras do código

- Função de topo sem `_` no fim é pública (chamável pelo navegador via `google.script.run`). Internas terminam em `_`.
- Toda API começa com `exigir_(token, modulo, acao)` (ou `exigirPMO_`). Módulos e ações em `Permissoes.gs` (`MODULOS`).
- Funções de manutenção começam com `somenteEditor_()`.
- Escrita: sempre dentro de `comLock_`, usando `atualizarCampos_` ou `substituirLinhasDe_`. Nunca regravar uma aba inteira.
- Leitura: `prepararAbas_([...])` para ler várias abas de uma vez, depois `readAll_`. Cache só com os helpers
  versionados (`cacheLer_`/`cacheGravar_`, `cacheLerVarios_`/`cacheGravarVarios_`).
- Aba nova: `SHEETS` + `cabecalhosDaAba_` em `Setup.gs`. Tela nova: `ROTAS['id']` + item em `SIDEBAR_SECOES` (`Shell.html`).
- Em arquivos `.html`: nunca `//` dentro ou na mesma linha de um regex (usar `BARRA2`); nunca `<?` em JavaScript.
- Sempre `esc()` ao montar HTML com dados; textos longos com `renderMarkdownLite` (`RichText.html`).
- Não renomear ids de rota (`obras`, `pagamentos`…) nem abas existentes: só acrescentar colunas no fim e abas novas.

## Comandos

- `npm test` — simulador do Apps Script + 28 testes.
- `npm run bench` — idas à planilha por tela.
- `npm run preview` — capturas desktop e celular (precisa de `playwright` + Chromium).
- Publicar: `clasp push` (o `.claspignore` envia só `.gs`, `.html` e `appsscript.json`) e nova versão na mesma implantação.

## Referências

- `referencias/eventos-relatorios/` (no pacote zip): motor de PDF do sistema de eventos a ser portado na etapa 6.
