/**
 * Restrições (Make Ready / Lookahead Planning) — impedimentos capturados
 * na criação de cada Pacote de Trabalho, revisados na janela móvel de 6
 * semanas até estarem liberados. Distinto de Riscos (Riscos.gs — risco
 * potencial futuro; Restrição é um bloqueio JÁ IDENTIFICADO que impede o
 * pacote de estar "pronto" pra execução — conceito do Last Planner System).
 * Status: Pendente → Em tratamento → Liberada (nunca pula direto de
 * Pendente pra Liberada sem passar por tratamento, mas o mover de status
 * é livre — quem decide o fluxo real é Engenharia/PMO).
 */
// Cache curto (120s) do agregado de portfólio do Lookahead — invalidado
// em toda escrita que afeta a lista (restrição em si ou suas evidências),
// já que todos os escritores vivem neste mesmo arquivo (invalidação
// barata e confiável, diferente do Kanban que agrega escritas de 4
// arquivos diferentes).
const CACHE_LOOKAHEAD = 'admin_lookahead_v1';
function invalidarCacheLookahead_() {
  cacheRemover_(CACHE_LOOKAHEAD);
}

function apiSalvarRestricao(token, dados) {
  const sessao = exigir_(token, 'execucao', 'editar');
  dados = dados || {};
  const idObra = sanitize_(dados.IDObra, 30);
  const idPacote = sanitize_(dados.IDPacote, 30);
  if (!idObra || !idPacote) throw new Error('Pacote de trabalho inválido — salve o pacote antes de cadastrar restrições.');
  const categoria = sanitize_(dados.Categoria, 60);
  if (CATEGORIAS_NAO_CUMPRIMENTO.indexOf(categoria) < 0) throw new Error('Selecione uma categoria válida.');
  const descricao = sanitize_(dados.Descricao, 1000);
  if (!descricao) throw new Error('Descreva a restrição.');

  return comLock_(() => {
    const sh = ensureSheet_(ss_(), SHEETS.RESTRICOES, RESTRICOES_HEADERS);
    const idInformado = sanitize_(dados.ID, 30);
    const todas = readAll_(SHEETS.RESTRICOES, RESTRICOES_HEADERS);
    const existente = idInformado ? todas.find(r => r.ID === idInformado) : null;
    const status = existente ? existente.Status : 'Pendente'; // status só muda via apiMoverRestricao

    const linha = [
      existente ? existente.ID : proximoId_('RESTR', SHEETS.RESTRICOES, RESTRICOES_HEADERS, 'ID'),
      idObra, idPacote, categoria, descricao,
      sanitize_(dados.ResponsavelNome, 120), sanitize_(dados.ResponsavelUserId, 30),
      sanitize_(dados.PrazoNecessario, 20), status,
      existente ? existente.CriadoPor : sessao.nome,
      existente ? existente.CriadoEm : nowIso_(),
      existente ? existente.LiberadoPor : '',
      existente ? existente.LiberadoEm : '',
      sanitize_(dados.Observacoes, 1000)
    ];
    if (existente) {
      sh.getRange(existente._row, 1, 1, RESTRICOES_HEADERS.length).setValues([linha]);
    } else {
      sh.getRange(sh.getLastRow() + 1, 1, 1, RESTRICOES_HEADERS.length).setValues([linha]);
    }
    const restricao = {};
    RESTRICOES_HEADERS.forEach((h, i) => restricao[h] = linha[i]);
    invalidarCacheLookahead_();
    return { ok: true, restricao: restricao };
  });
}

// Transição de status isolada (mesmo princípio de apiValidarCronograma/
// apiCancelarObra — mudanças de status significativas têm endpoint
// próprio, não ficam misturadas no salvar genérico). Só grava
// LiberadoPor/LiberadoEm ao ENTRAR em 'Liberada'; sair de 'Liberada' de
// volta pra outro status limpa esses campos, pra nunca ficar um registro
// "liberado por X" que na verdade foi reaberto depois.
function apiMoverRestricao(token, idRestricao, novoStatus) {
  const sessao = exigir_(token, 'execucao', 'editar');
  if (RESTRICAO_STATUS_OPCOES.indexOf(novoStatus) < 0) throw new Error('Status inválido.');
  return comLock_(() => {
    const restricao = readAll_(SHEETS.RESTRICOES, RESTRICOES_HEADERS).find(r => r.ID === idRestricao);
    if (!restricao) throw new Error('Restrição não encontrada.');
    const liberada = novoStatus === 'Liberada';
    atualizarCampos_(SHEETS.RESTRICOES, RESTRICOES_HEADERS, restricao._row, {
      Status: novoStatus,
      LiberadoPor: liberada ? sessao.nome : '',
      LiberadoEm: liberada ? nowIso_() : ''
    });
    invalidarCacheLookahead_();
    return { ok: true };
  });
}

