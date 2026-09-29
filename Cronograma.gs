/**
 * Cronograma Mestre — Etapas (pai, só nome) + Pacotes de Trabalho (filho).
 * Numeração 1/1.1 nunca é gravada — sempre derivada de Ordem na leitura.
 * Portado 1:1 do Code.gs; auth por token. Salvar: Engenharia (e PMO, que
 * tem acesso total). Validar: SEMPRE e somente PMO. Editar depois de
 * validado volta automaticamente para "Revisão solicitada".
 */

// etapas: [{ID?, Nome}] na ordem desejada. pacotes: [{ID?, EtapaIdx,
// Atividade, ..., PredecessoraIdx:[...]}] — EtapaIdx referencia a posição
// no array `etapas`, PredecessoraIdx a posição no array `pacotes`. Permite
// referenciar etapa/pacote novos criados no mesmo save, sem o front
// adivinhar IDs que o servidor ainda vai gerar.
// enviarParaValidacao=false: "apenas salvar" — persiste o cadastro sem
// avançar o status, pra quem não consegue terminar de cadastrar tudo de
// uma vez (fica em Rascunho/Aguardando validação/Revisão solicitada, o
// que já estava, sem mudar). enviarParaValidacao=true: comportamento de
// sempre, avança pra "Aguardando validação". Em QUALQUER dos dois casos,
// editar um cronograma já "Validado" sempre volta pra "Revisão
// solicitada" — essa regra de integridade não depende do botão usado,
// nunca pode ficar um "Validado" desatualizado silenciosamente.
function apiSalvarCronograma(token, idObra, etapas, pacotes, enviarParaValidacao) {
  exigirPapel_(token, ['Engenharia', 'PMO']);
  const obra = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(o => o.ID === idObra);
  if (!obra) throw new Error('Obra não encontrada.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    salvarEtapasPacotes_(idObra, etapas || [], pacotes || []);
    const sh = ss_().getSheetByName(SHEETS.OBRAS);
    const col = (h) => OBRAS_HEADERS.indexOf(h) + 1;
    const statusAtual = obra.StatusCronograma || 'Rascunho';
    let novoStatus = statusAtual;
    if (statusAtual === 'Validado') {
      novoStatus = 'Revisão solicitada';
    } else if (enviarParaValidacao) {
      novoStatus = 'Aguardando validação';
    }
    if (novoStatus !== statusAtual) sh.getRange(obra._row, col('StatusCronograma')).setValue(novoStatus);
    invalidarCacheObras_();
    return { ok: true, statusCronograma: novoStatus };
  } finally {
    lock.releaseLock();
  }
}

// Fase 7: CustoDoacao/CustoProprio viram número de verdade (antes era
// texto livre, herdado do sistema atual). parseMoedaServidor_ (Helpers.gs)
// só retorna null pra lixo genuinamente não-numérico (ex.: "-", "R$--")
// — vazio já vira 0 antes disso. Erro aqui aborta o save inteiro (nada é
// gravado pela metade), com mensagem apontando qual pacote tem o problema,
// pra Engenharia/PMO corrigir e salvar de novo.
function parseCustoValidado_(v, rotulo, nomeAtividade) {
  const n = parseMoedaServidor_(v);
  if (n === null) throw new Error(rotulo + ' inválido no pacote "' + (nomeAtividade || '?') + '": "' + v + '" — use só números (ex.: 1500 ou 1500,50).');
  return n;
}

