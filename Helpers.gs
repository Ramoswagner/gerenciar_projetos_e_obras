/**
 * Utilitários genéricos compartilhados por todos os módulos de API.
 * Portado de Code.gs (sistema atual) — mesma assinatura e comportamento,
 * só reorganizado por arquivo.
 */

// A planilha aberta é guardada durante a execução: cada chamada ao
// servidor é uma execução isolada, e reabrir a planilha a cada leitura
// custa uma ida ao serviço do Google por vez.
let SS_EXECUCAO_ = null;
function ss_() {
  if (!SS_EXECUCAO_) {
    SS_EXECUCAO_ = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActive();
  }
  return SS_EXECUCAO_;
}

function readAll_(sheetName, headers) {
  const sh = ss_().getSheetByName(sheetName);
  // aba ainda não criada (setup não rodou após uma atualização) = sem dados,
  // não um crash — as escritas criam a aba sob demanda via ensureSheet_
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, headers.length).getDisplayValues();
  // _row é a linha REAL na planilha: calculado antes de descartar as linhas
  // vazias, senão uma linha apagada no meio desloca todas as gravações
  // seguintes para a linha errada.
  const linhas = [];
  vals.forEach((r, i) => {
    if (r[0] === '') return;
    const o = { _row: i + 2 };
    headers.forEach((h, j) => o[h] = r[j]);
    linhas.push(o);
  });
  return linhas;
}

function getConfig_() {
  const sh = ss_().getSheetByName(SHEETS.CONFIG);
  const vals = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 5).getDisplayValues();
  const cfg = {};
  vals.forEach(r => { if (r[0]) cfg[r[0]] = r[1]; });
  cfg._areas = vals.map(r => r[3]).filter(v => v);
  cfg._setores = vals.map(r => r[4]).filter(v => v);
  return cfg;
}

// ────────────────────────────────────────────── ESCRITA SEGURA ──

// Trava do script com mensagem clara quando o sistema está ocupado (a
// padrão do Apps Script é "Lock timeout", em inglês).
function comLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('O sistema está ocupado com outra gravação. Tente de novo em instantes.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// Grava vários campos de UMA linha numa única escrita: lê só o trecho entre
// o primeiro e o último campo alterado (valores crus, sem formatação, para
// não converter número em texto) e devolve tudo com um setValues.
function atualizarCampos_(sheetName, headers, row, campos) {
  const nomes = Object.keys(campos);
  const idx = nomes.map(h => {
    const i = headers.indexOf(h);
    if (i < 0) throw new Error('Campo desconhecido em ' + sheetName + ': ' + h);
    return i;
  });
  const c0 = Math.min.apply(null, idx);
  const c1 = Math.max.apply(null, idx);
  const range = ss_().getSheetByName(sheetName).getRange(row, c0 + 1, 1, c1 - c0 + 1);
  const linha = range.getValues()[0];
  nomes.forEach((h, k) => { linha[idx[k] - c0] = campos[h]; });
  range.setValues([linha]);
}

// Substitui as linhas de UM dono (ex.: as linhas de uma obra) numa aba
// compartilhada sem tocar nas linhas de mais ninguém: reaproveita as
// posições que ele já ocupava, acrescenta o excedente no fim e remove as
// posições que sobraram. Nunca limpa a aba inteira — se a execução for
// interrompida no meio, os outros donos continuam intactos. Chamar sempre
// dentro de comLock_ (as posições lidas precisam continuar válidas).
function substituirLinhasDe_(sheetName, headers, campoDono, dono, novasLinhas) {
  const sh = ensureSheet_(ss_(), sheetName, headers);
  const posicoes = readAll_(sheetName, headers)
    .filter(l => l[campoDono] === dono)
    .map(l => l._row)
    .sort((a, b) => a - b);
  const n = Math.min(posicoes.length, novasLinhas.length);

  // posições consecutivas são gravadas num bloco só
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && posicoes[j + 1] === posicoes[j] + 1) j++;
    sh.getRange(posicoes[i], 1, j - i + 1, headers.length).setValues(novasLinhas.slice(i, j + 1));
    i = j + 1;
  }
  if (novasLinhas.length > n) {
    sh.getRange(sh.getLastRow() + 1, 1, novasLinhas.length - n, headers.length).setValues(novasLinhas.slice(n));
  }
  // de baixo para cima, para as posições de cima não mudarem
  const sobras = posicoes.slice(n);
  for (let i = sobras.length - 1; i >= 0;) {
    let j = i;
    while (j > 0 && sobras[j - 1] === sobras[j] - 1) j--;
    sh.deleteRows(sobras[j], i - j + 1);
    i = j - 1;
  }
}