function apiExcluirRestricao(token, idRestricao) {
  exigir_(token, 'execucao', 'excluir');
  return comLock_(() => {
    const restricao = readAll_(SHEETS.RESTRICOES, RESTRICOES_HEADERS).find(r => r.ID === idRestricao);
    if (!restricao) throw new Error('Restrição não encontrada.');
    ss_().getSheetByName(SHEETS.RESTRICOES).deleteRow(restricao._row);
    invalidarCacheLookahead_();
    return { ok: true };
  });
}

// ────────────────────────────────────────────── EVIDÊNCIAS DE SOLUÇÃO ──
// N arquivos por restrição (fotos/PDFs provando que o impedimento foi
// removido). Salvos direto no Drive — pasta "Evidências" ao lado da
// planilha (mesmo local de referência do backup, ver Backup.gs), com uma
// subpasta por obra pra não misturar evidências entre obras diferentes.

// Limite prático de payload do google.script.run (base64 tem ~33% de
// overhead sobre o binário) — 8MB decodificado cobre fotos/PDFs comuns
// sem arriscar timeout/erro de tamanho na chamada.
const TAMANHO_MAX_EVIDENCIA_BYTES = 8 * 1024 * 1024;

function pastaEvidencias_(idObra) {
  const arquivoPlanilha = DriveApp.getFileById(ss_().getId());
  const pais = arquivoPlanilha.getParents();
  const raiz = pais.hasNext() ? pais.next() : DriveApp.getRootFolder();
  const itRaiz = raiz.getFoldersByName('Evidências');
  const pastaRaiz = itRaiz.hasNext() ? itRaiz.next() : raiz.createFolder('Evidências');
  const itObra = pastaRaiz.getFoldersByName(idObra);
  return itObra.hasNext() ? itObra.next() : pastaRaiz.createFolder(idObra);
}

function apiUploadEvidenciaRestricao(token, idRestricao, nomeArquivo, mimeType, base64Data) {
  const sessao = exigir_(token, 'execucao', 'editar');
  const restricao = readAll_(SHEETS.RESTRICOES, RESTRICOES_HEADERS).find(r => r.ID === idRestricao);
  if (!restricao) throw new Error('Restrição não encontrada.');
  nomeArquivo = sanitize_(nomeArquivo, 180) || 'evidencia';
  mimeType = sanitize_(mimeType, 100) || 'application/octet-stream';
  if (!base64Data) throw new Error('Selecione um arquivo.');
  let bytes;
  try { bytes = Utilities.base64Decode(base64Data); }
  catch (e) { throw new Error('Arquivo inválido — tente novamente.'); }
  if (bytes.length > TAMANHO_MAX_EVIDENCIA_BYTES) throw new Error('Arquivo maior que 8MB — reduza o tamanho antes de enviar.');

  return comLock_(() => {
    const pasta = pastaEvidencias_(restricao.IDObra);
    const blob = Utilities.newBlob(bytes, mimeType, nomeArquivo);
    const arquivo = pasta.createFile(blob);
    const sh = ensureSheet_(ss_(), SHEETS.RESTRICOES_EVIDENCIAS, RESTRICOES_EVIDENCIAS_HEADERS);
    const linha = [
      proximoId_('EVID', SHEETS.RESTRICOES_EVIDENCIAS, RESTRICOES_EVIDENCIAS_HEADERS, 'ID'),
      idRestricao, restricao.IDObra, nomeArquivo, arquivo.getUrl(), arquivo.getId(),
      sessao.nome, nowIso_()
    ];
    sh.getRange(sh.getLastRow() + 1, 1, 1, RESTRICOES_EVIDENCIAS_HEADERS.length).setValues([linha]);
    const evidencia = {};
    RESTRICOES_EVIDENCIAS_HEADERS.forEach((h, i) => evidencia[h] = linha[i]);
    invalidarCacheLookahead_();
    return { ok: true, evidencia: evidencia };
  });
}

// Leitura leve de evidências de UMA restrição só — usado pelo modal de
// edição do Lookahead, que não carrega o cronograma inteiro da obra (like
// apiGetObraAdmin faz pra Cronograma.gs) só pra abrir 1 impedimento.
function apiListarEvidenciasRestricao(token, idRestricao) {
  exigir_(token, 'execucao', 'ler');
  return readAll_(SHEETS.RESTRICOES_EVIDENCIAS, RESTRICOES_EVIDENCIAS_HEADERS).filter(e => e.IDRestricao === idRestricao);
}

