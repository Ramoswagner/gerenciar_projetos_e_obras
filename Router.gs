/**
 * Roteamento — doGet decide a view pela query string e o Index.html
 * inclui condicionalmente só os módulos daquela view (rotas públicas
 * nunca carregam o JS/CSS do painel administrativo).
 *
 * Mesmo roteamento do sistema atual (?obra= / ?pedido=&tk= /
 * ?novopedido=1 / sem parâmetro = admin), agora servido por template
 * multi-arquivo em vez de um App.html único.
 */

// Usada dentro do Index.html: <?!= include('NomeDoArquivo') ?>
function include(nome) {
  return HtmlService.createHtmlOutputFromFile(nome).getContent();
}

// Nunca lança: erro vira {erro} pro front exibir a tela de "não
// encontrado" sem quebrar o doGet. O replace de "<" impede que um dado
// malicioso feche a tag <script> do template (JSON dentro de <script>).
function montarDadosIniciais_(view, p) {
  let dados = null;
  try {
    if (view === 'pedido_status') dados = apiGetPedidoStatus(p.pedido, p.tk || '');
    else if (view === 'pedido_form') dados = apiContextoPedido();
    else if (view === 'publica') dados = apiGetObraPublica(p.obra);
  } catch (e) {
    dados = { erro: String(e && e.message ? e.message : e) };
  }
  return JSON.stringify(dados).replace(/</g, '\\u003c');
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  const t = HtmlService.createTemplateFromFile('Index');

  if (p.obra) {
    t.view = 'publica';
  } else if (p.pedido) {
    t.view = 'pedido_status';
  } else if (p.novopedido) {
    t.view = 'pedido_form';
  } else {
    t.view = 'admin';
  }
  t.obraId = p.obra || '';
  t.pedidoId = p.pedido || '';
  t.pedidoToken = p.tk || '';
  // Dados das views públicas embutidos no HTML pelo servidor: a página
  // abre pronta em UMA viagem, sem depender do google.script.run pra
  // leitura inicial — que falha em silêncio com cookies de terceiros
  // bloqueados (padrão do Chrome atual) e deixava o público preso no
  // "Carregando…". Ações (enviar/responder) continuam via google.script.run.
  t.dadosJson = montarDadosIniciais_(t.view, p);

  return t.evaluate()
    .setTitle('Gestão Estratégica de Projetos | PMO')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