// Reescreve Etapas e Cronograma em lote, preservando IDs existentes
// (Predecessora referencia IDs de pacotes; ordem recontada da posição).
function salvarEtapasPacotes_(idObra, etapas, pacotes) {
  const shEtapas = ensureSheet_(ss_(), SHEETS.ETAPAS, ETAPAS_HEADERS);
  const shCron = ensureSheet_(ss_(), SHEETS.CRONOGRAMA, CRONOGRAMA_HEADERS);

  const etapasExistentesMap = {};
  const todasEtapasAtuais = readAll_(SHEETS.ETAPAS, ETAPAS_HEADERS);
  todasEtapasAtuais.filter(e => e.IDObra === idObra).forEach(e => { etapasExistentesMap[e.ID] = e; });
  const etapasOutrasObras = todasEtapasAtuais.filter(e => e.IDObra !== idObra)
    .map(e => ETAPAS_HEADERS.map(h => e[h]));

  let maiorNumEtapa = 0;
  Object.keys(etapasExistentesMap).forEach(id => {
    const m = id.match(/-ET(\d+)$/);
    if (m) maiorNumEtapa = Math.max(maiorNumEtapa, parseInt(m[1], 10));
  });

  const etapasValidas = etapas.filter(e => sanitize_(e.Nome, 150));
  const etapaIdsFinais = etapasValidas.map(e => {
    const idInformado = sanitize_(e.ID, 30);
    if (idInformado && etapasExistentesMap[idInformado]) return idInformado;
    maiorNumEtapa++;
    return idObra + '-ET' + ('00' + maiorNumEtapa).slice(-2);
  });
  // Blindagem contra duplicidade: se o array recebido do cliente trouxer
  // o MESMO ID final em mais de uma posição (não deveria acontecer com o
  // DOM correto, mas um render duplicado no cliente já produziu isso na
  // prática — ver memória do projeto), colapsa pra UMA linha por ID em
  // vez de multiplicar. Mantém o conteúdo da ÚLTIMA ocorrência.
  const etapasPorIdFinal = {};
  const etapaIdsOrdem = [];
  etapasValidas.forEach((e, i) => {
    const idInformado = sanitize_(e.ID, 30);
    const existente = idInformado && etapasExistentesMap[idInformado];
    const idFinal = etapaIdsFinais[i];
    if (!(idFinal in etapasPorIdFinal)) etapaIdsOrdem.push(idFinal);
    etapasPorIdFinal[idFinal] = [idFinal, idObra, sanitize_(e.Nome, 150), 0, existente ? existente.CriadoEm : nowIso_()];
  });
  const etapasNovasRows = etapaIdsOrdem.map((idFinal, i) => {
    const linha = etapasPorIdFinal[idFinal];
    linha[3] = i;
    return linha;
  });

  const pacotesExistentesMap = {};
  const todosPacotesAtuais = readAll_(SHEETS.CRONOGRAMA, CRONOGRAMA_HEADERS);
  todosPacotesAtuais.filter(c => c.IDObra === idObra).forEach(c => { pacotesExistentesMap[c.ID] = c; });
  const pacotesOutrasObras = todosPacotesAtuais.filter(c => c.IDObra !== idObra)
    .map(c => CRONOGRAMA_HEADERS.map(h => c[h]));

  let maiorNumPacote = 0;
  Object.keys(pacotesExistentesMap).forEach(id => {
    const m = id.match(/-C(\d+)$/);
    if (m) maiorNumPacote = Math.max(maiorNumPacote, parseInt(m[1], 10));
  });

  const pacotesValidos = pacotes.filter(p => sanitize_(p.Atividade, 300));
  const pacoteIdsFinais = pacotesValidos.map(p => {
    const idInformado = sanitize_(p.ID, 30);
    if (idInformado && pacotesExistentesMap[idInformado]) return idInformado;
    maiorNumPacote++;
    return idObra + '-C' + ('00' + maiorNumPacote).slice(-2);
  });

  // TemRisco nunca mais é confiado do cliente — é derivado de quantos
  // riscos de verdade (aba Riscos) o pacote tem cadastrados. Assim fica
  // sempre coerente com o popup de riscos, mesmo que o pacote seja salvo
  // por outro caminho. DescricaoRisco (legado) não é mais escrito.
  const riscosPorPacote_ = {};
  readAll_(SHEETS.RISCOS, RISCOS_HEADERS).filter(r => r.IDObra === idObra)
    .forEach(r => { riscosPorPacote_[r.IDPacote] = (riscosPorPacote_[r.IDPacote] || 0) + 1; });

  // Mesma blindagem de duplicidade aplicada aos pacotes: um ID final
  // repetido em mais de uma posição do array vira UMA linha só (última
  // ocorrência prevalece), nunca uma linha por repetição.
  const pacotesPorIdFinal = {};
  const pacoteIdsOrdem = [];
  pacotesValidos.forEach((p, i) => {
    const id = pacoteIdsFinais[i];
    const idInformado = sanitize_(p.ID, 30);
    const existente = idInformado && pacotesExistentesMap[idInformado];
    const etapaIdx = p.EtapaIdx;
    const idEtapa = (typeof etapaIdx === 'number' && etapaIdx >= 0 && etapaIdx < etapasValidas.length)
      ? etapaIdsFinais[etapaIdx] : '';
    const predIdx = Array.isArray(p.PredecessoraIdx) ? p.PredecessoraIdx : [];
    const predecessora = predIdx
      .filter(idx => typeof idx === 'number' && idx >= 0 && idx < pacotesValidos.length && idx !== i)
      .map(idx => pacoteIdsFinais[idx])
      .join(';');
    if (!(id in pacotesPorIdFinal)) pacoteIdsOrdem.push(id);
    pacotesPorIdFinal[id] = [
      id, idObra, idEtapa, 0,
      sanitize_(p.Atividade, 300), sanitize_(p.Responsavel, 120),
      sanitize_(p.DataInicioPrevista, 20), sanitize_(p.DataFimPrevista, 20),
      (riscosPorPacote_[id] > 0) ? 'SIM' : 'NAO', '',
      parseCustoValidado_(p.CustoDoacao, 'Custo doação', p.Atividade),
      parseCustoValidado_(p.CustoProprio, 'Custo próprio', p.Atividade),
      sanitize_(p.Observacao, 1000),
      predecessora,
      CRONOGRAMA_STATUS.indexOf(p.Status) >= 0 ? p.Status : 'Não iniciada',
      existente ? existente.CriadoEm : nowIso_(),
      nowIso_(),
      sanitize_(p.ResponsavelUserId, 30)
    ];
  });
  const ordemPorEtapa = {};
  const pacotesNovasRows = pacoteIdsOrdem.map(id => {
    const linha = pacotesPorIdFinal[id];
    const idEtapa = linha[2];
    ordemPorEtapa[idEtapa] = ordemPorEtapa[idEtapa] || 0;
    linha[3] = ordemPorEtapa[idEtapa]++;
    return linha;
  });

  const todasEtapas = etapasOutrasObras.concat(etapasNovasRows);
  const lastEtapas = shEtapas.getLastRow();
  if (lastEtapas > 1) shEtapas.getRange(2, 1, lastEtapas - 1, ETAPAS_HEADERS.length).clearContent();
  if (todasEtapas.length) shEtapas.getRange(2, 1, todasEtapas.length, ETAPAS_HEADERS.length).setValues(todasEtapas);

  const todosPacotes = pacotesOutrasObras.concat(pacotesNovasRows);
  const lastCron = shCron.getLastRow();
  if (lastCron > 1) shCron.getRange(2, 1, lastCron - 1, CRONOGRAMA_HEADERS.length).clearContent();
  if (todosPacotes.length) shCron.getRange(2, 1, todosPacotes.length, CRONOGRAMA_HEADERS.length).setValues(todosPacotes);
}

