/**
 * Rodar UMA VEZ manualmente no editor (função `criarProjetosExemplo`, sem
 * `_` no final de propósito — pra aparecer no seletor "Executar") pra
 * gerar 2 obras de demonstração que percorrem TODAS as fases construídas
 * até aqui (0-8), prontas pra inspeção visual no app:
 *
 * 1. "[EXEMPLO] Reforma da Ala de Internação" — fluxo COMPLETO: Pedido ->
 *    aceito -> Obra publicada -> manifestações -> em execução ->
 *    cronograma com uma Restrição (impedimento) já com evidência e
 *    liberada -> cronograma validado (Baseline congelada) -> parcelas de
 *    pagamento, uma medição aprovada e outra ainda Pendente (pra você
 *    aprovar ao vivo como PMO).
 *
 * 2. "[EXEMPLO] Modernização do Centro Cirúrgico — Bloco B" — obra
 *    AVANÇADA/quase concluindo: criada direto (sem Pedido, pra variar),
 *    manifestação com Objeção, prazo de manifestação encerrado
 *    manualmente, cronograma com a maioria dos pacotes já "Concluída",
 *    baseline + quase todas as parcelas medidas e aprovadas (curva S
 *    perto de 100%). Não existe ainda um jeito de chegar a "Finalizado"
 *    de verdade (Encerramento é a Fase 10, ainda não construída) — fica
 *    em "Em execução" bem avançada, que é o mais perto que dá hoje.
 *
 * Datas são sempre relativas a "hoje" (não fixas), pra ficar plausível
 * não importa quando este script for rodado.
 */