function apiExcluirEvidenciaRestricao(token, idEvidencia) {
  exigir_(token, 'execucao', 'excluir');
  return comLock_(() => {
    const evidencia = readAll_(SHEETS.RESTRICOES_EVIDENCIAS, RESTRICOES_EVIDENCIAS_HEADERS).find(e => e.ID === idEvidencia);
    if (!evidencia) throw new Error('Evidência não encontrada.');
    try { DriveApp.getFileById(evidencia.FileId).setTrashed(true); }
    catch (e) { /* arquivo já pode ter sido removido manualmente do Drive — não bloquear a exclusão do registro por isso */ }
    ss_().getSheetByName(SHEETS.RESTRICOES_EVIDENCIAS).deleteRow(evidencia._row);
    invalidarCacheLookahead_();
    return { ok: true };
  });
}

// ────────────────────────────────────────────── LOOKAHEAD ──

// Início (segunda-feira) da semana ISO que contém a data informada.
function inicioSemana_(d) {
  const dia = d.getDay(); // 0=domingo..6=sábado
  const offset = dia === 0 ? -6 : 1 - dia;
  const seg = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
  return seg;
}

// Janela móvel de 6 semanas a partir de hoje — pra cada semana, conta
// quantas restrições com PrazoNecessario caindo ali estão prontas
// (Liberada) vs. bloqueadas (Pendente/Em tratamento). Função pura
// (recebe "hoje" e a lista de restrições já lida) pra ser testável.
function janelaLookahead_(restricoes, hoje) {
  const inicioSem0 = inicioSemana_(hoje);
  const semanas = [];
  for (let i = 0; i < 6; i++) {
    const ini = new Date(inicioSem0.getFullYear(), inicioSem0.getMonth(), inicioSem0.getDate() + i * 7);
    const fim = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + 6);
    semanas.push({ indice: i, inicioIso: isoDoDate_(ini), fimIso: isoDoDate_(fim), prontas: 0, bloqueadas: 0 });
  }
  restricoes.forEach(r => {
    if (!r.PrazoNecessario) return;
    const idx = semanas.findIndex(s => r.PrazoNecessario >= s.inicioIso && r.PrazoNecessario <= s.fimIso);
    if (idx < 0) return; // fora da janela de 6 semanas — não entra na grade
    if (r.Status === 'Liberada') semanas[idx].prontas++;
    else semanas[idx].bloqueadas++;
  });
  return semanas;
}

function isoDoDate_(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function apiLookahead(token) {
  exigir_(token, 'execucao', 'ler');
  const hit = cacheLer_(CACHE_LOOKAHEAD);
  if (hit) return hit;
  prepararAbas_([SHEETS.RESTRICOES, SHEETS.OBRAS, SHEETS.CRONOGRAMA, SHEETS.RESTRICOES_EVIDENCIAS]);

  const restricoes = readAll_(SHEETS.RESTRICOES, RESTRICOES_HEADERS);
  const obras = readAll_(SHEETS.OBRAS, OBRAS_HEADERS);
  const pacotes = readAll_(SHEETS.CRONOGRAMA, CRONOGRAMA_HEADERS);
  const evidencias = readAll_(SHEETS.RESTRICOES_EVIDENCIAS, RESTRICOES_EVIDENCIAS_HEADERS);
  const obraPorId = {}; obras.forEach(o => obraPorId[o.ID] = o);
  const pacotePorId = {}; pacotes.forEach(p => pacotePorId[p.ID] = p);
  const evidenciasPorRestricao = {};
  evidencias.forEach(e => { evidenciasPorRestricao[e.IDRestricao] = (evidenciasPorRestricao[e.IDRestricao] || 0) + 1; });

  const lista = restricoes.map(r => ({
    ID: r.ID, IDObra: r.IDObra, IDPacote: r.IDPacote,
    TituloObra: (obraPorId[r.IDObra] || {}).Titulo || r.IDObra,
    Atividade: (pacotePorId[r.IDPacote] || {}).Atividade || r.IDPacote,
    Categoria: r.Categoria, Descricao: r.Descricao,
    ResponsavelNome: r.ResponsavelNome, PrazoNecessario: r.PrazoNecessario,
    Status: r.Status, CriadoEm: r.CriadoEm, LiberadoPor: r.LiberadoPor, LiberadoEm: r.LiberadoEm,
    Evidencias: evidenciasPorRestricao[r.ID] || 0
  })).sort((a, b) => String(a.PrazoNecessario || '9999').localeCompare(String(b.PrazoNecessario || '9999')));

  const semanas = janelaLookahead_(restricoes, new Date());
  const naJanela = restricoes.filter(r => r.PrazoNecessario && r.PrazoNecessario >= semanas[0].inicioIso && r.PrazoNecessario <= semanas[5].fimIso);
  const liberadasNaJanela = naJanela.filter(r => r.Status === 'Liberada').length;
  const pctLiberado = naJanela.length ? Math.round(liberadasNaJanela / naJanela.length * 100) : null;

  const resultado = { restricoes: lista, semanas: semanas, pctLiberado: pctLiberado, totalNaJanela: naJanela.length };
  cacheGravar_(CACHE_LOOKAHEAD, resultado, 120);
  return resultado;
}
