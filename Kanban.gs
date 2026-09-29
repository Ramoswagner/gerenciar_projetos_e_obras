/**
 * Painel de Controle — Kanban unificado do ciclo de vida da obra. Bucket
 * é sempre CALCULADO na leitura a partir de Pedidos.Status/Obras.Status/
 * Obras.StatusCronograma — nunca um enum novo gravado (mesmo princípio já
 * usado na numeração de Etapas/Pacotes). Funções puras (kanbanBucket*_),
 * sem I/O de planilha, pra poderem ser testadas isoladas.
 *
 * Mapeamento (ver plano de construção):
 * Pedido (Novo/Em análise/Aguardando mais informações) · Manifestação
 * (Obra Rascunho/Publicada/Manifestação encerrada) · Cronograma
 * (StatusCronograma Aguardando validação/Revisão solicitada) · Validado
 * (StatusCronograma Validado, obra ainda não liberada) · Execução
 * (Liberada/Em execução) · Encerramento (Concluída/Finalizado) ·
 * Cancelado/Recusado — saídas paralelas, fora do fluxo principal.
 */

const KANBAN_FASES = ['Pedido', 'Manifestação', 'Cronograma', 'Validado', 'Execução', 'Encerramento'];

function kanbanBucketPedido_(pedido) {
  if (pedido.Status === 'Cancelado') return { bucket: 'Cancelado', subfase: 'Pedido' };
  if (pedido.Status === 'Recusado') return { bucket: 'Recusado', subfase: 'Pedido' };
  if (pedido.Status === 'Aceito') return null; // já virou obra — representado só pela obra, evita duplicar o cartão
  return { bucket: 'Pedido', subfase: pedido.Status }; // Novo / Em análise / Aguardando mais informações
}

function kanbanBucketObra_(obra) {
  if (obra.Status === 'Cancelada') return { bucket: 'Cancelado', subfase: 'Obra' };
  if (obra.Status === 'Finalizado' || obra.Status === 'Concluída') return { bucket: 'Encerramento', subfase: obra.Status };
  if (obra.Status === 'Liberada' || obra.Status === 'Em execução') return { bucket: 'Execução', subfase: obra.Status };
  const sc = obra.StatusCronograma || 'Rascunho';
  if (sc === 'Validado') return { bucket: 'Validado', subfase: 'Aguardando liberação' };
  if (sc === 'Aguardando validação' || sc === 'Revisão solicitada') return { bucket: 'Cronograma', subfase: sc };
  return { bucket: 'Manifestação', subfase: obra.Status }; // Rascunho / Publicada / Manifestação encerrada
}

// Cache de 120s com a versão dos dados na chave (cacheLer_/cacheGravar_):
// qualquer gravação em Pedidos, Obras ou Cronograma já invalida o quadro,
// sem precisar lembrar de limpar esta chave em cada escritor.
const CACHE_KANBAN = 'admin_kanban_v1';

function apiKanban(token) {
  exigir_(token, 'painel', 'ler');
  const hit = cacheLer_(CACHE_KANBAN);
  if (hit) return hit;
  prepararAbas_([SHEETS.PEDIDOS, SHEETS.CRONOGRAMA, SHEETS.OBRAS]);

  const pedidos = readAll_(SHEETS.PEDIDOS, PEDIDOS_HEADERS)
    .map(p => {
      const b = kanbanBucketPedido_(p);
      if (!b) return null;
      return {
        tipo: 'pedido', ID: p.ID,
        Titulo: String(p.FinalidadeObjetivo || '').slice(0, 140),
        Area: p.Area, Urgencia: p.Urgencia, CriadoEm: p.CriadoEm,
        bucket: b.bucket, subfase: b.subfase
      };
    })
    .filter(Boolean);

  // progresso aproximado (pacotes concluídos / total) — decorativo até o
  // Compromisso Semanal (Fase 9) trazer PPC de verdade, mesma ressalva já
  // feita na barra de progresso do Gantt.
  const cronPorObra = {};
  readAll_(SHEETS.CRONOGRAMA, CRONOGRAMA_HEADERS).forEach(c => {
    cronPorObra[c.IDObra] = cronPorObra[c.IDObra] || { total: 0, concluidos: 0 };
    cronPorObra[c.IDObra].total++;
    if (c.Status === 'Concluída') cronPorObra[c.IDObra].concluidos++;
  });

  const obras = readAll_(SHEETS.OBRAS, OBRAS_HEADERS).map(o => {
    const b = kanbanBucketObra_(o);
    const cp = cronPorObra[o.ID];
    return {
      tipo: 'obra', ID: o.ID, Titulo: o.Titulo, Setor: o.Setor,
      PrazoManifestacao: o.PrazoManifestacao, Status: o.Status,
      StatusCronograma: o.StatusCronograma, CriadoEm: o.CriadoEm,
      progresso: (cp && cp.total) ? Math.round(cp.concluidos / cp.total * 100) : null,
      bucket: b.bucket, subfase: b.subfase
    };
  });

  const resultado = { pedidos: pedidos, obras: obras };
  cacheGravar_(CACHE_KANBAN, resultado, 120);
  return resultado;
}

