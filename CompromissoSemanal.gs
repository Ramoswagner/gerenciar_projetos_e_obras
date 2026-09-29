/**
 * Compromisso Semanal — Last Planner "Weekly Work Plan": a equipe escolhe
 * quais Pacotes de Trabalho serão executados na semana corrente, e ao
 * final marca cada um como Cumprido ou Não cumprido (com categoria —
 * mesma lista compartilhada com Restrições, `CATEGORIAS_NAO_CUMPRIMENTO`,
 * já que um impedimento não resolvido é frequentemente a própria causa de
 * uma atividade não cumprida). PPC (Percentual de Programação Concluída)
 * NUNCA é gravado — sempre calculado em leitura como
 * Cumpridos/(Cumpridos+Não cumpridos) da semana.
 *
 * Diferente de Medições (Fase 8, decisão definitiva/financeira): marcar
 * um compromisso é REVERSÍVEL — corrigir um lançamento errado durante a
 * própria semana é operação normal de planejamento, não um evento de
 * auditoria financeira.
 */

function fimDaSemana_(inicioIso) {
  const d = parseDate_(inicioIso);
  const fim = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6);
  return isoDoDate_(fim);
}

// Cache curto (120s) do portfólio+tendência (apiCompromissoSemanal) —
// invalidado nos 3 escritores deste mesmo arquivo.
const CACHE_COMPROMISSO_SEMANAL = 'admin_compromisso_semanal_v1';
function invalidarCacheCompromissoSemanal_() {
  CacheService.getScriptCache().remove(CACHE_COMPROMISSO_SEMANAL);
}

// Só um compromisso por Pacote por semana — não faz sentido comprometer o
// mesmo pacote 2x na mesma semana.
function apiComprometerPacote(token, idObra, idPacote, responsavelNome) {
  const sessao = exigirPapel_(token, ['Engenharia', 'PMO']);
  idObra = sanitize_(idObra, 30);
  idPacote = sanitize_(idPacote, 30);
  if (!idObra || !idPacote) throw new Error('Pacote inválido.');

  const segunda = inicioSemana_(new Date());
  const inicioSemana = isoDoDate_(segunda);
  const fimSemana = fimDaSemana_(inicioSemana);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const todos = readAll_(SHEETS.COMPROMISSO_SEMANAL, COMPROMISSO_SEMANAL_HEADERS);
    if (todos.some(c => c.IDPacote === idPacote && c.DataInicioSemana === inicioSemana)) {
      throw new Error('Este pacote já tem um compromisso registrado na semana atual.');
    }
    const sh = ensureSheet_(ss_(), SHEETS.COMPROMISSO_SEMANAL, COMPROMISSO_SEMANAL_HEADERS);
    const linha = [
      proximoId_('CS', SHEETS.COMPROMISSO_SEMANAL, COMPROMISSO_SEMANAL_HEADERS, 'ID'),
      idObra, idPacote, inicioSemana, fimSemana, 'Planejado', '', '',
      sanitize_(responsavelNome, 120), '',
      sessao.nome, nowIso_(), nowIso_()
    ];
    sh.getRange(sh.getLastRow() + 1, 1, 1, COMPROMISSO_SEMANAL_HEADERS.length).setValues([linha]);
    const compromisso = {};
    COMPROMISSO_SEMANAL_HEADERS.forEach((h, i) => compromisso[h] = linha[i]);
    invalidarCacheCompromissoSemanal_();
    return { ok: true, compromisso: compromisso };
  } finally {
    lock.releaseLock();
  }
}

