/**
 * Obras — TAP 5W2H, EAP, publicação, manifestação, requisitos, áreas
 * propostas, decisões de prazo e atas. Portado 1:1 do Code.gs do sistema
 * atual; mudanças estruturais: sessão por token (Auth.gs) no lugar do
 * PIN, cache da lista admin (mesmo padrão de Pedidos.gs).
 */

const CACHE_LISTA_OBRAS = 'admin_obras_lista_v1';
function invalidarCacheObras_() {
  cacheRemover_(CACHE_LISTA_OBRAS);
}

function apiListarObras(token) {
  exigir_(token, 'projetos', 'ler');
  const hit = cacheLer_(CACHE_LISTA_OBRAS);
  if (hit) return hit;
  prepararAbas_([SHEETS.OBRAS, SHEETS.MANIF, SHEETS.CRONOGRAMA]);

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
  cacheGravar_(CACHE_LISTA_OBRAS, lista, 120);
  return lista;
}

function apiGetObraAdmin(token, id) {
  exigir_(token, 'projetos', 'ler');
  prepararAbas_([SHEETS.OBRAS, SHEETS.EAP, SHEETS.MANIF, SHEETS.REQUISITOS, SHEETS.DECISOES_PRAZO,
    SHEETS.ATAS, SHEETS.ETAPAS, SHEETS.CRONOGRAMA, SHEETS.RISCOS, SHEETS.RESTRICOES,
    SHEETS.RESTRICOES_EVIDENCIAS, SHEETS.USUARIOS]);
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
    responsaveis: usuariosComPermissao_('minhas', 'editar')
      .map(u => ({ ID: u.ID, Nome: u.Nome }))
  };
}

function apiNovaObraContexto(token) {
  exigir_(token, 'projetos', 'editar');
  const cfg = getConfig_();
  return {
    areas: cfg._areas, setores: cfg._setores,
    prazoDiasUteis: parseInt(cfg.PRAZO_DIAS_UTEIS, 10) || 5
  };
}

function apiSalvarObra(token, dados, eapItens) {
  exigir_(token, 'projetos', 'editar');
  dados = dados || {};
  const linkPlanta = sanitize_(dados.LinkPlanta, 500);
  if (linkPlanta && !/^https?:\/\//i.test(linkPlanta)) {
    throw new Error('O link do croqui/planta deve começar com http:// ou https://');
  }
  return comLock_(() => {
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
  });
}

// Grava a EAP de UMA obra: só as linhas dessa obra são escritas, as das
// outras obras não são tocadas (ver substituirLinhasDe_). Sempre chamada
// dentro do lock de apiSalvarObra.
function salvarEap_(idObra, itens) {
  const novas = itens
    .filter(it => sanitize_(it.Codigo, 20) && sanitize_(it.Descricao, 300))
    .map((it, i) => [
      idObra + '-E' + largura_(i + 1, 2),
      idObra,
      sanitize_(it.Codigo, 20),
      sanitize_(it.Descricao, 300),
      sanitize_(it.NaturezaImpacto, 200)
    ]);
  substituirLinhasDe_(SHEETS.EAP, EAP_HEADERS, 'IDObra', idObra, novas);
}

function apiPublicarObra(token, id) {
  exigir_(token, 'projetos', 'editar');
  const obra = comLock_(() => {
    const o = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(x => x.ID === id);
    if (!o) throw new Error('Obra não encontrada.');
    if (!o.PrazoManifestacao) throw new Error('Defina o prazo de manifestação antes de publicar.');
    if (['Cancelada', 'Finalizado'].indexOf(o.Status) >= 0) throw new Error('Obra ' + o.Status.toLowerCase() + ' não pode ser publicada.');
    o.DataPublicacao = o.DataPublicacao || nowIso_();
    atualizarCampos_(SHEETS.OBRAS, OBRAS_HEADERS, o._row, { Status: 'Publicada', DataPublicacao: o.DataPublicacao });
    return o;
  });
  invalidarCacheObras_();
  cacheRemover_('pub_obra_' + id);

  const link = linkObra_(id);
  return { ok: true, link: link, mensagemGrupo: montarMensagemGrupo_(obra, link) };
}

