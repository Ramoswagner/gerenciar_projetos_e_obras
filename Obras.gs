/**
 * Obras — TAP 5W2H, EAP, publicação, manifestação, requisitos, áreas
 * propostas, decisões de prazo e atas. Portado 1:1 do Code.gs do sistema
 * atual; mudanças estruturais: sessão por token (Auth.gs) no lugar do
 * PIN, cache da lista admin (mesmo padrão de Pedidos.gs).
 */

const CACHE_LISTA_OBRAS = 'admin_obras_lista_v1';
function invalidarCacheObras_() {
  CacheService.getScriptCache().remove(CACHE_LISTA_OBRAS);
}

function apiListarObras(token) {
  validarToken_(token);
  const cache = CacheService.getScriptCache();
  const hit = cache.get(CACHE_LISTA_OBRAS);
  if (hit) return JSON.parse(hit);

  const obras = readAll_(SHEETS.OBRAS, OBRAS_HEADERS);
  const manifs = readAll_(SHEETS.MANIF, MANIF_HEADERS);
  const byObra = {};
  manifs.forEach(m => {
    if (!byObra[m.IDObra]) byObra[m.IDObra] = { total: 0, objecoes: 0, ressalvas: 0 };
    byObra[m.IDObra].total++;
    if (m.Posicionamento === 'Objeção') byObra[m.IDObra].objecoes++;
    if (m.Posicionamento === 'Ciente com ressalvas') byObra[m.IDObra].ressalvas++;
  });
  // Indicador compacto de progresso do cronograma — só a contagem, nunca o
  // Gantt inteiro (isso fica reservado para o detalhe/edição da obra).
  const cronPorObra = {};
  readAll_(SHEETS.CRONOGRAMA, CRONOGRAMA_HEADERS).forEach(c => {
    if (!cronPorObra[c.IDObra]) cronPorObra[c.IDObra] = { total: 0, concluidos: 0 };
    cronPorObra[c.IDObra].total++;
    if (c.Status === 'Concluída') cronPorObra[c.IDObra].concluidos++;
  });
  const lista = obras.map(o => ({
    ID: o.ID, Titulo: o.Titulo, Setor: o.Setor, Status: o.Status,
    PrazoManifestacao: o.PrazoManifestacao, DataPublicacao: o.DataPublicacao,
    ResponsavelNome: o.ResponsavelNome,
    manif: byObra[o.ID] || { total: 0, objecoes: 0, ressalvas: 0 },
    StatusCronograma: o.StatusCronograma || '',
    cronograma: cronPorObra[o.ID] || null
  })).reverse();
  cache.put(CACHE_LISTA_OBRAS, JSON.stringify(lista), 120);
  return lista;
}

function apiGetObraAdmin(token, id) {
  validarToken_(token);
  const obra = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(o => o.ID === id);
  if (!obra) throw new Error('Obra não encontrada: ' + id);
  obra.StatusCronograma = obra.StatusCronograma || 'Rascunho'; // obras antigas, sem migração de dados
  const cfg = getConfig_();
  return {
    obra: obra,
    eap: readAll_(SHEETS.EAP, EAP_HEADERS).filter(e => e.IDObra === id).sort(compareEap_),
    manifestacoes: readAll_(SHEETS.MANIF, MANIF_HEADERS).filter(m => m.IDObra === id),
    requisitos: readAll_(SHEETS.REQUISITOS, REQUISITOS_HEADERS).filter(r => r.IDObra === id),
    decisoesPrazo: readAll_(SHEETS.DECISOES_PRAZO, DECISOES_PRAZO_HEADERS).filter(d => d.IDObra === id),
    atas: readAll_(SHEETS.ATAS, ATAS_HEADERS).filter(a => a.IDObra === id)
      .sort((a, b) => String(a.DataReuniao).localeCompare(String(b.DataReuniao))),
    etapas: readAll_(SHEETS.ETAPAS, ETAPAS_HEADERS).filter(e => e.IDObra === id)
      .sort((a, b) => Number(a.Ordem) - Number(b.Ordem)),
    cronograma: readAll_(SHEETS.CRONOGRAMA, CRONOGRAMA_HEADERS).filter(c => c.IDObra === id)
      .sort((a, b) => Number(a.Ordem) - Number(b.Ordem)),
    riscos: readAll_(SHEETS.RISCOS, RISCOS_HEADERS).filter(r => r.IDObra === id),
    restricoes: readAll_(SHEETS.RESTRICOES, RESTRICOES_HEADERS).filter(r => r.IDObra === id),
    evidenciasRestricao: readAll_(SHEETS.RESTRICOES_EVIDENCIAS, RESTRICOES_EVIDENCIAS_HEADERS).filter(e => e.IDObra === id),
    linkPublico: linkObra_(id),
    areas: cfg._areas, setores: cfg._setores,
    prazoDiasUteis: parseInt(cfg.PRAZO_DIAS_UTEIS, 10) || 5,
    // Fase 11: usuários papel Responsável ativos — alimenta o vínculo
    // ResponsavelUserId por pacote no editor de Cronograma.
    responsaveis: readAll_(SHEETS.USUARIOS, USUARIOS_HEADERS)
      .filter(u => u.Papel === 'Responsavel' && u.Status === 'ativo')
      .map(u => ({ ID: u.ID, Nome: u.Nome }))
  };
}

