/**
 * ═══════════════════════════════════════════════════════════════════
 *  OBRAS HB — CIÊNCIA, MANIFESTAÇÃO E GOVERNANÇA DE OBRAS
 *  Hospital da Baleia · Engenharia e PMO
 *
 *  "nova versão" — reconstrução modular do sistema (ver Code.gs/App.html
 *  originais na pasta-mãe do projeto para o sistema em produção).
 *
 *  Este arquivo: schema da planilha (abas, cabeçalhos, enums) e setup
 *  idempotente. Autenticação vive em Auth.gs/Usuarios.gs — não há mais
 *  PIN por papel, login é individual por e-mail institucional.
 * ═══════════════════════════════════════════════════════════════════
 */

// Projeto standalone (não vinculado a uma planilha): cole aqui o ID da
// planilha. Se o script for container-bound (criado dentro da planilha),
// deixe vazio '' que o sistema usa a planilha ativa automaticamente.
const SPREADSHEET_ID = '';

const SHEETS = {
  OBRAS: 'Obras',
  EAP: 'EAP',
  MANIF: 'Manifestacoes',
  CONFIG: 'Config',
  PEDIDOS: 'Pedidos',
  REQUISITOS: 'Requisitos',
  PEDIDO_HIST: 'PedidoHistorico',
  AREAS_PROP: 'AreasPropostas',
  DECISOES_PRAZO: 'DecisoesPrazo',
  ATAS: 'Atas',
  CRONOGRAMA: 'Cronograma',
  ETAPAS: 'Etapas',
  USUARIOS: 'Usuarios',
  BASELINE: 'Baseline',
  PLANO_PAGAMENTO: 'PlanoPagamento',
  MEDICOES: 'Medicoes',
  RESTRICOES: 'Restricoes',
  COMPROMISSO_SEMANAL: 'CompromissoSemanal',
  ENCERRAMENTO_CHECKLIST: 'EncerramentoChecklist',
  ENCERRAMENTO_DOCUMENTOS: 'EncerramentoDocumentos',
  ENCERRAMENTO_ASSINATURAS: 'EncerramentoAssinaturas',
  RISCOS: 'Riscos',
  RESTRICOES_EVIDENCIAS: 'RestricoesEvidencias',
  MEDICOES_EVIDENCIAS: 'MedicoesEvidencias'
};

// ────────────────────────────────────────────── PAPÉIS E STATUS ──

const PAPEIS = ['PMO', 'Engenharia', 'Responsavel'];

// 'Cancelada' é alcançável de qualquer status anterior a 'Finalizado'
// (estado paralelo, não sequencial). 'Finalizado' só é atingido via
// apiFinalizarObra (Encerramento.gs), nunca pelo troca-status genérico —
// mesmo princípio que já isolava 'Manifestação encerrada' do troca-status
// genérico no sistema atual (ela só nasce via apiDecidirPrazo).
// 'Concluída' é o valor legado: obras já concluídas antes desta versão
// não migram retroativamente para 'Finalizado' — ver nota em apiFinalizarObra.
const OBRA_STATUS_OPCOES = [
  'Rascunho', 'Publicada', 'Manifestação encerrada', 'Liberada',
  'Em execução', 'Concluída', 'Cancelada', 'Finalizado'
];

const STATUS_CRONOGRAMA_OPCOES = ['Rascunho', 'Aguardando validação', 'Validado', 'Revisão solicitada'];
const CRONOGRAMA_STATUS = ['Não iniciada', 'Em andamento', 'Concluída'];

const URGENCIA_OPCOES = [
  'Sem urgência definida', 'Planejado — mais de 3 meses',
  'Necessário em até 3 meses', 'Urgente — menos de 1 mês'
];

// 'Cancelado' é do solicitante desistindo do próprio pedido (via link de
// acompanhamento); distinto de 'Recusado', que é decisão da Engenharia.
const STATUS_PEDIDO_OPCOES = [
  'Novo', 'Em análise', 'Aguardando mais informações', 'Aceito', 'Recusado', 'Cancelado'
];

