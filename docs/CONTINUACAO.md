# Continuação — situação do plano em 29/09/2026

Este arquivo é a passagem de bastão: onde o trabalho parou, o que já foi feito, as decisões
tomadas no caminho e o que falta, na ordem. O plano completo está em `docs/PLANO.md`.

Branch: `claude/funny-ramanujan-3dv511` (repositório `ramoswagner/gerenciar_projetos_e_obras`).
Commit de partida (código original): `42920bc`.

## Situação por etapa

| # | Etapa | Situação | Commit |
|---|---|---|---|
| 0 | Preparação | Código pronto (simulador, testes, guia de publicação). **Falta do seu lado:** cópia da planilha, implantação de homologação, medir o tempo real de cada tela | `74c8711` |
| 1 | Segurança e integridade | Feita, em homologação | `37934d6` |
| 2 | Base técnica e velocidade | Feita, em homologação. **Pendente: aba `Auditoria`** | `8f36aa0` |
| 3 | Usuários, permissões e aprovadores | Feita, em homologação | `c8db67a` |
| 4 | Visual novo e Painel | **Metade feita**: casca nova + menu no celular (`a1c439b`) e Painel novo (`41b1d7f`). Falta: projeto em abas, editor de texto como componente único, abertura instantânea nas demais telas | — |
| 5–11 | | Não iniciadas | — |

Nada disso foi rodado ainda no Apps Script de verdade: tudo foi validado no simulador (`tests/`)
e em capturas de tela (Chromium). Ver "Validar no Apps Script real", abaixo.

## O que foi feito, etapa por etapa

### Etapa 0 — simulador e testes
- `tests/gas-mock.js`: simula SpreadsheetApp, CacheService, PropertiesService, LockService, Session,
  Utilities, HtmlService e o serviço avançado Sheets (batchGet). Conta as idas à planilha.
- `tests/run.js` (`npm test`): 28 testes — segurança, integridade, cache, permissões, painel, fluxo completo.
- `tests/bench.js` (`npm run bench`): idas à planilha por tela, frio e reaberto.
- `tests/preview.js` (`npm run preview`): abre as telas no Chromium, desktop e celular (360 px), tira
  capturas e acusa rolagem lateral. Aceita um roteiro de passos (login, clique, `js:<código>=<nome>`).
- `LEIA-ME.md`: publicação, homologação, perfis, funções de manutenção, tabela de velocidade.
- `.claspignore` envia só `appsscript.json`, `*.gs` e `*.html` (nunca `tests/` nem `docs/`).

### Etapa 1 — segurança e integridade
- Funções de manutenção (`setup`, `semearPrimeiroPmo`, `testAuth`, `migrarCustoParaNumero`,
  `diagnosticarCronograma`, `instalarGatilhos`, `criarProjetosExemplo`…) chamam `somenteEditor_()`:
  recusam quem chega pelo site (compara `Session.getActiveUser()` com `getEffectiveUser()`).
- Cronograma e EAP gravam só as linhas do projeto: `substituirLinhasDe_(aba, coluna, id, linhas)`.
- `readAll_` devolve o número real da linha (`_row`) mesmo com linhas em branco no meio.
- `proximoId_`: nunca reaproveita (maior entre o máximo da aba e a sequência guardada) e não "vira" em 1000.
- `comLock_` em toda escrita; `atualizarCampos_` grava uma linha com um único `setValues`.
- Sessão com versão por usuário (`SESSAO_VER_<id>`): mudar perfil, situação ou senha derruba as sessões.
- Nunca fica sem PMO ativo (`garantirOutroPmoAtivo_`).
- Cache em partes de 30 000 caracteres (limite de 100 KB do CacheService).

### Etapa 2 — leitura rápida (`Helpers.gs`, seção LEITURA RÁPIDA)
- `prepararAbas_([...])` lê várias abas numa só requisição (`Sheets.Spreadsheets.Values.batchGet`);
  sem o serviço avançado, cai para leitura aba a aba.
- Memória por execução (`MEMORIA_ABAS_`) + CacheService com chave versionada (`DADOS_VERSAO` em
  ScriptProperties). Toda gravação chama `dadosAlterados_()` e troca a versão.
- `onEdit` (simples) e `aoAlterarPlanilha` (instalável, `instalarGatilhos`) trocam a versão quando alguém
  mexe direto na planilha.
- Gravações leem sempre da planilha (`EM_ESCRITA_` desliga o cache dentro de `comLock_`).
- Resultado: detalhe da obra 40 → 4 idas (0 reaberta); pagamentos 15 → 1; pública 16 → 4; lookahead 12 → 1.