function apiNovaObraContexto(token) {
  validarToken_(token);
  const cfg = getConfig_();
  return {
    areas: cfg._areas, setores: cfg._setores,
    prazoDiasUteis: parseInt(cfg.PRAZO_DIAS_UTEIS, 10) || 5
  };
}

function apiSalvarObra(token, dados, eapItens) {
  validarToken_(token);
  const linkPlanta = sanitize_(dados.LinkPlanta, 500);
  if (linkPlanta && !/^https?:\/\//i.test(linkPlanta)) {
    throw new Error('O link do croqui/planta deve começar com http:// ou https://');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ss_().getSheetByName(SHEETS.OBRAS);
    const isNew = !dados.ID;
    const id = isNew ? proximoId_('OBR', SHEETS.OBRAS, OBRAS_HEADERS, 'ID') : sanitize_(dados.ID, 20);

    const existing = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(o => o.ID === id);
    if (!isNew && !existing) throw new Error('Obra não encontrada para edição: ' + id);

    const row = OBRAS_HEADERS.map(h => {
      if (h === 'ID') return id;
      if (h === 'Status') return existing ? existing.Status : 'Rascunho';
      if (h === 'DataPublicacao') return existing ? existing.DataPublicacao : '';
      if (h === 'CriadoEm') return existing ? existing.CriadoEm : nowIso_();
      if (h === 'AtualizadoEm') return nowIso_();
      // campos geridos por fluxos próprios (cronograma/validação/cancelamento)
      // nunca passam pelo formulário genérico — preserva o que já existia
      if (h === 'StatusCronograma') return existing ? (existing.StatusCronograma || 'Rascunho') : 'Rascunho';
      if (h === 'CronogramaValidadoPor') return existing ? existing.CronogramaValidadoPor : '';
      if (h === 'CronogramaValidadoEm') return existing ? existing.CronogramaValidadoEm : '';
      if (h === 'CronogramaObservacoesPMO') return existing ? existing.CronogramaObservacoesPMO : '';
      if (h === 'CanceladoPor') return existing ? existing.CanceladoPor : '';
      if (h === 'DataCancelamento') return existing ? existing.DataCancelamento : '';
      if (h === 'MotivoCancelamento') return existing ? existing.MotivoCancelamento : '';
      return sanitize_(dados[h]);
    });

    if (existing) {
      sh.getRange(existing._row, 1, 1, OBRAS_HEADERS.length).setValues([row]);
    } else {
      sh.appendRow(row);
    }

    salvarEap_(id, eapItens || []);
    invalidarCacheObras_();
    return { ok: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

// Reescreve a aba EAP numa única operação em lote: mantém em memória as
// linhas das outras obras, substitui as da obra sendo salva e grava tudo
// com um único setValues. Sempre chamada dentro do lock de apiSalvarObra.
function salvarEap_(idObra, itens) {
  const sh = ss_().getSheetByName(SHEETS.EAP);
  const mantidas = readAll_(SHEETS.EAP, EAP_HEADERS)
    .filter(e => e.IDObra !== idObra)
    .map(e => EAP_HEADERS.map(h => e[h]));
  const novas = itens
    .filter(it => sanitize_(it.Codigo, 20) && sanitize_(it.Descricao, 300))
    .map((it, i) => [
      idObra + '-E' + ('00' + (i + 1)).slice(-2),
      idObra,
      sanitize_(it.Codigo, 20),
      sanitize_(it.Descricao, 300),
      sanitize_(it.NaturezaImpacto, 200)
    ]);
  const todas = mantidas.concat(novas);
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, EAP_HEADERS.length).clearContent();
  if (todas.length) sh.getRange(2, 1, todas.length, EAP_HEADERS.length).setValues(todas);
}

function apiPublicarObra(token, id) {
  validarToken_(token);
  const sh = ss_().getSheetByName(SHEETS.OBRAS);
  const obra = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(o => o.ID === id);
  if (!obra) throw new Error('Obra não encontrada.');
  if (!obra.PrazoManifestacao) throw new Error('Defina o prazo de manifestação antes de publicar.');

  const col = (h) => OBRAS_HEADERS.indexOf(h) + 1;
  sh.getRange(obra._row, col('Status')).setValue('Publicada');
  if (!obra.DataPublicacao) {
    sh.getRange(obra._row, col('DataPublicacao')).setValue(nowIso_());
  }
  obra.DataPublicacao = obra.DataPublicacao || nowIso_();
  invalidarCacheObras_();

  const link = linkObra_(id);
  return { ok: true, link: link, mensagemGrupo: montarMensagemGrupo_(obra, link) };
}

// Somente leitura — não altera Status. Use para reobter o texto/link
// de uma obra já publicada (botão "copiar mensagem" no painel).
function apiMensagemGrupo(token, id) {
  validarToken_(token);
  const obra = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(o => o.ID === id);
  if (!obra) throw new Error('Obra não encontrada.');
  const link = linkObra_(id);
  return { ok: true, link: link, mensagemGrupo: montarMensagemGrupo_(obra, link) };
}

function montarMensagemGrupo_(obra, link) {
  const prazoBr = isoToBr_(obra.PrazoManifestacao);
  return (
    '📋 *Nova obra publicada — ciência e manifestação*\n\n' +
    '*' + obra.Titulo + '* (' + obra.ID + ')\n' +
    'Local: ' + obra.Setor + '\n' +
    'Janela prevista: ' + isoToBr_(obra.DataInicio) + ' a ' + isoToBr_(obra.DataFim) + '\n\n' +
    '⏰ Prazo para manifestação das áreas: *' + prazoBr + '*\n' +
    'A ausência de manifestação até o prazo será registrada como ciência sem ressalvas.\n\n' +
    'Acesse, leia o escopo e posicione a sua área:\n' + link
  );
}

function apiMudarStatus(token, id, novoStatus) {
  validarToken_(token);
  // 'Manifestação encerrada' só via apiDecidirPrazo (justificativa
  // registrada); 'Cancelada' só via apiCancelarObra (Fase 5); 'Finalizado'
  // só via apiFinalizarObra (Encerramento, Fase 10).
  const permitidos = ['Rascunho', 'Publicada', 'Liberada', 'Em execução', 'Concluída'];
  if (permitidos.indexOf(novoStatus) < 0) throw new Error('Status inválido.');
  const sh = ss_().getSheetByName(SHEETS.OBRAS);
  const obra = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(o => o.ID === id);
  if (!obra) throw new Error('Obra não encontrada.');
  sh.getRange(obra._row, OBRAS_HEADERS.indexOf('Status') + 1).setValue(novoStatus);
  invalidarCacheObras_();
  return { ok: true };
}

// Cancelamento é uma saída paralela, alcançável de qualquer status
// anterior a 'Finalizado' — decisão de Engenharia/PMO, sempre com
// justificativa. Distinto de 'Manifestação encerrada' (que só fecha a
// janela de manifestação, a obra continua viva).
function apiCancelarObra(token, idObra, motivo) {
  const sessao = exigirPapel_(token, ['Engenharia', 'PMO']);
  const just = sanitize_(motivo, 2000);
  if (!just) throw new Error('Justifique o cancelamento.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const obra = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(o => o.ID === idObra);
    if (!obra) throw new Error('Obra não encontrada.');
    if (obra.Status === 'Cancelada') throw new Error('Esta obra já está cancelada.');
    if (obra.Status === 'Finalizado') throw new Error('Uma obra finalizada não pode ser cancelada.');
    const sh = ss_().getSheetByName(SHEETS.OBRAS);
    const col = (h) => OBRAS_HEADERS.indexOf(h) + 1;
    sh.getRange(obra._row, col('Status')).setValue('Cancelada');
    sh.getRange(obra._row, col('CanceladoPor')).setValue(sessao.nome + ' (' + sessao.papel + ')');
    sh.getRange(obra._row, col('DataCancelamento')).setValue(nowIso_());
    sh.getRange(obra._row, col('MotivoCancelamento')).setValue(just);
    invalidarCacheObras_();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ────────────────────────────────────────────── DECISÕES DE PRAZO ──

function apiDecidirPrazo(token, idObra, tipoDecisao, novoPrazo, justificativa) {
  const sessao = exigirPapel_(token, ['Engenharia', 'PMO']);
  if (TIPO_DECISAO_PRAZO.indexOf(tipoDecisao) < 0) throw new Error('Tipo de decisão inválido.');
  const just = sanitize_(justificativa, 2000);
  if (!just) throw new Error('Justifique a decisão.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const obra = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(o => o.ID === idObra);
    if (!obra) throw new Error('Obra não encontrada.');
    const prazoAnterior = obra.PrazoManifestacao;
    let prazoNovo = '';
    const sh = ss_().getSheetByName(SHEETS.OBRAS);
    const col = (h) => OBRAS_HEADERS.indexOf(h) + 1;
    if (tipoDecisao === 'Estender') {
      prazoNovo = sanitize_(novoPrazo, 20);
      if (!prazoNovo) throw new Error('Informe a nova data de prazo.');
      sh.getRange(obra._row, col('PrazoManifestacao')).setValue(prazoNovo);
    } else {
      sh.getRange(obra._row, col('Status')).setValue('Manifestação encerrada');
    }
    const doObra = readAll_(SHEETS.DECISOES_PRAZO, DECISOES_PRAZO_HEADERS).filter(d => d.IDObra === idObra).length;
    const decId = idObra + '-DP' + ('00' + (doObra + 1)).slice(-2);
    // decisão agora tem autoria nominal (sessão individual)
    ensureSheet_(ss_(), SHEETS.DECISOES_PRAZO, DECISOES_PRAZO_HEADERS).appendRow([
      decId, idObra, tipoDecisao, prazoAnterior, prazoNovo, just, sessao.nome + ' (' + sessao.papel + ')', nowIso_()
    ]);
    invalidarCacheObras_();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ────────────────────────────────────────────── PÚBLICA ──

function apiGetObraPublica(id) {
  // pico de acesso acontece logo após a publicação no grupo — 30s de cache
  // seguram a planilha; erros nunca são cacheados (throw antes do put)
  const cache = CacheService.getScriptCache();
  const cacheKey = 'pub_obra_' + id;
  const hit = cache.get(cacheKey);
  if (hit) return JSON.parse(hit);

  const obra = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(o => o.ID === id);
  if (!obra || obra.Status === 'Rascunho') {
    throw new Error('Obra não encontrada ou ainda não publicada.');
  }
  const cfg = getConfig_();
  const eap = readAll_(SHEETS.EAP, EAP_HEADERS)
    .filter(e => e.IDObra === id)
    .sort(compareEap_)
    .map(e => ({ IDItem: e.IDItem, Codigo: e.Codigo, Descricao: e.Descricao, NaturezaImpacto: e.NaturezaImpacto }));
  const manifs = readAll_(SHEETS.MANIF, MANIF_HEADERS).filter(m => m.IDObra === id);

  const pub = {};
  OBRAS_HEADERS.forEach(h => pub[h] = obra[h]);
  if (String(cfg.MOSTRAR_VALOR_PUBLICO).toUpperCase() !== 'SIM') {
    pub.ValorEstimado = '';
  }

  const resp = {
    obra: pub,
    eap: eap,
    areas: cfg._areas,
    totalManifestacoes: manifs.length,
    areasQueSePosicionaram: uniq_(manifs.map(m => m.Area)),
    instituicao: cfg.NOME_INSTITUICAO || 'Hospital da Baleia'
  };
  cache.put(cacheKey, JSON.stringify(resp), 30);
  return resp;
}

function apiManifestar(id, dados) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const obra = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(o => o.ID === id);
    if (!obra) throw new Error('Obra não encontrada.');
    if (obra.Status !== 'Publicada' && obra.Status !== 'Manifestação encerrada') {
      throw new Error('Esta obra não está aberta para manifestação (status: ' + obra.Status + ').');
    }

    const nome = sanitize_(dados.Nome, 120);
    const cargo = sanitize_(dados.Cargo, 120);
    let area = sanitize_(dados.Area, 120);
    const pos = sanitize_(dados.Posicionamento, 40);
    const posValidos = ['Ciente sem ressalvas', 'Ciente com ressalvas', 'Objeção', 'Área não impactada'];
    if (!nome || !cargo || !area) throw new Error('Preencha nome, cargo e área.');
    if (posValidos.indexOf(pos) < 0) throw new Error('Posicionamento inválido.');

    // "Outra" exige o nome digitado — vira a Área real desta manifestação
    // e entra na fila do PMO para virar opção oficial. Não bloqueia a
    // manifestação esperando aprovação.
    if (area === 'Outra') {
      const novaArea = sanitize_(dados.AreaNovaProposta, 120);
      if (!novaArea) throw new Error('Digite o nome da nova área.');
      area = novaArea;
      proporArea_(novaArea, nome, cargo, id);
    }
    if ((pos === 'Ciente com ressalvas' || pos === 'Objeção') && !sanitize_(dados.Manifestacao, 5000)) {
      throw new Error('Descreva a ressalva ou objeção no campo de manifestação.');
    }

    const extemporanea = prazoExpirado_(obra.PrazoManifestacao) || obra.Status === 'Manifestação encerrada';

    const sh = ss_().getSheetByName(SHEETS.MANIF);
    const idManif = id + '-M' + ('000' + (readAll_(SHEETS.MANIF, MANIF_HEADERS)
      .filter(m => m.IDObra === id).length + 1)).slice(-3);

    sh.appendRow([
      idManif, id, nowIso_(), nome, cargo, area, pos,
      sanitize_(dados.Manifestacao, 5000),
      sanitize_(dados.Requisitos, 3000),
      sanitize_(dados.ItensEAP, 500),
      extemporanea ? 'SIM' : 'NÃO'
    ]);
    CacheService.getScriptCache().remove('pub_obra_' + id);
    invalidarCacheObras_();

    return { ok: true, extemporanea: extemporanea };
  } finally {
    lock.releaseLock();
  }
}

// ────────────────────────────────────────────── ÁREAS PROPOSTAS ──

// Chamada de dentro de apiManifestar (pública, sem login) — nunca bloqueia
// a manifestação em andamento. Deduplica contra pendentes/aprovadas/oficiais.
function proporArea_(nome, propostoPor, cargoPropoente, idObraOrigem) {
  const existentes = readAll_(SHEETS.AREAS_PROP, AREAS_PROP_HEADERS);
  const nomeLower = nome.toLowerCase();
  const jaProposta = existentes.some(a =>
    a.Nome.toLowerCase() === nomeLower && (a.Status === 'Pendente' || a.Status === 'Aprovada'));
  if (jaProposta) return;
  const jaOficial = getConfig_()._areas.some(a => a.toLowerCase() === nomeLower);
  if (jaOficial) return;
  ensureSheet_(ss_(), SHEETS.AREAS_PROP, AREAS_PROP_HEADERS).appendRow([
    proximoId_('AP', SHEETS.AREAS_PROP, AREAS_PROP_HEADERS, 'ID'), nome, propostoPor, cargoPropoente, idObraOrigem,
    'Pendente', '', nowIso_(), ''
  ]);
}

// Qualquer papel logado vê a fila (PMO decide; Engenharia acompanha).
function apiListarAreasPropostas(token) {
  validarToken_(token);
  return readAll_(SHEETS.AREAS_PROP, AREAS_PROP_HEADERS)
    .filter(a => a.Status === 'Pendente')
    .reverse();
}

function apiDecidirAreaProposta(token, id, aprovar, observacoes) {
  exigirPMO_(token);
  const prop = readAll_(SHEETS.AREAS_PROP, AREAS_PROP_HEADERS).find(a => a.ID === id);
  if (!prop) throw new Error('Proposta não encontrada: ' + id);
  if (prop.Status !== 'Pendente') throw new Error('Esta proposta já foi decidida.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ss_().getSheetByName(SHEETS.AREAS_PROP);
    const col = (h) => AREAS_PROP_HEADERS.indexOf(h) + 1;
    const novoStatus = aprovar ? 'Aprovada' : 'Rejeitada';
    sh.getRange(prop._row, col('Status')).setValue(novoStatus);
    sh.getRange(prop._row, col('ObservacoesPMO')).setValue(sanitize_(observacoes, 1000));
    sh.getRange(prop._row, col('DecididoEm')).setValue(nowIso_());
    if (aprovar) {
      const cfgSheet = ss_().getSheetByName(SHEETS.CONFIG);
      const areasAtuais = getConfig_()._areas;
      if (!areasAtuais.some(a => a.toLowerCase() === prop.Nome.toLowerCase())) {
        cfgSheet.getRange(areasAtuais.length + 2, 4).setValue(prop.Nome);
      }
    }
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ────────────────────────────────────────────── ATAS (PULL PLANNING) ──

function apiCriarAta(token, idObra, dataReuniao, participantes, resumo) {
  const sessao = exigirPapel_(token, ['Engenharia', 'PMO']);
  const obra = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(o => o.ID === idObra);
  if (!obra) throw new Error('Obra não encontrada.');
  const data = sanitize_(dataReuniao, 20);
  const part = sanitize_(participantes, 2000);
  const res = sanitize_(resumo, 5000);
  if (!data) throw new Error('Informe a data da reunião.');
  if (!part) throw new Error('Registre os participantes da reunião.');
  if (!res) throw new Error('Registre o resumo da reunião.');
  const doObra = readAll_(SHEETS.ATAS, ATAS_HEADERS).filter(a => a.IDObra === idObra).length;
  const id = idObra + '-AT' + ('00' + (doObra + 1)).slice(-2);
  ensureSheet_(ss_(), SHEETS.ATAS, ATAS_HEADERS).appendRow([
    id, idObra, 'Pull Planning', data, part, res, sessao.nome, nowIso_()
  ]);
  return { ok: true, id: id };
}

// ────────────────────────────────────────────── REQUISITOS ──

function apiCriarRequisito(token, idObra, idManif, descricao, responsavel) {
  validarToken_(token);
  const desc = sanitize_(descricao, 3000);
  if (!desc) throw new Error('Descrição do requisito vazia.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const obra = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(o => o.ID === idObra);
    if (!obra) throw new Error('Obra não encontrada: ' + idObra);
    const existentes = readAll_(SHEETS.REQUISITOS, REQUISITOS_HEADERS);
    const manifId = sanitize_(idManif, 30);
    if (manifId && existentes.some(r => r.IDManifOrigem === manifId)) {
      throw new Error('Esta manifestação já tem um requisito rastreado.');
    }
    const doObra = existentes.filter(r => r.IDObra === idObra).length;
    const id = idObra + '-R' + ('00' + (doObra + 1)).slice(-2);
    ensureSheet_(ss_(), SHEETS.REQUISITOS, REQUISITOS_HEADERS).appendRow([
      id, idObra, manifId, desc,
      sanitize_(responsavel, 120),
      'Pendente', '', '', nowIso_(), nowIso_()
    ]);
    return { ok: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

function apiAtualizarRequisito(token, idRequisito, novoStatus, observacoes) {
  validarToken_(token);
  if (REQUISITO_STATUS.indexOf(novoStatus) < 0) throw new Error('Status de requisito inválido.');
  const req = readAll_(SHEETS.REQUISITOS, REQUISITOS_HEADERS).find(r => r.ID === idRequisito);
  if (!req) throw new Error('Requisito não encontrado: ' + idRequisito);
  const sh = ss_().getSheetByName(SHEETS.REQUISITOS);
  const col = (h) => REQUISITOS_HEADERS.indexOf(h) + 1;
  sh.getRange(req._row, col('Status')).setValue(novoStatus);
  sh.getRange(req._row, col('DataResolucao')).setValue(novoStatus === 'Pendente' ? '' : nowIso_());
  if (observacoes != null && sanitize_(observacoes, 2000)) {
    sh.getRange(req._row, col('Observacoes')).setValue(sanitize_(observacoes, 2000));
  }
  sh.getRange(req._row, col('AtualizadoEm')).setValue(nowIso_());
  return { ok: true };
}
