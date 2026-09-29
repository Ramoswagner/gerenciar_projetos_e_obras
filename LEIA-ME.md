# Gestão de Projetos e Obras — Hospital da Baleia

Web app em Google Apps Script com a planilha Google como banco de dados.

## Publicar

1. Envie o código: `clasp push` (ou copie os arquivos `.gs` e `.html` para o editor).
2. No editor: **Implantar → Gerenciar implantações → editar (lápis) → Versão: Nova versão → Implantar**.
   Sem isso, o endereço publicado continua na versão anterior. Mantenha sempre a **mesma implantação**,
   para os links já enviados (`?obra=`, `?pedido=&tk=`, `?novopedido=1`) continuarem valendo.

Antes de cada publicação em produção, faça uma cópia da planilha (Arquivo → Fazer uma cópia).
Para voltar atrás: **Gerenciar implantações → editar → escolher a versão anterior → Implantar**.

## Homologação (testar antes da produção)

1. Faça uma cópia da planilha de produção.
2. Na cópia: **Extensões → Apps Script** e cole o código novo (ou use um segundo `.clasp.json` apontando para esse projeto).
3. Implante a cópia como web app e teste com os usuários-chave.
4. Só depois publique na produção.

## Funções de manutenção (rodar pelo editor)

Escolha a função na barra do editor e clique em **Executar**. Todas são bloqueadas para quem acessa pelo site.

| Função | O que faz |
|---|---|
| `setup` | Cria as abas que faltam e completa colunas novas, sem apagar dados |
| `semearPrimeiroPmo` | Cria o primeiro PMO ou renova a senha dele (a senha sai no log) |
| `instalarTriggerBackup` | Instala o backup semanal (domingo, ~3h) |
| `backupSemanal` | Faz um backup agora e remove os com mais de 90 dias |
| `criarProjetosExemplo` | Cria 2 obras de demonstração percorrendo todas as fases |
| `migrarCustoParaNumero` | Converte custos antigos em texto para número |
| `diagnosticarCronograma` | Mostra no log as linhas do cronograma e IDs repetidos |
| `testAuth` | Testa login, sessão e bloqueio por tentativas |

## Testes automáticos (no computador)

Precisa do Node.js 18 ou mais novo. Na pasta do projeto:

```bash
npm test
```

Os testes rodam o servidor inteiro num simulador do Apps Script (`tests/gas-mock.js`), sem tocar em
nenhuma planilha real: segurança (funções de manutenção, papéis, sessões), integridade (salvar uma
obra nunca altera outra) e o fluxo completo de exemplo. O `.claspignore` impede que a pasta `tests/`
seja enviada ao Apps Script.
