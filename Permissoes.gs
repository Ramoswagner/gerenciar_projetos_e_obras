/**
 * Perfis, permissões e aprovadores — configuráveis pelo PMO na tela
 * Configurações, na mesma lógica do sistema de eventos (perfil → módulo →
 * ações). Ficam em abas da planilha e são checados pelo SERVIDOR em toda
 * chamada (exigir_): esconder um botão na tela nunca é a proteção.
 *
 * Regras fixas, que nenhuma configuração muda:
 *  - o PMO pode tudo, inclusive aprovar qualquer portão;
 *  - só o PMO mexe em Configurações (usuários, perfis, aprovadores);
 *  - validar cronograma, conferir medição, decidir área proposta e
 *    finalizar projeto continuam exclusivos do PMO (exigirPMO_).
 */

// Catálogo do que pode ser liberado por perfil. `acoes` lista só o que faz
// sentido em cada módulo; a tela de permissões é montada a partir daqui.
const MODULOS = [
  { id: 'painel', rotulo: 'Painel', acoes: ['ler'] },
  { id: 'pedidos', rotulo: 'Pedidos', acoes: ['ler', 'editar'] },
  { id: 'projetos', rotulo: 'Projetos (cadastro, EAP, consulta às áreas, atas, requisitos)', acoes: ['ler', 'editar', 'cancelar'] },
  { id: 'areas', rotulo: 'Áreas e impactos', acoes: ['ler', 'editar'] },
  { id: 'cronograma', rotulo: 'Cronograma e riscos', acoes: ['ler', 'editar', 'excluir'] },
  { id: 'execucao', rotulo: 'Execução (restrições, Lookahead, Compromisso Semanal)', acoes: ['ler', 'editar', 'excluir'] },
  { id: 'minhas', rotulo: 'Minhas atividades (ver e marcar os próprios pacotes)', acoes: ['editar'] },
  { id: 'medicoes', rotulo: 'Medições e pagamentos', acoes: ['ler', 'editar', 'excluir'] },
  { id: 'encerramento', rotulo: 'Encerramento', acoes: ['ler', 'editar', 'excluir'] },
  { id: 'relatorios', rotulo: 'Relatórios em PDF e planilha', acoes: ['gerar'] }
];

const ACOES_ROTULO = {
  ler: 'ver', editar: 'cadastrar e editar', excluir: 'excluir', cancelar: 'cancelar', gerar: 'gerar'
};

// Ponto de partida quando a aba Permissoes ainda não existe — equivale ao
// que cada papel já podia fazer antes das permissões configuráveis.
const PERMISSOES_PADRAO = {
  Engenharia: {
    descricao: 'Equipe de engenharia: cadastra e acompanha projetos do pedido ao encerramento.',
    permissoes: ['painel.ler', 'pedidos.ler', 'pedidos.editar', 'projetos.ler', 'projetos.editar', 'projetos.cancelar',
      'areas.ler', 'areas.editar', 'cronograma.ler', 'cronograma.editar', 'cronograma.excluir',
      'execucao.ler', 'execucao.editar', 'execucao.excluir', 'medicoes.ler', 'medicoes.editar', 'medicoes.excluir',
      'encerramento.ler', 'encerramento.editar', 'encerramento.excluir', 'relatorios.gerar']
  },
  Responsavel: {
    descricao: 'Responsável de campo: vê e marca só os pacotes de trabalho dele.',
    permissoes: ['minhas.editar']
  },
  Consulta: {
    descricao: 'Acompanha tudo sem alterar nada.',
    permissoes: ['painel.ler', 'pedidos.ler', 'projetos.ler', 'areas.ler', 'cronograma.ler', 'execucao.ler',
      'medicoes.ler', 'encerramento.ler', 'relatorios.gerar']
  }
};

// Portões do ciclo de vida. Quem aprova cada um (além do PMO) vem da aba
// Aprovadores. Usados a partir das etapas de pedidos e fases do projeto.
const PORTOES = [
  { id: 'G0', rotulo: 'G0 · Triagem do pedido' },
  { id: 'G1', rotulo: 'G1 · Priorização' },
  { id: 'G2', rotulo: 'G2 · TAP aprovado' },
  { id: 'G3', rotulo: 'G3 · Baseline e ordem de início' },
  { id: 'G4', rotulo: 'G4 · Aceite da entrega' }
];
const TIPOS_PROJETO = ['Obra', 'Projeto'];

