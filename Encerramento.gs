/**
 * Encerramento — fiel ao modelo "encerramento_e_entrega_handover_digital":
 * stepper de 4 etapas (Inspeção Técnica / Lista de Qualidade / Revisão
 * Documental / Aceite Final), checklist com posicionamento por item
 * (Pendente/Ciente/Objeção — reversível, é revisão técnica interna, não
 * decisão financeira), repositório de documentos as-built (upload real,
 * mesmo mecanismo de Drive já usado em Restrições/Medições) e assinaturas
 * múltiplas obrigatórias. `apiFinalizarObra` só libera Status='Finalizado'
 * quando TODAS as assinaturas estiverem 'Assinado' — mesmo princípio de
 * gate final já usado em `apiValidarCronograma`.
 *
 * As 3 primeiras etapas do stepper são o checklist (`ENCERRAMENTO_ETAPA_OPCOES`);
 * a 4ª ("Aceite Final") é resolvida pelas Assinaturas, não tem itens de
 * checklist próprios — mesmo comentário já deixado no schema desde a Fase 0-1.
 */

// ────────────────────────────────────────────── CHECKLIST ──

// Cache curto (120s) do resumo de portfólio (apiEncerramentoResumo) —
// invalidado pelas escritas que mudam checklistResolvido/assinaturasCompletas/
// Status (não pelos documentos, que não entram no resumo). Todos os
// escritores relevantes vivem neste mesmo arquivo.
const CACHE_ENCERRAMENTO_RESUMO = 'admin_encerramento_resumo_v1';
function invalidarCacheEncerramentoResumo_() {
  CacheService.getScriptCache().remove(CACHE_ENCERRAMENTO_RESUMO);
}

function apiSalvarItemChecklist(token, dados) {
  const sessao = exigirPapel_(token, ['Engenharia', 'PMO']);
  dados = dados || {};
  const idObra = sanitize_(dados.IDObra, 30);
  if (!idObra) throw new Error('Obra inválida.');
  if (ENCERRAMENTO_ETAPA_OPCOES.indexOf(dados.Etapa) < 0) throw new Error('Etapa inválida.');
  const item = sanitize_(dados.ItemChecklist, 200);
  if (!item) throw new Error('Descreva o item do checklist.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ensureSheet_(ss_(), SHEETS.ENCERRAMENTO_CHECKLIST, ENCERRAMENTO_CHECKLIST_HEADERS);
    const idInformado = sanitize_(dados.ID, 30);
    const existente = idInformado ? readAll_(SHEETS.ENCERRAMENTO_CHECKLIST, ENCERRAMENTO_CHECKLIST_HEADERS).find(c => c.ID === idInformado) : null;
    const linha = [
      existente ? existente.ID : proximoId_('EC', SHEETS.ENCERRAMENTO_CHECKLIST, ENCERRAMENTO_CHECKLIST_HEADERS, 'ID'),
      idObra, dados.Etapa, item, sanitize_(dados.Descricao, 1000),
      existente ? existente.Posicionamento : 'Pendente',
      existente ? existente.ObservacaoObjecao : '',
      sanitize_(dados.ResponsavelArea, 120),
      sessao.nome, nowIso_(),
      existente ? existente.CriadoEm : nowIso_()
    ];
    if (existente) sh.getRange(existente._row, 1, 1, ENCERRAMENTO_CHECKLIST_HEADERS.length).setValues([linha]);
    else sh.getRange(sh.getLastRow() + 1, 1, 1, ENCERRAMENTO_CHECKLIST_HEADERS.length).setValues([linha]);
    const item2 = {};
    ENCERRAMENTO_CHECKLIST_HEADERS.forEach((h, i) => item2[h] = linha[i]);
    invalidarCacheEncerramentoResumo_();
    return { ok: true, item: item2 };
  } finally {
    lock.releaseLock();
  }
}