// ────────────────────────────────────────────── PAINEL (Etapa 4) ──
//
// Tudo o que a tela Painel mostra, numa única chamada:
//  - aguardando: o que depende de QUEM está logado (filtrado pelas
//    permissões dele), com o destino do clique;
//  - indicadores: números do portfólio;
//  - quadro: pedidos e projetos por fase, com situação (em dia / atenção /
//    atrasado) e a próxima data importante.
// A parte comum a todos (quadro + indicadores) fica em cache com a versão
// dos dados; a lista "aguardando" é montada por usuário a partir das
// mesmas abas, já em memória.

const CACHE_PAINEL = 'painel_base_v1';
const DIAS_ATENCAO = 7;

function apiPainel(token) {
  const sessao = exigir_(token, 'painel', 'ler');
  prepararAbas_([SHEETS.PEDIDOS, SHEETS.OBRAS, SHEETS.CRONOGRAMA, SHEETS.RESTRICOES, SHEETS.COMPROMISSO_SEMANAL,
    SHEETS.MEDICOES, SHEETS.AREAS_PROP, SHEETS.ENCERRAMENTO_ASSINATURAS]);
  const hoje = isoDoDate_(new Date());
  let base = cacheLer_(CACHE_PAINEL);
  if (!base || base.hoje !== hoje) {
    base = montarPainelBase_(hoje);
    cacheGravar_(CACHE_PAINEL, base, 300);
  }
  return {
    hoje: hoje,
    aguardando: pendenciasDe_(sessao, hoje),
    indicadores: base.indicadores,
    fases: KANBAN_FASES,
    itens: base.itens
  };
}

function somarDias_(iso, dias) {
  const d = parseDate_(iso) || new Date();
  return isoDoDate_(new Date(d.getFullYear(), d.getMonth(), d.getDate() + dias));
}

