/**
 * Autenticação — login individual por e-mail institucional + senha,
 * substituindo o PIN compartilhado por papel do sistema anterior.
 *
 * Padrão adaptado do projeto irmão `relatorio_diagnostico/apps_script/`
 * (Auth.gs/Setup.gs) — hash SHA-256+salt, sessão por token em
 * CacheService com TTL deslizante. Ver Usuarios.gs pro CRUD (só PMO).
 */

// Salt fixo global (não por usuário) — mesma escolha já validada e usada
// no projeto Diagnóstico Estratégico; o usuário aceitou esse teto de
// segurança explicitamente para este projeto também. Salt PRÓPRIO deste
// projeto (não é o mesmo texto do Diagnóstico), pra que vazar um não
// comprometa o outro.
const SENHA_SALT = 'hb-obras-2026::';

function hashSenha_(txt) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, SENHA_SALT + txt, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

function normalizarEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

// 6h deslizante: expira só depois de 6h de INATIVIDADE (cada chamada
// válida renova o TTL), não 6h fixas desde o login.
const SESSAO_TTL_SEG = 21600;
const SESSAO_CACHE_PREFIXO = 'obrasHb_sessao_';

function login(email, senha) {
  const cache = CacheService.getScriptCache();
  const emailNorm = normalizarEmail_(email);
  const BLOCK_KEY = 'obrasHb_loginBlock_' + emailNorm;
  const FAILS_KEY = 'obrasHb_loginFails_' + emailNorm;

  if (cache.get(BLOCK_KEY)) {
    throw new Error('Muitas tentativas incorretas. Aguarde alguns minutos e tente novamente.');
  }

  const usuario = readAll_(SHEETS.USUARIOS, USUARIOS_HEADERS)
    .find(u => normalizarEmail_(u.Email) === emailNorm);
  const hashInformado = hashSenha_(senha);
  const ok = !!usuario && usuario.Status === 'ativo' && usuario.SenhaHash === hashInformado;

  if (!ok) {
    const fails = (parseInt(cache.get(FAILS_KEY), 10) || 0) + 1;
    if (fails >= 5) {
      cache.put(BLOCK_KEY, '1', 600); // bloqueia 10 minutos
      cache.remove(FAILS_KEY);
      throw new Error('Muitas tentativas incorretas. Acesso bloqueado por 10 minutos.');
    }
    cache.put(FAILS_KEY, String(fails), 600);
    throw new Error('E-mail ou senha incorretos.');
  }

  cache.remove(FAILS_KEY);

  const token = Utilities.getUuid();
  const payload = {
    usuarioId: usuario.ID, nome: usuario.Nome, email: usuario.Email,
    cargo: usuario.Cargo, papel: usuario.Papel, v: versaoSessao_(usuario.ID)
  };
  cache.put(SESSAO_CACHE_PREFIXO + token, JSON.stringify(payload), SESSAO_TTL_SEG);

  return {
    ok: true, token: token, nome: usuario.Nome, papel: usuario.Papel, cargo: usuario.Cargo,
    permissoes: permissoesDoPerfil_(usuario.Papel)
  };
}

function logout(token) {
  if (token) CacheService.getScriptCache().remove(SESSAO_CACHE_PREFIXO + token);
  return { ok: true };
}

// Valida o token e desliza o TTL. Chamada no início de toda função de API
// que exige sessão — substitui checkPin_ do sistema atual.
function validarToken_(token) {
  if (!token) throw new Error('Sessão inválida. Faça login novamente.');
  const cache = CacheService.getScriptCache();
  const key = SESSAO_CACHE_PREFIXO + token;
  const raw = cache.get(key);
  if (!raw) throw new Error('Sessão expirada. Faça login novamente.');
  const sessao = JSON.parse(raw);
  // papel, status ou senha mudaram depois do login: a sessão antiga não vale mais
  if ((sessao.v || '0') !== versaoSessao_(sessao.usuarioId)) {
    cache.remove(key);
    throw new Error('Sessão inválida: seu acesso foi alterado. Faça login novamente.');
  }
  cache.put(key, raw, SESSAO_TTL_SEG);
  return sessao;
}

// Versão das sessões de cada usuário. Mudar papel, status ou senha avança a
// versão e derruba todas as sessões abertas daquela pessoa — sem isso um PMO
// rebaixado ou desativado continuaria agindo como PMO até a sessão expirar.
function versaoSessao_(usuarioId) {
  return PropertiesService.getScriptProperties().getProperty('SESSAO_VER_' + usuarioId) || '0';
}

function encerrarSessoesDe_(usuarioId) {
  const props = PropertiesService.getScriptProperties();
  const atual = parseInt(props.getProperty('SESSAO_VER_' + usuarioId), 10) || 0;
  props.setProperty('SESSAO_VER_' + usuarioId, String(atual + 1));
}

// papeisPermitidos: array, ex. ['PMO'] ou ['PMO','Engenharia']. Endpoints
// sem restrição de papel usam validarToken_ direto — mesmo espírito de
// checkPapel_/checkPin_ do sistema atual, generalizado pra N papéis.
function exigirPapel_(token, papeisPermitidos) {
  const sessao = validarToken_(token);
  if (papeisPermitidos.indexOf(sessao.papel) < 0) {
    throw new Error('Ação restrita a: ' + papeisPermitidos.join(', ') + '. Você está logado como ' + sessao.papel + '.');
  }
  return sessao;
}

