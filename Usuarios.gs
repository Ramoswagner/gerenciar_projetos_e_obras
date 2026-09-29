/**
 * Gestão de usuários — só PMO ativa/cadastra (não há autocadastro).
 * Substitui por completo o PIN compartilhado do sistema anterior.
 */

function apiListarUsuarios(token) {
  exigirPMO_(token);
  return readAll_(SHEETS.USUARIOS, USUARIOS_HEADERS).map(u => ({
    ID: u.ID, Nome: u.Nome, Email: u.Email, Cargo: u.Cargo,
    Papel: u.Papel, Status: u.Status, CriadoEm: u.CriadoEm
    // SenhaHash nunca sai daqui, em nenhuma leitura.
  }));
}

function apiSalvarUsuario(token, dados) {
  const sessao = exigirPMO_(token);
  const nome = sanitize_(dados.Nome, 120);
  const email = normalizarEmail_(dados.Email);
  const cargo = sanitize_(dados.Cargo, 120);
  const papel = PAPEIS.indexOf(dados.Papel) >= 0 ? dados.Papel : null;

  if (!nome || !email || !papel) throw new Error('Preencha nome, e-mail e papel.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const usuarios = readAll_(SHEETS.USUARIOS, USUARIOS_HEADERS);
    const isNew = !dados.ID;
    const existente = !isNew ? usuarios.find(u => u.ID === dados.ID) : null;
    if (!isNew && !existente) throw new Error('Usuário não encontrado.');

    // Conta protegida: PMO não pode mudar o próprio papel nem se
    // desativar — evita se trancar pra fora do sistema sem querer.
    if (existente && existente.ID === sessao.usuarioId) {
      if (papel !== existente.Papel) throw new Error('Você não pode alterar o próprio papel.');
      if (dados.Status === 'inativo') throw new Error('Você não pode desativar a própria conta.');
    }

    const duplicado = usuarios.find(u =>
      normalizarEmail_(u.Email) === email && (!existente || u.ID !== existente.ID));
    if (duplicado) throw new Error('Já existe um usuário com este e-mail.');

    // Senha inicial obrigatória na criação; na edição, campo em branco
    // preserva a senha atual (mesmo padrão do projeto Diagnóstico).
    const senha = sanitize_(dados.Senha, 200);
    if (isNew && !senha) throw new Error('Defina uma senha inicial para o novo usuário.');
    const senhaHash = senha ? hashSenha_(senha) : (existente ? existente.SenhaHash : '');

    const sh = ss_().getSheetByName(SHEETS.USUARIOS);
    const id = isNew ? proximoId_('USR', SHEETS.USUARIOS, USUARIOS_HEADERS, 'ID') : existente.ID;
    const row = USUARIOS_HEADERS.map(h => {
      if (h === 'ID') return id;
      if (h === 'Nome') return nome;
      if (h === 'Email') return email;
      if (h === 'SenhaHash') return senhaHash;
      if (h === 'Cargo') return cargo;
      if (h === 'Papel') return papel;
      if (h === 'Status') return dados.Status === 'inativo' ? 'inativo' : 'ativo';
      if (h === 'CriadoPor') return existente ? existente.CriadoPor : sessao.nome;
      if (h === 'CriadoEm') return existente ? existente.CriadoEm : nowIso_();
      if (h === 'AtualizadoEm') return nowIso_();
      return '';
    });

    if (existente) {
      sh.getRange(existente._row, 1, 1, USUARIOS_HEADERS.length).setValues([row]);
    } else {
      sh.appendRow(row);
    }
    return { ok: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

// Soft-disable (Status='inativo'), nunca exclusão física — mesmo
// princípio já usado em todo o resto do sistema (nada é deletado, só
// muda de status), preserva o rastro de quem fez o quê no histórico.
function apiDesativarUsuario(token, id) {
  const sessao = exigirPMO_(token);
  if (id === sessao.usuarioId) throw new Error('Você não pode desativar a própria conta.');
  const usuario = readAll_(SHEETS.USUARIOS, USUARIOS_HEADERS).find(u => u.ID === id);
  if (!usuario) throw new Error('Usuário não encontrado.');
  ss_().getSheetByName(SHEETS.USUARIOS)
    .getRange(usuario._row, USUARIOS_HEADERS.indexOf('Status') + 1)
    .setValue('inativo');
  return { ok: true };
}

// ────────────────────────────────────────────── SEMENTE (rodar no editor) ──
//
// Cria o primeiro PMO — ou, se ele já existe, RENOVA a senha temporária
// (serve também como "esqueci a senha" do admin inicial, enquanto não há
// outro PMO pra resetar pela tela). O resultado sai via Logger.log — o
// editor NÃO exibe valores de return, só o log (lição aprendida: a 1ª
// versão desta função retornava a senha e ela nunca aparecia pra ninguém).
// SEM "_" no nome de propósito: o seletor de "Executar" do editor esconde
// funções terminadas em "_" (convenção de função privada) — esta precisa
// aparecer porque é rodada manualmente.
function semearPrimeiroPmo() {
  const NOME_ADMIN = 'Núcleo de Projetos';
  const EMAIL_ADMIN = 'nucleodeprojetos@hospitaldabaleia.org.br';

  const email = normalizarEmail_(EMAIL_ADMIN);
  const senhaTemp = Utilities.getUuid().slice(0, 8);
  const sh = ensureSheet_(ss_(), SHEETS.USUARIOS, USUARIOS_HEADERS);
  const existente = readAll_(SHEETS.USUARIOS, USUARIOS_HEADERS)
    .find(u => normalizarEmail_(u.Email) === email);

  let msg;
  if (existente) {
    const col = (h) => USUARIOS_HEADERS.indexOf(h) + 1;
    sh.getRange(existente._row, col('SenhaHash')).setValue(hashSenha_(senhaTemp));
    sh.getRange(existente._row, col('Status')).setValue('ativo');
    sh.getRange(existente._row, col('AtualizadoEm')).setValue(nowIso_());
    msg = 'PMO já existia — senha RENOVADA.';
  } else {
    sh.appendRow([
      proximoId_('USR', SHEETS.USUARIOS, USUARIOS_HEADERS, 'ID'),
      NOME_ADMIN, email, hashSenha_(senhaTemp),
      'Administrador do Núcleo de Projetos', 'PMO', 'ativo',
      'semearPrimeiroPmo', nowIso_(), nowIso_()
    ]);
    msg = 'PMO inicial criado.';
  }

  const resultado = msg + '\ne-mail: ' + email + '\nsenha temporária: ' + senhaTemp +
    '\n(troque depois de logar, pela tela de Usuários quando ela existir)';
  Logger.log(resultado);
  return resultado;
}