const REQUISITO_STATUS = ['Pendente', 'Atendido', 'Recusado'];
const TIPO_DECISAO_PRAZO = ['Estender', 'Finalizar'];
const AREAS_PROP_STATUS = ['Pendente', 'Aprovada', 'Rejeitada'];

// Categorias compartilhadas entre Restrições (Lookahead) e Compromisso
// Semanal (motivo de não-cumprimento) — mesma lista nos dois lugares de
// propósito: um impedimento não resolvido é frequentemente a própria causa
// de uma atividade não cumprida na semana. Lista extraída literalmente do
// modelo de referência "plano_semanal_compromisso_de_campo".
const CATEGORIAS_NAO_CUMPRIMENTO = [
  'Materiais (Falta na Obra)', 'Projeto (Revisão Pendente)',
  'Mão de Obra (Ausência)', 'Equipamento (Falha)', 'Clima'
];

// 3 estados (não 2, não 4) — ver justificativa no plano de construção:
// os modelos de referência eram inconsistentes entre si (um usava Kanban
// de 3 colunas, outro uma legenda de 2 estados com tabela de 3 valores).
const RESTRICAO_STATUS_OPCOES = ['Pendente', 'Em tratamento', 'Liberada'];

const COMPROMISSO_STATUS_OPCOES = ['Planejado', 'Cumprido', 'Não cumprido'];
const MEDICAO_STATUS_OPCOES = ['Pendente', 'Aprovada', 'Rejeitada'];

// 'Aceite Final' (4ª etapa do stepper de Encerramento) não é item de
// checklist — é resolvida por EncerramentoAssinaturas, não por esta lista.
const ENCERRAMENTO_ETAPA_OPCOES = ['Inspeção Técnica', 'Lista de Qualidade', 'Revisão Documental'];
// Vocabulário reduzido em relação ao posicionamento de Manifestações (que
// tem 4 valores): pós-obra não existe "não impactada", e a distinção
// sem/com ressalvas vira o campo livre ObservacaoObjecao quando há Objeção.
const ENCERRAMENTO_POSICIONAMENTO_OPCOES = ['Pendente', 'Ciente', 'Objeção'];
const ASSINATURA_STATUS_OPCOES = ['Pendente', 'Assinado'];

const AREAS_PADRAO = [
  'Assistência / Enfermagem', 'Corpo Clínico / Diretoria Médica', 'CCIH',
  'Física Médica / Radioproteção', 'Manutenção', 'Engenharia Clínica',
  'Segurança do Trabalho', 'Hotelaria / Higienização', 'TI',
  'Farmácia', 'Suprimentos / Compras', 'Financeiro', 'Jurídico',
  'Comunicação', 'Segurança Patrimonial', 'Recepção / Atendimento', 'Outra'
];

const SETORES_PADRAO = [
  'Setor de Imagem', 'Centro Cirúrgico', 'UTI', 'Pronto Atendimento',
  'Internação / Enfermarias', 'Ambulatório', 'Oncologia', 'Laboratório',
  'Farmácia', 'Área administrativa', 'Áreas externas', 'Outro'
];

// ────────────────────────────────────────────── CABEÇALHOS ──

// Idênticos ao sistema atual + CanceladoPor/DataCancelamento/
// MotivoCancelamento no fim (migração aditiva via ensureColunasNoFim_,
// não perde nenhuma obra já cadastrada).
const OBRAS_HEADERS = [
  'ID', 'Titulo', 'Descricao', 'Justificativa', 'OrigemDemanda',
  'Setor', 'AreasAdjacentes', 'LinkPlanta',
  'DataInicio', 'DataFim', 'PrazoManifestacao', 'RestricoesCalendario',
  'ResponsavelNome', 'ResponsavelCargo', 'ResponsavelContato',
  'Execucao', 'EmpresaContratada',
  'Impactos', 'DetalhamentoImpactos', 'HorarioTrabalho',
  'ValorEstimado', 'FonteRecurso',
  'Status', 'DataPublicacao', 'CriadoEm', 'AtualizadoEm', 'IDPedidoOrigem',
  'StatusCronograma', 'CronogramaValidadoPor', 'CronogramaValidadoEm', 'CronogramaObservacoesPMO',
  'CanceladoPor', 'DataCancelamento', 'MotivoCancelamento'
];