function apiMarcarCompromisso(token, idCompromisso, status, categoriaNaoCumprimento, detalhes) {
  exigirPapel_(token, ['Engenharia', 'PMO']);
  if (['Cumprido', 'Não cumprido'].indexOf(status) < 0) throw new Error('Status inválido — use "Cumprido" ou "Não cumprido".');
  if (status === 'Não cumprido' && CATEGORIAS_NAO_CUMPRIMENTO.indexOf(categoriaNaoCumprimento) < 0) {
    throw new Error('Selecione uma categoria de não-cumprimento válida.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const compromisso = readAll_(SHEETS.COMPROMISSO_SEMANAL, COMPROMISSO_SEMANAL_HEADERS).find(c => c.ID === idCompromisso);
    if (!compromisso) throw new Error('Compromisso não encontrado.');
    const sh = ss_().getSheetByName(SHEETS.COMPROMISSO_SEMANAL);
    const col = (h) => COMPROMISSO_SEMANAL_HEADERS.indexOf(h) + 1;
    sh.getRange(compromisso._row, col('Status')).setValue(status);
    sh.getRange(compromisso._row, col('CategoriaNaoCumprimento')).setValue(status === 'Não cumprido' ? categoriaNaoCumprimento : '');
    sh.getRange(compromisso._row, col('DetalhesNaoCumprimento')).setValue(status === 'Não cumprido' ? sanitize_(detalhes, 1000) : '');
    sh.getRange(compromisso._row, col('AtualizadoEm')).setValue(nowIso_());
    invalidarCacheCompromissoSemanal_();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// Só remove um compromisso ainda "Planejado" (desfazer um lançamento por
// engano antes da semana ser decidida) — uma vez marcado Cumprido/Não
// cumprido, vira histórico do PPC e não pode mais sumir.
function apiExcluirCompromisso(token, idCompromisso) {
  exigirPapel_(token, ['Engenharia', 'PMO']);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const compromisso = readAll_(SHEETS.COMPROMISSO_SEMANAL, COMPROMISSO_SEMANAL_HEADERS).find(c => c.ID === idCompromisso);
    if (!compromisso) throw new Error('Compromisso não encontrado.');
    if (compromisso.Status !== 'Planejado') throw new Error('Compromisso já decidido não pode ser excluído (preserva o histórico de PPC).');
    ss_().getSheetByName(SHEETS.COMPROMISSO_SEMANAL).deleteRow(compromisso._row);
    invalidarCacheCompromissoSemanal_();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// PPC = Cumpridos / (Cumpridos+Não cumpridos). "Planejado" (semana ainda
// em andamento, não decidido) fica de fora do denominador — null quando
// não há nenhum compromisso decidido ainda (não é 0%, é "sem dado").
// Função pura, testável.
function calcularPPC_(compromissosDaSemana) {
  const decididos = compromissosDaSemana.filter(c => c.Status === 'Cumprido' || c.Status === 'Não cumprido');
  if (!decididos.length) return null;
  const cumpridos = decididos.filter(c => c.Status === 'Cumprido').length;
  return Math.round(cumpridos / decididos.length * 100);
}

// Pacotes do cronograma da obra que AINDA NÃO têm compromisso na semana
// atual — alimenta a lista de "comprometer" na tela.
function apiPacotesParaComprometer(token, idObra) {
  validarToken_(token);
  const inicioSemana = isoDoDate_(inicioSemana_(new Date()));
  const jaComprometidos = readAll_(SHEETS.COMPROMISSO_SEMANAL, COMPROMISSO_SEMANAL_HEADERS)
    .filter(c => c.DataInicioSemana === inicioSemana).map(c => c.IDPacote);
  return readAll_(SHEETS.CRONOGRAMA, CRONOGRAMA_HEADERS)
    .filter(p => p.IDObra === idObra && jaComprometidos.indexOf(p.ID) < 0)
    .map(p => ({ ID: p.ID, Atividade: p.Atividade, Status: p.Status, Responsavel: p.Responsavel }));
}

function apiCompromissoSemanal(token) {
  validarToken_(token);
  const cache = CacheService.getScriptCache();
  const hit = cache.get(CACHE_COMPROMISSO_SEMANAL);
  if (hit) return JSON.parse(hit);

  const compromissos = readAll_(SHEETS.COMPROMISSO_SEMANAL, COMPROMISSO_SEMANAL_HEADERS);
  const obras = readAll_(SHEETS.OBRAS, OBRAS_HEADERS);
  const pacotes = readAll_(SHEETS.CRONOGRAMA, CRONOGRAMA_HEADERS);
  const obraPorId = {}; obras.forEach(o => obraPorId[o.ID] = o);
  const pacotePorId = {}; pacotes.forEach(p => pacotePorId[p.ID] = p);

  const lista = compromissos.map(c => ({
    ID: c.ID, IDObra: c.IDObra, IDPacote: c.IDPacote,
    TituloObra: (obraPorId[c.IDObra] || {}).Titulo || c.IDObra,
    Atividade: (pacotePorId[c.IDPacote] || {}).Atividade || c.IDPacote,
    DataInicioSemana: c.DataInicioSemana, DataFimSemana: c.DataFimSemana,
    Status: c.Status, CategoriaNaoCumprimento: c.CategoriaNaoCumprimento,
    DetalhesNaoCumprimento: c.DetalhesNaoCumprimento, ResponsavelNome: c.ResponsavelNome
  })).sort((a, b) => b.DataInicioSemana.localeCompare(a.DataInicioSemana));

  const hoje = new Date();
  const inicioSem0 = inicioSemana_(hoje);
  const tendencia = [];
  for (let i = -5; i <= 0; i++) {
    const ini = new Date(inicioSem0.getFullYear(), inicioSem0.getMonth(), inicioSem0.getDate() + i * 7);
    const iniIso = isoDoDate_(ini);
    const doSemana = lista.filter(c => c.DataInicioSemana === iniIso);
    tendencia.push({ inicioIso: iniIso, fimIso: fimDaSemana_(iniIso), ppc: calcularPPC_(doSemana), total: doSemana.length });
  }

  const semanaAtualIso = isoDoDate_(inicioSem0);
  const compromissosSemanaAtual = lista.filter(c => c.DataInicioSemana === semanaAtualIso);

  const resultado = {
    compromissos: lista,
    semanaAtualIso: semanaAtualIso,
    ppcSemanaAtual: calcularPPC_(compromissosSemanaAtual),
    totalSemanaAtual: compromissosSemanaAtual.length,
    tendencia: tendencia
  };
  cache.put(CACHE_COMPROMISSO_SEMANAL, JSON.stringify(resultado), 120);
  return resultado;
}
