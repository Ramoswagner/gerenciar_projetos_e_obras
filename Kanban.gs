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

// Cache curto (120s), SEM invalidação explícita de propósito: o Kanban
// agrega Pedidos+Obras+Cronograma, escritos em 4 arquivos diferentes —
// perseguir invalidação em cada um deles custaria mais risco (fácil
// esquecer um ponto) do que o benefício vale aqui, já que é um quadro de
// visão geral (não uma tela de detalhe/decisão). No pior caso, o Kanban
// fica até 2min desatualizado — aceitável pra um board de "onde as coisas
// estão", igual a outras aproximações já assumidas neste projeto (%
// decorativo do Gantt/progresso). Detalhe de cada item (apiGetObraAdmin
// etc.) nunca passa por este cache.
const CACHE_KANBAN = 'admin_kanban_v1';

function apiKanban(token) {
  validarToken_(token);
  const cache = CacheService.getScriptCache();
  const hit = cache.get(CACHE_KANBAN);
  if (hit) return JSON.parse(hit);

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
  cache.put(CACHE_KANBAN, JSON.stringify(resultado), 120);
  return resultado;
}
