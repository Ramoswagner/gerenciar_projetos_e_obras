/**
 * Plano de Pagamento (parcelas variáveis por Pacote de Trabalho) +
 * Medições (execução financeira registrada por Engenharia/PMO) +
 * aprovação (SEMPRE PMO, mesmo princípio de apiValidarCronograma) +
 * Curva S físico-financeira (calculada em leitura a partir de
 * Baseline+Medições aprovadas, nunca persistida — ver Baseline.gs).
 *
 * Parcelas só podem ser criadas pra obras que já têm Baseline (cronograma
 * validado ao menos 1 vez) — sem isso não há contra o que comparar o
 * realizado. Evidência de medição aceita os DOIS mecanismos (pedido
 * explícito do usuário): upload real (reaproveita pastaEvidencias_/
 * TAMANHO_MAX_EVIDENCIA_BYTES de Restricoes.gs) ou link colado.
 */

// ────────────────────────────────────────────── PARCELAS ──

// Cache curto (120s) do resumo de portfólio (apiPagamentosResumo) —
// invalidado só pelas escritas que mudam os números agregados (parcela/
// medição/aprovação); evidência de medição não entra porque não muda
// planejado/realizado/pendências. Todos os escritores vivem neste mesmo
// arquivo, invalidação barata.
const CACHE_PAGAMENTOS_RESUMO = 'admin_pagamentos_resumo_v1';
function invalidarCachePagamentosResumo_() {
  CacheService.getScriptCache().remove(CACHE_PAGAMENTOS_RESUMO);
}

function apiSalvarParcela(token, dados) {
  const sessao = exigirPapel_(token, ['Engenharia', 'PMO']);
  dados = dados || {};
  const idObra = sanitize_(dados.IDObra, 30);
  const idPacote = sanitize_(dados.IDPacote, 30);
  if (!idObra || !idPacote) throw new Error('Pacote inválido.');
  const temBaseline = readAll_(SHEETS.BASELINE, BASELINE_HEADERS).some(b => b.IDObra === idObra);
  if (!temBaseline) throw new Error('Esta obra ainda não tem baseline — valide o cronograma ao menos uma vez antes de criar o plano de pagamento.');
  const descricao = sanitize_(dados.DescricaoParcela, 200);
  if (!descricao) throw new Error('Descreva a parcela.');
  const valor = parseMoedaServidor_(dados.ValorPrevisto);
  if (valor === null) throw new Error('Valor previsto inválido — use só números (ex.: 1500 ou 1500,50).');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ensureSheet_(ss_(), SHEETS.PLANO_PAGAMENTO, PLANO_PAGAMENTO_HEADERS);
    const idInformado = sanitize_(dados.ID, 30);
    const todas = readAll_(SHEETS.PLANO_PAGAMENTO, PLANO_PAGAMENTO_HEADERS);
    const existente = idInformado ? todas.find(p => p.ID === idInformado) : null;
    const numeroParcela = existente ? existente.NumeroParcela :
      (Math.max(0, ...todas.filter(p => p.IDPacote === idPacote).map(p => Number(p.NumeroParcela) || 0)) + 1);

    const linha = [
      existente ? existente.ID : proximoId_('PARC', SHEETS.PLANO_PAGAMENTO, PLANO_PAGAMENTO_HEADERS, 'ID'),
      idObra, idPacote, numeroParcela, descricao, valor,
      existente ? existente.CriadoPor : sessao.nome,
      existente ? existente.CriadoEm : nowIso_(),
      nowIso_()
    ];
    if (existente) sh.getRange(existente._row, 1, 1, PLANO_PAGAMENTO_HEADERS.length).setValues([linha]);
    else sh.getRange(sh.getLastRow() + 1, 1, 1, PLANO_PAGAMENTO_HEADERS.length).setValues([linha]);
    const parcela = {};
    PLANO_PAGAMENTO_HEADERS.forEach((h, i) => parcela[h] = linha[i]);
    invalidarCachePagamentosResumo_();
    return { ok: true, parcela: parcela };
  } finally {
    lock.releaseLock();
  }
}

