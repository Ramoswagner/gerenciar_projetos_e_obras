/**
 * Backup semanal da planilha inteira — portado 1:1 do sistema atual.
 */

// Copia a planilha inteira para a mesma pasta do Drive e remove backups
// com mais de 90 dias. Executada pelo trigger semanal (ver
// instalarTriggerBackup) ou manualmente pelo editor.
function backupSemanal() {
  somenteEditor_();
  const ss = ss_();
  const arquivo = DriveApp.getFileById(ss.getId());
  const pais = arquivo.getParents();
  const pasta = pais.hasNext() ? pais.next() : DriveApp.getRootFolder();

  const nome = 'Backup Obras HB ' +
    Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
  arquivo.makeCopy(nome, pasta);

  const limite = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const it = pasta.getFilesByType(MimeType.GOOGLE_SHEETS);
  let removidos = 0;
  while (it.hasNext()) {
    const f = it.next();
    if (f.getId() !== ss.getId() &&
        f.getName().indexOf('Backup Obras HB ') === 0 &&
        f.getDateCreated() < limite) {
      f.setTrashed(true);
      removidos++;
    }
  }
  return 'Backup criado: ' + nome + (removidos ? ' · ' + removidos + ' backup(s) antigo(s) removido(s).' : '');
}

// Rodar UMA vez manualmente pelo editor após o deploy. Substitui os
// gatilhos anteriores se já existirem, então é seguro rodar de novo.
// Instala: backup semanal + aviso de mudança de estrutura na planilha
// (linhas inseridas/apagadas à mão), que invalida o cache de leitura.
function instalarGatilhos() {
  somenteEditor_();
  ScriptApp.getProjectTriggers()
    .filter(t => ['backupSemanal', 'aoAlterarPlanilha'].indexOf(t.getHandlerFunction()) >= 0)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('backupSemanal')
    .timeBased()
    .everyWeeks(1)
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(3)
    .create();
  ScriptApp.newTrigger('aoAlterarPlanilha')
    .forSpreadsheet(ss_())
    .onChange()
    .create();
  return 'Gatilhos instalados: backup semanal (domingos ~3h) e atualização do cache quando a planilha muda de estrutura.';
}

// Nome antigo, mantido para quem já usa pelo editor.
function instalarTriggerBackup() {
  return instalarGatilhos();
}