### Etapa 3 — usuários, perfis, permissões, aprovadores
- `Permissoes.gs`: catálogo `MODULOS` (painel, pedidos, projetos, areas, cronograma, execucao, minhas,
  medicoes, encerramento, relatorios) × ações (ler, editar, excluir, cancelar, gerar).
- Abas novas `Permissoes` (Perfil, Permissoes, …) e `Aprovadores` (Tipo, Portao, Perfil, UsuarioId).
- `exigir_(token, modulo, acao)` em todas as 62 APIs. O PMO passa em tudo. Continuam só-PMO
  (`exigirPMO_`): validar cronograma, aprovar medição, decidir área proposta, finalizar obra, usuários, configurações.
- `podeAprovar_(sessao, tipo, portao)`: PMO sempre; senão consulta `Aprovadores` por perfil ou pessoa.
- Tela `ConfiguracoesAdmin.html`: abas Usuários / Perfis e permissões / Aprovadores (grade portão × tipo).
- "Minha senha" no rodapé do menu (`apiTrocarMinhaSenha`).
- O front recebe `permissoes` no login (`PERMS` no sessionStorage) e `pode('modulo.acao')` esconde o que não pode.

### Etapa 4 (metade) — casca e Painel
- `Shell.html`: `SIDEBAR_SECOES` na ordem do ciclo (Visão geral › Ciclo do projeto › Administração).
  Um item só aparece se existir `ROTAS[id]` **e** o usuário tiver a permissão. `cronogramapmo` está no
  menu mas escondido até a tela existir.
- Celular: barra superior com botão de menu, gaveta lateral com fundo escurecido (`abrirMenu_`/`fecharMenu_`).
- Paleta do eventos em `Estilos.html` (`--navy #0A2B4E`, `--teal-dark #0077B6` para contraste AA).
- `KanbanAdmin.html` virou o **Painel**: "Aguardando você" (por permissão), 6 indicadores clicáveis,
  quadro por fase (colunas recolhíveis), busca e filtro de situação. Servidor: `apiPainel` em `Kanban.gs`
  (base do dia em cache `painel_base_v1`; só as pendências são por usuário).
- `memoTela_(chave, valor)` em `Constantes.html`: a tela abre na hora com a última versão e se atualiza
  por baixo. **Hoje só o Painel usa**; estender às outras telas faz parte do restante da etapa 4.

## Desvios do plano (decididos no caminho)

- Os papéis fixos (`PAPEIS`) saíram: perfis vêm da aba `Permissoes`. PMO é embutido e não editável.
- A aba `Auditoria` foi adiada (a trava já existe). Criar na etapa 5 junto com `Gates`, gravando dentro de `comLock_`.
- A rota `obras` continua com esse id interno; o rótulo no menu é "Projetos". Idem `pagamentos` → "Medições",
  `kanban` → `painel`. Não renomear ids de rota: links e testes dependem deles.
- O Painel mede "situação" (atrasado / atenção / em dia) a partir de prazos existentes, porque as fases
  (`FaseAtual`) só chegam na etapa 5. Ao criar as fases, trocar o agrupamento do quadro por `FaseAtual`.

## Pedidos do usuário que entraram no plano durante o trabalho

1. **Relatório de histórico do projeto** (etapa 6): onde o projeto está e por onde passou — cada fase e
   portão, decisões, mudanças, restrições liberadas, medições e assinaturas, com quem, quando e o quê.
   No padrão do eventos, com **cabeçalho e rodapé bem definidos** (logo, título, emitido em, código do documento,
   "emitido por", paginação).
2. **Tela do pedido com a cara do relatório** (etapa 6): fundo branco, as **ondas** separando os tópicos
   (mesmo SVG `REL_ONDA` do eventos), seções numeradas "01 • …". A tela e o PDF usam o mesmo HTML.

## Referência do eventos (pasta `referencias/eventos-relatorios/` do zip)

Vem do repositório `ramoswagner/lista_eventos`, branch `claude/verificar-arquivos-repositorio-wr7huu`.

- `RelatoriosAPI.js` — motor dos PDFs. Peças para portar:
  `REL_MARCA` + `_imagemRelatorio_` (logo do cabeçalho, marca d'água e logo do rodapé guardados no Drive e
  embutidos em base64), `REL_CSS` (A4, cabeçalho, tabelas azul-marinho, paginação), `REL_ONDA` (divisor em
  onda), `_secao_(num, titulo, direita, corpo)`, `_kpis_`, `_tabela_`, `_barra_`, `_def_`,
  `_documento_(cfg)` (monta a folha: cabeçalho, seções, rodapé com `DOC: <código>`) e `_codigoDoc_`.
  A prévia na tela e o "Gerar PDF" (impressão do navegador) saem idênticos.