function apiExcluirParcela(token, idParcela) {
  exigirPapel_(token, ['Engenharia', 'PMO']);
  const temMedicao = readAll_(SHEETS.MEDICOES, MEDICOES_HEADERS).some(m => m.IDParcela === idParcela);
  if (temMedicao) throw new Error('Esta parcela já tem medição registrada — não pode ser excluída (preserva o histórico financeiro).');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const parcela = readAll_(SHEETS.PLANO_PAGAMENTO, PLANO_PAGAMENTO_HEADERS).find(p => p.ID === idParcela);
    if (!parcela) throw new Error('Parcela não encontrada.');
    ss_().getSheetByName(SHEETS.PLANO_PAGAMENTO).deleteRow(parcela._row);
    invalidarCachePagamentosResumo_();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ────────────────────────────────────────────── MEDIÇÕES ──

function apiRegistrarMedicao(token, dados) {
  const sessao = exigirPapel_(token, ['Engenharia', 'PMO']);
  dados = dados || {};
  const idObra = sanitize_(dados.IDObra, 30);
  const idPacote = sanitize_(dados.IDPacote, 30);
  const idParcela = sanitize_(dados.IDParcela, 30);
  if (!idObra || !idPacote || !idParcela) throw new Error('Parcela inválida.');
  const parcela = readAll_(SHEETS.PLANO_PAGAMENTO, PLANO_PAGAMENTO_HEADERS).find(p => p.ID === idParcela);
  if (!parcela) throw new Error('Parcela não encontrada.');
  const valor = parseMoedaServidor_(dados.ValorMedido);
  if (valor === null || valor <= 0) throw new Error('Valor medido inválido — use só números maiores que zero.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ensureSheet_(ss_(), SHEETS.MEDICOES, MEDICOES_HEADERS);
    const linha = [
      proximoId_('MED', SHEETS.MEDICOES, MEDICOES_HEADERS, 'ID'),
      idObra, idPacote, idParcela, valor,
      sanitize_(dados.DescricaoEvidencia, 500), '', // LinkEvidencia legado não usado mais — evidências vivem em MedicoesEvidencias (N por medição)
      sessao.nome, nowIso_(),
      'Pendente', '', '', ''
    ];
    sh.getRange(sh.getLastRow() + 1, 1, 1, MEDICOES_HEADERS.length).setValues([linha]);
    const medicao = {};
    MEDICOES_HEADERS.forEach((h, i) => medicao[h] = linha[i]);
    invalidarCachePagamentosResumo_();
    return { ok: true, medicao: medicao };
  } finally {
    lock.releaseLock();
  }
}

// Aprovação SEMPRE do PMO — mesmo princípio de apiValidarCronograma. Uma
// vez decidida (Aprovada/Rejeitada), a medição não pode ser reaberta nem
// excluída — preserva o histórico financeiro intacto (diferente das
// Restrições, que podem ir e voltar de status livremente).
function apiAprovarMedicao(token, idMedicao, aprovado, observacoes) {
  const sessao = exigirPMO_(token);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const medicao = readAll_(SHEETS.MEDICOES, MEDICOES_HEADERS).find(m => m.ID === idMedicao);
    if (!medicao) throw new Error('Medição não encontrada.');
    if (medicao.StatusAprovacao !== 'Pendente') throw new Error('Esta medição já foi decidida e não pode ser alterada.');
    const sh = ss_().getSheetByName(SHEETS.MEDICOES);
    const col = (h) => MEDICOES_HEADERS.indexOf(h) + 1;
    const novoStatus = aprovado ? 'Aprovada' : 'Rejeitada';
    sh.getRange(medicao._row, col('StatusAprovacao')).setValue(novoStatus);
    sh.getRange(medicao._row, col('AprovadoPor')).setValue(sessao.nome);
    sh.getRange(medicao._row, col('AprovadoEm')).setValue(nowIso_());
    sh.getRange(medicao._row, col('ObservacoesPMO')).setValue(sanitize_(observacoes, 1000));
    invalidarCachePagamentosResumo_();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function apiExcluirMedicao(token, idMedicao) {
  exigirPapel_(token, ['Engenharia', 'PMO']);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const medicao = readAll_(SHEETS.MEDICOES, MEDICOES_HEADERS).find(m => m.ID === idMedicao);
    if (!medicao) throw new Error('Medição não encontrada.');
    if (medicao.StatusAprovacao !== 'Pendente') throw new Error('Medição já decidida não pode ser excluída (preserva o histórico financeiro).');
    ss_().getSheetByName(SHEETS.MEDICOES).deleteRow(medicao._row);
    invalidarCachePagamentosResumo_();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ────────────────────────────────────────────── EVIDÊNCIA DE MEDIÇÃO ──
// Dois mecanismos (pedido explícito do usuário): upload real (reaproveita
// pastaEvidencias_/TAMANHO_MAX_EVIDENCIA_BYTES já definidas em
// Restricoes.gs) ou link colado (URL validada no servidor).

function apiUploadEvidenciaMedicao(token, idMedicao, nomeArquivo, mimeType, base64Data) {
  const sessao = exigirPapel_(token, ['Engenharia', 'PMO']);
  const medicao = readAll_(SHEETS.MEDICOES, MEDICOES_HEADERS).find(m => m.ID === idMedicao);
  if (!medicao) throw new Error('Medição não encontrada.');
  nomeArquivo = sanitize_(nomeArquivo, 180) || 'evidencia';
  mimeType = sanitize_(mimeType, 100) || 'application/octet-stream';
  if (!base64Data) throw new Error('Selecione um arquivo.');
  let bytes;
  try { bytes = Utilities.base64Decode(base64Data); }
  catch (e) { throw new Error('Arquivo inválido — tente novamente.'); }
  if (bytes.length > TAMANHO_MAX_EVIDENCIA_BYTES) throw new Error('Arquivo maior que 8MB — reduza o tamanho antes de enviar.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const pasta = pastaEvidencias_(medicao.IDObra);
    const blob = Utilities.newBlob(bytes, mimeType, nomeArquivo);
    const arquivo = pasta.createFile(blob);
    const sh = ensureSheet_(ss_(), SHEETS.MEDICOES_EVIDENCIAS, MEDICOES_EVIDENCIAS_HEADERS);
    const linha = [
      proximoId_('MEVID', SHEETS.MEDICOES_EVIDENCIAS, MEDICOES_EVIDENCIAS_HEADERS, 'ID'),
      idMedicao, medicao.IDObra, 'Upload', nomeArquivo, arquivo.getUrl(), arquivo.getId(),
      sessao.nome, nowIso_()
    ];
    sh.getRange(sh.getLastRow() + 1, 1, 1, MEDICOES_EVIDENCIAS_HEADERS.length).setValues([linha]);
    const evidencia = {};
    MEDICOES_EVIDENCIAS_HEADERS.forEach((h, i) => evidencia[h] = linha[i]);
    return { ok: true, evidencia: evidencia };
  } finally {
    lock.releaseLock();
  }
}

// Regex com barra-barra é seguro aqui — a armadilha documentada do projeto
// (decapitação de linha) é só pra .html processado pelo templating do
// HtmlService; .gs é JS de servidor puro, sem esse risco.
function linkValidoServidor_(s) {
  return /^https?:\/\//i.test(String(s || '').trim());
}

function apiAnexarLinkEvidenciaMedicao(token, idMedicao, descricao, link) {
  const sessao = exigirPapel_(token, ['Engenharia', 'PMO']);
  const medicao = readAll_(SHEETS.MEDICOES, MEDICOES_HEADERS).find(m => m.ID === idMedicao);
  if (!medicao) throw new Error('Medição não encontrada.');
  const linkOk = sanitize_(link, 500);
  if (!linkValidoServidor_(linkOk)) throw new Error('Informe um link válido, começando com http:// ou https://.');
  const descricaoOk = sanitize_(descricao, 200) || 'Link de evidência';

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ensureSheet_(ss_(), SHEETS.MEDICOES_EVIDENCIAS, MEDICOES_EVIDENCIAS_HEADERS);
    const linha = [
      proximoId_('MEVID', SHEETS.MEDICOES_EVIDENCIAS, MEDICOES_EVIDENCIAS_HEADERS, 'ID'),
      idMedicao, medicao.IDObra, 'Link', descricaoOk, linkOk, '',
      sessao.nome, nowIso_()
    ];
    sh.getRange(sh.getLastRow() + 1, 1, 1, MEDICOES_EVIDENCIAS_HEADERS.length).setValues([linha]);
    const evidencia = {};
    MEDICOES_EVIDENCIAS_HEADERS.forEach((h, i) => evidencia[h] = linha[i]);
    return { ok: true, evidencia: evidencia };
  } finally {
    lock.releaseLock();
  }
}

function apiExcluirEvidenciaMedicao(token, idEvidencia) {
  exigirPapel_(token, ['Engenharia', 'PMO']);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const evidencia = readAll_(SHEETS.MEDICOES_EVIDENCIAS, MEDICOES_EVIDENCIAS_HEADERS).find(e => e.ID === idEvidencia);
    if (!evidencia) throw new Error('Evidência não encontrada.');
    if (evidencia.Tipo === 'Upload' && evidencia.FileId) {
      try { DriveApp.getFileById(evidencia.FileId).setTrashed(true); }
      catch (e) { /* arquivo já pode ter sido removido manualmente do Drive */ }
    }
    ss_().getSheetByName(SHEETS.MEDICOES_EVIDENCIAS).deleteRow(evidencia._row);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ────────────────────────────────────────────── CURVA S ──
// Planejado: custo da Baseline (CustoDoacao+CustoProprio por pacote)
// distribuído linearmente entre DataInicioPrevista/DataFimPrevista,
// acumulado por semana (mesma convenção de semana de janelaLookahead_ —
// segunda-feira como início). Realizado: soma de Medições Aprovadas por
// AprovadoEm, acumulado na mesma grade de semanas. Se o realizado se
// estender além da janela original da baseline (atraso real de execução),
// a janela do gráfico se alarga pra não esconder esse atraso — o ponto
// da Curva S é justamente mostrar esse tipo de desvio.
// Função pura (recebe as listas já lidas) — reaproveita inicioSemana_/
// isoDoDate_ (Restricoes.gs) e parseDate_/parseMoedaServidor_ (Helpers.gs).
function curvaSFisicoFinanceira_(baseline, medicoesAprovadas) {
  if (!baseline.length) return [];
  const datasBaseline = [];
  baseline.forEach(b => {
    if (b.DataInicioPrevista) datasBaseline.push(b.DataInicioPrevista);
    if (b.DataFimPrevista) datasBaseline.push(b.DataFimPrevista);
  });
  if (!datasBaseline.length) return [];
  datasBaseline.sort();
  let dataMin = parseDate_(datasBaseline[0]);
  let dataMax = parseDate_(datasBaseline[datasBaseline.length - 1]);
  if (!dataMin || !dataMax) return [];

  const porDiaPlanejado = {};
  baseline.forEach(b => {
    const custo = (parseMoedaServidor_(b.CustoDoacao) || 0) + (parseMoedaServidor_(b.CustoProprio) || 0);
    if (custo <= 0) return;
    const ini = parseDate_(b.DataInicioPrevista) || dataMin;
    const fim = parseDate_(b.DataFimPrevista) || ini;
    const dias = Math.max(1, Math.round((fim - ini) / 86400000) + 1);
    const valorDia = custo / dias;
    for (let i = 0; i < dias; i++) {
      const d = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + i);
      const iso = isoDoDate_(d);
      porDiaPlanejado[iso] = (porDiaPlanejado[iso] || 0) + valorDia;
    }
  });

  const porDiaRealizado = {};
  medicoesAprovadas.forEach(m => {
    const dataRef = String(m.AprovadoEm || '').slice(0, 10);
    if (!dataRef) return;
    const d = parseDate_(dataRef);
    if (!d) return;
    if (d > dataMax) dataMax = d;
    if (d < dataMin) dataMin = d;
    porDiaRealizado[dataRef] = (porDiaRealizado[dataRef] || 0) + (parseMoedaServidor_(m.ValorMedido) || 0);
  });

  const inicioSem0 = inicioSemana_(dataMin);
  const pontos = [];
  let acPlan = 0, acReal = 0;
  let cursor = new Date(inicioSem0.getFullYear(), inicioSem0.getMonth(), inicioSem0.getDate());
  let guarda = 0; // trava defensiva contra loop infinito com datas malformadas
  while (cursor <= dataMax && guarda < 2000) {
    let somaP = 0, somaR = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + i);
      const iso = isoDoDate_(d);
      somaP += porDiaPlanejado[iso] || 0;
      somaR += porDiaRealizado[iso] || 0;
    }
    acPlan += somaP; acReal += somaR;
    pontos.push({
      semanaInicio: isoDoDate_(cursor),
      planejadoAcumulado: Math.round(acPlan * 100) / 100,
      realizadoAcumulado: Math.round(acReal * 100) / 100
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
    guarda++;
  }
  return pontos;
}

function apiCurvaS(token, idObra) {
  validarToken_(token);
  const baseline = readAll_(SHEETS.BASELINE, BASELINE_HEADERS).filter(b => b.IDObra === idObra);
  const medicoesAprovadas = readAll_(SHEETS.MEDICOES, MEDICOES_HEADERS)
    .filter(m => m.IDObra === idObra && m.StatusAprovacao === 'Aprovada');
  const pontos = curvaSFisicoFinanceira_(baseline, medicoesAprovadas);
  const custoTotalPlanejado = baseline.reduce((s, b) => s + (parseMoedaServidor_(b.CustoDoacao) || 0) + (parseMoedaServidor_(b.CustoProprio) || 0), 0);
  const custoTotalRealizado = medicoesAprovadas.reduce((s, m) => s + (parseMoedaServidor_(m.ValorMedido) || 0), 0);
  return {
    pontos: pontos,
    custoTotalPlanejado: Math.round(custoTotalPlanejado * 100) / 100,
    custoTotalRealizado: Math.round(custoTotalRealizado * 100) / 100,
    temBaseline: baseline.length > 0
  };
}

// ────────────────────────────────────────────── LEITURA AGREGADA (tela) ──

// Portfólio — só obras que já têm Baseline (as únicas que podem ter plano
// de pagamento). Alimenta a lista/filtro da tela Pagamentos.
function apiPagamentosResumo(token) {
  validarToken_(token);
  const cache = CacheService.getScriptCache();
  const hit = cache.get(CACHE_PAGAMENTOS_RESUMO);
  if (hit) return JSON.parse(hit);

  const baseline = readAll_(SHEETS.BASELINE, BASELINE_HEADERS);
  const obras = readAll_(SHEETS.OBRAS, OBRAS_HEADERS);
  const medicoes = readAll_(SHEETS.MEDICOES, MEDICOES_HEADERS);
  const obraPorId = {}; obras.forEach(o => obraPorId[o.ID] = o);

  const idsObraComBaseline = [];
  const baselinePorObra = {};
  baseline.forEach(b => {
    if (!baselinePorObra[b.IDObra]) { baselinePorObra[b.IDObra] = []; idsObraComBaseline.push(b.IDObra); }
    baselinePorObra[b.IDObra].push(b);
  });

  const resultado = idsObraComBaseline.map(idObra => {
    const linhasBaseline = baselinePorObra[idObra];
    const custoTotalPlanejado = linhasBaseline.reduce((s, b) => s + (parseMoedaServidor_(b.CustoDoacao) || 0) + (parseMoedaServidor_(b.CustoProprio) || 0), 0);
    const medicoesDaObra = medicoes.filter(m => m.IDObra === idObra);
    const custoTotalRealizado = medicoesDaObra.filter(m => m.StatusAprovacao === 'Aprovada')
      .reduce((s, m) => s + (parseMoedaServidor_(m.ValorMedido) || 0), 0);
    const qtdMedicoesPendentes = medicoesDaObra.filter(m => m.StatusAprovacao === 'Pendente').length;
    return {
      ID: idObra,
      Titulo: (obraPorId[idObra] || {}).Titulo || idObra,
      custoTotalPlanejado: Math.round(custoTotalPlanejado * 100) / 100,
      custoTotalRealizado: Math.round(custoTotalRealizado * 100) / 100,
      pctExecutado: custoTotalPlanejado > 0 ? Math.round(custoTotalRealizado / custoTotalPlanejado * 100) : 0,
      qtdMedicoesPendentes: qtdMedicoesPendentes
    };
  }).sort((a, b) => a.Titulo.localeCompare(b.Titulo));
  cache.put(CACHE_PAGAMENTOS_RESUMO, JSON.stringify(resultado), 120);
  return resultado;
}

// Detalhe de UMA obra — pacotes (da Baseline, imutáveis) com suas
// parcelas e medições (com evidências) aninhadas, pronto pro cliente
// agrupar sem chamadas extras.
function apiPagamentosObra(token, idObra) {
  validarToken_(token);
  const baseline = readAll_(SHEETS.BASELINE, BASELINE_HEADERS).filter(b => b.IDObra === idObra)
    .sort((a, b) => String(a.DataInicioPrevista || '9999').localeCompare(String(b.DataInicioPrevista || '9999')));
  const parcelas = readAll_(SHEETS.PLANO_PAGAMENTO, PLANO_PAGAMENTO_HEADERS).filter(p => p.IDObra === idObra);
  const medicoes = readAll_(SHEETS.MEDICOES, MEDICOES_HEADERS).filter(m => m.IDObra === idObra);
  const evidencias = readAll_(SHEETS.MEDICOES_EVIDENCIAS, MEDICOES_EVIDENCIAS_HEADERS).filter(e => e.IDObra === idObra);
  const obra = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(o => o.ID === idObra);
  return {
    obra: obra || { ID: idObra, Titulo: idObra },
    baseline: baseline,
    parcelas: parcelas,
    medicoes: medicoes,
    evidencias: evidencias
  };
}
