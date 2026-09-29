/**
 * Pedidos — porta de entrada do sistema. Qualquer área solicita a obra à
 * engenharia pelo link fixo "?novopedido=1" (público, sem login, como a
 * manifestação). Cada pedido recebe um token aleatório; o link de
 * acompanhamento (?pedido=ID&tk=TOKEN) só funciona com o token correto.
 *
 * Portado 1:1 do Code.gs do sistema atual — única mudança estrutural:
 * as APIs administrativas recebem `token` de sessão (Auth.gs) no lugar
 * do `pin` compartilhado.
 */

// ────────────────────────────────────────────── PÚBLICA ──

function apiCriarPedido(dados) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // honeypot anti-spam: campo invisível que só um robô preencheria
    if (sanitize_(dados._hp, 50)) {
      return { ok: true, id: 'PED-0000-000', token: '', linkAcompanhamento: '' };
    }

    const nome = sanitize_(dados.Nome, 120);
    const cargo = sanitize_(dados.Cargo, 120);
    const contato = sanitize_(dados.Contato, 150);
    const area = sanitize_(dados.Area, 120);
    const finalidade = sanitize_(dados.FinalidadeObjetivo, 3000);
    const urgencia = sanitize_(dados.Urgencia, 60);

    if (!nome || !cargo || !contato || !area) {
      throw new Error('Preencha nome, cargo, contato e área.');
    }
    if (!finalidade) throw new Error('Descreva a finalidade/objetivo da obra.');
    if (URGENCIA_OPCOES.indexOf(urgencia) < 0) throw new Error('Selecione a urgência.');

    const id = proximoId_('PED', SHEETS.PEDIDOS, PEDIDOS_HEADERS, 'ID');
    const token = Utilities.getUuid();
    const sh = ensureSheet_(ss_(), SHEETS.PEDIDOS, PEDIDOS_HEADERS);

    sh.appendRow([
      id, token,
      nome, cargo, contato, area,
      sanitize_(dados.SuperintendenciaGestora, 150), sanitize_(dados.CentroCusto, 100),
      sanitize_(dados.SetorDesejado, 120),
      finalidade, sanitize_(dados.Ambientes, 2000), sanitize_(dados.Equipamentos, 2000),
      sanitize_(dados.PopulacaoEstimada, 500),
      urgencia, sanitize_(dados.DataDesejada, 20), sanitize_(dados.JustificativaUrgencia, 1000),
      sanitize_(dados.Anexos, 500),
      'Novo', '', '',
      '', '', // reservado: aprovação da diretoria (futuro)
      nowIso_(), nowIso_(),
      '', '', '' // CanceladoPor / DataCancelamento / MotivoCancelamento
    ]);

    invalidarCachePedidos_();
    return { ok: true, id: id, token: token, linkAcompanhamento: linkAcompanhamentoPedido_(id, token) };
  } finally {
    lock.releaseLock();
  }
}

// Contexto público para o formulário de novo pedido — busca as listas de
// áreas/setores da aba Config, para não duplicar essas listas no front-end
// e ficarem dessincronizadas quando alguém editar a Config.
function apiContextoPedido() {
  const cfg = getConfig_();
  return { areas: cfg._areas, setores: cfg._setores };
}

function appendHistorico_(idPedido, autor, texto, linkEvidencia) {
  const sh = ensureSheet_(ss_(), SHEETS.PEDIDO_HIST, PEDIDO_HIST_HEADERS);
  const n = readAll_(SHEETS.PEDIDO_HIST, PEDIDO_HIST_HEADERS)
    .filter(h => h.IDPedido === idPedido).length;
  const id = idPedido + '-H' + ('00' + (n + 1)).slice(-2);
  sh.appendRow([id, idPedido, autor, texto, linkEvidencia || '', nowIso_()]);
  return id;
}

function historicoDoPedido_(idPedido) {
  return readAll_(SHEETS.PEDIDO_HIST, PEDIDO_HIST_HEADERS)
    .filter(h => h.IDPedido === idPedido)
    .sort((a, b) => String(a.CriadoEm).localeCompare(String(b.CriadoEm)))
    .map(h => ({ ID: h.ID, Autor: h.Autor, Texto: h.Texto, LinkEvidencia: h.LinkEvidencia, CriadoEm: h.CriadoEm }));
}

