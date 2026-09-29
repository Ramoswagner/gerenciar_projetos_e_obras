/**
 * Utilitários genéricos compartilhados por todos os módulos de API.
 * Portado de Code.gs (sistema atual) — mesma assinatura e comportamento,
 * só reorganizado por arquivo.
 */

function ss_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActive();
}

function readAll_(sheetName, headers) {
  const sh = ss_().getSheetByName(sheetName);
  // aba ainda não criada (setup não rodou após uma atualização) = sem dados,
  // não um crash — as escritas criam a aba sob demanda via ensureSheet_
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, headers.length).getDisplayValues();
  return vals
    .filter(r => r[0] !== '')
    .map((r, i) => {
      const o = { _row: i + 2 };
      headers.forEach((h, j) => o[h] = r[j]);
      return o;
    });
}

function getConfig_() {
  const sh = ss_().getSheetByName(SHEETS.CONFIG);
  const vals = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 2).getDisplayValues();
  const cfg = {};
  vals.forEach(r => { if (r[0]) cfg[r[0]] = r[1]; });
  const col = (n) => sh.getRange(2, n, Math.max(sh.getLastRow() - 1, 1), 1)
    .getDisplayValues().map(r => r[0]).filter(v => v);
  cfg._areas = col(4);
  cfg._setores = col(5);
  return cfg;
}

function nowIso_() {
  return Utilities.formatDate(new Date(), 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ss");
}

// Gerador de ID sequencial por ano, genérico — consolida o que no sistema
// atual eram 3 funções quase idênticas (nextObraId_/nextPedidoId_/
// nextAreaPropId_). `campoId` é o nome do header que guarda o ID.
function proximoId_(prefixo, sheetName, headers, campoId) {
  const year = new Date().getFullYear();
  const linhas = readAll_(sheetName, headers);
  const marcador = prefixo + '-' + year + '-';
  const nums = linhas
    .map(l => l[campoId])
    .filter(id => id.indexOf(marcador) === 0)
    .map(id => parseInt(id.split('-')[2], 10) || 0);
  const next = (nums.length ? Math.max.apply(null, nums) : 0) + 1;
  return marcador + ('000' + next).slice(-3);
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