// Somente leitura — não altera Status. Use para reobter o texto/link
// de uma obra já publicada (botão "copiar mensagem" no painel).
function apiMensagemGrupo(token, id) {
  exigir_(token, 'projetos', 'ler');
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
  exigir_(token, 'projetos', 'editar');
  // 'Manifestação encerrada' só via apiDecidirPrazo (justificativa
  // registrada); 'Cancelada' só via apiCancelarObra (Fase 5); 'Finalizado'
  // só via apiFinalizarObra (Encerramento, Fase 10).
  const permitidos = ['Rascunho', 'Publicada', 'Liberada', 'Em execução', 'Concluída'];
  if (permitidos.indexOf(novoStatus) < 0) throw new Error('Status inválido.');
  comLock_(() => {
    const obra = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(o => o.ID === id);
    if (!obra) throw new Error('Obra não encontrada.');
    if (['Cancelada', 'Finalizado'].indexOf(obra.Status) >= 0) {
      throw new Error('Obra ' + obra.Status.toLowerCase() + ' não muda mais de status.');
    }
    atualizarCampos_(SHEETS.OBRAS, OBRAS_HEADERS, obra._row, { Status: novoStatus, AtualizadoEm: nowIso_() });
  });
  invalidarCacheObras_();
  cacheRemover_('pub_obra_' + id);
  return { ok: true };
}

// Cancelamento é uma saída paralela, alcançável de qualquer status
// anterior a 'Finalizado' — decisão de Engenharia/PMO, sempre com
// justificativa. Distinto de 'Manifestação encerrada' (que só fecha a
// janela de manifestação, a obra continua viva).
function apiCancelarObra(token, idObra, motivo) {
  const sessao = exigir_(token, 'projetos', 'cancelar');
  const just = sanitize_(motivo, 2000);
  if (!just) throw new Error('Justifique o cancelamento.');
  return comLock_(() => {
    const obra = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(o => o.ID === idObra);
    if (!obra) throw new Error('Obra não encontrada.');
    if (obra.Status === 'Cancelada') throw new Error('Esta obra já está cancelada.');
    if (obra.Status === 'Finalizado') throw new Error('Uma obra finalizada não pode ser cancelada.');
    atualizarCampos_(SHEETS.OBRAS, OBRAS_HEADERS, obra._row, {
      Status: 'Cancelada', CanceladoPor: sessao.nome + ' (' + sessao.papel + ')',
      DataCancelamento: nowIso_(), MotivoCancelamento: just
    });
    invalidarCacheObras_();
    cacheRemover_('pub_obra_' + idObra);
    return { ok: true };
  });
}

// ────────────────────────────────────────────── DECISÕES DE PRAZO ──

function apiDecidirPrazo(token, idObra, tipoDecisao, novoPrazo, justificativa) {
  const sessao = exigir_(token, 'projetos', 'editar');
  if (TIPO_DECISAO_PRAZO.indexOf(tipoDecisao) < 0) throw new Error('Tipo de decisão inválido.');
  const just = sanitize_(justificativa, 2000);
  if (!just) throw new Error('Justifique a decisão.');
  return comLock_(() => {
    const obra = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(o => o.ID === idObra);
    if (!obra) throw new Error('Obra não encontrada.');
    const prazoAnterior = obra.PrazoManifestacao;
    let prazoNovo = '';
    if (tipoDecisao === 'Estender') {
      prazoNovo = sanitize_(novoPrazo, 20);
      if (!prazoNovo) throw new Error('Informe a nova data de prazo.');
      atualizarCampos_(SHEETS.OBRAS, OBRAS_HEADERS, obra._row, { PrazoManifestacao: prazoNovo });
    } else {
      atualizarCampos_(SHEETS.OBRAS, OBRAS_HEADERS, obra._row, { Status: 'Manifestação encerrada' });
    }
    const doObra = readAll_(SHEETS.DECISOES_PRAZO, DECISOES_PRAZO_HEADERS).filter(d => d.IDObra === idObra).length;
    const decId = idObra + '-DP' + largura_(doObra + 1, 2);
    // decisão agora tem autoria nominal (sessão individual)
    ensureSheet_(ss_(), SHEETS.DECISOES_PRAZO, DECISOES_PRAZO_HEADERS).appendRow([
      decId, idObra, tipoDecisao, prazoAnterior, prazoNovo, just, sessao.nome + ' (' + sessao.papel + ')', nowIso_()
    ]);
    invalidarCacheObras_();
    cacheRemover_('pub_obra_' + idObra);
    return { ok: true };
  });
}