// Resposta do solicitante quando a Engenharia pediu mais informações.
// Valida o token como apiGetPedidoStatus e devolve o pedido para análise.
function apiResponderPedido(id, token, texto, linkEvidencia) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const pedido = readAll_(SHEETS.PEDIDOS, PEDIDOS_HEADERS).find(p => p.ID === id);
    if (!pedido || !token || pedido.Token !== token) {
      throw new Error('Pedido não encontrado ou link de acompanhamento inválido.');
    }
    if (pedido.Status !== 'Aguardando mais informações') {
      throw new Error('Este pedido não está aguardando resposta (status: ' + pedido.Status + ').');
    }
    const txt = sanitize_(texto, 3000);
    if (!txt) throw new Error('Escreva a resposta antes de enviar.');
    const link = sanitize_(linkEvidencia, 500);
    if (link && !/^https?:\/\//i.test(link)) {
      throw new Error('O link de evidência deve começar com http:// ou https://');
    }

    appendHistorico_(id, 'Solicitante', txt, link);
    const sh = ss_().getSheetByName(SHEETS.PEDIDOS);
    const col = (h) => PEDIDOS_HEADERS.indexOf(h) + 1;
    sh.getRange(pedido._row, col('Status')).setValue('Em análise');
    sh.getRange(pedido._row, col('AtualizadoEm')).setValue(nowIso_());
    // invalida o cache público para o re-render já mostrar o novo status
    CacheService.getScriptCache().remove('pub_ped_' + id + '_' + token);
    invalidarCachePedidos_();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// Cancelamento é do próprio solicitante, via link de acompanhamento — só
// possível enquanto o pedido ainda está em análise (uma vez Aceito, virou
// obra e cancela por lá; Recusado/Cancelado já são estados finais).
function apiCancelarPedido(id, token, motivo) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const pedido = readAll_(SHEETS.PEDIDOS, PEDIDOS_HEADERS).find(p => p.ID === id);
    if (!pedido || !token || pedido.Token !== token) {
      throw new Error('Pedido não encontrado ou link de acompanhamento inválido.');
    }
    const cancelaveis = ['Novo', 'Em análise', 'Aguardando mais informações'];
    if (cancelaveis.indexOf(pedido.Status) < 0) {
      throw new Error('Este pedido não pode mais ser cancelado (status atual: ' + pedido.Status + ').');
    }
    const just = sanitize_(motivo, 1000);
    const sh = ss_().getSheetByName(SHEETS.PEDIDOS);
    const col = (h) => PEDIDOS_HEADERS.indexOf(h) + 1;
    sh.getRange(pedido._row, col('Status')).setValue('Cancelado');
    sh.getRange(pedido._row, col('CanceladoPor')).setValue(pedido.Nome);
    sh.getRange(pedido._row, col('DataCancelamento')).setValue(nowIso_());
    sh.getRange(pedido._row, col('MotivoCancelamento')).setValue(just);
    sh.getRange(pedido._row, col('AtualizadoEm')).setValue(nowIso_());
    appendHistorico_(id, 'Solicitante', 'Pedido cancelado pelo solicitante.' + (just ? ' Motivo: ' + just : ''), '');
    CacheService.getScriptCache().remove('pub_ped_' + id + '_' + token);
    invalidarCachePedidos_();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function apiGetPedidoStatus(id, token) {
  // token na chave: só respostas de token válido chegam ao put (erro faz throw antes)
  const cache = CacheService.getScriptCache();
  const cacheKey = 'pub_ped_' + id + '_' + token;
  const hit = cache.get(cacheKey);
  if (hit) return JSON.parse(hit);

  const pedido = readAll_(SHEETS.PEDIDOS, PEDIDOS_HEADERS).find(p => p.ID === id);
  if (!pedido || !token || pedido.Token !== token) {
    throw new Error('Pedido não encontrado ou link de acompanhamento inválido.');
  }
  let obraLink = '';
  if (pedido.IDObraGerada) obraLink = linkObra_(pedido.IDObraGerada);
  const resp = {
    ID: pedido.ID, Nome: pedido.Nome, Area: pedido.Area,
    FinalidadeObjetivo: pedido.FinalidadeObjetivo, SetorDesejado: pedido.SetorDesejado,
    Urgencia: pedido.Urgencia, Status: pedido.Status,
    ObservacoesEngenharia: pedido.ObservacoesEngenharia,
    IDObraGerada: pedido.IDObraGerada, linkObra: obraLink,
    CriadoEm: pedido.CriadoEm, AtualizadoEm: pedido.AtualizadoEm,
    historico: historicoDoPedido_(id)
  };
  cache.put(cacheKey, JSON.stringify(resp), 30);
  return resp;
}

// ────────────────────────────────────────────── ADMIN ──

// Lista cacheada por 2 min (invalidada em toda escrita) — clicar em
// "Pedidos" repetidas vezes não relê a planilha inteira a cada vez.
const CACHE_LISTA_PEDIDOS = 'admin_pedidos_lista_v1';
function invalidarCachePedidos_() {
  CacheService.getScriptCache().remove(CACHE_LISTA_PEDIDOS);
}

function apiListarPedidos(token) {
  validarToken_(token);
  const cache = CacheService.getScriptCache();
  const hit = cache.get(CACHE_LISTA_PEDIDOS);
  if (hit) return JSON.parse(hit);
  const lista = readAll_(SHEETS.PEDIDOS, PEDIDOS_HEADERS)
    .map(p => ({
      ID: p.ID, Nome: p.Nome, Cargo: p.Cargo, Area: p.Area, SetorDesejado: p.SetorDesejado,
      Urgencia: p.Urgencia, Status: p.Status, CriadoEm: p.CriadoEm,
      Finalidade: String(p.FinalidadeObjetivo || '').slice(0, 200)
    }))
    .reverse();
  cache.put(CACHE_LISTA_PEDIDOS, JSON.stringify(lista), 120);
  return lista;
}

