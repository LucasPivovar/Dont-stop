# Academia Don't Stop — site e gestão

Site institucional e sistema de gestão da Academia Don't Stop, em Araucária, PR. O painel segue a identidade visual da academia e utiliza um banco SQLite persistente no servidor, compartilhado entre os acessos da equipe.

## Iniciar

Requer **Node.js 24 ou superior**. Não é necessário instalar dependências.

```sh
npm start
```

- Site: http://127.0.0.1:3100/
- Gestão: http://127.0.0.1:3100/sistema/

No primeiro acesso, crie o administrador. Não existe senha padrão no ambiente real. Os dados ficam em `.data/gym.sqlite`, fora dos arquivos públicos e do controle de versão.

Para executar apenas a prévia estática do site antigo na porta 3000, use `npm run preview`.

## Demonstração separada

### Apresentação estática na Vercel

Importe este repositório na Vercel usando a branch `main` e a pasta raiz. O arquivo `vercel.json` já define a compilação e a pasta de saída. Não é necessário configurar banco ou variáveis de ambiente para essa apresentação.

- `/`: site da academia, com um link "Sistema" na navegação.
- `/sistema/`: painel que abre com oito mensalistas fictícios, planos, assinaturas, cobranças e agenda preenchida.
- `/mensalista/`: área individual com slides, treino do dia, mensalidade e benefícios. Escolha um aluno fictício em "Explorar área do mensalista". O acesso de Ana é `aluno1@dontstop.local` / `Mensalista!2026`.
- Cadastros, edição, remarcação, pagamentos simulados e exportação CSV funcionam no navegador. As alterações ficam no localStorage desse navegador; não são compartilhadas com outras pessoas.
- O botão "Restaurar demonstração" volta aos dados iniciais.
- Ao sair, use "Explorar demonstração" ou o acesso fictício `demo@dontstop.local` / `Demonstracao!2026`.

Essa versão serve para apresentar o produto. O login é simulado e os dados são públicos; não cadastre alunos reais nem senhas utilizadas em outros serviços. A versão real com banco compartilhado continua no servidor Node.

Para testar a apresentação localmente:

```sh
npm run build:demo
npm run preview:demo
```

Abra http://127.0.0.1:3200/. A compilação copia apenas arquivos públicos para `dist-demo`, com dados gerados de um banco de demonstração em memória. Ela não lê `.data`, credenciais ou o banco real. O adaptador estático é incluído somente nessa compilação; o sistema Node continua usando sua API real.

### Demonstração com servidor Node

```sh
npm run sistema:demo
```

Abra http://127.0.0.1:3101/sistema/?demo=1. Esse ambiente usa **dados fictícios** e um banco separado, `.data/demo.sqlite`. O acesso de demonstração, intencionalmente público, é `demo@dontstop.local` / `Demonstracao!2026`. A opção de demonstração não é habilitada pelo comando de produção.

## O que está implementado

- **Mensalistas:** cadastro, edição, situação ativa/inativa, busca, paginação, perfil com histórico e exportação CSV.
- **Agenda:** calendário mensal, grade semanal e lista diária; criação por data/horário, visitantes, responsáveis, duração, filtros, edição, remarcação, conclusão e cancelamento. Conflitos do mesmo responsável são recusados.
- **Assinaturas:** vínculo ao plano, primeira cobrança, pausa, retomada, cancelamento e geração da próxima mensalidade após quitação da atual. O dia de cobrança é preservado nos finais de mês e o valor contratado não muda quando o plano é reajustado.
- **Cobranças:** criação avulsa, vencimentos, valores em aberto/atraso, baixa manual, forma e data do pagamento, cancelamento e histórico. Pagamentos duplicados são bloqueados.
- **Planos:** cadastro, edição de valores e condições, ativação e inativação.
- **Equipe:** acessos individuais de administrador ou equipe, edição, desativação, redefinição de senha e revogação de sessões.
- **Minha conta:** alteração de nome e senha com verificação da senha atual.
- **Visão geral:** indicadores calculados a partir dos registros, recebimentos por mês, agenda de hoje e cobranças pendentes.
- **WhatsApp:** preparação de lembretes para revisão e envio manual. Não envia mensagens sozinho.
- **Área do mensalista:** login separado da equipe, consulta somente aos próprios dados, slides da academia, plano e histórico financeiro, treino semanal com exercícios/séries/repetições/carga/pausa, conclusão diária, alteração de dados/senha e apresentação de benefícios.
- **Gestão do portal:** em Mensalistas, use "Área do mensalista e treinos" ou abra o perfil e "Área do mensalista". A equipe cadastra o e-mail e a senha inicial, desativa acessos, sinaliza os benefícios incluídos e monta o treino de cada dia. Novos alunos reais não recebem treinos nem benefícios automaticamente.

