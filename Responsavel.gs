/**
 * Papel Responsável (Fase 11) — visão restrita pro dono de campo de um
 * Pacote de Trabalho: só enxerga os próprios pacotes (via
 * `ResponsavelUserId`, vinculado no editor de Cronograma por Engenharia/
 * PMO) e só pode fazer o checkoff dos que são dele — validado no
 * SERVIDOR (não confia em nada vindo do cliente além do token de sessão),
 * mesmo princípio de todo o resto do app: nunca confiar em autorização
 * feita só no front-end.
 */

function apiMeusPacotes(token) {
  const sessao = exigirPapel_(token, ['Responsavel']);
  const obras = readAll_(SHEETS.OBRAS, OBRAS_HEADERS);
  const obraPorId = {}; obras.forEach(o => obraPorId[o.ID] = o);
  return readAll_(SHEETS.CRONOGRAMA, CRONOGRAMA_HEADERS)
    .filter(p => p.ResponsavelUserId === sessao.usuarioId)
    .map(p => ({
      ID: p.ID, IDObra: p.IDObra,
      TituloObra: (obraPorId[p.IDObra] || {}).Titulo || p.IDObra,
      Atividade: p.Atividade,
      DataInicioPrevista: p.DataInicioPrevista, DataFimPrevista: p.DataFimPrevista,
      Status: p.Status
    }))
    .sort((a, b) => String(a.DataInicioPrevista || '9999').localeCompare(String(b.DataInicioPrevista || '9999')));
}

// Checkoff — SEMPRE valida no servidor que o pacote pertence à sessão
// atual (ResponsavelUserId === sessao.usuarioId), nunca confia em vir do
// cliente qual pacote pode ser alterado por quem.
function apiCheckoffPacote(token, idPacote, novoStatus) {
  const sessao = exigirPapel_(token, ['Responsavel']);
  if (CRONOGRAMA_STATUS.indexOf(novoStatus) < 0) throw new Error('Status inválido.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const pacote = readAll_(SHEETS.CRONOGRAMA, CRONOGRAMA_HEADERS).find(p => p.ID === idPacote);
    if (!pacote) throw new Error('Pacote não encontrado.');
    if (pacote.ResponsavelUserId !== sessao.usuarioId) {
      throw new Error('Você não é o responsável designado para este pacote.');
    }
    atualizarCampos_(SHEETS.CRONOGRAMA, CRONOGRAMA_HEADERS, pacote._row, { Status: novoStatus, AtualizadoEm: nowIso_() });
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}