const PERMISSOES_HEADERS = ['Perfil', 'Permissoes', 'Descricao', 'AtualizadoPor', 'AtualizadoEm'];
const APROVADORES_HEADERS = ['ID', 'Tipo', 'Portao', 'Perfil', 'UsuarioId', 'CriadoPor', 'CriadoEm'];

// ────────────────────────────────────────────── CHECAGEM ──

// { perfil: { descricao, permissoes: Set-like objeto } } — lido da aba
// (com cache de leitura) ou do padrão, se a aba ainda não tem linhas.
function matrizPermissoes_() {
  const linhas = readAll_(SHEETS.PERMISSOES, PERMISSOES_HEADERS);
  const m = {};
  if (!linhas.length) {
    Object.keys(PERMISSOES_PADRAO).forEach(p => {
      m[p] = { descricao: PERMISSOES_PADRAO[p].descricao, permissoes: PERMISSOES_PADRAO[p].permissoes.slice() };
    });
    return m;
  }
  linhas.forEach(l => {
    m[l.Perfil] = {
      descricao: l.Descricao || '',
      permissoes: String(l.Permissoes || '').split(',').map(x => x.trim()).filter(Boolean)
    };
  });
  return m;
}

function perfisValidos_() {
  return ['PMO'].concat(Object.keys(matrizPermissoes_()));
}

function permissoesDoPerfil_(perfil) {
  if (perfil === 'PMO') {
    const todas = [];
    MODULOS.forEach(mod => mod.acoes.forEach(a => todas.push(mod.id + '.' + a)));
    return todas;
  }
  const p = matrizPermissoes_()[perfil];
  return p ? p.permissoes.slice() : [];
}

function temPermissao_(perfil, modulo, acao) {
  if (perfil === 'PMO') return true;
  return permissoesDoPerfil_(perfil).indexOf(modulo + '.' + acao) >= 0;
}

// Porta de entrada de toda API protegida: valida a sessão e a permissão.
function exigir_(token, modulo, acao) {
  const sessao = validarToken_(token);
  if (!temPermissao_(sessao.papel, modulo, acao)) {
    const mod = MODULOS.find(m => m.id === modulo);
    throw new Error('Ação restrita: o perfil ' + sessao.papel + ' não tem permissão para ' +
      (ACOES_ROTULO[acao] || acao) + ' em ' + (mod ? mod.rotulo : modulo) + '.');
  }
  return sessao;
}

// Pode aprovar o portão? O PMO sempre; os demais, se estiverem na aba
// Aprovadores para aquele tipo (ou "Todos") e portão — por perfil ou por
// usuário.
function podeAprovar_(sessao, tipo, portao) {
  if (sessao.papel === 'PMO') return true;
  return readAll_(SHEETS.APROVADORES, APROVADORES_HEADERS).some(a =>
    (a.Tipo === tipo || a.Tipo === 'Todos') && a.Portao === portao &&
    ((a.Perfil && a.Perfil === sessao.papel) || (a.UsuarioId && a.UsuarioId === sessao.usuarioId)));
}

// Usuários ativos cujo perfil tem a permissão (ex.: quem pode ser
// responsável de campo = quem tem minhas.editar).
function usuariosComPermissao_(modulo, acao) {
  return readAll_(SHEETS.USUARIOS, USUARIOS_HEADERS)
    .filter(u => u.Status === 'ativo' && u.Papel !== 'PMO' && temPermissao_(u.Papel, modulo, acao));
}

// ────────────────────────────────────────────── SESSÃO (qualquer usuário) ──

// O que a tela precisa saber de quem está logado: perfil e permissões,
// para montar o menu. A proteção de verdade continua no servidor.
function apiMinhaSessao(token) {
  const s = validarToken_(token);
  return { nome: s.nome, cargo: s.cargo, papel: s.papel, permissoes: permissoesDoPerfil_(s.papel) };
}

