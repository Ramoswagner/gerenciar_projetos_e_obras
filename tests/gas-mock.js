/**
 * Simulador mínimo dos serviços do Google Apps Script usados pelo sistema
 * (SpreadsheetApp, CacheService, PropertiesService, LockService, DriveApp,
 * Utilities, Session, ScriptApp, Logger). Roda só no Node, para os testes
 * em tests/run.js — nunca é enviado ao Apps Script (ver .claspignore).
 *
 * Fiel ao que importa para os testes: planilha como matriz de valores,
 * getLastRow ignorando linhas vazias no fim, limite de 100 KB por item do
 * CacheService (o real lança erro acima disso) e contagem de chamadas à
 * planilha, usada para medir o custo de cada tela antes/depois.
 */
const crypto = require('crypto');

function criarAmbiente(opcoes) {
  opcoes = opcoes || {};
  const stats = { chamadasPlanilha: 0 };
  const conta = () => { stats.chamadasPlanilha++; };
  const logs = [];

  // ───────────────────────────── planilha ─────────────────────────────
  function colunaParaNumero(letras) {
    let n = 0;
    for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
    return n;
  }

  class Range {
    constructor(sheet, row, col, numRows, numCols) {
      if (row < 1 || col < 1 || numRows < 1 || numCols < 1) {
        throw new Error('Range inválido: ' + [row, col, numRows, numCols].join(','));
      }
      this.sheet = sheet; this.row = row; this.col = col; this.numRows = numRows; this.numCols = numCols;
    }
    _ler(fmt) {
      conta();
      const out = [];
      for (let r = 0; r < this.numRows; r++) {
        const linha = this.sheet.data[this.row - 1 + r] || [];
        const o = [];
        for (let c = 0; c < this.numCols; c++) {
          const v = linha[this.col - 1 + c];
          o.push(fmt ? formatarExibicao(v) : (v === undefined || v === null ? '' : v));
        }
        out.push(o);
      }
      return out;
    }
    getValues() { return this._ler(false); }
    getDisplayValues() { return this._ler(true); }
    getValue() { return this._ler(false)[0][0]; }
    setValues(vals) {
      conta();
      if (vals.length !== this.numRows) throw new Error('setValues: ' + vals.length + ' linhas para um range de ' + this.numRows);
      vals.forEach((linha, r) => {
        if (linha.length !== this.numCols) throw new Error('setValues: ' + linha.length + ' colunas para um range de ' + this.numCols);
        const alvo = this.sheet._linha(this.row + r);
        linha.forEach((v, c) => { alvo[this.col - 1 + c] = v; });
      });
      return this;
    }
    setValue(v) {
      conta();
      for (let r = 0; r < this.numRows; r++) {
        const alvo = this.sheet._linha(this.row + r);
        for (let c = 0; c < this.numCols; c++) alvo[this.col - 1 + c] = v;
      }
      return this;
    }
    clearContent() {
      conta();
      for (let r = 0; r < this.numRows; r++) {
        const alvo = this.sheet.data[this.row - 1 + r];
        if (!alvo) continue;
        for (let c = 0; c < this.numCols; c++) alvo[this.col - 1 + c] = '';
      }
      return this;
    }
    setFontWeight() { return this; }
    setNumberFormat() { return this; }
    setBackground() { return this; }
    setFontColor() { return this; }
    setDataValidation() { return this; }
  }

  function formatarExibicao(v) {
    if (v === undefined || v === null) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v);
  }

  class Sheet {
    constructor(name) { this.name = name; this.data = []; }
    _linha(n) {
      while (this.data.length < n) this.data.push([]);
      return this.data[n - 1];
    }
    getName() { return this.name; }
    setName(n) { this.name = n; return this; }
    getLastRow() {
      conta();
      for (let i = this.data.length - 1; i >= 0; i--) {
        if ((this.data[i] || []).some(v => v !== '' && v !== undefined && v !== null)) return i + 1;
      }
      return 0;
    }
    getLastColumn() {
      conta();
      let max = 0;
      this.data.forEach(l => {
        for (let c = l.length - 1; c >= 0; c--) {
          if (l[c] !== '' && l[c] !== undefined && l[c] !== null) { max = Math.max(max, c + 1); break; }
        }
      });
      return max;
    }
    getRange(a, b, c, d) {
      if (typeof a === 'string') {
        // 'A1', 'A1:B4', 'I2:I' (coluna aberta até o fim dos dados)
        const m = a.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d*))?$/);
        if (!m) throw new Error('A1 não suportado no simulador: ' + a);
        const c0 = colunaParaNumero(m[1]), r0 = +m[2];
        const c1 = m[3] ? colunaParaNumero(m[3]) : c0;
        const r1 = m[3] ? (m[4] ? +m[4] : Math.max(r0, this.data.length)) : r0;
        return new Range(this, r0, c0, r1 - r0 + 1, c1 - c0 + 1);
      }
      return new Range(this, a, b, c || 1, d || 1);
    }
    appendRow(vals) {
      conta();
      const n = this.getLastRow() + 1;
      const alvo = this._linha(n);
      vals.forEach((v, i) => { alvo[i] = v; });
      return this;
    }
    deleteRow(n) { conta(); this.data.splice(n - 1, 1); return this; }
    deleteRows(n, qtd) { conta(); this.data.splice(n - 1, qtd); return this; }
    setFrozenRows() { return this; }
    autoResizeColumns() { return this; }
  }

  class Spreadsheet {
    constructor(id) { this.id = id; this.sheets = []; }
    getId() { return this.id; }
    getSheetByName(n) { conta(); return this.sheets.find(s => s.name === n) || null; }
    getSheets() { return this.sheets.slice(); }
    insertSheet(n) {
      conta();
      if (this.sheets.some(s => s.name === n)) throw new Error('Aba já existe: ' + n);
      const s = new Sheet(n); this.sheets.push(s); return s;
    }
    deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
    getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  }

  const planilha = new Spreadsheet('planilha-teste');
  const SpreadsheetApp = {
    getActive: () => planilha,
    getActiveSpreadsheet: () => planilha,
    openById: () => { conta(); return planilha; }
  };

  // ───────────────────────────── cache / propriedades / trava ─────────────────────────────
  const cacheStore = new Map();
  const LIMITE_CACHE_BYTES = 100 * 1024;
  const CacheService = {
    getScriptCache: () => ({
      get: (k) => (cacheStore.has(k) ? cacheStore.get(k) : null),
      put: (k, v, ttl) => {
        if (Buffer.byteLength(String(v), 'utf8') > LIMITE_CACHE_BYTES) throw new Error('Argument too large: value');
        cacheStore.set(k, String(v));
      },
      remove: (k) => { cacheStore.delete(k); },
      getAll: (ks) => { const o = {}; ks.forEach(k => { if (cacheStore.has(k)) o[k] = cacheStore.get(k); }); return o; },
      putAll: (obj) => { Object.keys(obj).forEach(k => CacheService.getScriptCache().put(k, obj[k])); },
      removeAll: (ks) => { ks.forEach(k => cacheStore.delete(k)); }
    })
  };

  const props = new Map();
  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (props.has(k) ? props.get(k) : null),
      setProperty: (k, v) => { props.set(k, String(v)); },
      deleteProperty: (k) => { props.delete(k); },
      getProperties: () => Object.fromEntries(props)
    })
  };

  const LockService = {
    getScriptLock: () => ({
      waitLock: () => {}, tryLock: () => true, releaseLock: () => {}, hasLock: () => true
    })
  };

  // ───────────────────────────── Drive ─────────────────────────────
  let seqDrive = 0;
  function criarPasta(nome) {
    const pasta = {
      nome, filhas: [], arquivos: [],
      getFoldersByName: (n) => iterador(pasta.filhas.filter(f => f.nome === n)),
      createFolder: (n) => { const f = criarPasta(n); pasta.filhas.push(f); return f; },
      createFile: (blob) => { const a = criarArquivo(blob.getName ? blob.getName() : 'arquivo', pasta); pasta.arquivos.push(a); return a; },
      getFilesByType: () => iterador(pasta.arquivos.slice())
    };
    return pasta;
  }
  const arquivos = new Map();
  function criarArquivo(nome, pasta) {
    const id = 'arq-' + (++seqDrive);
    const a = {
      getId: () => id, getName: () => nome, getUrl: () => 'https://drive.google.com/file/d/' + id,
      getParents: () => iterador([pasta]), setTrashed: () => {}, getDateCreated: () => new Date(),
      makeCopy: () => criarArquivo(nome + ' (cópia)', pasta),
      getBlob: () => ({ getContentType: () => 'image/png', getBytes: () => [] })
    };
    arquivos.set(id, a);
    return a;
  }
  function iterador(lista) { let i = 0; return { hasNext: () => i < lista.length, next: () => lista[i++] }; }
  const raiz = criarPasta('Meu Drive');
  const arquivoPlanilha = criarArquivo('Planilha', raiz);
  const DriveApp = {
    getFileById: (id) => {
      if (id === planilha.getId()) return arquivoPlanilha;
      if (!arquivos.has(id)) throw new Error('Arquivo não encontrado: ' + id);
      return arquivos.get(id);
    },
    getRootFolder: () => raiz,
    createFile: (blob) => raiz.createFile(blob)
  };

  // ───────────────────────────── utilitários ─────────────────────────────
  function formatDate(d, tz, fmt) {
    const p = (n, w) => String(n).padStart(w || 2, '0');
    return fmt
      .replace(/'T'/g, 'T')
      .replace('yyyy', d.getFullYear()).replace('MM', p(d.getMonth() + 1)).replace('dd', p(d.getDate()))
      .replace('HH', p(d.getHours())).replace('mm', p(d.getMinutes())).replace('ss', p(d.getSeconds()));
  }
  const Utilities = {
    getUuid: () => crypto.randomUUID(),
    formatDate,
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, txt) => Array.from(crypto.createHash(alg).update(String(txt), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
    base64Encode: (s) => Buffer.from(typeof s === 'string' ? s : Buffer.from(s)).toString('base64'),
    base64Decode: (s) => {
      if (!/^[A-Za-z0-9+/=\s]*$/.test(s)) throw new Error('base64 inválido');
      return Array.from(Buffer.from(s, 'base64'));
    },
    newBlob: (bytes, mime, nome) => ({ getName: () => nome, getBytes: () => bytes, getContentType: () => mime })
  };

  // Quem está executando: 'editor' (dono rodando pelo editor), 'visitante'
  // (web app anônimo) ou um e-mail de outra pessoa do mesmo domínio.
  const sessao = { ativo: 'usuarioAtivo' in opcoes ? opcoes.usuarioAtivo : 'dono@hospital.org', dono: 'dono@hospital.org' };
  const Session = {
    getActiveUser: () => ({ getEmail: () => sessao.ativo }),
    getEffectiveUser: () => ({ getEmail: () => sessao.dono })
  };

  const triggers = [];
  const ScriptApp = {
    getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TESTE/exec' }),
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: (t) => { triggers.splice(triggers.indexOf(t), 1); },
    newTrigger: (fn) => {
      const t = { getHandlerFunction: () => fn };
      const cadeia = { timeBased: () => cadeia, everyWeeks: () => cadeia, onWeekDay: () => cadeia, atHour: () => cadeia, create: () => { triggers.push(t); return t; } };
      return cadeia;
    },
    WeekDay: { SUNDAY: 'SUNDAY' }
  };

  const globais = {
    SpreadsheetApp, CacheService, PropertiesService, LockService, DriveApp, Utilities, Session, ScriptApp,
    MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
    Logger: { log: (m) => { logs.push(String(m)); } },
    HtmlService: {},
    console
  };

  return {
    globais, stats, logs, planilha, cacheStore, props,
    definirUsuarioAtivo: (email) => { sessao.ativo = email; },
    aba: (nome) => planilha.sheets.find(s => s.name === nome)
  };
}

module.exports = { criarAmbiente };