// ────────────────────────────────────────────── DIAGNÓSTICO (rodar no editor) ──
//
// Só leitura — mostra o header real da aba Cronograma vs. o que o código
// espera (CRONOGRAMA_HEADERS), e as 3 primeiras linhas de dados, coluna a
// coluna. Usar pra investigar qualquer suspeita de campo fora de lugar.
function diagnosticarCronograma() {
  const sh = ss_().getSheetByName(SHEETS.CRONOGRAMA);
  const shEt = ss_().getSheetByName(SHEETS.ETAPAS);
  if (!sh) { Logger.log('Aba Cronograma não existe.'); return; }
  const lastCol = sh.getLastColumn();
  const lastRow = sh.getLastRow();
  Logger.log('=== TOTAL DE LINHAS ===\nCronograma: ' + (lastRow - 1) + ' linha(s) de dado (+ header)' +
    (shEt ? '\nEtapas: ' + (shEt.getLastRow() - 1) + ' linha(s) de dado (+ header)' : ''));

  if (lastRow >= 2) {
    const todas = sh.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
    // agrupa por IDObra pra contar quantos pacotes cada obra tem
    const porObra = {};
    todas.forEach(l => { const ido = l[1]; porObra[ido] = (porObra[ido] || 0) + 1; });
    Logger.log('=== CONTAGEM DE PACOTES POR OBRA ===\n' +
      Object.keys(porObra).map(k => k + ': ' + porObra[k] + ' pacote(s)').join('\n'));
    // agrupa por ID (coluna 1) pra achar IDs literalmente repetidos
    const porId = {};
    todas.forEach((l, i) => { const id = l[0]; (porId[id] = porId[id] || []).push(i + 2); });
    const idsDuplicados = Object.keys(porId).filter(id => porId[id].length > 1);
    if (idsDuplicados.length) {
      Logger.log('⚠⚠⚠ IDs REPETIDOS (mesmo ID em mais de uma linha) ===\n' +
        idsDuplicados.map(id => id + ' aparece nas linhas: ' + porId[id].join(', ')).join('\n'));
    } else {
      Logger.log('Nenhum ID literalmente repetido — se há duplicação, são IDs DIFERENTES com conteúdo parecido (ver linhas abaixo).');
    }
    Logger.log('=== TODAS AS LINHAS (ID | IDObra | IDEtapa | Ordem | Atividade) ===\n' +
      todas.map((l, i) => (i + 2) + ': ' + l[0] + ' | ' + l[1] + ' | ' + l[2] + ' | ' + l[3] + ' | ' + l[4]).join('\n'));
  } else {
    Logger.log('Nenhuma linha de dados ainda.');
  }
  if (shEt && shEt.getLastRow() >= 2) {
    const todasEt = shEt.getRange(2, 1, shEt.getLastRow() - 1, shEt.getLastColumn()).getDisplayValues();
    Logger.log('=== TODAS AS ETAPAS (ID | IDObra | Nome | Ordem) ===\n' +
      todasEt.map((l, i) => (i + 2) + ': ' + l[0] + ' | ' + l[1] + ' | ' + l[2] + ' | ' + l[3]).join('\n'));
  }
}