function montarPainelBase_(hoje) {
  const limiteAtencao = somarDias_(hoje, DIAS_ATENCAO);
  const pacotes = readAll_(SHEETS.CRONOGRAMA, CRONOGRAMA_HEADERS);
  const restricoes = readAll_(SHEETS.RESTRICOES, RESTRICOES_HEADERS);
  const porObra = (lista) => {
    const m = {};
    lista.forEach(x => { (m[x.IDObra] = m[x.IDObra] || []).push(x); });
    return m;
  };
  const pacotesPorObra = porObra(pacotes);
  const restricoesPorObra = porObra(restricoes);

  const itens = [];
  readAll_(SHEETS.PEDIDOS, PEDIDOS_HEADERS).forEach(p => {
    const b = kanbanBucketPedido_(p);
    if (!b) return;
    const aberto = b.bucket === 'Pedido';
    itens.push({
      tipo: 'pedido', ID: p.ID, Titulo: String(p.FinalidadeObjetivo || '').slice(0, 140),
      bucket: b.bucket, subfase: b.subfase, local: p.SetorDesejado || p.Area || '',
      responsavel: p.Nome || '', proximaData: p.DataDesejada || '', rotuloData: 'desejado para',
      situacao: aberto && String(p.Urgencia).indexOf('Urgente') === 0 ? 'atencao' : 'emdia',
      motivo: aberto && String(p.Urgencia).indexOf('Urgente') === 0 ? 'Urgente' : '',
      progresso: null, criadoEm: p.CriadoEm
    });
  });

  readAll_(SHEETS.OBRAS, OBRAS_HEADERS).forEach(o => {
    const b = kanbanBucketObra_(o);
    const pacs = pacotesPorObra[o.ID] || [];
    const pendentes = pacs.filter(x => x.Status !== 'Concluída');
    const atrasados = pendentes.filter(x => x.DataFimPrevista && x.DataFimPrevista < hoje);
    const restAbertas = (restricoesPorObra[o.ID] || []).filter(r => r.Status !== 'Liberada');
    const restVencendo = restAbertas.filter(r => r.PrazoNecessario && r.PrazoNecessario <= limiteAtencao);
    const encerrada = ['Cancelada', 'Finalizado', 'Concluída'].indexOf(o.Status) >= 0;

    let proximaData = '', rotuloData = '';
    if (b.bucket === 'Manifestação' && o.Status === 'Publicada') { proximaData = o.PrazoManifestacao; rotuloData = 'manifestação até'; }
    else if (pendentes.length) {
      const prox = pendentes.map(x => x.DataFimPrevista).filter(Boolean).sort()[0];
      if (prox) { proximaData = prox; rotuloData = 'próxima entrega'; }
    }
    if (!proximaData && o.DataFim && !encerrada) { proximaData = o.DataFim; rotuloData = 'término previsto'; }

    let situacao = 'emdia', motivo = '';
    if (!encerrada) {
      if (atrasados.length) { situacao = 'atrasado'; motivo = atrasados.length + ' atividade(s) atrasada(s)'; }
      else if (restVencendo.length) { situacao = 'atencao'; motivo = restVencendo.length + ' restrição(ões) vencendo'; }
      else if (o.Status === 'Publicada' && o.PrazoManifestacao && o.PrazoManifestacao <= somarDias_(hoje, 2)) { situacao = 'atencao'; motivo = 'prazo de manifestação acabando'; }
    }
    itens.push({
      tipo: 'obra', ID: o.ID, Titulo: o.Titulo, bucket: b.bucket, subfase: b.subfase,
      local: o.Setor || '', responsavel: o.ResponsavelNome || '',
      proximaData: proximaData, rotuloData: rotuloData, situacao: situacao, motivo: motivo,
      progresso: pacs.length ? Math.round(pacs.filter(x => x.Status === 'Concluída').length / pacs.length * 100) : null,
      criadoEm: o.CriadoEm
    });
  });

  // PPC da semana atual (todas as obras)
  const semana = isoDoDate_(inicioSemana_(parseDate_(hoje)));
  const ppc = calcularPPC_(readAll_(SHEETS.COMPROMISSO_SEMANAL, COMPROMISSO_SEMANAL_HEADERS).filter(c => c.DataInicioSemana === semana));
  const medicoes = readAll_(SHEETS.MEDICOES, MEDICOES_HEADERS);
  const soma = (lista) => Math.round(lista.reduce((s, m) => s + (parseMoedaServidor_(m.ValorMedido) || 0), 0) * 100) / 100;

  const ativos = itens.filter(i => i.tipo === 'obra' && ['Cancelado', 'Recusado', 'Encerramento'].indexOf(i.bucket) < 0);
  return {
    hoje: hoje,
    itens: itens,
    indicadores: {
      pedidosAbertos: itens.filter(i => i.tipo === 'pedido' && i.bucket === 'Pedido').length,
      projetosAtivos: ativos.length,
      atrasados: ativos.filter(i => i.situacao === 'atrasado').length,
      atencao: ativos.filter(i => i.situacao === 'atencao').length,
      ppcSemana: ppc,
      restricoesAbertas: restricoes.filter(r => r.Status !== 'Liberada').length,
      valorMedidoAprovado: soma(medicoes.filter(m => m.StatusAprovacao === 'Aprovada')),
      valorMedidoPendente: soma(medicoes.filter(m => m.StatusAprovacao === 'Pendente'))
    }
  };
}

