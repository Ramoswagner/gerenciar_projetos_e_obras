/**
 * Registro de Riscos por Pacote de Trabalho. Um pacote pode ter N riscos
 * cadastrados (local, nome, descrição, responsável, plano de ação, prazo
 * de solução em dias corridos ou úteis). Salvar: Engenharia e PMO — mesmo
 * papel que edita o cronograma. TemRisco (Cronograma) é sempre derivado
 * daqui em salvarEtapasPacotes_ (ver Cronograma.gs), nunca editado direto.
 */
function apiSalvarRisco(token, dados) {
  const sessao = exigirPapel_(token, ['Engenharia', 'PMO']);
  dados = dados || {};
  const idObra = sanitize_(dados.IDObra, 30);
  const idPacote = sanitize_(dados.IDPacote, 30);
  if (!idObra || !idPacote) throw new Error('Pacote de trabalho inválido — salve o pacote antes de cadastrar riscos.');
  const nome = sanitize_(dados.NomeRisco, 200);
  if (!nome) throw new Error('Informe o nome do risco.');
  const prazoNum = parseInt(dados.PrazoDias, 10);

  return comLock_(() => {
    const sh = ensureSheet_(ss_(), SHEETS.RISCOS, RISCOS_HEADERS);
    const idInformado = sanitize_(dados.ID, 30);
    const existente = idInformado ? readAll_(SHEETS.RISCOS, RISCOS_HEADERS).find(r => r.ID === idInformado) : null;

    const linha = [
      existente ? existente.ID : proximoId_('RISCO', SHEETS.RISCOS, RISCOS_HEADERS, 'ID'),
      idObra, idPacote,
      sanitize_(dados.Local, 150), nome, sanitize_(dados.Descricao, 1000),
      sanitize_(dados.Responsavel, 120), sanitize_(dados.PlanoAcao, 1000),
      isNaN(prazoNum) ? '' : prazoNum,
      TIPO_PRAZO_OPCOES.indexOf(dados.TipoPrazo) >= 0 ? dados.TipoPrazo : 'Corridos',
      existente ? existente.CriadoPor : sessao.nome,
      existente ? existente.CriadoEm : nowIso_(),
      sessao.nome, nowIso_()
    ];

    if (existente) {
      sh.getRange(existente._row, 1, 1, RISCOS_HEADERS.length).setValues([linha]);
    } else {
      sh.getRange(sh.getLastRow() + 1, 1, 1, RISCOS_HEADERS.length).setValues([linha]);
    }
    const risco = {};
    RISCOS_HEADERS.forEach((h, i) => risco[h] = linha[i]);
    return { ok: true, risco: risco };
  });
}

function apiExcluirRisco(token, idRisco) {
  exigirPapel_(token, ['Engenharia', 'PMO']);
  return comLock_(() => {
    const risco = readAll_(SHEETS.RISCOS, RISCOS_HEADERS).find(r => r.ID === idRisco);
    if (!risco) throw new Error('Risco não encontrado.');
    ss_().getSheetByName(SHEETS.RISCOS).deleteRow(risco._row);
    return { ok: true };
  });
}