function apiTrocarMinhaSenha(token, senhaAtual, senhaNova) {
  const sessao = validarToken_(token);
  const nova = sanitize_(senhaNova, 200);
  if (nova.length < SENHA_MIN_CARACTERES) throw new Error('A nova senha precisa ter pelo menos ' + SENHA_MIN_CARACTERES + ' caracteres.');
  return comLock_(() => {
    const u = readAll_(SHEETS.USUARIOS, USUARIOS_HEADERS).find(x => x.ID === sessao.usuarioId);
    if (!u || u.Status !== 'ativo') throw new Error('Usuário não encontrado.');
    if (u.SenhaHash !== hashSenha_(senhaAtual)) throw new Error('A senha atual não confere.');
    atualizarCampos_(SHEETS.USUARIOS, USUARIOS_HEADERS, u._row, { SenhaHash: hashSenha_(nova), AtualizadoEm: nowIso_() });
    encerrarSessoesDe_(u.ID);
    return { ok: true };
  });
}

// ────────────────────────────────────────────── CONFIGURAÇÕES (só PMO) ──

function apiConfigAcessos(token) {
  exigirPMO_(token);
  prepararAbas_([SHEETS.PERMISSOES, SHEETS.APROVADORES, SHEETS.USUARIOS]);
  const matriz = matrizPermissoes_();
  const usuarios = readAll_(SHEETS.USUARIOS, USUARIOS_HEADERS);
  return {
    modulos: MODULOS,
    acoesRotulo: ACOES_ROTULO,
    portoes: PORTOES,
    tipos: TIPOS_PROJETO,
    perfis: Object.keys(matriz).map(p => ({
      perfil: p, descricao: matriz[p].descricao, permissoes: matriz[p].permissoes,
      usuarios: usuarios.filter(u => u.Papel === p && u.Status === 'ativo').length
    })),
    aprovadores: readAll_(SHEETS.APROVADORES, APROVADORES_HEADERS)
      .map(a => ({ ID: a.ID, Tipo: a.Tipo, Portao: a.Portao, Perfil: a.Perfil, UsuarioId: a.UsuarioId })),
    usuarios: usuarios.map(u => ({ ID: u.ID, Nome: u.Nome, Email: u.Email, Cargo: u.Cargo, Papel: u.Papel, Status: u.Status, CriadoEm: u.CriadoEm }))
  };
}

// Grava o perfil inteiro (cria se não existir). `permissoes` = lista de
// "modulo.acao"; o que não estiver no catálogo é descartado.
function apiSalvarPerfil(token, dados) {
  const sessao = exigirPMO_(token);
  dados = dados || {};
  const perfil = sanitize_(dados.Perfil, 40);
  if (!perfil) throw new Error('Dê um nome ao perfil.');
  if (!/^[A-Za-zÀ-ÿ0-9 ._-]+$/.test(perfil)) throw new Error('Use só letras, números, espaço, ponto, hífen ou sublinhado no nome do perfil.');
  if (perfil.toUpperCase() === 'PMO') throw new Error('O perfil PMO é fixo e tem acesso total.');
  const validas = [];
  MODULOS.forEach(m => m.acoes.forEach(a => validas.push(m.id + '.' + a)));
  const permissoes = (Array.isArray(dados.Permissoes) ? dados.Permissoes : [])
    .filter(p => validas.indexOf(p) >= 0)
    .filter((p, i, arr) => arr.indexOf(p) === i);
  const descricao = sanitize_(dados.Descricao, 300);

  return comLock_(() => {
    semearPermissoesSeVazia_(sessao.nome);
    const sh = ss_().getSheetByName(SHEETS.PERMISSOES);
    const linhas = readAll_(SHEETS.PERMISSOES, PERMISSOES_HEADERS);
    const existente = linhas.find(l => l.Perfil.toLowerCase() === perfil.toLowerCase());
    if (dados.Novo && existente) throw new Error('Já existe um perfil com este nome.');
    const linha = [existente ? existente.Perfil : perfil, permissoes.join(','), descricao, sessao.nome, nowIso_()];
    if (existente) sh.getRange(existente._row, 1, 1, PERMISSOES_HEADERS.length).setValues([linha]);
    else sh.getRange(sh.getLastRow() + 1, 1, 1, PERMISSOES_HEADERS.length).setValues([linha]);
    return { ok: true };
  });
}