const EAP_HEADERS = ['IDItem', 'IDObra', 'Codigo', 'Descricao', 'NaturezaImpacto'];

const MANIF_HEADERS = [
  'IDManif', 'IDObra', 'Timestamp', 'Nome', 'Cargo', 'Area',
  'Posicionamento', 'Manifestacao', 'Requisitos', 'ItensEAP', 'Extemporanea'
];

// Idênticos ao atual + CanceladoPor/DataCancelamento/MotivoCancelamento.
// StatusAprovacaoDiretoria/ObservacoesDiretoria seguem reservados (mesma
// razão do sistema atual: gate futuro de autorização formal, campo já
// existe pra não exigir migração quando for ativado).
const PEDIDOS_HEADERS = [
  'ID', 'Token',
  'Nome', 'Cargo', 'Contato', 'Area',
  'SuperintendenciaGestora', 'CentroCusto', 'SetorDesejado',
  'FinalidadeObjetivo', 'Ambientes', 'Equipamentos', 'PopulacaoEstimada',
  'Urgencia', 'DataDesejada', 'JustificativaUrgencia', 'Anexos',
  'Status', 'ObservacoesEngenharia', 'IDObraGerada',
  'StatusAprovacaoDiretoria', 'ObservacoesDiretoria',
  'CriadoEm', 'AtualizadoEm',
  'CanceladoPor', 'DataCancelamento', 'MotivoCancelamento'
];

const REQUISITOS_HEADERS = [
  'ID', 'IDObra', 'IDManifOrigem', 'Descricao', 'Responsavel',
  'Status', 'DataResolucao', 'Observacoes', 'CriadoEm', 'AtualizadoEm'
];

const PEDIDO_HIST_HEADERS = ['ID', 'IDPedido', 'Autor', 'Texto', 'LinkEvidencia', 'CriadoEm'];

const AREAS_PROP_HEADERS = [
  'ID', 'Nome', 'PropostoPor', 'CargoPropoente', 'IDObraOrigem',
  'Status', 'ObservacoesPMO', 'CriadoEm', 'DecididoEm'
];

const DECISOES_PRAZO_HEADERS = [
  'ID', 'IDObra', 'TipoDecisao', 'PrazoAnterior', 'PrazoNovo',
  'Justificativa', 'DecididoPor', 'CriadoEm'
];

const ATAS_HEADERS = [
  'ID', 'IDObra', 'TipoReuniao', 'DataReuniao', 'Participantes',
  'Resumo', 'ConduzidoPor', 'CriadoEm'
];

const ETAPAS_HEADERS = ['ID', 'IDObra', 'Nome', 'Ordem', 'CriadoEm'];

// Idênticos ao atual + ResponsavelUserId no fim (liga a Usuarios.ID
// quando o responsável tem login próprio — papel Responsavel; fica vazio
// quando é terceirizada/texto livre em Responsavel). CustoDoacao/
// CustoProprio continuam texto nesta fase — a migração pra número
// validado é cirúrgica e separada (ver PARSE_MOEDA em Helpers.gs).
const CRONOGRAMA_HEADERS = [
  'ID', 'IDObra', 'IDEtapa', 'Ordem', 'Atividade', 'Responsavel',
  'DataInicioPrevista', 'DataFimPrevista', 'TemRisco', 'DescricaoRisco',
  'CustoDoacao', 'CustoProprio', 'Observacao', 'Predecessora', 'Status',
  'CriadoEm', 'AtualizadoEm', 'ResponsavelUserId'
];
// TemRisco/DescricaoRisco (acima) ficam como colunas legadas, mantidas só
// pra não quebrar leitura de dados antigos — TemRisco agora é DERIVADO em
// salvarEtapasPacotes_ (SIM se o pacote tiver ≥1 linha em Riscos), nunca
// mais editado direto pelo cliente. DescricaoRisco não é mais escrito.

