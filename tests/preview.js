/**
 * Visualizador local: roda a página real (Index.html com os includes, como
 * o HtmlService monta) no Chromium, com google.script.run ligado ao servidor
 * simulado (tests/gas-mock.js) e dados de exemplo — sem Apps Script e sem
 * planilha real. Tira capturas de tela em tamanho de computador e celular.
 *
 * Uso: NODE_PATH=$(npm root -g) node tests/preview.js <pasta-saida> [roteiro]
 * O roteiro padrão percorre as telas principais; cada passo vira um PNG.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');
const { criarAmbiente } = require('./gas-mock');

const RAIZ = path.join(__dirname, '..');
const SAIDA = process.argv[2] || path.join(RAIZ, 'tests', 'capturas');
fs.mkdirSync(SAIDA, { recursive: true });

// ── servidor simulado com dados de exemplo ──
const arquivos = fs.readdirSync(RAIZ).filter(f => f.endsWith('.gs'))
  .sort((a, b) => (a === 'Setup.gs' ? -1 : b === 'Setup.gs' ? 1 : a.localeCompare(b)));
const amb = criarAmbiente();
const ctx = vm.createContext(Object.assign({}, amb.globais));
vm.runInContext(arquivos.map(f => fs.readFileSync(path.join(RAIZ, f), 'utf8')).join('\n;\n') + '\n;globalThis.__g = (n) => eval(n);', ctx);
const g = (n) => ctx.__g(n);
const novaExecucao = () => g('MEMORIA_ABAS_ = {}; VERSAO_DADOS_ = null; SS_EXECUCAO_ = null; EM_ESCRITA_ = false');

g('setup')();
g('semearPrimeiroPmo')();
const H = g('USUARIOS_HEADERS');
amb.aba('Usuarios').data[1][H.indexOf('SenhaHash')] = g('hashSenha_')('senha123');
const tPmo = g('login')('nucleodeprojetos@hospitaldabaleia.org.br', 'senha123').token;
g('criarProjetosExemplo')();
[['Carla Mendes', 'carla.mendes@hospitaldabaleia.org.br', 'Engenheira Civil', 'Engenharia'],
 ['Rafael Souza', 'rafael.souza@hospitaldabaleia.org.br', 'Engenheiro Eletricista', 'Engenharia'],
 ['Joana Lima', 'joana.lima@hospitaldabaleia.org.br', 'Mestre de obras', 'Responsavel'],
 ['Pedro Alves', 'pedro.alves@hospitaldabaleia.org.br', 'Diretor Administrativo', 'Consulta']]
  .forEach(([Nome, Email, Cargo, Papel]) => g('apiSalvarUsuario')(tPmo, { Nome, Email, Cargo, Papel, Senha: 'senha123' }));

// ── HtmlService mínimo: <? código ?>, <?= escapado ?>, <?!= cru ?> ──
function avaliarTemplate(nomeArquivo, vars) {
  const fonte = fs.readFileSync(path.join(RAIZ, nomeArquivo + '.html'), 'utf8');
  let js = 'let __o = "";\n';
  const re = /<\?(!?=)?([\s\S]*?)\?>/g;
  let ultimo = 0, m;
  while ((m = re.exec(fonte))) {
    js += '__o += ' + JSON.stringify(fonte.slice(ultimo, m.index)) + ';\n';
    if (m[1] === '!=') js += '__o += String(' + m[2].trim().replace(/;$/, '') + ');\n';
    else if (m[1] === '=') js += '__o += __esc(' + m[2].trim().replace(/;$/, '') + ');\n';
    else js += m[2] + '\n';
    ultimo = re.lastIndex;
  }
  js += '__o += ' + JSON.stringify(fonte.slice(ultimo)) + ';\nreturn __o;';
  const nomes = Object.keys(vars);
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return new Function(...nomes, '__esc', 'include', js)(...nomes.map(n => vars[n]), esc,
    (n) => fs.readFileSync(path.join(RAIZ, n + '.html'), 'utf8'));
}

function paginaAdmin() {
  const html = avaliarTemplate('Index', { view: 'admin', obraId: '', pedidoId: '', pedidoToken: '', dadosJson: 'null' });
  // google.script.run falso: encaminha cada chamada ao servidor simulado
  const ponte = `<script>
    (function(){
      function runner(ok, falha){
        return new Proxy({}, { get(_, nome){
          if(nome==='withSuccessHandler') return f => runner(f, falha);
          if(nome==='withFailureHandler') return f => runner(ok, f);
          return (...args) => { window.__gs(nome, JSON.stringify(args)).then(r => {
            const res = JSON.parse(r);
            setTimeout(() => res.erro ? (falha && falha(new Error(res.erro))) : (ok && ok(res.valor)), 0);
          }); };
        }});
      }
      window.google = { script: { run: runner(null, null) } };
    })();
  </script>`;
  return html.replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1">' + ponte);
}

// Recursos externos (fontes do Google, logo) baixados pelo curl — que confia
// no certificado do proxy da rede — e entregues prontos ao navegador de teste.
const { execFileSync } = require('child_process');
const externos = {};
function baixarExterno(url) {
  if (!externos[url]) {
    const tmp = path.join(require('os').tmpdir(), 'preview-' + Buffer.from(url).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 60));
    try {
      const tipo = execFileSync('curl', ['-sSL', '-A', 'Mozilla/5.0 Chrome/140', '-o', tmp, '-w', '%{content_type}', url]).toString();
      externos[url] = { status: 200, body: fs.readFileSync(tmp), contentType: tipo || 'application/octet-stream',
        headers: { 'access-control-allow-origin': '*' } };
    } catch (e) {
      externos[url] = { status: 404, body: '' };
    }
  }
  return externos[url];
}

async function main() {
  const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const tamanhos = { desktop: { width: 1366, height: 860 }, celular: { width: 390, height: 844 } };
  const roteiro = (process.argv[3] || 'login,painel,configuracoes-usuarios,configuracoes-perfis,configuracoes-aprovadores,usuario-modal,interacoes').split(',');
  for (const [nomeTam, viewport] of Object.entries(tamanhos)) {
    const pagina = await navegador.newPage({ viewport, deviceScaleFactor: 1 });
    const erros = [];
    pagina.on('pageerror', e => { erros.push(e.message); console.log('[erro na página] ' + e.message); });
    pagina.on('console', m => { if (m.type() === 'error') console.log('[console] ' + m.text()); });
    await pagina.exposeFunction('__gs', (nome, args) => {
      try {
        novaExecucao();
        const valor = g(nome)(...JSON.parse(args));
        return JSON.stringify({ valor: valor === undefined ? null : valor });
      } catch (e) {
        return JSON.stringify({ erro: e.message });
      }
    });
    // a página precisa de uma origem de verdade (sessionStorage); fontes e
    // imagens externas são bloqueadas, como numa rede sem internet
    const html = paginaAdmin();
    await pagina.route('**/*', r => {
      const url = r.request().url();
      if (url.indexOf('http://obras.local/') === 0) return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
      return r.fulfill(baixarExterno(url)); // fontes, ícones e logo reais
    });
    await pagina.goto('http://obras.local/', { waitUntil: 'networkidle' }).catch(() => {});
    const foto = async (nome) => {
      await pagina.waitForTimeout(250);
      // critério de aceite: nenhuma tela com rolagem lateral da página inteira
      const larg = await pagina.evaluate(() => ({ doc: document.documentElement.scrollWidth, tela: window.innerWidth,
        culpados: Array.from(document.querySelectorAll('#shellConteudo *')).filter(e => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.tab-scroll,.kanban-board,[style*="overflow-x:auto"],.seg-abas,.gantt-wrap'))
          .slice(0, 3).map(e => e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0]) }));
      if (larg.doc > larg.tela + 1) {
        console.log('[' + nomeTam + '] ROLAGEM LATERAL em ' + nome + ': página com ' + larg.doc + 'px numa tela de ' + larg.tela + 'px ' + JSON.stringify(larg.culpados));
        process.exitCode = 1;
      }
      await pagina.screenshot({ path: path.join(SAIDA, nomeTam + '-' + nome + '.png'), fullPage: nome !== 'usuario-modal' });
    };
    for (const passo of roteiro) {
      if (passo === 'login') {
        await foto('login');
        await pagina.fill('#loginEmail', 'nucleodeprojetos@hospitaldabaleia.org.br');
        await pagina.fill('#loginSenha', 'senha123');
        await pagina.click('#btnLogin');
        await pagina.waitForTimeout(400);
      } else if (passo === 'painel') {
        await foto('painel');
      } else if (passo.indexOf('configuracoes-') === 0) {
        await pagina.evaluate(() => navTo('configuracoes'));
        await pagina.waitForTimeout(300);
        await pagina.evaluate((aba) => { CFG_ABA = aba; renderConfiguracoes(); }, passo.split('-')[1]);
        await foto(passo);
      } else if (passo === 'interacoes') {
        // cliques reais na tela de Configurações; o resultado é conferido no servidor simulado
        await pagina.evaluate(() => navTo('configuracoes'));
        await pagina.waitForTimeout(300);
        await pagina.click('.seg-abas button:nth-child(2)');
        await pagina.click('#perfil-Consulta .pc-toggle');
        await pagina.click('#perfil-Consulta .perm-linha:nth-child(4) .perm-chip:nth-child(2)'); // Projetos · cadastrar e editar
        await foto('interacoes-perfil-alterado');
        await pagina.click('#perfil-Consulta .btn-teal');
        await pagina.waitForTimeout(400);
        await pagina.click('.seg-abas button:nth-child(3)');
        await pagina.selectOption('.apr-celula >> nth=0 >> select', 'P:Engenharia');
        await foto('interacoes-aprovador');
        await pagina.click('.barra-salvar .btn-teal');
        await pagina.waitForTimeout(400);
        await pagina.click('.seg-abas button:nth-child(1)');
        await pagina.click('.pg-header .btn-primary');
        await pagina.fill('#mu_nome', 'Teste Visual');
        await pagina.fill('#mu_email', 'teste.visual@hospitaldabaleia.org.br');
        await pagina.selectOption('#mu_perfil', 'Consulta');
        await pagina.click('button:has-text("Gerar")');
        await pagina.click('#mu_salvar');
        await pagina.waitForTimeout(500);
        await foto('interacoes-usuario-criado');
        novaExecucao();
        const cfg = g('apiConfigAcessos')(tPmo);
        const consulta = cfg.perfis.find(p => p.perfil === 'Consulta').permissoes;
        const verif = {
          permissaoSalva: consulta.indexOf('projetos.editar') >= 0 && consulta.indexOf('projetos.ler') >= 0,
          aprovadorSalvo: cfg.aprovadores.some(a => a.Portao === 'G0' && a.Tipo === 'Obra' && a.Perfil === 'Engenharia'),
          usuarioCriado: cfg.usuarios.some(u => u.Email === 'teste.visual@hospitaldabaleia.org.br' && u.Papel === 'Consulta')
        };
        console.log('[' + nomeTam + '] interações: ' + JSON.stringify(verif));
        if (!verif.permissaoSalva || !verif.aprovadorSalvo || !verif.usuarioCriado) process.exitCode = 1;
        // desfaz para o próximo tamanho de tela
        g('apiSalvarPerfil')(tPmo, { Perfil: 'Consulta', Permissoes: consulta.filter(x => x !== 'projetos.editar') });
        g('apiSalvarAprovadores')(tPmo, []);
        const u = cfg.usuarios.find(x => x.Email === 'teste.visual@hospitaldabaleia.org.br');
        g('apiSalvarUsuario')(tPmo, { ID: u.ID, Nome: u.Nome, Email: 'removido.' + nomeTam + '@x.org', Papel: 'Consulta', Status: 'inativo' });
        await pagina.evaluate(() => { CFG = null; });
      } else if (passo.indexOf('js:') === 0) {
        // passo livre: "js:<código>=<nome da captura>" (ex.: abrir o detalhe de uma obra)
        const [codigo, nome] = passo.slice(3).split('=');
        await pagina.evaluate(codigo);
        await pagina.waitForTimeout(700);
        await foto(nome);
      } else if (passo === 'menu') {
        if (viewport.width <= 900) {
          await pagina.click('.mb-botao');
          await pagina.waitForTimeout(300);
          await foto('menu-aberto');
          await pagina.click('.sb-fundo', { position: { x: viewport.width - 20, y: 400 } });
          await pagina.waitForTimeout(250);
        }
      } else if (passo === 'usuario-modal') {
        await pagina.evaluate(() => { CFG_ABA = 'usuarios'; renderConfiguracoes(); abrirUsuario_(CFG.usuarios[1].ID); });
        await foto(passo);
        await pagina.evaluate(() => fecharModalCfg_('modalUsuario'));
      } else {
        await pagina.evaluate((id) => navTo(id), passo);
        await pagina.waitForTimeout(300);
        await foto(passo);
      }
    }
    if (erros.length) console.log('[' + nomeTam + '] erros de JavaScript na página:\n  ' + erros.join('\n  '));
    await pagina.close();
  }
  await navegador.close();
  console.log('Capturas em ' + SAIDA);
}
main().catch(e => { console.error(e); process.exit(1); });