function apiValidarCronograma(token, idObra, aprovado, observacoes) {
  const sessao = exigirPMO_(token);
  const obra = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(o => o.ID === idObra);
  if (!obra) throw new Error('Obra não encontrada.');
  const cron = readAll_(SHEETS.CRONOGRAMA, CRONOGRAMA_HEADERS).filter(c => c.IDObra === idObra);
  if (!cron.length) throw new Error('Não há cronograma cadastrado para validar.');
  const sh = ss_().getSheetByName(SHEETS.OBRAS);
  const col = (h) => OBRAS_HEADERS.indexOf(h) + 1;
  const novoStatus = aprovado ? 'Validado' : 'Revisão solicitada';
  sh.getRange(obra._row, col('StatusCronograma')).setValue(novoStatus);
  sh.getRange(obra._row, col('CronogramaValidadoPor')).setValue(sessao.nome + ' (PMO)');
  sh.getRange(obra._row, col('CronogramaValidadoEm')).setValue(nowIso_());
  sh.getRange(obra._row, col('CronogramaObservacoesPMO')).setValue(sanitize_(observacoes, 2000));
  if (aprovado) congelarBaseline_(idObra); // idempotente — só age na 1ª validação, nunca sobrescreve depois
  invalidarCacheObras_();
  return { ok: true };
}

// ────────────────────────────────────────────── FASE 7 (rodar no editor) ──
//
// Migração one-shot: converte CustoDoacao/CustoProprio de texto (herdado
// das fases 0-6, cópia da produção) pra número de verdade. Idempotente —
// células que já são número não são tocadas. Não sobrescreve valores que
// não conseguem ser convertidos (texto genuinamente não-numérico): fica
// registrado no log pra correção manual, e a linha permanece com o valor
// antigo até alguém arrumar. Sem underscore no nome de propósito — senão
// não aparece no seletor "Executar" do editor (armadilha já documentada).
function migrarCustoParaNumero() {
  const sh = ss_().getSheetByName(SHEETS.CRONOGRAMA);
  if (!sh) return 'Aba Cronograma não existe — nada para migrar.';
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return 'Nenhuma linha de dado na aba Cronograma.';

  const colDoacao = CRONOGRAMA_HEADERS.indexOf('CustoDoacao') + 1;
  const colProprio = CRONOGRAMA_HEADERS.indexOf('CustoProprio') + 1;
  const colId = CRONOGRAMA_HEADERS.indexOf('ID') + 1;
  const maxCol = Math.max(colDoacao, colProprio, colId);

  const linhas = sh.getRange(2, 1, lastRow - 1, maxCol).getValues();

  let convertidos = 0, jaEramNumero = 0;
  const problemas = [];

  linhas.forEach((linha, i) => {
    const linhaNum = i + 2;
    const id = linha[colId - 1];
    [['CustoDoacao', colDoacao], ['CustoProprio', colProprio]].forEach(par => {
      const campo = par[0], col = par[1];
      const bruto = linha[col - 1];
      if (typeof bruto === 'number') { jaEramNumero++; return; }
      const n = parseMoedaServidor_(bruto);
      if (n === null) {
        problemas.push('Linha ' + linhaNum + ' (' + id + ', ' + campo + '): valor "' + bruto + '" não é um número válido — corrigir manualmente.');
        return;
      }
      sh.getRange(linhaNum, col).setValue(n);
      convertidos++;
    });
  });

  const resumo = 'Migração de custo concluída.\n' +
    convertidos + ' célula(s) convertida(s) de texto pra número.\n' +
    jaEramNumero + ' célula(s) já eram número (sem alteração).\n' +
    problemas.length + ' problema(s) encontrado(s)' + (problemas.length ? ':\n' + problemas.join('\n') : '.');
  Logger.log(resumo);
  return resumo;
}