// Registro de riscos por Pacote de Trabalho — 1 pacote pode ter N riscos,
// cada um com plano de ação e prazo de solução próprios. Distinto de
// Restricoes (Fase 6/Lookahead — log de impedimentos do Pull Planning,
// conceito diferente de risco).
const RISCOS_HEADERS = [
  'ID', 'IDObra', 'IDPacote', 'Local', 'NomeRisco', 'Descricao',
  'Responsavel', 'PlanoAcao', 'PrazoDias', 'TipoPrazo',
  'CriadoPor', 'CriadoEm', 'AtualizadoPor', 'AtualizadoEm'
];
const TIPO_PRAZO_OPCOES = ['Corridos', 'Úteis'];

// Evidências de solução de uma Restrição (Lookahead) — N arquivos por
// restrição, enviados pelo navegador e salvos direto no Drive (pasta
// "Evidências" ao lado da planilha, subpasta por obra — ver
// pastaEvidencias_ em Restricoes.gs). FileId separado de LinkDrive pra
// poder mandar o arquivo pra lixeira ao excluir sem precisar parsear URL.
const RESTRICOES_EVIDENCIAS_HEADERS = [
  'ID', 'IDRestricao', 'IDObra', 'NomeArquivo', 'LinkDrive', 'FileId',
  'EnviadoPor', 'EnviadoEm'
];

// Evidências de Medição (Fase 8) — mesmo princípio das evidências de
// Restrição, mas aceitando os DOIS mecanismos (pedido explícito do
// usuário): 'Upload' (arquivo salvo no Drive via pastaEvidencias_,
// reaproveitada de Restricoes.gs) ou 'Link' (URL colada, ex.: nota fiscal
// já hospedada em outro sistema). NomeOuDescricao é o nome do arquivo
// (Upload) ou a descrição livre que o usuário deu ao link (Link).
const MEDICOES_EVIDENCIAS_HEADERS = [
  'ID', 'IDMedicao', 'IDObra', 'Tipo', 'NomeOuDescricao', 'Link', 'FileId',
  'EnviadoPor', 'EnviadoEm'
];
const TIPO_EVIDENCIA_MEDICAO_OPCOES = ['Upload', 'Link'];

// ── Abas novas ──

// senhaHash nunca é devolvido ao cliente em nenhuma API (ver Usuarios.gs).
const USUARIOS_HEADERS = ['ID', 'Nome', 'Email', 'SenhaHash', 'Cargo', 'Papel', 'Status', 'CriadoPor', 'CriadoEm', 'AtualizadoEm'];

// Append-only: nunca reescrita depois de criada. Congelada por
// congelarBaseline_ (Baseline.gs) só na 1ª validação do PMO de cada obra,
// mesmo com revalidações futuras do cronograma. Aba própria (não colunas
// dentro de Cronograma) porque salvarEtapasPacotes_ faz clearContent()+
// setValues() da aba inteira a cada save do Pull Planning.
const BASELINE_HEADERS = [
  'ID', 'IDObra', 'IDPacote', 'IDEtapa', 'Atividade',
  'DataInicioPrevista', 'DataFimPrevista', 'CustoDoacao', 'CustoProprio', 'CriadoEm'
];

// Só pode ter linhas para uma obra que já tem Baseline (checado na API,
// não aqui) — parcelas variáveis por Pacote, não fixo mensal.
const PLANO_PAGAMENTO_HEADERS = [
  'ID', 'IDObra', 'IDPacote', 'NumeroParcela', 'DescricaoParcela',
  'ValorPrevisto', 'CriadoPor', 'CriadoEm', 'AtualizadoEm'
];

// Mesmo shape de dupla checagem que Obras.CronogramaValidadoPor/Em/
// ObservacoesPMO já usa para o cronograma — replicado aqui pra medição.
const MEDICOES_HEADERS = [
  'ID', 'IDObra', 'IDPacote', 'IDParcela', 'ValorMedido',
  'DescricaoEvidencia', 'LinkEvidencia', 'RegistradoPor', 'RegistradoEm',
  'StatusAprovacao', 'AprovadoPor', 'AprovadoEm', 'ObservacoesPMO'
];

// Capturada na criação de cada Pacote de Trabalho (Pull Planning) —
// Lookahead é a janela móvel que revisa estas linhas até Liberada.
const RESTRICOES_HEADERS = [
  'ID', 'IDObra', 'IDPacote', 'Categoria', 'Descricao',
  'ResponsavelNome', 'ResponsavelUserId', 'PrazoNecessario', 'Status',
  'CriadoPor', 'CriadoEm', 'LiberadoPor', 'LiberadoEm', 'Observacoes'
];

