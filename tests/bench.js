/**
 * Mede quantas idas à planilha cada tela faz (a métrica que domina o tempo
 * de resposta no Apps Script). Uso: `node tests/bench.js [pasta-do-codigo]`
 * — sem argumento mede o código atual; com uma pasta, mede outra versão
 * (ex.: uma cópia do commit anterior) para comparar.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { criarAmbiente } = require('./gas-mock');

const RAIZ = process.argv[2] || path.join(__dirname, '..');
const arquivos = fs.readdirSync(RAIZ).filter(f => f.endsWith('.gs'))
  .sort((a, b) => (a === 'Setup.gs' ? -1 : b === 'Setup.gs' ? 1 : a.localeCompare(b)));
const fonte = arquivos.map(f => fs.readFileSync(path.join(RAIZ, f), 'utf8')).join('\n;\n');

const amb = criarAmbiente();
const ctx = vm.createContext(Object.assign({}, amb.globais));
vm.runInContext(fonte + '\n;globalThis.__g = (n) => eval(n);', ctx);
const g = (n) => ctx.__g(n);
const novaExecucao = () => { try { g('MEMORIA_ABAS_ = {}; VERSAO_DADOS_ = null; SS_EXECUCAO_ = null; EM_ESCRITA_ = false'); } catch (e) { /* versão antiga */ } };

g('setup')();
g('semearPrimeiroPmo')();
const H = g('USUARIOS_HEADERS');
amb.aba('Usuarios').data[1][H.indexOf('SenhaHash')] = g('hashSenha_')('x');
const token = g('login')('nucleodeprojetos@hospitaldabaleia.org.br', 'x').token;
g('criarProjetosExemplo')();
const idObra = g('apiListarObras')(token)[0].ID;

const telas = [
  ['Detalhe da obra (apiGetObraAdmin)', () => g('apiGetObraAdmin')(token, idObra)],
  ['Lista de obras (apiListarObras)', () => g('apiListarObras')(token)],
  ['Painel/Kanban (apiKanban)', () => g('apiKanban')(token)],
  ['Lookahead (apiLookahead)', () => g('apiLookahead')(token)],
  ['Pagamentos da obra (apiPagamentosObra)', () => g('apiPagamentosObra')(token, idObra)],
  ['Encerramento da obra (apiGetEncerramento)', () => g('apiGetEncerramento')(token, idObra)],
  ['Página pública da obra (apiGetObraPublica)', () => g('apiGetObraPublica')(idObra)]
];
const medir = (fn) => { novaExecucao(); [...amb.cacheStore.keys()].filter(k => k.indexOf('obrasHb_') !== 0).forEach(k => amb.cacheStore.delete(k)); const a = amb.stats.chamadasPlanilha; fn(); return amb.stats.chamadasPlanilha - a; };
const medirQuente = (fn) => { novaExecucao(); fn(); novaExecucao(); const a = amb.stats.chamadasPlanilha; fn(); return amb.stats.chamadasPlanilha - a; };
console.log('Idas à planilha por tela — ' + path.basename(path.resolve(RAIZ)));
console.log('tela'.padEnd(46) + 'cache frio  cache quente');
telas.forEach(([nome, fn]) => {
  console.log(nome.padEnd(46) + String(medir(fn)).padStart(10) + String(medirQuente(fn)).padStart(13));
});
