/**
 * Baseline — snapshot congelado do Cronograma na 1ª validação do PMO.
 * Append-only, NUNCA reescrita depois de criada (mesmo com revalidações
 * futuras do cronograma) — é a referência fixa contra a qual a Curva S
 * físico-financeira compara o realizado (Medições aprovadas). Pré-
 * requisito da Fase 8 concluído na Fase 7: CustoDoacao/CustoProprio já
 * são número de verdade no Cronograma, então o snapshot também nasce
 * numérico, sem precisar reparsear texto aqui.
 */

// Congela o snapshot da obra — NUNCA sobrescreve se já existir baseline
// pra essa obra (idempotente: chamável em toda validação, só age na 1ª).
// Chamada de dentro de apiValidarCronograma (Cronograma.gs) quando
// aprovado=true.
function congelarBaseline_(idObra) {
  const jaTemBaseline = readAll_(SHEETS.BASELINE, BASELINE_HEADERS).some(b => b.IDObra === idObra);
  if (jaTemBaseline) return; // baseline é imutável — só a 1ª validação congela

  const pacotes = readAll_(SHEETS.CRONOGRAMA, CRONOGRAMA_HEADERS).filter(p => p.IDObra === idObra);
  if (!pacotes.length) return; // nada pra congelar (não deveria acontecer — validação exige cronograma)

  const sh = ensureSheet_(ss_(), SHEETS.BASELINE, BASELINE_HEADERS);
  const agora = nowIso_();
  const linhas = pacotes.map(p => [
    'BASE-' + p.ID, idObra, p.ID, p.IDEtapa, p.Atividade,
    p.DataInicioPrevista, p.DataFimPrevista,
    parseMoedaServidor_(p.CustoDoacao) || 0,
    parseMoedaServidor_(p.CustoProprio) || 0,
    agora
  ]);
  sh.getRange(sh.getLastRow() + 1, 1, linhas.length, BASELINE_HEADERS.length).setValues(linhas);
}

function apiGetBaseline(token, idObra) {
  exigir_(token, 'cronograma', 'ler');
  return readAll_(SHEETS.BASELINE, BASELINE_HEADERS).filter(b => b.IDObra === idObra)
    .sort((a, b) => String(a.DataInicioPrevista || '9999').localeCompare(String(b.DataInicioPrevista || '9999')));
}