// PPC (Percentual de Programação Concluída) nunca é gravado — sempre
// calculado na leitura como cumpridas/comprometidas da semana.
const COMPROMISSO_SEMANAL_HEADERS = [
  'ID', 'IDObra', 'IDPacote', 'DataInicioSemana', 'DataFimSemana', 'Status',
  'CategoriaNaoCumprimento', 'DetalhesNaoCumprimento',
  'ResponsavelNome', 'ResponsavelUserId', 'CriadoPor', 'CriadoEm', 'AtualizadoEm'
];

const ENCERRAMENTO_CHECKLIST_HEADERS = [
  'ID', 'IDObra', 'Etapa', 'ItemChecklist', 'Descricao',
  'Posicionamento', 'ObservacaoObjecao', 'ResponsavelArea',
  'AtualizadoPor', 'AtualizadoEm', 'CriadoEm'
];

const ENCERRAMENTO_DOCUMENTOS_HEADERS = [
  'ID', 'IDObra', 'NomeArquivo', 'Tipo', 'LinkArquivo', 'TamanhoOuData', 'EnviadoPor', 'EnviadoEm'
];

// apiFinalizarObra só libera Status='Finalizado' quando TODAS as linhas
// desta obra estiverem Status='Assinado'.
const ENCERRAMENTO_ASSINATURAS_HEADERS = [
  'ID', 'IDObra', 'NomeSignatario', 'Cargo', 'Status', 'AssinadoEm', 'IDUsuario'
];

// Cabeçalho de cada aba de dados, pelo nome — usado pela leitura em lote
// (prepararAbas_ em Helpers.gs) para saber quantas colunas buscar.
function cabecalhosDaAba_(nome) {
  const mapa = {};
  mapa[SHEETS.OBRAS] = OBRAS_HEADERS;
  mapa[SHEETS.EAP] = EAP_HEADERS;
  mapa[SHEETS.MANIF] = MANIF_HEADERS;
  mapa[SHEETS.PEDIDOS] = PEDIDOS_HEADERS;
  mapa[SHEETS.REQUISITOS] = REQUISITOS_HEADERS;
  mapa[SHEETS.PEDIDO_HIST] = PEDIDO_HIST_HEADERS;
  mapa[SHEETS.AREAS_PROP] = AREAS_PROP_HEADERS;
  mapa[SHEETS.DECISOES_PRAZO] = DECISOES_PRAZO_HEADERS;
  mapa[SHEETS.ATAS] = ATAS_HEADERS;
  mapa[SHEETS.ETAPAS] = ETAPAS_HEADERS;
  mapa[SHEETS.CRONOGRAMA] = CRONOGRAMA_HEADERS;
  mapa[SHEETS.USUARIOS] = USUARIOS_HEADERS;
  mapa[SHEETS.BASELINE] = BASELINE_HEADERS;
  mapa[SHEETS.PLANO_PAGAMENTO] = PLANO_PAGAMENTO_HEADERS;
  mapa[SHEETS.MEDICOES] = MEDICOES_HEADERS;
  mapa[SHEETS.RESTRICOES] = RESTRICOES_HEADERS;
  mapa[SHEETS.COMPROMISSO_SEMANAL] = COMPROMISSO_SEMANAL_HEADERS;
  mapa[SHEETS.ENCERRAMENTO_CHECKLIST] = ENCERRAMENTO_CHECKLIST_HEADERS;
  mapa[SHEETS.ENCERRAMENTO_DOCUMENTOS] = ENCERRAMENTO_DOCUMENTOS_HEADERS;
  mapa[SHEETS.ENCERRAMENTO_ASSINATURAS] = ENCERRAMENTO_ASSINATURAS_HEADERS;
  mapa[SHEETS.RISCOS] = RISCOS_HEADERS;
  mapa[SHEETS.RESTRICOES_EVIDENCIAS] = RESTRICOES_EVIDENCIAS_HEADERS;
  mapa[SHEETS.MEDICOES_EVIDENCIAS] = MEDICOES_EVIDENCIAS_HEADERS;
  const h = mapa[nome];
  if (!h) throw new Error('Aba sem cabeçalho registrado: ' + nome);
  return h;
}

