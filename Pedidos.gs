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
  return comLock_(() => {
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
  });
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
  const id = idPedido + '-H' + largura_(n + 1, 2);
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
  return comLock_(() => {
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
    atualizarCampos_(SHEETS.PEDIDOS, PEDIDOS_HEADERS, pedido._row, { Status: 'Em análise', AtualizadoEm: nowIso_() });
    // invalida o cache público para o re-render já mostrar o novo status
    cacheRemover_('pub_ped_' + id + '_' + token);
    invalidarCachePedidos_();
    return { ok: true };
  });
}

// Cancelamento é do próprio solicitante, via link de acompanhamento — só
// possível enquanto o pedido ainda está em análise (uma vez Aceito, virou
// obra e cancela por lá; Recusado/Cancelado já são estados finais).
function apiCancelarPedido(id, token, motivo) {
  return comLock_(() => {
    const pedido = readAll_(SHEETS.PEDIDOS, PEDIDOS_HEADERS).find(p => p.ID === id);
    if (!pedido || !token || pedido.Token !== token) {
      throw new Error('Pedido não encontrado ou link de acompanhamento inválido.');
    }
    const cancelaveis = ['Novo', 'Em análise', 'Aguardando mais informações'];
    if (cancelaveis.indexOf(pedido.Status) < 0) {
      throw new Error('Este pedido não pode mais ser cancelado (status atual: ' + pedido.Status + ').');
    }
    const just = sanitize_(motivo, 1000);
    atualizarCampos_(SHEETS.PEDIDOS, PEDIDOS_HEADERS, pedido._row, {
      Status: 'Cancelado', AtualizadoEm: nowIso_(),
      CanceladoPor: pedido.Nome, DataCancelamento: nowIso_(), MotivoCancelamento: just
    });
    appendHistorico_(id, 'Solicitante', 'Pedido cancelado pelo solicitante.' + (just ? ' Motivo: ' + just : ''), '');
    cacheRemover_('pub_ped_' + id + '_' + token);
    invalidarCachePedidos_();
    return { ok: true };
  });
}

function apiGetPedidoStatus(id, token) {
  // token na chave: só respostas de token válido chegam ao put (erro faz throw antes)
  const cacheKey = 'pub_ped_' + id + '_' + token;
  const hit = cacheLer_(cacheKey);
  if (hit) return hit;

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
  cacheGravar_(cacheKey, resp, 30);
  return resp;
}

// ────────────────────────────────────────────── ADMIN ──

// Lista cacheada por 2 min (invalidada em toda escrita) — clicar em
// "Pedidos" repetidas vezes não relê a planilha inteira a cada vez.
const CACHE_LISTA_PEDIDOS = 'admin_pedidos_lista_v1';
function invalidarCachePedidos_() {
  cacheRemover_(CACHE_LISTA_PEDIDOS);
}

function apiListarPedidos(token) {
  exigir_(token, 'pedidos', 'ler');
  const hit = cacheLer_(CACHE_LISTA_PEDIDOS);
  if (hit) return hit;
  const lista = readAll_(SHEETS.PEDIDOS, PEDIDOS_HEADERS)
    .map(p => ({
      ID: p.ID, Nome: p.Nome, Cargo: p.Cargo, Area: p.Area, SetorDesejado: p.SetorDesejado,
      Urgencia: p.Urgencia, Status: p.Status, CriadoEm: p.CriadoEm,
      Finalidade: String(p.FinalidadeObjetivo || '').slice(0, 200)
    }))
    .reverse();
  cacheGravar_(CACHE_LISTA_PEDIDOS, lista, 120);
  return lista;
}

function apiGetPedidoAdmin(token, id) {
  exigir_(token, 'pedidos', 'ler');
  const pedido = readAll_(SHEETS.PEDIDOS, PEDIDOS_HEADERS).find(p => p.ID === id);
  if (!pedido) throw new Error('Pedido não encontrado: ' + id);
  return {
    pedido: pedido,
    linkAcompanhamento: linkAcompanhamentoPedido_(id, pedido.Token),
    historico: historicoDoPedido_(id)
  };
}

function apiLinkNovoPedido(token) {
  exigir_(token, 'pedidos', 'ler');
  return { link: linkNovoPedido_() };
}

function apiAtualizarStatusPedido(token, id, novoStatus, observacoes) {
  exigir_(token, 'pedidos', 'editar');
  // 'Cancelado' fica fora deste endpoint de propósito — cancelamento tem
  // fluxo próprio com justificativa obrigatória (Fase 5), mesmo princípio
  // que já isola 'Manifestação encerrada' em Obras.
  const permitidos = ['Novo', 'Em análise', 'Aguardando mais informações', 'Aceito', 'Recusado'];
  if (permitidos.indexOf(novoStatus) < 0) throw new Error('Status inválido.');
  const obs = sanitize_(observacoes, 2000);
  const pedido = comLock_(() => {
    const p = readAll_(SHEETS.PEDIDOS, PEDIDOS_HEADERS).find(x => x.ID === id);
    if (!p) throw new Error('Pedido não encontrado.');
    if (p.Status === 'Cancelado') throw new Error('Pedido cancelado pelo solicitante não muda mais de status.');
    atualizarCampos_(SHEETS.PEDIDOS, PEDIDOS_HEADERS, p._row, {
      Status: novoStatus, ObservacoesEngenharia: obs, AtualizadoEm: nowIso_()
    });
    // Autor agora é nominal (sessão individual), não mais o papel genérico —
    // primeiro ganho concreto do login por pessoa.
    if (obs) appendHistorico_(id, 'Engenharia', obs, '');
    return p;
  });
  // invalida o cache público para o solicitante ver o novo status sem esperar o TTL
  cacheRemover_('pub_ped_' + id + '_' + pedido.Token);
  invalidarCachePedidos_();
  return { ok: true };
}

// Monta o pré-preenchimento do formulário de Nova Obra a partir de um
// pedido aceito. Não cria a obra sozinho — devolve os dados para o admin
// revisar/completar (EAP, datas, impactos) antes de salvar de fato.
function apiPedidoParaObraContexto(token, id) {
  exigir_(token, 'projetos', 'editar');
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
  exigir_(token, 'pedidos', 'editar');
  const pedido = comLock_(() => {
    const p = readAll_(SHEETS.PEDIDOS, PEDIDOS_HEADERS).find(x => x.ID === idPedido);
    if (!p) throw new Error('Pedido não encontrado.');
    if (!readAll_(SHEETS.OBRAS, OBRAS_HEADERS).some(o => o.ID === idObra)) throw new Error('Obra não encontrada: ' + idObra);
    atualizarCampos_(SHEETS.PEDIDOS, PEDIDOS_HEADERS, p._row, { Status: 'Aceito', IDObraGerada: idObra, AtualizadoEm: nowIso_() });
    return p;
  });
  cacheRemover_('pub_ped_' + idPedido + '_' + pedido.Token);
  invalidarCachePedidos_();
  return { ok: true };
}
