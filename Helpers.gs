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

// ────────────────────────────────────────────── LEITURA RÁPIDA ──
//
// Ler a planilha é o que mais custa no Apps Script. Cada aba é buscada no
// nível mais barato disponível:
//   1. memória desta execução;
//   2. CacheService (compartilhado entre execuções);
//   3. a planilha — e, quando várias abas faltam, todas numa só requisição.
// A chave do cache carrega a VERSÃO DOS DADOS, trocada ao fim de toda
// gravação (comLock_) e a cada edição manual na planilha (gatilhos no fim
// deste arquivo). Por isso o cache nunca devolve um dado já alterado.
// Dentro de comLock_ as leituras vão sempre direto à planilha: quem grava
// precisa do dado exato daquele instante.

const CACHE_ABAS_SEGUNDOS_ = 300;
let EM_ESCRITA_ = false;
let MEMORIA_ABAS_ = {};
let VERSAO_DADOS_ = null;

function versaoDados_() {
  if (VERSAO_DADOS_ === null) {
    VERSAO_DADOS_ = PropertiesService.getScriptProperties().getProperty('DADOS_VERSAO') || '0';
  }
  return VERSAO_DADOS_;
}

// Troca a versão (valor novo e imprevisível, nunca reaproveitado) e limpa a
// memória desta execução. Todo cache de dados fica invalidado de uma vez.
function dadosAlterados_() {
  VERSAO_DADOS_ = Utilities.getUuid().slice(0, 8);
  PropertiesService.getScriptProperties().setProperty('DADOS_VERSAO', VERSAO_DADOS_);
  MEMORIA_ABAS_ = {};
}

function readAll_(sheetName, headers) {
  const dados = lerAba_(sheetName, headers.length);
  // objetos novos a cada chamada: quem altera o resultado não contamina a memória
  return dados.v.map((r, k) => {
    const o = { _row: dados.r[k] };
    headers.forEach((h, j) => { o[h] = r[j] === undefined ? '' : r[j]; });
    return o;
  });
}

// { r: [nº real da linha], v: [[valores exibidos]], n: colunas lidas }.
// Linhas sem ID (1ª coluna vazia) são descartadas, mas o nº da linha é o
// real — calculado antes do descarte, senão uma linha apagada no meio da
// aba deslocaria todas as gravações seguintes.
function lerAba_(nome, ncols) {
  if (EM_ESCRITA_) return lerAbaDaPlanilha_(nome, ncols);
  const m = MEMORIA_ABAS_[nome];
  if (m && m.n >= ncols) return m;
  prepararAbas_([[nome, ncols]]);
  return MEMORIA_ABAS_[nome];
}

// Busca de uma vez as abas que uma tela vai usar. `abas` = lista de nomes
// (colunas pelo cabeçalho registrado) ou de pares [nome, nº de colunas].
function prepararAbas_(abas) {
  if (EM_ESCRITA_) return;
  const pedidas = abas.map(a => Array.isArray(a) ? a : [a, cabecalhosDaAba_(a).length])
    .filter(a => !(MEMORIA_ABAS_[a[0]] && MEMORIA_ABAS_[a[0]].n >= a[1]));
  if (!pedidas.length) return;

  const doCache = cacheLerVarios_(pedidas.map(a => chaveAba_(a[0])));
  const faltando = [];
  pedidas.forEach(a => {
    const c = doCache[chaveAba_(a[0])];
    if (c && c.n >= a[1]) MEMORIA_ABAS_[a[0]] = c;
    else faltando.push(a);
  });
  if (!faltando.length) return;

  const lidas = lerAbasDaPlanilha_(faltando);
  const paraCache = {};
  faltando.forEach(a => {
    MEMORIA_ABAS_[a[0]] = lidas[a[0]];
    paraCache[chaveAba_(a[0])] = lidas[a[0]];
  });
  cacheGravarVarios_(paraCache, CACHE_ABAS_SEGUNDOS_);
}

function chaveAba_(nome) {
  return 'aba_' + versaoDados_() + '_' + nome;
}