// ────────────────────────────────────────────── SETUP ──

function setup() {
  somenteEditor_();
  const ss = ss_();

  ensureSheet_(ss, SHEETS.OBRAS, OBRAS_HEADERS);
  ensureSheet_(ss, SHEETS.EAP, EAP_HEADERS);
  ensureSheet_(ss, SHEETS.MANIF, MANIF_HEADERS);
  ensureSheet_(ss, SHEETS.PEDIDOS, PEDIDOS_HEADERS);
  ensureSheet_(ss, SHEETS.REQUISITOS, REQUISITOS_HEADERS);
  ensureSheet_(ss, SHEETS.PEDIDO_HIST, PEDIDO_HIST_HEADERS);
  ensureSheet_(ss, SHEETS.AREAS_PROP, AREAS_PROP_HEADERS);
  ensureSheet_(ss, SHEETS.DECISOES_PRAZO, DECISOES_PRAZO_HEADERS);
  ensureSheet_(ss, SHEETS.ATAS, ATAS_HEADERS);
  ensureSheet_(ss, SHEETS.ETAPAS, ETAPAS_HEADERS);
  // Cronograma tem lógica própria (não é só ensureSheet_): pode precisar
  // migrar do formato antigo (Etapa como texto livre, um só nível) para o
  // novo (Etapas + Pacotes de Trabalho) — defensivo, herdado do sistema
  // atual; numa cópia recente da planilha de produção isso já deve estar
  // migrado, mas não custa manter a rede de segurança.
  migrarOuCriarCronograma_(ss);

  ensureSheet_(ss, SHEETS.USUARIOS, USUARIOS_HEADERS);
  ensureSheet_(ss, SHEETS.BASELINE, BASELINE_HEADERS);
  ensureSheet_(ss, SHEETS.PLANO_PAGAMENTO, PLANO_PAGAMENTO_HEADERS);
  ensureSheet_(ss, SHEETS.MEDICOES, MEDICOES_HEADERS);
  ensureSheet_(ss, SHEETS.RESTRICOES, RESTRICOES_HEADERS);
  ensureSheet_(ss, SHEETS.COMPROMISSO_SEMANAL, COMPROMISSO_SEMANAL_HEADERS);
  ensureSheet_(ss, SHEETS.ENCERRAMENTO_CHECKLIST, ENCERRAMENTO_CHECKLIST_HEADERS);
  ensureSheet_(ss, SHEETS.ENCERRAMENTO_DOCUMENTOS, ENCERRAMENTO_DOCUMENTOS_HEADERS);
  ensureSheet_(ss, SHEETS.ENCERRAMENTO_ASSINATURAS, ENCERRAMENTO_ASSINATURAS_HEADERS);
  ensureSheet_(ss, SHEETS.RISCOS, RISCOS_HEADERS);
  ensureSheet_(ss, SHEETS.RESTRICOES_EVIDENCIAS, RESTRICOES_EVIDENCIAS_HEADERS);
  ensureSheet_(ss, SHEETS.MEDICOES_EVIDENCIAS, MEDICOES_EVIDENCIAS_HEADERS);

  // Migração idempotente: completa colunas novas no fim das abas que já
  // existiam numa planilha copiada da produção, preservando todo o
  // histórico já cadastrado.
  ensureColunasNoFim_(ss.getSheetByName(SHEETS.OBRAS), OBRAS_HEADERS);
  ensureColunasNoFim_(ss.getSheetByName(SHEETS.PEDIDOS), PEDIDOS_HEADERS);
  ensureColunasNoFim_(ss.getSheetByName(SHEETS.CRONOGRAMA), CRONOGRAMA_HEADERS);

  let cfg = ss.getSheetByName(SHEETS.CONFIG);
  if (!cfg) {
    // Sem PIN_ENGENHARIA/PIN_PMO aqui — autenticação agora é por
    // Usuarios (ver Auth.gs/Usuarios.gs), não mais por chave em Config.
    cfg = ss.insertSheet(SHEETS.CONFIG);
    cfg.getRange('A1:B1').setValues([['Chave', 'Valor']]).setFontWeight('bold');
    cfg.getRange('A2:B4').setValues([
      ['PRAZO_DIAS_UTEIS', 5],
      ['MOSTRAR_VALOR_PUBLICO', 'NAO'],
      ['NOME_INSTITUICAO', 'Hospital da Baleia']
    ]);
    cfg.getRange('D1').setValue('AreasManifestantes').setFontWeight('bold');
    cfg.getRange(2, 4, AREAS_PADRAO.length, 1)
      .setValues(AREAS_PADRAO.map(a => [a]));
    cfg.getRange('E1').setValue('Setores').setFontWeight('bold');
    cfg.getRange(2, 5, SETORES_PADRAO.length, 1)
      .setValues(SETORES_PADRAO.map(s => [s]));
  }

  // Colunas de data como texto para preservar o formato ISO (yyyy-mm-dd)
  const obras = ss.getSheetByName(SHEETS.OBRAS);
  ['I', 'J', 'K', 'X', 'Y', 'AB'].forEach(col =>
    obras.getRange(col + '2:' + col).setNumberFormat('@'));
  ss.getSheetByName(SHEETS.MANIF).getRange('C2:C').setNumberFormat('@');
  const pedidos = ss.getSheetByName(SHEETS.PEDIDOS);
  ['O', 'W', 'X', 'AA'].forEach(col => pedidos.getRange(col + '2:' + col).setNumberFormat('@'));

  // CustoDoacao/CustoProprio (Fase 7): número de verdade, não mais texto —
  // formato fixo de 2 casas pra abrir bem a planilha direto, mesmo que a
  // exibição real dependa do locale da planilha (parseMoedaServidor_/
  // parseMoeda no cliente já lidam com vírgula OU ponto decimal).
  const cron = ss.getSheetByName(SHEETS.CRONOGRAMA);
  if (cron) ['K', 'L'].forEach(col => cron.getRange(col + '2:' + col).setNumberFormat('0.00'));

  // Fase 8: Baseline/PlanoPagamento/Medicoes já nascem numéricos (abas
  // novas, sem dado legado em texto pra migrar) — só formato de exibição.
  const baseline = ss.getSheetByName(SHEETS.BASELINE);
  if (baseline) {
    ['F', 'G'].forEach(col => baseline.getRange(col + '2:' + col).setNumberFormat('@')); // datas como texto ISO
    ['H', 'I'].forEach(col => baseline.getRange(col + '2:' + col).setNumberFormat('0.00'));
  }
  const planoPagto = ss.getSheetByName(SHEETS.PLANO_PAGAMENTO);
  if (planoPagto) planoPagto.getRange('F2:F').setNumberFormat('0.00');
  const medicoes = ss.getSheetByName(SHEETS.MEDICOES);
  if (medicoes) medicoes.getRange('E2:E').setNumberFormat('0.00');

  dadosAlterados_();
  return 'Setup concluído. Abas: ' + Object.keys(SHEETS).length + '. Login agora é por Usuarios (ver Auth.gs) — rode semearPrimeiroPmo no editor (Usuarios.gs) se esta for uma planilha nova.';
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Completa, ao final da aba, as colunas do array `headers` que ainda não
// existem — usado para evoluir o esquema de abas já em produção sem
// perder dados. Assume que os headers já presentes mantêm a mesma ordem.
function ensureColunasNoFim_(sh, headers) {
  const atual = sh.getLastColumn();
  if (atual < headers.length) {
    const faltantes = headers.slice(atual);
    sh.getRange(1, atual + 1, 1, faltantes.length).setValues([faltantes]).setFontWeight('bold');
  }
}

// Decide entre criar a aba Cronograma do zero (instalação nova) ou migrar
// do formato antigo (coluna "Etapa" como texto livre) para o novo
// (Etapas + Pacotes de Trabalho). Detecta o formato antigo pela 3ª coluna
// do cabeçalho ainda ser literalmente "Etapa" — se já for "IDEtapa" (ou a
// aba não existir ainda), não faz nada. Herdado do sistema atual, mantido
// como rede de segurança defensiva.
function migrarOuCriarCronograma_(ss) {
  const sh = ss.getSheetByName(SHEETS.CRONOGRAMA);
  if (!sh) { ensureSheet_(ss, SHEETS.CRONOGRAMA, CRONOGRAMA_HEADERS); return; }
  const lastCol = sh.getLastColumn();
  if (lastCol < 3) return; // aba existe mas sem cabeçalho ainda — defensivo, não deveria ocorrer
  const header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  if (header[2] !== 'Etapa') return; // já está no formato novo
  migrarCronogramaParaEtapas_(ss, sh, header);
}

// A aba antiga NUNCA é apagada — é renomeada para backup (com sufixo de
// data se por algum motivo já existir um backup com esse nome) e uma
// Cronograma nova é criada já no formato de dois níveis. IDs de pacotes
// são preservados, então valores de Predecessora continuam válidos sem
// precisar de tradução.
function migrarCronogramaParaEtapas_(ss, shAntiga, headerAntigo) {
  const headers = headerAntigo.filter(h => h);
  const last = shAntiga.getLastRow();
  const linhasAntigas = last < 2 ? [] : shAntiga.getRange(2, 1, last - 1, headers.length).getDisplayValues()
    .filter(r => r[0] !== '');

  let nomeBackup = 'Cronograma_backup_pre_etapas';
  if (ss.getSheetByName(nomeBackup)) {
    nomeBackup += '_' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyyMMddHHmmss');
  }
  shAntiga.setName(nomeBackup);

  const novaCron = ss.insertSheet(SHEETS.CRONOGRAMA);
  novaCron.getRange(1, 1, 1, CRONOGRAMA_HEADERS.length).setValues([CRONOGRAMA_HEADERS]).setFontWeight('bold');
  novaCron.setFrozenRows(1);

  const etapasSh = ss.getSheetByName(SHEETS.ETAPAS) || ensureSheet_(ss, SHEETS.ETAPAS, ETAPAS_HEADERS);

  const idx = {};
  headers.forEach((h, i) => idx[h] = i);

  const etapaPorChave = {};
  const ordemEtapaPorObra = {};
  const ordemPacotePorEtapa = {};
  const etapasNovasRows = [];
  const pacotesNovosRows = [];

  linhasAntigas.forEach(r => {
    const idObra = r[idx.IDObra];
    const textoEtapa = r[idx.Etapa] || '(sem etapa)';
    const chave = idObra + '|' + textoEtapa;
    if (!etapaPorChave[chave]) {
      ordemEtapaPorObra[idObra] = ordemEtapaPorObra[idObra] || 0;
      const idEtapa = idObra + '-ET' + largura_(ordemEtapaPorObra[idObra] + 1, 2);
      etapasNovasRows.push([idEtapa, idObra, textoEtapa, ordemEtapaPorObra[idObra], nowIso_()]);
      etapaPorChave[chave] = idEtapa;
      ordemEtapaPorObra[idObra]++;
      ordemPacotePorEtapa[idEtapa] = 0;
    }
    const idEtapa = etapaPorChave[chave];
    pacotesNovosRows.push([
      r[idx.ID], idObra, idEtapa, ordemPacotePorEtapa[idEtapa],
      r[idx.Atividade], r[idx.Responsavel], r[idx.DataInicioPrevista], r[idx.DataFimPrevista],
      r[idx.TemRisco], r[idx.DescricaoRisco], r[idx.CustoDoacao], r[idx.CustoProprio],
      r[idx.Observacao], r[idx.Predecessora], r[idx.Status], r[idx.CriadoEm], r[idx.AtualizadoEm],
      '' // ResponsavelUserId — coluna nova, sem equivalente no formato antigo
    ]);
    ordemPacotePorEtapa[idEtapa]++;
  });

  if (etapasNovasRows.length) {
    const startRow = etapasSh.getLastRow() + 1;
    etapasSh.getRange(startRow, 1, etapasNovasRows.length, ETAPAS_HEADERS.length).setValues(etapasNovasRows);
  }
  if (pacotesNovosRows.length) {
    novaCron.getRange(2, 1, pacotesNovosRows.length, CRONOGRAMA_HEADERS.length).setValues(pacotesNovosRows);
  }
}