function apiGetPedidoAdmin(token, id) {
  validarToken_(token);
  const pedido = readAll_(SHEETS.PEDIDOS, PEDIDOS_HEADERS).find(p => p.ID === id);
  if (!pedido) throw new Error('Pedido não encontrado: ' + id);
  return {
    pedido: pedido,
    linkAcompanhamento: linkAcompanhamentoPedido_(id, pedido.Token),
    historico: historicoDoPedido_(id)
  };
}

function apiLinkNovoPedido(token) {
  validarToken_(token);
  return { link: linkNovoPedido_() };
}

function apiAtualizarStatusPedido(token, id, novoStatus, observacoes) {
  const sessao = validarToken_(token);
  // 'Cancelado' fica fora deste endpoint de propósito — cancelamento tem
  // fluxo próprio com justificativa obrigatória (Fase 5), mesmo princípio
  // que já isola 'Manifestação encerrada' em Obras.
  const permitidos = ['Novo', 'Em análise', 'Aguardando mais informações', 'Aceito', 'Recusado'];
  if (permitidos.indexOf(novoStatus) < 0) throw new Error('Status inválido.');
  const sh = ss_().getSheetByName(SHEETS.PEDIDOS);
  const pedido = readAll_(SHEETS.PEDIDOS, PEDIDOS_HEADERS).find(p => p.ID === id);
  if (!pedido) throw new Error('Pedido não encontrado.');
  const col = (h) => PEDIDOS_HEADERS.indexOf(h) + 1;
  const obs = sanitize_(observacoes, 2000);
  sh.getRange(pedido._row, col('Status')).setValue(novoStatus);
  sh.getRange(pedido._row, col('ObservacoesEngenharia')).setValue(obs);
  sh.getRange(pedido._row, col('AtualizadoEm')).setValue(nowIso_());
  // Autor agora é nominal (sessão individual), não mais o papel genérico —
  // primeiro ganho concreto do login por pessoa.
  if (obs) appendHistorico_(id, 'Engenharia', obs, '');
  // invalida o cache público para o solicitante ver o novo status sem esperar o TTL
  CacheService.getScriptCache().remove('pub_ped_' + id + '_' + pedido.Token);
  invalidarCachePedidos_();
  return { ok: true };
}

// Monta o pré-preenchimento do formulário de Nova Obra a partir de um
// pedido aceito. Não cria a obra sozinho — devolve os dados para o admin
// revisar/completar (EAP, datas, impactos) antes de salvar de fato.
function apiPedidoParaObraContexto(token, id) {
  validarToken_(token);
  const pedido = readAll_(SHEETS.PEDIDOS, PEDIDOS_HEADERS).find(p => p.ID === id);
  if (!pedido) throw new Error('Pedido não encontrado.');

  const partesDescricao = [];
  if (pedido.Ambientes) partesDescricao.push('Ambientes desejados: ' + pedido.Ambientes);
  if (pedido.Equipamentos) partesDescricao.push('Equipamentos: ' + pedido.Equipamentos);
  if (pedido.PopulacaoEstimada) partesDescricao.push('População estimada: ' + pedido.PopulacaoEstimada);

  return {
    IDPedidoOrigem: pedido.ID,
    Titulo: pedido.FinalidadeObjetivo.slice(0, 140),
    Descricao: partesDescricao.join('\n'),
    Justificativa: pedido.FinalidadeObjetivo,
    OrigemDemanda: 'Demanda assistencial',
    Setor: pedido.SetorDesejado,
    RestricoesCalendario: pedido.JustificativaUrgencia ||
      (pedido.DataDesejada ? 'Data desejada pelo solicitante: ' + pedido.DataDesejada : ''),
    LinkPlanta: /^https?:\/\//i.test(pedido.Anexos || '') ? pedido.Anexos : ''
  };
}

// Vincula definitivamente um pedido à obra que foi criada a partir dele —
// chamado depois que o admin salva a Nova Obra pré-preenchida.
function apiVincularPedidoObra(token, idPedido, idObra) {
  validarToken_(token);
  const sh = ss_().getSheetByName(SHEETS.PEDIDOS);
  const pedido = readAll_(SHEETS.PEDIDOS, PEDIDOS_HEADERS).find(p => p.ID === idPedido);
  if (!pedido) throw new Error('Pedido não encontrado.');
  const col = (h) => PEDIDOS_HEADERS.indexOf(h) + 1;
  sh.getRange(pedido._row, col('Status')).setValue('Aceito');
  sh.getRange(pedido._row, col('IDObraGerada')).setValue(idObra);
  sh.getRange(pedido._row, col('AtualizadoEm')).setValue(nowIso_());
  invalidarCachePedidos_();
  return { ok: true };
}