Telemedicina e clube de descontos estão preparados como benefícios. Para oferecer o serviço de verdade, a academia precisa contratar os parceiros e configurar `GYM_TELEMEDICINE_URL` / `GYM_DISCOUNTS_URL` com os links HTTPS. Até isso acontecer, o portal orienta o aluno a falar com a recepção. Não há consulta médica, emissão de voucher ou autenticação no parceiro implementada no projeto. A demonstração informa isso ao abrir os benefícios.

O portal real usa sessões próprias em cookies HttpOnly, separadas da equipe. Desativar o acesso ou inativar o mensalista bloqueia seu uso. Resetar a senha pela equipe revoga as sessões anteriores. Conclusões de treino são vinculadas ao aluno e ao dia programado, sem duplicação. O backend filtra os dados pelo aluno autenticado; o cliente não escolhe o identificador para consultar outro cadastro.

O gateway foi adiado por decisão do projeto. **Não há geração automática de Pix/boletos, débito automático, disparo automático de mensagens ou conciliação com banco.** Registrar um pagamento no painel não movimenta dinheiro.

## Acesso compartilhado

Todos os computadores e celulares devem acessar **o mesmo servidor**, com armazenamento persistente. Cada dispositivo usa sua própria sessão; os dados não ficam em localStorage.

Copie `.env.example` para `.env` e configure quando necessário:

| Variável | Uso |
| --- | --- |
| `PORT` | Porta do servidor, padrão 3100. |
| `HOST` | Interface de rede; padrão 127.0.0.1. Use 0.0.0.0 no servidor de hospedagem. |
| `APP_ORIGIN` | Origem exata do painel, por exemplo https://gestao.suaacademia.com.br. |
| `GYM_SETUP_TOKEN` | Código exclusivo para o primeiro cadastro de administrador fora do computador local. |
| `GYM_DATABASE` | Caminho do arquivo SQLite, caso não use .data/gym.sqlite. |

Para internet, configure domínio e HTTPS no proxy da hospedagem e defina `APP_ORIGIN` com a URL HTTPS. A sessão passa a usar cookie Secure. O cadastro inicial remoto exige o código configurado no servidor. Cadastre o administrador antes de entregar os acessos à equipe.

O backend Node não funciona em hospedagem puramente estática, como GitHub Pages. É necessário um serviço Node com disco persistente, uma VPS ou o container incluído. Mantenha uma única instância de aplicação apontada para o volume SQLite; não use réplicas com bancos separados.

### Docker

Preencha `APP_ORIGIN` e um `GYM_SETUP_TOKEN` exclusivo no ambiente do Docker Compose.

```sh
docker compose up -d --build
```

O painel fica em http://localhost:3100/sistema/ com volume persistente `dont-stop-data`. Configure a origem e o proxy HTTPS para acesso pela internet. O container usa usuário não privilegiado.

## Backup

```sh
npm run backup
```

O comando usa a API de backup do SQLite, incluindo dados confirmados no WAL, e salva um novo arquivo em `.data/backups/`. Em Docker, use `docker compose exec academia node server/backup.cjs`.

Guarde cópias fora do servidor. Para restaurar, pare a aplicação, copie o backup para um **novo arquivo SQLite** e configure `GYM_DATABASE` para esse arquivo antes de iniciar novamente; isso evita misturar um backup com arquivos WAL antigos. Bancos e backups contêm dados da academia e não devem ser publicados no GitHub.

## Verificação

```sh
npm test
```

Os testes usam um banco temporário isolado e cobrem autenticação, permissões, origens de requisição, persistência, cadastro, cobranças, baixa duplicada, datas de renovação, remarcação, conflitos de agenda, cancelamentos, troca de senha, exportação e lógica dos calendários mensal/semanal/diário. Não exigem dados reais.

## Bibliotecas e imagens

GSAP e Bootstrap Icons são distribuídos localmente. Os avisos de licença estão em `assets/vendor/gsap/SOURCE.txt` e `assets/bootstrap-icons-LICENSE.txt`. As fotos do site têm variantes responsivas. Confirme com a academia preços, horários, endereço, telefone e fotos antes de uma campanha pública.