// ────────────────────────────────────────────── CACHE ──

// O CacheService recusa itens acima de 100 KB e lança erro — o que antes
// derrubava a tela inteira quando uma lista crescia. Item grande demais
// simplesmente não é cacheado (a próxima leitura vem da planilha).
const CACHE_LIMITE_BYTES_ = 100 * 1024 - 512;

function cacheLer_(chave) {
  try {
    const v = CacheService.getScriptCache().get(chave);
    return v ? JSON.parse(v) : null;
  } catch (e) {
    return null;
  }
}

function cacheGravar_(chave, valor, segundos) {
  try {
    const txt = JSON.stringify(valor);
    // tamanho em bytes UTF-8 (acentos ocupam 2 bytes)
    if (unescape(encodeURIComponent(txt)).length > CACHE_LIMITE_BYTES_) return;
    CacheService.getScriptCache().put(chave, txt, segundos);
  } catch (e) {
    // cache é otimização: falhar aqui nunca pode derrubar a resposta
  }
}

function cacheRemover_(chave) {
  try { CacheService.getScriptCache().remove(chave); } catch (e) { /* idem */ }
}

function largura_(n, digitos) {
  return String(n).padStart(digitos, '0');
}

function nowIso_() {
  return Utilities.formatDate(new Date(), 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ss");
}

// Gerador de ID sequencial por ano, genérico — consolida o que no sistema
// atual eram 3 funções quase idênticas (nextObraId_/nextPedidoId_/
// nextAreaPropId_). `campoId` é o nome do header que guarda o ID.
// O último número emitido fica nas propriedades do script, então um ID
// nunca é reaproveitado depois de uma exclusão; o maior ID da aba também
// entra na conta, para uma planilha restaurada de backup não gerar
// repetidos. Sem teto: depois de 999 vem 1000 (antes voltava para 000).
// Chamar sempre dentro de comLock_/lock.
function proximoId_(prefixo, sheetName, headers, campoId) {
  const year = new Date().getFullYear();
  const marcador = prefixo + '-' + year + '-';
  const maiorNaAba = readAll_(sheetName, headers)
    .map(l => String(l[campoId] || ''))
    .filter(id => id.indexOf(marcador) === 0)
    .reduce((m, id) => Math.max(m, parseInt(id.slice(marcador.length), 10) || 0), 0);
  const props = PropertiesService.getScriptProperties();
  const chave = 'SEQ_' + marcador;
  const emitido = parseInt(props.getProperty(chave), 10) || 0;
  const next = Math.max(maiorNaAba, emitido) + 1;
  props.setProperty(chave, String(next));
  return marcador + largura_(next, 3);
}

function webAppUrl_() {
  return ScriptApp.getService().getUrl();
}

function linkObra_(id) {
  return webAppUrl_() + '?obra=' + encodeURIComponent(id);
}

function linkNovoPedido_() {
  return webAppUrl_() + '?novopedido=1';
}

function linkAcompanhamentoPedido_(id, token) {
  return webAppUrl_() + '?pedido=' + encodeURIComponent(id) + '&tk=' + encodeURIComponent(token);
}

function sanitize_(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max || 5000);
}

function compareEap_(a, b) {
  const pa = String(a.Codigo).split('.').map(Number);
  const pb = String(b.Codigo).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function prazoExpirado_(prazoIso) {
  if (!prazoIso) return false;
  const p = parseDate_(prazoIso);
  if (!p) return false;
  p.setHours(23, 59, 59);
  return new Date() > p;
}

function parseDate_(s) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}

function isoToBr_(s) {
  const d = parseDate_(s);
  if (!d) return s || '—';
  return Utilities.formatDate(d, 'America/Sao_Paulo', 'dd/MM/yyyy');
}

function uniq_(arr) {
  const seen = {};
  return arr.filter(v => v && !seen[v] && (seen[v] = true));
}

// ────────────────────────────────────────────── DINHEIRO (Fase 7) ──
//
// Contraparte no servidor do parseMoeda() que hoje só existe no
// front-end (App.html). Não usada ainda por nenhuma API na Fase 0-1 —
// entra em uso na Fase 7 (migração de CustoDoacao/CustoProprio de texto
// para número) e desde já em Baseline/PlanoPagamento/Medicoes, que
// nascem numéricos porque são abas novas sem dado legado para migrar.
// Aceita "R$ 1.234,56", "1234.56", "1234,56" — mesma lógica do front,
// replicada aqui pra nunca gravar um valor não numérico.
function parseMoedaServidor_(v) {
  if (v === '' || v == null) return 0;
  let s = String(v).replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  s = /,\d{2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n; // null = valor não numérico, caller decide se rejeita
}