function lerAbaDaPlanilha_(nome, ncols) {
  const vazia = { r: [], v: [], n: ncols };
  const sh = ss_().getSheetByName(nome);
  // aba ainda não criada (setup não rodou após uma atualização) = sem dados,
  // não um crash — as escritas criam a aba sob demanda via ensureSheet_
  if (!sh) return vazia;
  const last = sh.getLastRow();
  if (last < 2) return vazia;
  return montarAba_(sh.getRange(2, 1, last - 1, ncols).getDisplayValues(), ncols);
}

function montarAba_(linhas, ncols) {
  const out = { r: [], v: [], n: ncols };
  linhas.forEach((l, i) => {
    if (l[0] === '' || l[0] === undefined) return;
    const v = l.slice(0, ncols);
    while (v.length < ncols) v.push('');
    out.r.push(i + 2);
    out.v.push(v);
  });
  return out;
}

// Várias abas numa única requisição à API do Sheets (serviço avançado
// "Sheets", ativado em appsscript.json). Se o serviço não estiver disponível,
// cai para a leitura aba a aba — o resultado é o mesmo.
function lerAbasDaPlanilha_(abas) {
  const out = {};
  if (abas.length > 1 && typeof Sheets !== 'undefined') {
    try {
      const ranges = abas.map(a => "'" + a[0].replace(/'/g, "''") + "'!A2:" + letraColuna_(a[1]));
      const resp = Sheets.Spreadsheets.Values.batchGet(ss_().getId(), {
        ranges: ranges, valueRenderOption: 'FORMATTED_VALUE', majorDimension: 'ROWS'
      });
      (resp.valueRanges || []).forEach((vr, i) => {
        out[abas[i][0]] = montarAba_(vr.values || [], abas[i][1]);
      });
      if (abas.every(a => out[a[0]])) return out;
    } catch (e) {
      // aba inexistente, serviço desligado ou sem permissão: segue pelo caminho simples
    }
  }
  abas.forEach(a => { out[a[0]] = lerAbaDaPlanilha_(a[0], a[1]); });
  return out;
}

function letraColuna_(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// Aba Config: chave/valor nas colunas A-B e as listas de áreas (D) e
// setores (E). Lida sem descartar linhas sem chave — as listas costumam ser
// mais longas que as chaves.
function getConfig_() {
  if (!EM_ESCRITA_ && MEMORIA_ABAS_._config) return MEMORIA_ABAS_._config;
  const guardada = EM_ESCRITA_ ? null : cacheLer_('config');
  if (guardada) return (MEMORIA_ABAS_._config = guardada);
  const sh = ss_().getSheetByName(SHEETS.CONFIG);
  const vals = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 5).getDisplayValues();
  const cfg = {};
  vals.forEach(r => { if (r[0]) cfg[r[0]] = r[1]; });
  cfg._areas = vals.map(r => r[3]).filter(v => v);
  cfg._setores = vals.map(r => r[4]).filter(v => v);
  if (!EM_ESCRITA_) {
    MEMORIA_ABAS_._config = cfg;
    cacheGravar_('config', cfg, CACHE_ABAS_SEGUNDOS_);
  }
  return cfg;
}

// ────────────────────────────────────────────── ESCRITA SEGURA ──

// Trava do script com mensagem clara quando o sistema está ocupado (a
// padrão do Apps Script é "Lock timeout", em inglês). Ao terminar: grava
// de fato na planilha (flush) antes de soltar a trava e troca a versão dos
// dados, invalidando todo cache de leitura.
function comLock_(fn) {
  if (EM_ESCRITA_) return fn(); // já dentro de uma trava desta mesma execução
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('O sistema está ocupado com outra gravação. Tente de novo em instantes.');
  EM_ESCRITA_ = true;
  try {
    return fn();
  } finally {
    EM_ESCRITA_ = false;
    try { SpreadsheetApp.flush(); } catch (e) { /* nada pendente */ }
    dadosAlterados_();
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
//
// O CacheService recusa itens acima de 100 KB (lança erro, o que antes
// derrubava a tela quando uma lista crescia). Valores grandes são
// divididos em partes e remontados na leitura; ler ou gravar várias chaves
// usa uma única chamada ao serviço. Toda chave de dados leva a versão dos
// dados (ver LEITURA RÁPIDA), então nenhuma resposta cacheada sobrevive a
// uma gravação. Falhar aqui nunca derruba a resposta: o cache é otimização.

const CACHE_PARTE_CARACTERES_ = 30000; // ≤ 90 KB mesmo com 3 bytes por caractere
const CACHE_MAX_PARTES_ = 60;

function cacheLer_(chave) {
  return cacheLerVarios_([versionada_(chave)])[versionada_(chave)] || null;
}

function cacheGravar_(chave, valor, segundos) {
  const o = {};
  o[versionada_(chave)] = valor;
  cacheGravarVarios_(o, segundos);
}

// A versão já invalida tudo a cada gravação; remover a chave antiga só
// libera espaço.
function cacheRemover_(chave) {
  try { CacheService.getScriptCache().remove(versionada_(chave)); } catch (e) { /* idem */ }
}

function versionada_(chave) {
  return chave + '@' + versaoDados_();
}

// { chave: valor } para as chaves encontradas. Duas idas ao serviço no
// máximo, para qualquer quantidade de chaves: cabeçalhos, depois as partes.
function cacheLerVarios_(chaves) {
  const out = {};
  if (!chaves.length) return out;
  try {
    const cache = CacheService.getScriptCache();
    const cabecalhos = cache.getAll(chaves);
    const partes = [];
    chaves.forEach(k => {
      const h = cabecalhos[k];
      if (!h) return;
      if (h.charAt(0) === '#') {
        const n = parseInt(h.slice(1), 10);
        for (let i = 0; i < n; i++) partes.push(k + '#' + i);
      } else {
        out[k] = JSON.parse(h);
      }
    });
    if (partes.length) {
      const pedacos = cache.getAll(partes);
      chaves.forEach(k => {
        const h = cabecalhos[k];
        if (!h || h.charAt(0) !== '#') return;
        const n = parseInt(h.slice(1), 10);
        let txt = '';
        for (let i = 0; i < n; i++) {
          const p = pedacos[k + '#' + i];
          if (p === undefined || p === null) return; // parte expirada: trata como ausente
          txt += p;
        }
        out[k] = JSON.parse(txt);
      });
    }
  } catch (e) {
    // qualquer falha = cache vazio
  }
  return out;
}

function cacheGravarVarios_(valores, segundos) {
  try {
    const itens = {};
    Object.keys(valores).forEach(k => {
      const txt = JSON.stringify(valores[k]);
      if (txt.length <= CACHE_PARTE_CARACTERES_) { itens[k] = txt; return; }
      const n = Math.ceil(txt.length / CACHE_PARTE_CARACTERES_);
      if (n > CACHE_MAX_PARTES_) return; // grande demais até para partes: não cacheia
      for (let i = 0; i < n; i++) itens[k + '#' + i] = txt.slice(i * CACHE_PARTE_CARACTERES_, (i + 1) * CACHE_PARTE_CARACTERES_);
      itens[k] = '#' + n; // gravado por último no mesmo lote: só vale se todas as partes foram gravadas
    });
    if (Object.keys(itens).length) CacheService.getScriptCache().putAll(itens, segundos);
  } catch (e) {
    // idem
  }
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

// ────────────────────────────────────────────── EDIÇÃO MANUAL NA PLANILHA ──
//
// Alguém editou uma célula direto na planilha: troca a versão dos dados para
// o sistema não mostrar o valor antigo guardado em cache. onEdit é um gatilho
// simples (roda sozinho, sem instalar). Mudanças de estrutura — inserir ou
// apagar linhas pela planilha — só são vistas pelo gatilho instalável
// aoAlterarPlanilha (ver instalarGatilhos em Backup.gs); sem ele, a tela pode
// levar até 5 minutos para refletir essas mudanças. As gravações do próprio
// sistema nunca dependem disso: dentro de comLock_ tudo é lido da planilha.
function onEdit() {
  dadosAlterados_();
}

function aoAlterarPlanilha() {
  dadosAlterados_();
}