// ────────────────────────────────────────────── PÚBLICA ──

// Só estes campos da obra saem na página pública (?obra=). O resto
// (observações do PMO, cancelamento, vínculo com pedido, status do
// cronograma) é interno.
const CAMPOS_OBRA_PUBLICA = [
  'ID', 'Titulo', 'Descricao', 'Justificativa', 'OrigemDemanda', 'Setor', 'AreasAdjacentes', 'LinkPlanta',
  'DataInicio', 'DataFim', 'PrazoManifestacao', 'RestricoesCalendario',
  'ResponsavelNome', 'ResponsavelCargo', 'ResponsavelContato', 'Execucao', 'EmpresaContratada',
  'Impactos', 'DetalhamentoImpactos', 'HorarioTrabalho', 'ValorEstimado', 'FonteRecurso',
  'Status', 'DataPublicacao'
];

function apiGetObraPublica(id) {
  // pico de acesso acontece logo após a publicação no grupo — 30s de cache
  // seguram a planilha; erros nunca são cacheados (throw antes do put)
  const cacheKey = 'pub_obra_' + id;
  const hit = cacheLer_(cacheKey);
  if (hit) return hit;
  prepararAbas_([SHEETS.OBRAS, SHEETS.EAP, SHEETS.MANIF]);

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
  CAMPOS_OBRA_PUBLICA.forEach(h => pub[h] = obra[h]);
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
  cacheGravar_(cacheKey, resp, 30);
  return resp;
}

function apiManifestar(id, dados) {
  return comLock_(() => {
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
    const idManif = id + '-M' + largura_(readAll_(SHEETS.MANIF, MANIF_HEADERS)
      .filter(m => m.IDObra === id).length + 1, 3);

    sh.appendRow([
      idManif, id, nowIso_(), nome, cargo, area, pos,
      sanitize_(dados.Manifestacao, 5000),
      sanitize_(dados.Requisitos, 3000),
      sanitize_(dados.ItensEAP, 500),
      extemporanea ? 'SIM' : 'NÃO'
    ]);
    cacheRemover_('pub_obra_' + id);
    invalidarCacheObras_();

    return { ok: true, extemporanea: extemporanea };
  });
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
  exigir_(token, 'areas', 'ler');
  return readAll_(SHEETS.AREAS_PROP, AREAS_PROP_HEADERS)
    .filter(a => a.Status === 'Pendente')
    .reverse();
}

function apiDecidirAreaProposta(token, id, aprovar, observacoes) {
  exigirPMO_(token);
  return comLock_(() => {
    const prop = readAll_(SHEETS.AREAS_PROP, AREAS_PROP_HEADERS).find(a => a.ID === id);
    if (!prop) throw new Error('Proposta não encontrada: ' + id);
    if (prop.Status !== 'Pendente') throw new Error('Esta proposta já foi decidida.');
    atualizarCampos_(SHEETS.AREAS_PROP, AREAS_PROP_HEADERS, prop._row, {
      Status: aprovar ? 'Aprovada' : 'Rejeitada', ObservacoesPMO: sanitize_(observacoes, 1000), DecididoEm: nowIso_()
    });
    if (aprovar) {
      const cfgSheet = ss_().getSheetByName(SHEETS.CONFIG);
      const areasAtuais = getConfig_()._areas;
      if (!areasAtuais.some(a => a.toLowerCase() === prop.Nome.toLowerCase())) {
        cfgSheet.getRange(areasAtuais.length + 2, 4).setValue(prop.Nome);
      }
    }
    return { ok: true };
  });
}

