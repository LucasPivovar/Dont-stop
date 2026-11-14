# Academia Don't Stop

Site estático da Academia Don't Stop, em Araucária, PR. HTML, CSS e JavaScript, com GSAP, ScrollTrigger e MotionPathPlugin distribuídos localmente.

## Executar localmente

Requer Node.js. Não é necessário instalar dependências.

```sh
npm start
```

Abra http://localhost:3000. Também é possível executar `node preview.cjs`.

## Recursos

- Layout adaptado para celular, tablet e desktop.
- Galeria com botões, teclado e gestos de toque.
- Cards com contornos que acompanham os recortes e animações GSAP.
- Anilha decorativa de 10 kg com trajeto vinculado à rolagem, recalculado conforme o tamanho da tela.
- Suporte à preferência de movimento reduzido.
- Imagens com tamanhos responsivos e carregamento tardio abaixo da primeira tela.
- Bootstrap Icons em SVG local; licença em `assets/bootstrap-icons-LICENSE.txt`.

## Contato e agendamento

O formulário valida os dados e prepara uma mensagem para o WhatsApp da academia. O visitante revisa e envia a mensagem no WhatsApp; o site não confirma reservas, não salva cadastros e não possui backend.

## Publicação

Publique os arquivos da raiz em um serviço de hospedagem estática. Não existe etapa de build. O servidor `preview.cjs` serve somente para visualização local e escuta em `127.0.0.1`.

Antes de lançar uma campanha, confirme com a academia os preços, horários, endereço, telefone, condições e fotos. As bibliotecas GSAP mantêm seus avisos de licença; origem e versão estão em `assets/vendor/gsap/SOURCE.txt`.