- `Relatorios.html` — tela de prévia + botão Gerar PDF + CSV.
- `Marca.js` — logos padrão em base64 (Hospital da Baleia) usados quando nada foi enviado.

Ao portar: trocar `validarSessao_`/`_exigirPermissao_` por `exigir_(token, 'relatorios', 'gerar')`;
`dbListar_` por `readAll_`/`prepararAbas_`; `logAudit_` pela futura `Auditoria`.
O `renderMarkdownLite` do `RichText.html` deve ser espelhado no servidor para o negrito sair igual no PDF.

## Próximos passos, na ordem

1. **Validar no Apps Script real** (antes de qualquer coisa nova), numa cópia da planilha:
   - `clasp push` (ou colar os arquivos), rodar `setup`, depois `instalarGatilhos` e autorizar (serviço avançado Sheets).
   - `semearPrimeiroPmo` se a cópia não tiver PMO; entrar; criar um usuário pela tela e entrar com ele.
   - Conferir `somenteEditor_`: chamar `semearPrimeiroPmo` pelo site precisa ser recusado. Em conta de
     domínio Google Workspace, `Session.getActiveUser()` volta vazio para visitantes — é esse o comportamento esperado.
   - Medir o tempo de abertura de cada tela (meta 2 s em 4G) e anotar no LEIA-ME.
2. **Terminar a etapa 4**:
   - Projeto em abas (Resumo · Cronograma · Execução · Medições · Áreas · Documentos · Histórico) em `ObrasAdmin.html`.
   - Editor de texto como componente único (`RichText.html`): Ctrl+B/Ctrl+I, botões de 40 px no celular,
     colar limpo de Word/WhatsApp mantendo negrito e listas, contador de caracteres. Sem remendos: o valor gravado
     continua texto simples com marcação leve.
   - `memoTela_` nas listas (pedidos, projetos, medições, encerramento) e no detalhe do projeto.
   - Rodar `npm run preview` e zerar rolagem lateral em 360 px.
3. **Etapa 5** — `Tipo`, `FaseAtual`, abas `Gates`, `TiposProjeto`, `Auditoria`; botões Aprovar portão / Dar start /
   Suspender; script de migração com modo simulação (tabela de migração no PLANO).
4. **Etapa 6** — pedidos com aprovação por `podeAprovar_`, converter em Obra/Projeto, motor de relatórios
   portado do eventos, PDF do pedido, relatório de histórico, tela do pedido no visual do relatório.
5. **Etapas 7 a 11** conforme o roteiro do PLANO (Áreas e impactos → Cronograma e Execução → Medições →
   Encerramento e relatórios → Finalização).

## Convenções que não podem ser quebradas

- Toda função de topo **sem** `_` no fim é chamável pelo navegador. Função interna termina em `_`.
  Função de manutenção começa com `somenteEditor_()`.
- Toda API começa com `const s = exigir_(token, '<modulo>', '<acao>')` (ou `exigirPMO_`).
- Toda escrita dentro de `comLock_(() => { ... })`; gravar com `atualizarCampos_` / `substituirLinhasDe_`,
  nunca `clear()` + reescrever a aba inteira. Se gravar fora desses helpers, chamar `dadosAlterados_()`.
- Telas que leem várias abas chamam `prepararAbas_([...])` antes de `readAll_`.
- Aba nova: nome em `SHEETS` e cabeçalhos em `cabecalhosDaAba_` (`Setup.gs`); `setup` cria sem apagar nada.
- Tela nova: registrar `ROTAS['id'] = carregar...` e o item em `SIDEBAR_SECOES` com a permissão.
- **Arquivos `.html`**: nunca escrever `//` dentro de um regex nem na mesma linha de um regex (o Apps Script
  corta a linha); usar `BARRA2` ou `\/{2}`. Não escrever `<?` em JavaScript.
- Sempre `esc()` ao montar HTML com dados. Textos longos passam por `renderMarkdownLite`.
- Cor de destaque para texto: `#0077B6` (`--teal-dark`); `#28A8E8` só em fundos/ícones (contraste).
- Antes de commitar: `npm test` verde; para mudanças visuais, `npm run preview` sem rolagem lateral.
- Textos da interface em português, diretos, sem jargão.

## Ambiente de teste (Claude Code desktop)

- Node 18+. `npm test` e `npm run bench` não precisam de nada instalado.
- `npm run preview` precisa do Playwright: `npm i -D playwright` e `npx playwright install chromium`
  (na nuvem o Chromium já vinha instalado). As capturas vão para `tests/capturas/` (ignorada pelo git).
- O preview serve as páginas numa origem falsa (`http://obras.local/`) para o sessionStorage funcionar,
  e baixa fontes/ícones externos. Nunca desligar a verificação TLS para isso.
