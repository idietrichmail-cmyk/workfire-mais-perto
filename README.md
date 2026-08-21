# Work Fire mais perto de você — Portal da área de trabalho

Este site é uma segunda porta de entrada para a **mesma área de trabalho** do projeto `agenda-instrutores` — mesmo banco de dados (Supabase), mesmos cadastros (Instrutores, Empresas, Centros de Treinamento, Tipos de Treinamento, Usuários do Sistema), mesmas operações (Agendar Treinamento, Orçamentos, Turmas por Orçamento) e mesmas permissões por usuário.

- Login com e-mail e senha (mesmo cadastro de **Usuários do Sistema**).
- Depois de autenticado, aparece o menu com os módulos liberados para aquele usuário, conforme os direitos (Consultar, Incluir, Alterar, Excluir) cadastrados em **Usuários do Sistema**.
- "Instrutores" é um dos itens desse menu — não é preciso outro cadastro separado, é a mesma base de dados do `agenda-instrutores`.

## Configuração

`config.js` aponta para o **mesmo projeto Supabase** do `agenda-instrutores` — não crie um banco novo nem rode o `supabase-schema.sql` de novo aqui; ele está incluído só como referência do schema já existente.

## Publicação

Mesmo processo do projeto original: publique a pasta inteira (Netlify, Vercel, GitHub Pages, etc.) como um site estático — sem build.