// O que depende de quem está logado. Cada item: {tipo, titulo, detalhe,
// quando, urgente, tela, id} — `tela`/`id` dizem o que abrir ao clicar.
function pendenciasDe_(sessao, hoje) {
  const pmo = sessao.papel === 'PMO';
  const pode = (m, a) => temPermissao_(sessao.papel, m, a);
  const limite = somarDias_(hoje, DIAS_ATENCAO);
  const obras = readAll_(SHEETS.OBRAS, OBRAS_HEADERS);
  const tituloObra = {}; obras.forEach(o => { tituloObra[o.ID] = o.Titulo; });
  const out = [];

  if (pode('pedidos', 'editar')) {
    readAll_(SHEETS.PEDIDOS, PEDIDOS_HEADERS).filter(p => p.Status === 'Novo' || p.Status === 'Em análise').forEach(p => out.push({
      tipo: 'pedido', titulo: 'Analisar pedido: ' + String(p.FinalidadeObjetivo || '').slice(0, 90),
      detalhe: (p.Area || '') + (p.Nome ? ' · ' + p.Nome : ''), quando: (p.CriadoEm || '').slice(0, 10),
      urgente: String(p.Urgencia).indexOf('Urgente') === 0, tela: 'pedido', id: p.ID
    }));
  }
  if (pmo) {
    obras.filter(o => o.StatusCronograma === 'Aguardando validação').forEach(o => out.push({
      tipo: 'cronograma', titulo: 'Validar cronograma', detalhe: o.ID + ' · ' + o.Titulo, quando: '',
      urgente: false, tela: 'cronograma', id: o.ID
    }));
    readAll_(SHEETS.MEDICOES, MEDICOES_HEADERS).filter(m => m.StatusAprovacao === 'Pendente').forEach(m => out.push({
      tipo: 'medicao', titulo: 'Conferir medição de R$ ' + Number(parseMoedaServidor_(m.ValorMedido) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
      detalhe: m.IDObra + ' · ' + (tituloObra[m.IDObra] || ''), quando: (m.RegistradoEm || '').slice(0, 10),
      urgente: false, tela: 'pagamentos', id: m.IDObra
    }));
    readAll_(SHEETS.AREAS_PROP, AREAS_PROP_HEADERS).filter(a => a.Status === 'Pendente').forEach(a => out.push({
      tipo: 'area', titulo: 'Decidir área proposta: ' + a.Nome, detalhe: 'Sugerida por ' + (a.PropostoPor || '—'),
      quando: (a.CriadoEm || '').slice(0, 10), urgente: false, tela: 'areas', id: a.ID
    }));
  }
  if (pode('execucao', 'editar')) {
    readAll_(SHEETS.RESTRICOES, RESTRICOES_HEADERS)
      .filter(r => r.Status !== 'Liberada' && r.PrazoNecessario && r.PrazoNecessario <= limite)
      .forEach(r => out.push({
        tipo: 'restricao', titulo: (r.PrazoNecessario < hoje ? 'Restrição vencida: ' : 'Liberar restrição: ') + String(r.Descricao || '').slice(0, 90),
        detalhe: r.IDObra + ' · ' + (tituloObra[r.IDObra] || '') + (r.ResponsavelNome ? ' · ' + r.ResponsavelNome : ''),
        quando: r.PrazoNecessario, urgente: r.PrazoNecessario < hoje, tela: 'lookahead', id: r.ID
      }));
  }
  if (pode('projetos', 'editar')) {
    obras.filter(o => o.Status === 'Publicada' && o.PrazoManifestacao && o.PrazoManifestacao <= somarDias_(hoje, 2)).forEach(o => out.push({
      tipo: 'manifestacao', titulo: o.PrazoManifestacao < hoje ? 'Prazo de manifestação vencido: decidir' : 'Prazo de manifestação acabando',
      detalhe: o.ID + ' · ' + o.Titulo, quando: o.PrazoManifestacao, urgente: o.PrazoManifestacao < hoje, tela: 'obra', id: o.ID
    }));
  }
  readAll_(SHEETS.ENCERRAMENTO_ASSINATURAS, ENCERRAMENTO_ASSINATURAS_HEADERS)
    .filter(a => a.Status === 'Pendente' && a.IDUsuario && a.IDUsuario === sessao.usuarioId)
    .forEach(a => out.push({
      tipo: 'assinatura', titulo: 'Assinar aceite da entrega', detalhe: a.IDObra + ' · ' + (tituloObra[a.IDObra] || ''),
      quando: '', urgente: false, tela: 'encerramento', id: a.IDObra
    }));

  // urgentes primeiro; depois pela data (sem data por último)
  return out.sort((a, b) => (b.urgente - a.urgente) || String(a.quando || '9999').localeCompare(String(b.quando || '9999')));
}