// ────────────────────────────────────────────── ATAS (PULL PLANNING) ──

function apiCriarAta(token, idObra, dataReuniao, participantes, resumo) {
  const sessao = exigir_(token, 'projetos', 'editar');
  const data = sanitize_(dataReuniao, 20);
  const part = sanitize_(participantes, 2000);
  const res = sanitize_(resumo, 5000);
  if (!data) throw new Error('Informe a data da reunião.');
  if (!part) throw new Error('Registre os participantes da reunião.');
  if (!res) throw new Error('Registre o resumo da reunião.');
  return comLock_(() => {
    const obra = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(o => o.ID === idObra);
    if (!obra) throw new Error('Obra não encontrada.');
    const doObra = readAll_(SHEETS.ATAS, ATAS_HEADERS).filter(a => a.IDObra === idObra).length;
    const id = idObra + '-AT' + largura_(doObra + 1, 2);
    ensureSheet_(ss_(), SHEETS.ATAS, ATAS_HEADERS).appendRow([
      id, idObra, 'Pull Planning', data, part, res, sessao.nome, nowIso_()
    ]);
    return { ok: true, id: id };
  });
}

// ────────────────────────────────────────────── REQUISITOS ──

function apiCriarRequisito(token, idObra, idManif, descricao, responsavel) {
  exigir_(token, 'projetos', 'editar');
  const desc = sanitize_(descricao, 3000);
  if (!desc) throw new Error('Descrição do requisito vazia.');
  return comLock_(() => {
    const obra = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(o => o.ID === idObra);
    if (!obra) throw new Error('Obra não encontrada: ' + idObra);
    const existentes = readAll_(SHEETS.REQUISITOS, REQUISITOS_HEADERS);
    const manifId = sanitize_(idManif, 30);
    if (manifId && existentes.some(r => r.IDManifOrigem === manifId)) {
      throw new Error('Esta manifestação já tem um requisito rastreado.');
    }
    const doObra = existentes.filter(r => r.IDObra === idObra).length;
    const id = idObra + '-R' + largura_(doObra + 1, 2);
    ensureSheet_(ss_(), SHEETS.REQUISITOS, REQUISITOS_HEADERS).appendRow([
      id, idObra, manifId, desc,
      sanitize_(responsavel, 120),
      'Pendente', '', '', nowIso_(), nowIso_()
    ]);
    return { ok: true, id: id };
  });
}

function apiAtualizarRequisito(token, idRequisito, novoStatus, observacoes) {
  exigir_(token, 'projetos', 'editar');
  if (REQUISITO_STATUS.indexOf(novoStatus) < 0) throw new Error('Status de requisito inválido.');
  return comLock_(() => {
    const req = readAll_(SHEETS.REQUISITOS, REQUISITOS_HEADERS).find(r => r.ID === idRequisito);
    if (!req) throw new Error('Requisito não encontrado: ' + idRequisito);
    const campos = {
      Status: novoStatus,
      DataResolucao: novoStatus === 'Pendente' ? '' : nowIso_(),
      AtualizadoEm: nowIso_()
    };
    const obs = observacoes != null ? sanitize_(observacoes, 2000) : '';
    if (obs) campos.Observacoes = obs;
    atualizarCampos_(SHEETS.REQUISITOS, REQUISITOS_HEADERS, req._row, campos);
    return { ok: true };
  });
}