// Só apaga perfil sem ninguém usando (evita usuário órfão sem permissões).
function apiExcluirPerfil(token, perfil) {
  const sessao = exigirPMO_(token);
  return comLock_(() => {
    semearPermissoesSeVazia_(sessao.nome);
    const emUso = readAll_(SHEETS.USUARIOS, USUARIOS_HEADERS).filter(u => u.Papel === perfil).length;
    if (emUso) throw new Error('Há ' + emUso + ' usuário(s) com este perfil. Mude o perfil deles antes de excluir.');
    const linha = readAll_(SHEETS.PERMISSOES, PERMISSOES_HEADERS).find(l => l.Perfil === perfil);
    if (!linha) throw new Error('Perfil não encontrado.');
    ss_().getSheetByName(SHEETS.PERMISSOES).deleteRow(linha._row);
    readAll_(SHEETS.APROVADORES, APROVADORES_HEADERS).filter(a => a.Perfil === perfil)
      .map(a => a._row).sort((a, b) => b - a)
      .forEach(r => ss_().getSheetByName(SHEETS.APROVADORES).deleteRow(r));
    return { ok: true };
  });
}

// Substitui a lista inteira de aprovadores (a tela edita e manda tudo).
function apiSalvarAprovadores(token, lista) {
  const sessao = exigirPMO_(token);
  const perfis = perfisValidos_();
  const usuarios = readAll_(SHEETS.USUARIOS, USUARIOS_HEADERS);
  const tiposOk = TIPOS_PROJETO.concat(['Todos']);
  const vistos = {};
  const limpa = (Array.isArray(lista) ? lista : []).map(a => ({
    Tipo: tiposOk.indexOf(a.Tipo) >= 0 ? a.Tipo : null,
    Portao: PORTOES.some(p => p.id === a.Portao) ? a.Portao : null,
    Perfil: a.Perfil && perfis.indexOf(a.Perfil) >= 0 && a.Perfil !== 'PMO' ? a.Perfil : '',
    UsuarioId: a.UsuarioId && usuarios.some(u => u.ID === a.UsuarioId) ? a.UsuarioId : ''
  })).filter(a => {
    if (!a.Tipo || !a.Portao || (!a.Perfil && !a.UsuarioId)) return false;
    const k = [a.Tipo, a.Portao, a.Perfil, a.UsuarioId].join('|');
    if (vistos[k]) return false;
    vistos[k] = true;
    return true;
  });
  return comLock_(() => {
    const sh = ensureSheet_(ss_(), SHEETS.APROVADORES, APROVADORES_HEADERS);
    const ultima = sh.getLastRow();
    if (ultima > 1) sh.deleteRows(2, ultima - 1);
    if (limpa.length) {
      const agora = nowIso_();
      sh.getRange(2, 1, limpa.length, APROVADORES_HEADERS.length).setValues(limpa.map((a, i) =>
        ['APR-' + largura_(i + 1, 3), a.Tipo, a.Portao, a.Perfil, a.UsuarioId, sessao.nome, agora]));
    }
    return { ok: true, total: limpa.length };
  });
}

// Na primeira alteração pela tela, grava o padrão na aba para ele passar a
// ser editável linha a linha.
function semearPermissoesSeVazia_(autor) {
  const sh = ensureSheet_(ss_(), SHEETS.PERMISSOES, PERMISSOES_HEADERS);
  if (sh.getLastRow() > 1) return;
  const agora = nowIso_();
  const linhas = Object.keys(PERMISSOES_PADRAO).map(p =>
    [p, PERMISSOES_PADRAO[p].permissoes.join(','), PERMISSOES_PADRAO[p].descricao, autor || 'padrão', agora]);
  sh.getRange(2, 1, linhas.length, PERMISSOES_HEADERS.length).setValues(linhas);
}