function exigirPMO_(token) {
  return exigirPapel_(token, ['PMO']);
}

// Telas e ações da equipe (tudo menos a visão reduzida do Responsável).
function exigirEquipe_(token) {
  return exigirPapel_(token, ['PMO', 'Engenharia']);
}

// Funções de manutenção (setup, semente do PMO, backup, migrações, testes)
// não terminam em "_" para aparecerem no seletor "Executar" do editor — e,
// por isso mesmo, também poderiam ser chamadas pelo navegador por qualquer
// visitante do web app. Esta checagem só deixa passar o dono do script: no
// editor e nos gatilhos dele, o usuário ativo é o próprio dono; um visitante
// anônimo aparece sem e-mail, e um colega do domínio, com o e-mail dele.
function somenteEditor_() {
  let ativo = '';
  try { ativo = Session.getActiveUser().getEmail(); } catch (e) { ativo = ''; }
  const dono = Session.getEffectiveUser().getEmail();
  if (!ativo || ativo !== dono) {
    throw new Error('Esta função só pode ser executada pelo editor do Apps Script.');
  }
}

// ────────────────────────────────────────────── TESTE (rodar no editor) ──
//
// Cria um usuário-fixture isolado, roda os cenários, e remove a linha no
// final (try/finally) mesmo se algo falhar no meio — nunca deixa lixo na
// aba Usuarios real. Mesmo padrão de suite embutida no .gs já usado no
// projeto Diagnóstico (testAuth/testGestores/runTestSuite).
function testAuth() {
  somenteEditor_();
  const resultados = [];
  const ok = (cond, msg) => resultados.push((cond ? 'OK' : 'FALHOU') + ' — ' + msg);

  const sh = ensureSheet_(ss_(), SHEETS.USUARIOS, USUARIOS_HEADERS);
  const emailTeste = 'teste.auth+' + Date.now() + '@hospitaldabaleia.org.br';
  const senhaTeste = 'senhaTeste123';
  sh.appendRow([
    'TESTE-AUTH', 'Usuário de Teste', emailTeste, hashSenha_(senhaTeste),
    'Cargo Teste', 'PMO', 'ativo', 'testAuth', nowIso_(), nowIso_()
  ]);

  dadosAlterados_(); // a linha de teste foi gravada fora de comLock_
  try {
    const r1 = login(emailTeste, senhaTeste);
    ok(r1.ok && !!r1.token, 'login com credenciais corretas retorna token');

    const sessao = validarToken_(r1.token);
    ok(sessao.papel === 'PMO', 'sessão carrega o papel correto');

    let senhaErradaFalhou = false;
    try { login(emailTeste, 'senhaErrada'); } catch (e) { senhaErradaFalhou = true; }
    ok(senhaErradaFalhou, 'login com senha errada lança erro');

    const r2 = login('  ' + emailTeste.toUpperCase() + '  ', senhaTeste);
    ok(r2.ok, 'login tolera maiúsculas/espaços no e-mail');

    let tokenInvalidoFalhou = false;
    try { validarToken_('token-que-nao-existe'); } catch (e) { tokenInvalidoFalhou = true; }
    ok(tokenInvalidoFalhou, 'token inexistente é rejeitado');

    let papelErradoFalhou = false;
    try { exigirPapel_(r1.token, ['Engenharia']); } catch (e) { papelErradoFalhou = true; }
    ok(papelErradoFalhou, 'exigirPapel_ bloqueia quando o papel logado não bate');

    logout(r1.token);
    let aposLogoutFalhou = false;
    try { validarToken_(r1.token); } catch (e) { aposLogoutFalhou = true; }
    ok(aposLogoutFalhou, 'token é invalidado após logout');

    let bloqueioAtivo = false;
    for (let i = 0; i < 5; i++) {
      try { login(emailTeste, 'senhaErradaDeNovo'); } catch (e) { /* esperado */ }
    }
    // as duas mensagens possíveis (5ª tentativa vs. bloqueio já ativo)
    // compartilham "tentativas incorretas" — é esse o trecho estável.
    try { login(emailTeste, senhaTeste); } catch (e) { bloqueioAtivo = /tentativas incorretas/i.test(e.message); }
    ok(bloqueioAtivo, '5 tentativas erradas bloqueiam mesmo a senha certa por 10min');
  } finally {
    dadosAlterados_();
    const linhaTeste = readAll_(SHEETS.USUARIOS, USUARIOS_HEADERS).find(u => u.ID === 'TESTE-AUTH');
    if (linhaTeste) ss_().getSheetByName(SHEETS.USUARIOS).deleteRow(linhaTeste._row);
    dadosAlterados_();
    // limpa também o bloqueio de rate-limit criado no último cenário, pra
    // não atrapalhar uma próxima rodada de teste com o mesmo e-mail
    CacheService.getScriptCache().remove('obrasHb_loginBlock_' + normalizarEmail_(emailTeste));
  }

  Logger.log(resultados.join('\n'));
  const falhas = resultados.filter(r => r.indexOf('FALHOU') === 0);
  Logger.log(falhas.length ? ('\n⚠ ' + falhas.length + ' TESTE(S) FALHARAM') : ('\n✓ TODOS OS ' + resultados.length + ' TESTES PASSARAM'));
  return resultados;
}