function isoOffset_(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// Mesmo mecanismo de sessão que login() usa (Auth.gs), só que sem exigir
// senha — legítimo aqui porque este script já roda com a confiança total
// do editor (mesmo nível de um administrador rodando funções manuais como
// semearPrimeiroPmo/migrarCustoParaNumero). O token gerado é 100% válido
// pras APIs normais (validarToken_/exigirPapel_/exigirPMO_ aceitam sem
// diferença nenhuma de um login de verdade).
function criarTokenDireto_(usuarioId) {
  const usuario = readAll_(SHEETS.USUARIOS, USUARIOS_HEADERS).find(u => u.ID === usuarioId);
  if (!usuario) throw new Error('Usuário não encontrado: ' + usuarioId);
  const token = Utilities.getUuid();
  const payload = { usuarioId: usuario.ID, nome: usuario.Nome, email: usuario.Email, cargo: usuario.Cargo, papel: usuario.Papel };
  CacheService.getScriptCache().put(SESSAO_CACHE_PREFIXO + token, JSON.stringify(payload), SESSAO_TTL_SEG);
  return token;
}

function criarProjetosExemplo() {
  const pmo = readAll_(SHEETS.USUARIOS, USUARIOS_HEADERS).find(u => u.Papel === 'PMO' && u.Status === 'ativo');
  if (!pmo) throw new Error('Nenhum usuário PMO ativo encontrado — rode semearPrimeiroPmo() antes.');
  const token = criarTokenDireto_(pmo.ID);

  const r1 = criarProjetoCompleto_(token);
  const r2 = criarProjetoFinalizando_(token);

  const msg = 'Projetos de exemplo criados com sucesso.\n\n' + r1 + '\n\n' + r2;
  Logger.log(msg);
  return msg;
}

function criarProjetoCompleto_(token) {
  // 1) Pedido -> aceito -> Obra
  const pedido = apiCriarPedido({
    Nome: 'Ana Ferreira', Cargo: 'Coordenadora de Enfermagem',
    Contato: 'ana.ferreira@hospitaldabaleia.org.br', Area: 'Assistência / Enfermagem',
    FinalidadeObjetivo: '[EXEMPLO] Reforma da ala de internação para ampliação de 8 leitos',
    Urgencia: 'Necessário em até 3 meses'
  });

  const ctx = apiPedidoParaObraContexto(token, pedido.id);
  const dadosObra = Object.assign({}, ctx, {
    Setor: 'Internação / Enfermarias',
    DataInicio: isoOffset_(7), DataFim: isoOffset_(50),
    PrazoManifestacao: isoOffset_(5),
    ResponsavelNome: 'Carlos Almeida', ResponsavelCargo: 'Engenheiro Residente', ResponsavelContato: 'carlos.almeida@hospitaldabaleia.org.br',
    Execucao: 'Empreiteira contratada', EmpresaContratada: 'Construtora Exemplo Ltda',
    Impactos: 'Impacto moderado', HorarioTrabalho: '07h às 17h, dias úteis',
    ValorEstimado: '', FonteRecurso: 'Recurso próprio'
  });
  const salvou = apiSalvarObra(token, dadosObra, [
    { Codigo: '1', Descricao: 'Ampliação de leitos', NaturezaImpacto: 'Direto' }
  ]);
  const idObra = salvou.id;
  apiVincularPedidoObra(token, pedido.id, idObra);
  apiPublicarObra(token, idObra);

  // 2) Manifestações
  apiManifestar(idObra, { Nome: 'Fernanda Costa', Cargo: 'Enfermeira-chefe CCIH', Area: 'CCIH', Posicionamento: 'Ciente sem ressalvas' });
  apiManifestar(idObra, {
    Nome: 'Roberto Dias', Cargo: 'Técnico de Manutenção', Area: 'Manutenção', Posicionamento: 'Ciente com ressalvas',
    Manifestacao: 'Pedimos atenção ao isolamento de poeira durante a demolição, próximo às enfermarias ocupadas.'
  });
  apiMudarStatus(token, idObra, 'Em execução');

  // 3) Cronograma (1 etapa, 3 pacotes) com uma Restrição já resolvida
  const etapas = [{ Nome: 'Execução da Reforma' }];
  const pacotes = [
    { EtapaIdx: 0, Atividade: 'Demolição de divisórias antigas', Responsavel: 'Equipe Exemplo A', DataInicioPrevista: isoOffset_(7), DataFimPrevista: isoOffset_(13), CustoDoacao: '0', CustoProprio: '15000', PredecessoraIdx: [] },
    { EtapaIdx: 0, Atividade: 'Instalação elétrica e hidráulica', Responsavel: 'Equipe Exemplo B', DataInicioPrevista: isoOffset_(14), DataFimPrevista: isoOffset_(27), CustoDoacao: '5000', CustoProprio: '20000', PredecessoraIdx: [0] },
    { EtapaIdx: 0, Atividade: 'Acabamento e entrega de leitos', Responsavel: 'Equipe Exemplo C', DataInicioPrevista: isoOffset_(28), DataFimPrevista: isoOffset_(41), CustoDoacao: '0', CustoProprio: '18000', PredecessoraIdx: [1] }
  ];
  apiSalvarCronograma(token, idObra, etapas, pacotes, true);
  const cronSalvo = readAll_(SHEETS.CRONOGRAMA, CRONOGRAMA_HEADERS).filter(p => p.IDObra === idObra);
  const idPacoteEletrica = cronSalvo.find(p => p.Atividade.indexOf('elétrica') >= 0).ID;
  const idPacoteAcabamento = cronSalvo.find(p => p.Atividade.indexOf('Acabamento') >= 0).ID;

  const restricao = apiSalvarRestricao(token, {
    IDObra: idObra, IDPacote: idPacoteEletrica, Categoria: 'Materiais (Falta na Obra)',
    Descricao: '[EXEMPLO] Falta de disjuntores especiais em estoque no almoxarifado',
    ResponsavelNome: 'Carlos Almeida', PrazoNecessario: isoOffset_(10)
  });
  const evidRestricaoBase64 = Utilities.base64Encode('Evidência de exemplo — nota de compra dos disjuntores aprovada pelo setor de compras.', Utilities.Charset.UTF_8);
  apiUploadEvidenciaRestricao(token, restricao.restricao.ID, 'nota-compra-exemplo.txt', 'text/plain', evidRestricaoBase64);
  apiMoverRestricao(token, restricao.restricao.ID, 'Em tratamento');
  apiMoverRestricao(token, restricao.restricao.ID, 'Liberada');

  // 4) Validar cronograma -> congela Baseline
  apiValidarCronograma(token, idObra, true, '[EXEMPLO] Cronograma aprovado pelo PMO.');

  // 5) Plano de pagamento + medições (1 aprovada, 1 pendente de propósito)
  const parc1 = apiSalvarParcela(token, { IDObra: idObra, IDPacote: idPacoteEletrica, DescricaoParcela: 'Adiantamento de material elétrico', ValorPrevisto: '10000' });
  const parc2 = apiSalvarParcela(token, { IDObra: idObra, IDPacote: idPacoteAcabamento, DescricaoParcela: 'Entrega final do acabamento', ValorPrevisto: '18000' });

  const med1 = apiRegistrarMedicao(token, { IDObra: idObra, IDPacote: idPacoteEletrica, IDParcela: parc1.parcela.ID, ValorMedido: '10000', DescricaoEvidencia: 'Nota fiscal do material elétrico entregue' });
  const evidMedBase64 = Utilities.base64Encode('Evidência de exemplo — nota fiscal simulada do material elétrico.', Utilities.Charset.UTF_8);
  apiUploadEvidenciaMedicao(token, med1.medicao.ID, 'nf-material-eletrico-exemplo.txt', 'text/plain', evidMedBase64);
  apiAprovarMedicao(token, med1.medicao.ID, true, '[EXEMPLO] Confere com o combinado.');

  apiRegistrarMedicao(token, { IDObra: idObra, IDPacote: idPacoteAcabamento, IDParcela: parc2.parcela.ID, ValorMedido: '18000', DescricaoEvidencia: 'Aguardando conferência final do PMO' });
  // esta 2ª medição fica PENDENTE de propósito — pra você aprovar/rejeitar ao vivo.

  return 'PROJETO 1 (completo) -> ' + idObra + ' — passou por Pedido, Obra publicada, manifestações, cronograma com impedimento resolvido (com evidência), baseline congelada, 1 medição aprovada e 1 medição PENDENTE esperando sua decisão como PMO.';
}

function criarProjetoFinalizando_(token) {
  // Obra criada DIRETO (sem Pedido, pra variar o caminho de criação)
  const salvou = apiSalvarObra(token, {
    Titulo: '[EXEMPLO] Modernização do Centro Cirúrgico — Bloco B',
    Descricao: 'Modernização de equipamentos e infraestrutura do Bloco B do Centro Cirúrgico.',
    Justificativa: 'Atualização tecnológica necessária para acreditação hospitalar.',
    OrigemDemanda: 'Demanda institucional', Setor: 'Centro Cirúrgico',
    DataInicio: isoOffset_(-35), DataFim: isoOffset_(-5), PrazoManifestacao: isoOffset_(-30),
    ResponsavelNome: 'Patrícia Souza', ResponsavelCargo: 'Engenheira de Obras', ResponsavelContato: 'patricia.souza@hospitaldabaleia.org.br',
    Execucao: 'Empreiteira contratada', EmpresaContratada: 'Obras Hospitalares Exemplo S.A.',
    Impactos: 'Impacto alto', HorarioTrabalho: '24h (área isolada)', FonteRecurso: 'Recurso próprio'
  }, [
    { Codigo: '1', Descricao: 'Modernização de equipamentos', NaturezaImpacto: 'Direto' }
  ]);
  const idObra = salvou.id;
  apiPublicarObra(token, idObra);

  apiManifestar(idObra, { Nome: 'Marcos Vieira', Cargo: 'Chefe do Centro Cirúrgico', Area: 'Corpo Clínico / Diretoria Médica', Posicionamento: 'Ciente sem ressalvas' });
  apiManifestar(idObra, {
    Nome: 'Juliana Prado', Cargo: 'Enfermeira Instrumentadora', Area: 'Assistência / Enfermagem', Posicionamento: 'Objeção',
    Manifestacao: '[EXEMPLO] Objeção inicial registrada e já tratada em reunião — manter para demonstrar o histórico de manifestações.'
  });
  apiDecidirPrazo(token, idObra, 'Finalizar', '', '[EXEMPLO] Prazo de manifestação encerrado — manifestações suficientes recebidas.');
  apiMudarStatus(token, idObra, 'Em execução');

  // Cronograma já majoritariamente concluído (datas no passado)
  const etapas = [{ Nome: 'Modernização do Bloco B' }];
  const pacotes = [
    { EtapaIdx: 0, Atividade: 'Substituição de equipamentos de anestesia', Responsavel: 'Equipe Exemplo D', DataInicioPrevista: isoOffset_(-35), DataFimPrevista: isoOffset_(-28), CustoDoacao: '0', CustoProprio: '40000', Status: 'Concluída', PredecessoraIdx: [] },
    { EtapaIdx: 0, Atividade: 'Atualização de sistema de exaustão', Responsavel: 'Equipe Exemplo E', DataInicioPrevista: isoOffset_(-27), DataFimPrevista: isoOffset_(-18), CustoDoacao: '0', CustoProprio: '25000', Status: 'Concluída', PredecessoraIdx: [0] },
    { EtapaIdx: 0, Atividade: 'Testes finais e comissionamento', Responsavel: 'Equipe Exemplo F', DataInicioPrevista: isoOffset_(-17), DataFimPrevista: isoOffset_(-5), CustoDoacao: '0', CustoProprio: '10000', Status: 'Em andamento', PredecessoraIdx: [1] }
  ];
  apiSalvarCronograma(token, idObra, etapas, pacotes, true);
  const cronSalvo = readAll_(SHEETS.CRONOGRAMA, CRONOGRAMA_HEADERS).filter(p => p.IDObra === idObra);

  // Uma restrição que JÁ NASCE liberada — mostra histórico de impedimento resolvido, sem nada pendente
  const idPacoteExaustao = cronSalvo.find(p => p.Atividade.indexOf('exaustão') >= 0).ID;
  const restricao = apiSalvarRestricao(token, {
    IDObra: idObra, IDPacote: idPacoteExaustao, Categoria: 'Equipamento (Falha)',
    Descricao: '[EXEMPLO] Atraso na entrega do duto de exaustão — já resolvido',
    ResponsavelNome: 'Patrícia Souza', PrazoNecessario: isoOffset_(-20)
  });
  apiMoverRestricao(token, restricao.restricao.ID, 'Liberada');

  apiValidarCronograma(token, idObra, true, '[EXEMPLO] Cronograma aprovado pelo PMO.');

  // Parcelas + medições — quase tudo medido e aprovado (perto de 100%)
  let totalPlanejado = 0, totalAprovado = 0;
  cronSalvo.forEach((pac, i) => {
    const custo = (Number(pac.CustoDoacao) || 0) + (Number(pac.CustoProprio) || 0);
    totalPlanejado += custo;
    const parc = apiSalvarParcela(token, { IDObra: idObra, IDPacote: pac.ID, DescricaoParcela: 'Pagamento único', ValorPrevisto: String(custo) });
    // o ÚLTIMO pacote (ainda "Em andamento") fica só 80% medido — o resto fica de propósito sem medir,
    // pra mostrar uma curva S real (não 100% redondo) e uma obra genuinamente "quase" terminando.
    const valorMedir = i === cronSalvo.length - 1 ? Math.round(custo * 0.8) : custo;
    const med = apiRegistrarMedicao(token, { IDObra: idObra, IDPacote: pac.ID, IDParcela: parc.parcela.ID, ValorMedido: String(valorMedir), DescricaoEvidencia: '[EXEMPLO] Medição referente à execução já realizada.' });
    apiAprovarMedicao(token, med.medicao.ID, true, '[EXEMPLO] Aprovado pelo PMO.');
    totalAprovado += valorMedir;
  });

  return 'PROJETO 2 (finalizando) -> ' + idObra + ' — obra criada direto (sem Pedido), manifestação com Objeção, prazo encerrado manualmente, cronograma com ' +
    (cronSalvo.length - 1) + ' de ' + cronSalvo.length + ' pacotes Concluída, baseline congelada, ' +
    Math.round(totalAprovado / totalPlanejado * 100) + '% do valor planejado já medido e aprovado (não é 100% de propósito — falta a Fase 10/Encerramento pra fechar de vez).';
}