// Reversível de propósito — é revisão técnica interna durante o
// encerramento, corrigir um posicionamento errado é operação normal.
function apiPosicionarItemChecklist(token, idItem, posicionamento, observacaoObjecao) {
  exigirPapel_(token, ['Engenharia', 'PMO']);
  if (ENCERRAMENTO_POSICIONAMENTO_OPCOES.indexOf(posicionamento) < 0) throw new Error('Posicionamento inválido.');
  if (posicionamento === 'Objeção' && !sanitize_(observacaoObjecao, 1000)) {
    throw new Error('Descreva a objeção.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const item = readAll_(SHEETS.ENCERRAMENTO_CHECKLIST, ENCERRAMENTO_CHECKLIST_HEADERS).find(c => c.ID === idItem);
    if (!item) throw new Error('Item de checklist não encontrado.');
    const sh = ss_().getSheetByName(SHEETS.ENCERRAMENTO_CHECKLIST);
    const col = (h) => ENCERRAMENTO_CHECKLIST_HEADERS.indexOf(h) + 1;
    sh.getRange(item._row, col('Posicionamento')).setValue(posicionamento);
    sh.getRange(item._row, col('ObservacaoObjecao')).setValue(posicionamento === 'Objeção' ? sanitize_(observacaoObjecao, 1000) : '');
    sh.getRange(item._row, col('AtualizadoEm')).setValue(nowIso_());
    invalidarCacheEncerramentoResumo_();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function apiExcluirItemChecklist(token, idItem) {
  exigirPapel_(token, ['Engenharia', 'PMO']);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const item = readAll_(SHEETS.ENCERRAMENTO_CHECKLIST, ENCERRAMENTO_CHECKLIST_HEADERS).find(c => c.ID === idItem);
    if (!item) throw new Error('Item de checklist não encontrado.');
    ss_().getSheetByName(SHEETS.ENCERRAMENTO_CHECKLIST).deleteRow(item._row);
    invalidarCacheEncerramentoResumo_();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ────────────────────────────────────────────── DOCUMENTOS AS-BUILT ──
// Pasta própria (separada da "Evidências" de Restrições/Medições, pra não
// misturar no Drive) — mesmo padrão de auto-criação idempotente.
function pastaDocumentosEncerramento_(idObra) {
  const arquivoPlanilha = DriveApp.getFileById(ss_().getId());
  const pais = arquivoPlanilha.getParents();
  const raiz = pais.hasNext() ? pais.next() : DriveApp.getRootFolder();
  const itRaiz = raiz.getFoldersByName('Documentos As-Built');
  const pastaRaiz = itRaiz.hasNext() ? itRaiz.next() : raiz.createFolder('Documentos As-Built');
  const itObra = pastaRaiz.getFoldersByName(idObra);
  return itObra.hasNext() ? itObra.next() : pastaRaiz.createFolder(idObra);
}

function formatarTamanho_(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function apiUploadDocumentoEncerramento(token, idObra, nomeArquivo, mimeType, base64Data) {
  const sessao = exigirPapel_(token, ['Engenharia', 'PMO']);
  idObra = sanitize_(idObra, 30);
  if (!idObra) throw new Error('Obra inválida.');
  nomeArquivo = sanitize_(nomeArquivo, 180) || 'documento';
  mimeType = sanitize_(mimeType, 100) || 'application/octet-stream';
  if (!base64Data) throw new Error('Selecione um arquivo.');
  let bytes;
  try { bytes = Utilities.base64Decode(base64Data); }
  catch (e) { throw new Error('Arquivo inválido — tente novamente.'); }
  if (bytes.length > TAMANHO_MAX_EVIDENCIA_BYTES) throw new Error('Arquivo maior que 8MB — reduza o tamanho antes de enviar.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const pasta = pastaDocumentosEncerramento_(idObra);
    const blob = Utilities.newBlob(bytes, mimeType, nomeArquivo);
    const arquivo = pasta.createFile(blob);
    const sh = ensureSheet_(ss_(), SHEETS.ENCERRAMENTO_DOCUMENTOS, ENCERRAMENTO_DOCUMENTOS_HEADERS);
    const linha = [
      proximoId_('ED', SHEETS.ENCERRAMENTO_DOCUMENTOS, ENCERRAMENTO_DOCUMENTOS_HEADERS, 'ID'),
      idObra, nomeArquivo, mimeType, arquivo.getUrl(), formatarTamanho_(bytes.length),
      sessao.nome, nowIso_()
    ];
    sh.getRange(sh.getLastRow() + 1, 1, 1, ENCERRAMENTO_DOCUMENTOS_HEADERS.length).setValues([linha]);
    const documento = {};
    ENCERRAMENTO_DOCUMENTOS_HEADERS.forEach((h, i) => documento[h] = linha[i]);
    return { ok: true, documento: documento };
  } finally {
    lock.releaseLock();
  }
}

function apiExcluirDocumentoEncerramento(token, idDocumento) {
  exigirPapel_(token, ['Engenharia', 'PMO']);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const documento = readAll_(SHEETS.ENCERRAMENTO_DOCUMENTOS, ENCERRAMENTO_DOCUMENTOS_HEADERS).find(d => d.ID === idDocumento);
    if (!documento) throw new Error('Documento não encontrado.');
    ss_().getSheetByName(SHEETS.ENCERRAMENTO_DOCUMENTOS).deleteRow(documento._row);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ────────────────────────────────────────────── ASSINATURAS ──

function apiSalvarSignatario(token, idObra, nomeSignatario, cargo, idUsuario) {
  exigirPapel_(token, ['Engenharia', 'PMO']);
  idObra = sanitize_(idObra, 30);
  nomeSignatario = sanitize_(nomeSignatario, 120);
  if (!idObra || !nomeSignatario) throw new Error('Informe o nome do signatário.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ensureSheet_(ss_(), SHEETS.ENCERRAMENTO_ASSINATURAS, ENCERRAMENTO_ASSINATURAS_HEADERS);
    const linha = [
      proximoId_('EA', SHEETS.ENCERRAMENTO_ASSINATURAS, ENCERRAMENTO_ASSINATURAS_HEADERS, 'ID'),
      idObra, nomeSignatario, sanitize_(cargo, 120), 'Pendente', '', sanitize_(idUsuario, 30)
    ];
    sh.getRange(sh.getLastRow() + 1, 1, 1, ENCERRAMENTO_ASSINATURAS_HEADERS.length).setValues([linha]);
    const signatario = {};
    ENCERRAMENTO_ASSINATURAS_HEADERS.forEach((h, i) => signatario[h] = linha[i]);
    invalidarCacheEncerramentoResumo_();
    return { ok: true, signatario: signatario };
  } finally {
    lock.releaseLock();
  }
}

function apiExcluirSignatario(token, idSignatario) {
  exigirPapel_(token, ['Engenharia', 'PMO']);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const signatario = readAll_(SHEETS.ENCERRAMENTO_ASSINATURAS, ENCERRAMENTO_ASSINATURAS_HEADERS).find(s => s.ID === idSignatario);
    if (!signatario) throw new Error('Signatário não encontrado.');
    if (signatario.Status === 'Assinado') throw new Error('Signatário já assinou — não pode ser removido (preserva o histórico de aceite).');
    ss_().getSheetByName(SHEETS.ENCERRAMENTO_ASSINATURAS).deleteRow(signatario._row);
    invalidarCacheEncerramentoResumo_();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// Assinar exige que TODO o checklist já esteja resolvido (nenhum item
// "Pendente" — Objeção conta como resolvido, é um posicionamento válido,
// só "Pendente" bloqueia). Se o signatário está ligado a um Usuario real
// (IDUsuario preenchido), só a PRÓPRIA pessoa logada pode assinar por si
// (auto-atendimento). Se é um signatário externo (sem login no sistema,
// ex.: um stakeholder clínico), qualquer Engenharia/PMO pode registrar a
// assinatura em nome dele — representa o registro de uma assinatura física
// já obtida fora do sistema, prática comum em handover de obra.
function apiAssinarDocumento(token, idAssinatura) {
  const sessao = exigirPapel_(token, ['Engenharia', 'PMO']);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const signatario = readAll_(SHEETS.ENCERRAMENTO_ASSINATURAS, ENCERRAMENTO_ASSINATURAS_HEADERS).find(s => s.ID === idAssinatura);
    if (!signatario) throw new Error('Signatário não encontrado.');
    if (signatario.Status === 'Assinado') throw new Error('Este signatário já assinou.');
    if (signatario.IDUsuario && signatario.IDUsuario !== sessao.usuarioId) {
      throw new Error('Este signatário está vinculado a um usuário do sistema — só a própria pessoa (logada) pode assinar por si.');
    }
    const checklist = readAll_(SHEETS.ENCERRAMENTO_CHECKLIST, ENCERRAMENTO_CHECKLIST_HEADERS).filter(c => c.IDObra === signatario.IDObra);
    if (checklist.some(c => c.Posicionamento === 'Pendente')) {
      throw new Error('Ainda há itens do checklist pendentes — resolva-os (Ciente ou Objeção) antes de assinar.');
    }
    const sh = ss_().getSheetByName(SHEETS.ENCERRAMENTO_ASSINATURAS);
    const col = (h) => ENCERRAMENTO_ASSINATURAS_HEADERS.indexOf(h) + 1;
    sh.getRange(signatario._row, col('Status')).setValue('Assinado');
    sh.getRange(signatario._row, col('AssinadoEm')).setValue(nowIso_());
    invalidarCacheEncerramentoResumo_();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ────────────────────────────────────────────── FINALIZAR ──

// Só PMO — mesmo princípio de gate final já usado em apiValidarCronograma.
// Exige ao menos 1 signatário cadastrado e TODOS "Assinado".
function apiFinalizarObra(token, idObra) {
  const sessao = exigirPMO_(token);
  const obra = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(o => o.ID === idObra);
  if (!obra) throw new Error('Obra não encontrada.');
  if (obra.Status === 'Finalizado') throw new Error('Esta obra já está finalizada.');
  if (obra.Status === 'Cancelada') throw new Error('Obra cancelada não pode ser finalizada.');
  const assinaturas = readAll_(SHEETS.ENCERRAMENTO_ASSINATURAS, ENCERRAMENTO_ASSINATURAS_HEADERS).filter(a => a.IDObra === idObra);
  if (!assinaturas.length) throw new Error('Cadastre ao menos um signatário antes de finalizar.');
  if (assinaturas.some(a => a.Status !== 'Assinado')) {
    throw new Error('Ainda há signatário(s) pendente(s) — todas as assinaturas precisam estar concluídas antes de finalizar.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ss_().getSheetByName(SHEETS.OBRAS);
    sh.getRange(obra._row, OBRAS_HEADERS.indexOf('Status') + 1).setValue('Finalizado');
    invalidarCacheObras_();
    invalidarCacheEncerramentoResumo_();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ────────────────────────────────────────────── LEITURA AGREGADA (tela) ──

// Portfólio — obras que já passaram da fase de manifestação (candidatas a
// encerramento). Alimenta o filtro/lista da tela.
function apiEncerramentoResumo(token) {
  validarToken_(token);
  const cache = CacheService.getScriptCache();
  const hit = cache.get(CACHE_ENCERRAMENTO_RESUMO);
  if (hit) return JSON.parse(hit);

  const elegiveis = ['Liberada', 'Em execução', 'Concluída', 'Finalizado'];
  const obras = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).filter(o => elegiveis.indexOf(o.Status) >= 0);
  const checklist = readAll_(SHEETS.ENCERRAMENTO_CHECKLIST, ENCERRAMENTO_CHECKLIST_HEADERS);
  const assinaturas = readAll_(SHEETS.ENCERRAMENTO_ASSINATURAS, ENCERRAMENTO_ASSINATURAS_HEADERS);
  const resultado = obras.map(o => {
    const itensDaObra = checklist.filter(c => c.IDObra === o.ID);
    const assinaturasDaObra = assinaturas.filter(a => a.IDObra === o.ID);
    return {
      ID: o.ID, Titulo: o.Titulo, Status: o.Status,
      totalChecklist: itensDaObra.length,
      checklistResolvido: itensDaObra.length ? itensDaObra.every(c => c.Posicionamento !== 'Pendente') : false,
      totalAssinaturas: assinaturasDaObra.length,
      assinaturasCompletas: assinaturasDaObra.length ? assinaturasDaObra.every(a => a.Status === 'Assinado') : false
    };
  }).sort((a, b) => a.Titulo.localeCompare(b.Titulo));
  cache.put(CACHE_ENCERRAMENTO_RESUMO, JSON.stringify(resultado), 120);
  return resultado;
}

function apiGetEncerramento(token, idObra) {
  validarToken_(token);
  const obra = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).find(o => o.ID === idObra);
  if (!obra) throw new Error('Obra não encontrada.');
  return {
    obra: obra,
    checklist: readAll_(SHEETS.ENCERRAMENTO_CHECKLIST, ENCERRAMENTO_CHECKLIST_HEADERS).filter(c => c.IDObra === idObra),
    documentos: readAll_(SHEETS.ENCERRAMENTO_DOCUMENTOS, ENCERRAMENTO_DOCUMENTOS_HEADERS).filter(d => d.IDObra === idObra),
    assinaturas: readAll_(SHEETS.ENCERRAMENTO_ASSINATURAS, ENCERRAMENTO_ASSINATURAS_HEADERS).filter(a => a.IDObra === idObra)
  };
}
