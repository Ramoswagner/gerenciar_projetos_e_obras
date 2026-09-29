/**
 * Testes do servidor rodando no Node com o simulador (tests/gas-mock.js).
 * Uso: `node tests/run.js` (ou `npm test`). Cada teste recebe um ambiente
 * novo (planilha vazia), carrega todos os .gs como o Apps Script faz
 * (escopo global único) e exercita as APIs de verdade.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { criarAmbiente } = require('./gas-mock');

const RAIZ = path.join(__dirname, '..');
// Setup.gs primeiro: define as constantes de schema usadas pelos outros arquivos.
const ARQUIVOS = fs.readdirSync(RAIZ).filter(f => f.endsWith('.gs'))
  .sort((a, b) => (a === 'Setup.gs' ? -1 : b === 'Setup.gs' ? 1 : a.localeCompare(b)));
const FONTE = ARQUIVOS.map(f => fs.readFileSync(path.join(RAIZ, f), 'utf8')).join('\n;\n');

// Carrega o sistema num ambiente novo. `exporta` devolve as funções/constantes
// globais que o teste quer usar (const/let de topo não viram propriedade do
// contexto, então são expostas por uma função auxiliar).
function carregar(opcoes) {
  const amb = criarAmbiente(opcoes);
  const ctx = vm.createContext(Object.assign({}, amb.globais));
  vm.runInContext(FONTE + '\n;globalThis.__g = (n) => eval(n);', ctx, { filename: 'sistema.gs' });
  const g = (nome) => ctx.__g(nome);
  return { amb, g };
}

// Ambiente pronto: abas criadas e um PMO com senha conhecida logado.
function sistemaComPmo() {
  const s = carregar();
  s.g('setup')();
  s.g('semearPrimeiroPmo')();
  const email = 'nucleodeprojetos@hospitaldabaleia.org.br';
  const sh = s.amb.aba('Usuarios');
  const H = s.g('USUARIOS_HEADERS');
  sh.data[1][H.indexOf('SenhaHash')] = s.g('hashSenha_')('senha-teste');
  s.token = s.g('login')(email, 'senha-teste').token;
  return s;
}

function criarUsuario(s, papel, email) {
  s.g('apiSalvarUsuario')(s.token, { Nome: papel + ' Teste', Email: email, Cargo: 'Teste', Papel: papel, Senha: 'senha-' + papel });
  return s.g('login')(email, 'senha-' + papel).token;
}

// Simula o início de uma nova chamada ao servidor: no Apps Script cada
// execução começa com as variáveis globais zeradas (a memória some, o
// CacheService e as propriedades continuam).
function novaExecucao(s) {
  s.g('MEMORIA_ABAS_ = {}; VERSAO_DADOS_ = null; SS_EXECUCAO_ = null; EM_ESCRITA_ = false');
}

const testes = [];
const teste = (nome, fn) => testes.push({ nome, fn });

// ─────────────────────────────── segurança ───────────────────────────────

teste('funções de manutenção recusam chamada de fora do editor', () => {
  const s = carregar({ usuarioAtivo: '' }); // visitante anônimo do web app
  ['semearPrimeiroPmo', 'setup', 'backupSemanal', 'instalarTriggerBackup', 'criarProjetosExemplo',
   'migrarCustoParaNumero', 'testAuth', 'diagnosticarCronograma'].forEach(fn => {
    assert.throws(() => s.g(fn)(), /editor/i, fn + ' deveria exigir o editor');
  });
  const outro = carregar({ usuarioAtivo: 'visitante@hospital.org' });
  assert.throws(() => outro.g('semearPrimeiroPmo')(), /editor/i);
});

teste('funções de manutenção funcionam pelo editor (dono)', () => {
  const s = carregar();
  s.g('setup')();
  const msg = s.g('semearPrimeiroPmo')();
  assert.match(msg, /senha tempor/);
});

teste('papel Responsavel não chama APIs de equipe', () => {
  const s = sistemaComPmo();
  const tResp = criarUsuario(s, 'Responsavel', 'resp@hospital.org');
  const bloqueadas = [
    ['apiListarObras'], ['apiGetObraAdmin', 'OBR-X'], ['apiSalvarObra', { Titulo: 'x' }, []],
    ['apiPublicarObra', 'OBR-X'], ['apiMudarStatus', 'OBR-X', 'Publicada'], ['apiListarPedidos'],
    ['apiAtualizarStatusPedido', 'PED-X', 'Aceito', ''], ['apiVincularPedidoObra', 'PED-X', 'OBR-X'],
    ['apiKanban'], ['apiLookahead'], ['apiPagamentosResumo'], ['apiCriarRequisito', 'OBR-X', '', 'x', ''],
    ['apiAtualizarRequisito', 'R-X', 'Atendido', ''], ['apiEncerramentoResumo'], ['apiCompromissoSemanal'],
    ['apiListarAreasPropostas'], ['apiGetBaseline', 'OBR-X'], ['apiCurvaS', 'OBR-X']
  ];
  bloqueadas.forEach(([fn, ...args]) => {
    assert.throws(() => s.g(fn)(tResp, ...args), /restrita/i, fn + ' deveria bloquear o papel Responsavel');
  });
  // o que é dele continua funcionando
  assert.strictEqual(s.g('apiMeusPacotes')(tResp).length, 0);
});

teste('PMO rebaixado ou desativado perde o acesso na hora (sessão antiga cai)', () => {
  const s = sistemaComPmo();
  const tB = criarUsuario(s, 'PMO', 'pmo2@hospital.org');
  const B = s.g('apiListarUsuarios')(s.token).find(u => u.Email === 'pmo2@hospital.org');
  assert.ok(s.g('apiListarUsuarios')(tB).length >= 2, 'B começa como PMO');
  s.g('apiSalvarUsuario')(s.token, { ID: B.ID, Nome: B.Nome, Email: B.Email, Cargo: '', Papel: 'Engenharia', Status: 'ativo' });
  assert.throws(() => s.g('apiListarUsuarios')(tB), /login novamente/i, 'token antigo de B não pode continuar valendo como PMO');
  // B entra de novo, agora como Engenharia, e não consegue mexer em usuários
  const tB2 = s.g('login')('pmo2@hospital.org', 'senha-PMO').token;
  const A = s.g('apiListarUsuarios')(s.token).find(u => u.Papel === 'PMO');
  assert.throws(() => s.g('apiDesativarUsuario')(tB2, A.ID), /restrita/i);
  // desativado: sessão cai e o login é recusado
  s.g('apiDesativarUsuario')(s.token, B.ID);
  assert.throws(() => s.g('apiListarObras')(tB2), /login novamente/i);
  assert.throws(() => s.g('login')('pmo2@hospital.org', 'senha-PMO'), /incorretos/i);
});

teste('o último PMO ativo não pode ser desativado nem rebaixado', () => {
  const s = sistemaComPmo();
  const usuarios = () => s.g('readAll_')('Usuarios', s.g('USUARIOS_HEADERS'));
  const A = usuarios()[0];
  assert.throws(() => s.g('garantirOutroPmoAtivo_')(usuarios(), A.ID), /último PMO/);
  criarUsuario(s, 'PMO', 'pmo2@hospital.org');
  s.g('garantirOutroPmoAtivo_')(usuarios(), A.ID); // com dois PMOs, passa
  assert.throws(() => s.g('apiSalvarUsuario')(s.token, { ID: A.ID, Nome: A.Nome, Email: A.Email, Papel: 'Engenharia' }), /próprio papel/);
});

teste('página pública da obra só expõe os campos públicos', () => {
  const s = sistemaComPmo();
  const r = s.g('apiSalvarObra')(s.token, { Titulo: 'Obra pública', PrazoManifestacao: '2030-01-01', MotivoCancelamento: 'x' }, []);
  s.g('apiPublicarObra')(s.token, r.id);
  const pub = s.g('apiGetObraPublica')(r.id);
  ['CronogramaObservacoesPMO', 'CanceladoPor', 'MotivoCancelamento', 'IDPedidoOrigem', 'StatusCronograma']
    .forEach(c => assert.ok(!(c in pub.obra), c + ' não deveria ser público'));
  assert.strictEqual(pub.obra.Titulo, 'Obra pública');
});

// ─────────────────────────────── permissões configuráveis ───────────────────────────────

teste('perfil Consulta vê tudo mas não altera nada', () => {
  const s = sistemaComPmo();
  const id = s.g('apiSalvarObra')(s.token, { Titulo: 'Obra' }, []).id;
  const t = criarUsuario(s, 'Consulta', 'consulta@hospital.org');
  assert.strictEqual(s.g('apiListarObras')(t).length, 1);
  assert.strictEqual(s.g('apiGetObraAdmin')(t, id).obra.ID, id);
  s.g('apiKanban')(t);
  assert.throws(() => s.g('apiSalvarObra')(t, { ID: id, Titulo: 'x' }, []), /restrita/);
  assert.throws(() => s.g('apiMudarStatus')(t, id, 'Publicada'), /restrita/);
  assert.throws(() => s.g('apiSalvarCronograma')(t, id, [], [], false), /restrita/);
});

teste('perfil criado pelo PMO vale na hora e muda na hora', () => {
  const s = sistemaComPmo();
  s.g('apiSalvarPerfil')(s.token, { Perfil: 'Financeiro', Novo: true, Descricao: 'Pagamentos', Permissoes: ['medicoes.ler', 'medicoes.editar', 'invalida.x'] });
  const t = criarUsuario(s, 'Financeiro', 'fin@hospital.org');
  assert.deepStrictEqual(Array.from(s.g('login')('fin@hospital.org', 'senha-Financeiro').permissoes), ['medicoes.ler', 'medicoes.editar']);
  s.g('apiPagamentosResumo')(t);
  assert.throws(() => s.g('apiListarObras')(t), /restrita/);
  novaExecucao(s);
  s.g('apiSalvarPerfil')(s.token, { Perfil: 'Financeiro', Permissoes: ['medicoes.ler', 'projetos.ler'] });
  novaExecucao(s);
  s.g('apiListarObras')(t); // passou a poder, sem novo login
  assert.throws(() => s.g('apiSalvarParcela')(t, {}), /restrita/);
  assert.throws(() => s.g('apiSalvarPerfil')(s.token, { Perfil: 'pmo', Novo: true, Permissoes: [] }), /PMO é fixo/);
  assert.throws(() => s.g('apiSalvarPerfil')(s.token, { Perfil: 'Financeiro', Novo: true, Permissoes: [] }), /Já existe/);
});

teste('perfil em uso não pode ser excluído; perfil vazio pode', () => {
  const s = sistemaComPmo();
  criarUsuario(s, 'Consulta', 'c@hospital.org');
  assert.throws(() => s.g('apiExcluirPerfil')(s.token, 'Consulta'), /usuário/);
  s.g('apiExcluirPerfil')(s.token, 'Responsavel');
  assert.ok(s.g('perfisValidos_')().indexOf('Responsavel') < 0);
  assert.throws(() => criarUsuario(s, 'Responsavel', 'r@hospital.org'), /perfil/);
});

teste('aprovadores: PMO sempre; demais por perfil ou por usuário, tipo e portão', () => {
  const s = sistemaComPmo();
  const tEng = criarUsuario(s, 'Engenharia', 'eng@hospital.org');
  const tCons = criarUsuario(s, 'Consulta', 'cons@hospital.org');
  const cons = s.g('apiConfigAcessos')(s.token).usuarios.find(u => u.Email === 'cons@hospital.org');
  s.g('apiSalvarAprovadores')(s.token, [
    { Tipo: 'Obra', Portao: 'G0', Perfil: 'Engenharia' },
    { Tipo: 'Todos', Portao: 'G1', UsuarioId: cons.ID },
    { Tipo: 'Obra', Portao: 'G0', Perfil: 'Engenharia' }, // repetido: ignorado
    { Tipo: 'Obra', Portao: 'G9', Perfil: 'Engenharia' }  // portão inválido: ignorado
  ]);
  novaExecucao(s);
  const sess = (t) => s.g('validarToken_')(t);
  const pode = s.g('podeAprovar_');
  assert.strictEqual(s.g('apiConfigAcessos')(s.token).aprovadores.length, 2);
  assert.ok(pode(sess(s.token), 'Projeto', 'G4'));
  assert.ok(pode(sess(tEng), 'Obra', 'G0'));
  assert.ok(!pode(sess(tEng), 'Projeto', 'G0'));
  assert.ok(pode(sess(tCons), 'Projeto', 'G1'));
  assert.ok(!pode(sess(tCons), 'Obra', 'G0'));
});

teste('trocar a própria senha exige a atual e derruba as sessões antigas', () => {
  const s = sistemaComPmo();
  const t = criarUsuario(s, 'Engenharia', 'eng@hospital.org');
  assert.throws(() => s.g('apiTrocarMinhaSenha')(t, 'errada', 'nova-senha-1'), /não confere/);
  assert.throws(() => s.g('apiTrocarMinhaSenha')(t, 'senha-Engenharia', '123'), /pelo menos/);
  s.g('apiTrocarMinhaSenha')(t, 'senha-Engenharia', 'nova-senha-1');
  assert.throws(() => s.g('apiListarObras')(t), /Sessão inválida/);
  assert.ok(s.g('login')('eng@hospital.org', 'nova-senha-1').token);
  assert.deepStrictEqual(Array.from(s.g('apiMinhaSessao')(s.g('login')('eng@hospital.org', 'nova-senha-1').token).permissoes).slice(0, 1), ['painel.ler']);
});

teste('só o PMO acessa as configurações de acesso', () => {
  const s = sistemaComPmo();
  const t = criarUsuario(s, 'Engenharia', 'eng@hospital.org');
  ['apiConfigAcessos', 'apiSalvarPerfil', 'apiExcluirPerfil', 'apiSalvarAprovadores', 'apiListarUsuarios', 'apiSalvarUsuario']
    .forEach(fn => assert.throws(() => s.g(fn)(t, {}), /restrita/i, fn));
});

// ─────────────────────────────── integridade ───────────────────────────────

teste('salvar o cronograma de uma obra não altera nenhuma linha de outra obra', () => {
  const s = sistemaComPmo();
  const A = s.g('apiSalvarObra')(s.token, { Titulo: 'Obra A' }, []).id;
  const B = s.g('apiSalvarObra')(s.token, { Titulo: 'Obra B' }, []).id;
  const pac = (n, custo) => ({ EtapaIdx: 0, Atividade: n, CustoDoacao: '0', CustoProprio: custo, PredecessoraIdx: [] });
  s.g('apiSalvarCronograma')(s.token, A, [{ Nome: 'Etapa A' }], [pac('A1', '1500,50'), pac('A2', '10')], false);
  s.g('apiSalvarCronograma')(s.token, B, [{ Nome: 'Etapa B' }], [pac('B1', '5')], false);
  const cron = s.amb.aba('Cronograma');
  const linhasA = () => cron.data.filter(l => l[1] === A).map(l => JSON.stringify(l));
  const antes = linhasA();
  // B cresce, encolhe e é reordenado; A tem que ficar byte a byte igual
  s.g('apiSalvarCronograma')(s.token, B, [{ Nome: 'Etapa B' }], [pac('B1', '5'), pac('B2', '6'), pac('B3', '7')], false);
  s.g('apiSalvarCronograma')(s.token, B, [{ Nome: 'Etapa B' }], [pac('B3', '7')], false);
  assert.deepStrictEqual(linhasA(), antes);
  // o custo de A continua número (não virou texto formatado)
  assert.strictEqual(typeof cron.data.find(l => l[1] === A && l[4] === 'A1')[10 + 1], 'number');
  // B ficou exatamente com 1 pacote
  assert.strictEqual(cron.data.filter(l => l[1] === B).length, 1);
});

teste('salvar a EAP de uma obra não altera a EAP de outra', () => {
  const s = sistemaComPmo();
  const A = s.g('apiSalvarObra')(s.token, { Titulo: 'A' }, [{ Codigo: '1', Descricao: 'EAP A' }]).id;
  const B = s.g('apiSalvarObra')(s.token, { Titulo: 'B' }, [{ Codigo: '1', Descricao: 'EAP B' }]).id;
  const eap = s.amb.aba('EAP');
  const antes = JSON.stringify(eap.data.filter(l => l[1] === A));
  s.g('apiSalvarObra')(s.token, { ID: B, Titulo: 'B' }, [{ Codigo: '1', Descricao: 'x' }, { Codigo: '2', Descricao: 'y' }]);
  s.g('apiSalvarObra')(s.token, { ID: B, Titulo: 'B' }, []);
  assert.strictEqual(JSON.stringify(eap.data.filter(l => l[1] === A)), antes);
  assert.strictEqual(eap.data.filter(l => l[1] === B).length, 0);
});

teste('linha vazia no meio da aba não desloca as gravações', () => {
  const s = sistemaComPmo();
  const ids = ['1', '2', '3'].map(n => s.g('apiSalvarObra')(s.token, { Titulo: 'Obra ' + n }, []).id);
  const obras = s.amb.aba('Obras');
  obras.data[2] = obras.data[2].map(() => ''); // alguém apagou o conteúdo da 2ª obra na planilha
  s.g('apiMudarStatus')(s.token, ids[2], 'Publicada');
  const col = s.g('OBRAS_HEADERS').indexOf('Status');
  assert.strictEqual(obras.data[3][col], 'Publicada', 'a obra 3 deveria ter recebido o status');
  assert.strictEqual(obras.data[2][col], '', 'a linha apagada não pode ser escrita');
});

teste('IDs continuam únicos depois de 999 registros no ano', () => {
  const s = sistemaComPmo();
  const proximo = s.g('proximoId_');
  const H = s.g('RISCOS_HEADERS');
  const sh = s.amb.aba('Riscos');
  const vistos = new Set();
  for (let i = 0; i < 1003; i++) {
    const id = proximo('RISCO', 'Riscos', H, 'ID');
    assert.ok(!vistos.has(id), 'ID repetido: ' + id);
    vistos.add(id);
    sh.appendRow([id, 'O', 'P']);
  }
});

teste('ID não é reaproveitado depois que o último registro é excluído', () => {
  const s = sistemaComPmo();
  const proximo = s.g('proximoId_');
  const H = s.g('RISCOS_HEADERS');
  const sh = s.amb.aba('Riscos');
  const a = proximo('RISCO', 'Riscos', H, 'ID'); sh.appendRow([a]);
  const b = proximo('RISCO', 'Riscos', H, 'ID'); sh.appendRow([b]);
  sh.deleteRow(3);
  const c = proximo('RISCO', 'Riscos', H, 'ID');
  assert.notStrictEqual(c, b);
});

teste('mais de 99 pacotes numa obra geram IDs distintos', () => {
  const s = sistemaComPmo();
  const A = s.g('apiSalvarObra')(s.token, { Titulo: 'Grande' }, []).id;
  const pacotes = Array.from({ length: 120 }, (_, i) => ({ EtapaIdx: 0, Atividade: 'P' + i, PredecessoraIdx: [] }));
  s.g('apiSalvarCronograma')(s.token, A, [{ Nome: 'E' }], pacotes, false);
  const ids = s.amb.aba('Cronograma').data.filter(l => l[1] === A).map(l => l[0]);
  assert.strictEqual(new Set(ids).size, 120);
});

teste('listas grandes não quebram por causa do limite do cache', () => {
  const s = sistemaComPmo();
  const sh = s.amb.aba('Pedidos');
  const H = s.g('PEDIDOS_HEADERS');
  for (let i = 0; i < 800; i++) {
    const l = H.map(() => '');
    l[0] = 'PED-2026-' + i; l[H.indexOf('FinalidadeObjetivo')] = 'x'.repeat(300); l[H.indexOf('Status')] = 'Novo';
    sh.appendRow(l);
  }
  const lista = s.g('apiListarPedidos')(s.token);
  assert.strictEqual(lista.length, 800);
  assert.strictEqual(s.g('apiKanban')(s.token).pedidos.length, 800);
});

// ─────────────────────────────── leitura rápida / cache ───────────────────────────────

teste('depois de uma gravação a próxima leitura nunca mostra o dado antigo', () => {
  const s = sistemaComPmo();
  const id = s.g('apiSalvarObra')(s.token, { Titulo: 'Obra', PrazoManifestacao: '2030-01-01' }, []).id;
  novaExecucao(s);
  assert.strictEqual(s.g('apiGetObraAdmin')(s.token, id).obra.Status, 'Rascunho');
  assert.strictEqual(s.g('apiListarObras')(s.token)[0].Status, 'Rascunho');
  novaExecucao(s);
  s.g('apiPublicarObra')(s.token, id);
  novaExecucao(s);
  assert.strictEqual(s.g('apiGetObraAdmin')(s.token, id).obra.Status, 'Publicada');
  assert.strictEqual(s.g('apiListarObras')(s.token)[0].Status, 'Publicada');
  assert.strictEqual(s.g('apiKanban')(s.token).obras[0].Status, 'Publicada');
});

teste('edição manual na planilha (onEdit) invalida o cache', () => {
  const s = sistemaComPmo();
  const id = s.g('apiSalvarObra')(s.token, { Titulo: 'Antes' }, []).id;
  novaExecucao(s);
  assert.strictEqual(s.g('apiGetObraAdmin')(s.token, id).obra.Titulo, 'Antes');
  s.amb.aba('Obras').data[1][1] = 'Depois';
  novaExecucao(s);
  s.g('onEdit')();
  novaExecucao(s);
  assert.strictEqual(s.g('apiGetObraAdmin')(s.token, id).obra.Titulo, 'Depois');
});

teste('gravação usa a posição real da linha mesmo com o cache desatualizado', () => {
  const s = sistemaComPmo();
  const a = s.g('apiSalvarObra')(s.token, { Titulo: 'A' }, []).id;
  const b = s.g('apiSalvarObra')(s.token, { Titulo: 'B' }, []).id;
  novaExecucao(s);
  s.g('apiListarObras')(s.token); // cache guarda B na linha 3
  s.amb.aba('Obras').deleteRow(2); // alguém apaga a linha de A à mão, sem gatilho
  novaExecucao(s);
  s.g('apiMudarStatus')(s.token, b, 'Publicada');
  const col = s.g('OBRAS_HEADERS').indexOf('Status');
  assert.strictEqual(s.amb.aba('Obras').data[1][0], b);
  assert.strictEqual(s.amb.aba('Obras').data[1][col], 'Publicada');
});

teste('leitura em lote (API do Sheets) devolve exatamente o mesmo que a leitura aba a aba', () => {
  const s = sistemaComPmo();
  s.g('criarProjetosExemplo')();
  const abas = ['Obras', 'EAP', 'Manifestacoes', 'Cronograma', 'Usuarios', 'Baseline'];
  novaExecucao(s);
  const lote = s.g('lerAbasDaPlanilha_')(abas.map(n => [n, s.g('cabecalhosDaAba_')(n).length]));
  abas.forEach(n => {
    const uma = s.g('lerAbaDaPlanilha_')(n, s.g('cabecalhosDaAba_')(n).length);
    assert.strictEqual(JSON.stringify(lote[n]), JSON.stringify(uma), 'aba ' + n);
  });
});

teste('aba grande passa pelo cache em partes sem perder nada', () => {
  const s = sistemaComPmo();
  const sh = s.amb.aba('Cronograma');
  const H = s.g('CRONOGRAMA_HEADERS');
  for (let i = 0; i < 1500; i++) {
    const l = H.map(() => ''); l[0] = 'OBR-2026-001-C' + i; l[1] = 'OBR-2026-001'; l[4] = 'Atividade com acentuação ' + i + ' ' + 'ç'.repeat(40);
    sh.appendRow(l);
  }
  novaExecucao(s);
  const direto = JSON.stringify(s.g('readAll_')('Cronograma', H));
  novaExecucao(s);
  const antes = s.amb.stats.chamadasPlanilha;
  const doCache = JSON.stringify(s.g('readAll_')('Cronograma', H));
  assert.strictEqual(s.amb.stats.chamadasPlanilha, antes, 'a 2ª leitura deveria vir do cache');
  assert.strictEqual(doCache, direto);
});

teste('tela aberta de novo (cache quente) não toca na planilha', () => {
  const s = sistemaComPmo();
  s.g('criarProjetosExemplo')();
  const id = s.g('apiListarObras')(s.token)[0].ID;
  novaExecucao(s);
  s.g('apiGetObraAdmin')(s.token, id);
  s.g('apiKanban')(s.token);
  s.g('apiLookahead')(s.token);
  novaExecucao(s);
  const antes = s.amb.stats.chamadasPlanilha;
  s.g('apiGetObraAdmin')(s.token, id);
  s.g('apiKanban')(s.token);
  s.g('apiLookahead')(s.token);
  assert.strictEqual(s.amb.stats.chamadasPlanilha - antes, 0);
});

// ─────────────────────────────── painel ───────────────────────────────

teste('painel: "aguardando você" respeita o perfil de quem está logado', () => {
  const s = sistemaComPmo();
  s.g('criarProjetosExemplo')(); // deixa 1 medição pendente
  s.g('apiCriarPedido')({ Nome: 'A', Cargo: 'B', Contato: 'c', Area: 'TI', FinalidadeObjetivo: 'Pedido novo', Urgencia: 'Urgente — menos de 1 mês' });
  const tEng = criarUsuario(s, 'Engenharia', 'eng@hospital.org');
  const tCons = criarUsuario(s, 'Consulta', 'cons@hospital.org');
  const tResp = criarUsuario(s, 'Responsavel', 'resp@hospital.org');
  novaExecucao(s);
  const tipos = (t) => s.g('apiPainel')(t).aguardando.map(a => a.tipo).sort().join(',');
  assert.strictEqual(tipos(s.token), 'medicao,pedido');
  assert.strictEqual(tipos(tEng), 'pedido');
  assert.strictEqual(tipos(tCons), '');
  assert.throws(() => s.g('apiPainel')(tResp), /restrita/);
  // urgente vem primeiro
  assert.strictEqual(s.g('apiPainel')(s.token).aguardando[0].tipo, 'pedido');
});

teste('painel: situação atrasado/atenção e indicadores', () => {
  const s = sistemaComPmo();
  s.g('criarProjetosExemplo')(); // obra 2 tem pacote em andamento com fim no passado
  novaExecucao(s);
  const p = s.g('apiPainel')(s.token);
  const obra2 = p.itens.find(i => i.ID === 'OBR-2026-002');
  assert.strictEqual(obra2.situacao, 'atrasado');
  assert.match(obra2.motivo, /atrasad/);
  assert.strictEqual(p.indicadores.projetosAtivos, 2);
  assert.strictEqual(p.indicadores.atrasados, 1);
  assert.strictEqual(p.indicadores.valorMedidoPendente, 18000);
  assert.deepStrictEqual(Array.from(p.fases), ['Pedido', 'Manifestação', 'Cronograma', 'Validado', 'Execução', 'Encerramento']);
});

// ─────────────────────────────── fluxo completo ───────────────────────────────

teste('fluxo completo de exemplo (pedido → obra → cronograma → baseline → medições) roda sem erro', () => {
  const s = sistemaComPmo();
  const msg = s.g('criarProjetosExemplo')();
  assert.match(msg, /PROJETO 1/);
  assert.match(msg, /PROJETO 2/);
  const obras = s.g('apiListarObras')(s.token);
  assert.strictEqual(obras.length, 2);
  const det = s.g('apiGetObraAdmin')(s.token, obras[0].ID);
  assert.ok(det.cronograma.length >= 3);
  assert.ok(s.g('apiGetBaseline')(s.token, obras[0].ID).length >= 3);
});

// ─────────────────────────────── execução ───────────────────────────────

const soNome = process.argv[2];
let falhas = 0;
testes.filter(t => !soNome || t.nome.indexOf(soNome) >= 0).forEach(t => {
  try {
    t.fn();
    console.log('  ok   ' + t.nome);
  } catch (e) {
    falhas++;
    console.log('  FALHOU ' + t.nome + '\n         ' + String(e && e.message || e).split('\n')[0]);
  }
});
console.log(falhas ? '\n' + falhas + ' teste(s) falharam' : '\nTodos os ' + testes.length + ' testes passaram');
process.exit(falhas ? 1 : 0);
