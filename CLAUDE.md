# Contexto do projeto BioVerso para o Claude Code

Este documento é o briefing que você (Claude Code) deve ler antes de qualquer tarefa neste repositório. Ele resume o que o projeto é, como está organizado, as convenções usadas e o que já está pronto. Leia inteiro antes de propor mudanças.

---

## 1. O que é o BioVerso

Site informativo de saúde com modelos 3D interativos de vírus, bactérias e órgãos do corpo humano. É um **projeto acadêmico de computação gráfica** feito em dupla/grupo de faculdade. O avaliador vai olhar duas coisas:

1. Se o site funciona como site informativo (textos corretos, navegação, acessibilidade).
2. Se as **técnicas de computação gráfica estão visíveis e justificadas** — não é para baixar modelos prontos do Sketchfab; os modelos devem ser gerados por código, com técnicas claramente identificáveis.

O conteúdo é em **português do Brasil** (textos, nomes de variáveis, slugs no banco, mensagens de erro). Mantenha esse padrão.

### Pilha

| Camada | Tecnologia |
|---|---|
| Front-end | Vite + JavaScript puro (ES modules) + Three.js (~0.186) + simplex-noise |
| Back-end | Node.js 20+ + Express 5 |
| Banco de dados | SQLite via `better-sqlite3` (síncrono, zero config) |

Nada de React, nada de TypeScript, nada de ORM. É proposital: o código é lido por professores e colegas que podem não conhecer essas ferramentas.

---

## 2. Estrutura de pastas

```
bioverso/
├── package.json                   # scripts raiz: instalar, dev, seed, build, start
├── README.md
├── .gitignore
├── backend/
│   ├── .env.example               # PORT, CORS_ORIGIN, DB_PATH
│   ├── package.json               # type: module
│   └── src/
│       ├── server.js              # Express: API + serve o front compilado em produção
│       ├── routes/index.js        # todas as rotas da API
│       └── db/
│           ├── schema.sql         # DDL (CREATE TABLE ...)
│           ├── database.js        # abre a conexão SQLite, aplica schema
│           ├── dados-iniciais.js  # TODO o conteúdo (textos, partes, doenças)
│           └── seed.js            # popula o banco a partir de dados-iniciais.js
└── frontend/
    ├── index.html                 # shell com header, main vazio e footer
    ├── vite.config.js             # proxy /api -> localhost:3333
    ├── package.json
    ├── public/models/             # .glb opcionais, servidos como /models/*.glb
    └── src/
        ├── main.js                # ponto de entrada; chama o router
        ├── router.js              # hash router minúsculo (sem lib)
        ├── api.js                 # cliente fetch da API
        ├── util.js                # esc(), mensagemErro(), mancha()
        ├── estilo.css             # único arquivo de CSS (tudo global)
        ├── pages/
        │   ├── inicio.js          # home com destaque 3D + grades por categoria
        │   ├── especime.js        # página de um vírus/bactéria/órgão
        │   └── doencas.js         # lista e detalhe de doenças
        └── three/
            ├── Visualizador.js    # classe que encapsula cena, câmera, luzes, controles, raycasting, corte, aramado, pausa
            ├── shaders/fresnel.js # ShaderMaterial GLSL próprio (halo das membranas)
            ├── utils/geometria.js # criarAleatorio (mulberry32), deformarComRuido, pontosFibonacci, cilindroEntre, marcarParte
            └── modelos/
                ├── index.js       # registro { virus, bacilo, coco, coracao, pulmoes, cerebro }
                ├── virus.js
                ├── bacilo.js
                ├── coco.js
                ├── coracao.js
                ├── pulmoes.js
                └── cerebro.js
```

Arquivos que **não devem** ser criados sem motivo forte: `tsconfig.json`, `.prettierrc`, `.eslintrc`, pastas `src/components`, `src/hooks`, `src/types`. A simplicidade é feature.

---

## 3. Como rodar

Pré-requisito: Node.js 20 ou mais recente.

```bash
npm run instalar     # instala raiz + backend + frontend
npm run dev          # sobe API (3333) e site (5173) em paralelo (concurrently)
npm run seed         # recria o banco a partir de dados-iniciais.js
npm run build        # compila o front
npm start            # produção: Express serve API + front compilado em 3333
```

O banco é criado automaticamente em `backend/data/bioverso.db` na primeira execução. Está no `.gitignore`.

Em dev: o front chama `/api/*` e o Vite faz proxy para `localhost:3333`. Em produção: o Express serve `frontend/dist/` e a API no mesmo processo.

---

## 4. Banco de dados

### Modelo

```
categorias (slug, nome, descricao, ordem)
    │ 1
    │
    │ N
entidades (slug, nome, nome_cientifico, categoria_id, resumo, descricao,
           tamanho, modelo_tipo, modelo_params JSON, modelo_url,
           cor_primaria, cor_secundaria)
    │ 1              │ 1
    │                │
    │ N              │ N
partes          curiosidades
(chave, nome,   (texto)
 descricao)
    N
    │
entidade_doenca (entidade_id, doenca_id, relacao CHECK IN ('causa','afeta'))
    │
    N
doencas (slug, nome, resumo, descricao, transmissao, sintomas, prevencao)
```

### Conceitos importantes

- **entidade** = qualquer coisa com modelo 3D (um vírus, uma bactéria ou um órgão). Categoria decide onde ela aparece.
- **modelo_tipo** = string que escolhe o gerador procedural no front (`virus`, `bacilo`, `coco`, `coracao`, `pulmoes`, `cerebro`). Precisa bater com uma chave de `frontend/src/three/modelos/index.js`.
- **modelo_params** = JSON serializado com parâmetros específicos daquele gerador (número de espículas, batimentos por minuto, profundidade dos sulcos…). Fica como TEXT no banco e é parseado em `routes/index.js` por `lerParams()`.
- **modelo_url** = opcional. Se preenchido, o Visualizador carrega um `.glb` de `/models/<arquivo>.glb` em vez de usar o gerador procedural. O nome de cada mesh do .glb vira a chave da parte clicável.
- **partes.chave** = string que precisa bater com `userData.parte` da mesh correspondente no Three.js. É assim que o raycasting liga uma mesh ao seu texto.
- **cor_primaria / cor_secundaria** = usadas tanto pelo gerador 3D quanto pela "mancha" colorida no cartão de lâmina da home.

### Convenções de dados

- Slugs em kebab-case ASCII: `sars-cov-2`, `escherichia-coli`, `infeccao-urinaria`.
- Nomes científicos em itálico (feito via CSS). No banco, só o texto.
- Textos educativos, revisados por fontes oficiais (OMS, Ministério da Saúde). Nunca invente estatística médica. Em caso de dúvida, prefira texto genérico correto ("os pulmões têm centenas de milhões de alvéolos") a número específico duvidoso.
- Sintomas de emergência (infarto, AVC) sempre terminam com instrução para ligar 192.
- `transmissao` para doenças não transmissíveis: literal "Não transmissível."

---

## 5. API

Todas as rotas vivem em `backend/src/routes/index.js` e são prefixadas por `/api`.

| Método | Rota | Resposta |
|---|---|---|
| GET | `/api/saude` | `{ status: 'ok', horario: ISO }` |
| GET | `/api/categorias` | Lista com `total` de entidades por categoria |
| GET | `/api/entidades?categoria=&busca=` | Lista filtrada; `modelo_params` já desserializado |
| GET | `/api/entidades/:slug` | Detalhe com `partes`, `curiosidades`, `doencas` |
| GET | `/api/doencas` | Lista resumida |
| GET | `/api/doencas/:slug` | Detalhe com `relacionadas` (entidades) |
| POST | `/api/doencas` | Cria. Requer `slug`, `nome`, `resumo`, `descricao`. Slug kebab-case |
| PUT | `/api/doencas/:slug` | Atualiza (slug é imutável) |
| DELETE | `/api/doencas/:slug` | Remove |

**Padrões obrigatórios de resposta:**
- Erro de validação: `400` com `{ erro: "mensagem em português" }`.
- Não encontrado: `404` com `{ erro: "..." }`.
- Conflito de slug único: `409` com `{ erro: "Já existe ..." }`.
- Sucesso de criação: `201` com o recurso criado.
- Sucesso de delete: `204` sem corpo.
- Erro interno: tratado pelo middleware final; nunca vaze `err.message` para o cliente.

Mantenha os CRUDs novos no mesmo estilo (função `validarXxx`, lista `CAMPOS_XXX`, uso de `db.transaction` quando houver inserts em cascata).

---

## 6. Front-end

### Roteamento

Hash router caseiro em `router.js`. Rotas:

| Padrão | Página |
|---|---|
| `#/` | Home |
| `#/especime/:slug` | Espécime (vírus, bactéria ou órgão) |
| `#/doencas` | Lista de doenças |
| `#/doenca/:slug` | Detalhe de uma doença |

Formato especial: `#/caminho#ancora` rola suavemente até o `id` depois de montar a página. Isso é usado pelo menu do topo (`#/#virus`, `#/#bacteria`, `#/#orgao`).

Cada página exporta uma função `async (raiz, ...params) => limparOpcional`. Se retornar uma função, ela é chamada ao sair da página (usado para `visualizador.destruir()`).

### Páginas

- **inicio.js**: hero com o coronavírus girando sozinho + três coleções (`<ul class="laminas">`) com cartões no formato 3:1 de lâmina de microscópio.
- **especime.js**: grid com o Visualizador à esquerda (sticky), e à direita texto + lista de partes clicáveis + doenças relacionadas (seções "Causa" e "Pode ser afetado por") + curiosidades. Barra de ferramentas sobre o campo: **Pausar**, **Aramado**, **Corte** (range 0–1). O corte em duas peças fica no menu do botão direito sobre o modelo (`Cortar em duas peças` / `Juntar peças`); o botão **Separar peças** continua na barra só para teclado e toque (`.ferramenta--reserva`).
- **doencas.js**: lista simples; detalhe com transmissão/sintomas/prevenção e as entidades relacionadas agrupadas por relação.

### Estilo

Identidade visual: lâminas de histologia (coloração H&E, roxo + rosa) e o campo circular do microscópio. Está em `estilo.css` (único arquivo). Variáveis CSS em `:root` (`--vidro`, `--lamina`, `--tinta`, `--hematoxilina`, `--eosina`, `--palco`…). Tipografia: Bricolage Grotesque (títulos) + Source Serif 4 (texto).

Regras importantes:
- Toda inserção de texto vindo da API usa `esc()` de `util.js`. Sem exceção — é como evitamos XSS sem framework.
- O campo 3D tem máscara circular (`.campo::after`) que simula o campo visual do microscópio. Não quebre essa estética.
- `@media (prefers-reduced-motion: reduce)` desliga animações; o Visualizador respeita.
- Breakpoint único em 860px: a grade de duas colunas vira uma coluna só.

---

## 7. Visualizador 3D

Classe `Visualizador` em `frontend/src/three/Visualizador.js`. Encapsula tudo: cena, câmera perspectiva (fov 35), renderer com tone mapping ACES e sRGB, iluminação (direcional + pontual colorida + hemisférica + IBL via `PMREMGenerator` com `RoomEnvironment`), `OrbitControls` com damping, raycasting por `pointermove`/`pointerup`, redimensionamento via `ResizeObserver`, loop com `setAnimationLoop`.

### API pública

```js
const vis = new Visualizador(elementoDiv, {
  interativo: true,       // habilita clique, zoom, pan
  girarSozinho: true,     // autoRotate até o usuário interagir
  aoPassar(chave, x, y),  // callback de hover (para tooltip)
  aoSelecionar(chave),    // callback de clique
  aoMenu(x, y),           // callback do botão direito sobre o modelo (abre o menu de corte)
});

await vis.carregar(entidade);   // monta o modelo e enquadra a câmera
vis.selecionar(chave|null);     // destaque programático (usado pelos botões de parte)
vis.pausar(true|false);         // liga/desliga animação + autoRotate
vis.definirAramado(true|false); // wireframe nos materiais standard
vis.definirCorte(0..1);         // plano de clipping fixo no modelo, orientado pela câmera ao sair do 0 (0 = sem corte)
vis.separar(true|false);        // true: parte em duas peças no plano de corte (sem corte, corta perto do meio); false: junta e zera o corte
vis.destruir();                 // dispose completo; chame ao sair da página
```

### Decisões de design que não devem ser quebradas

- Materiais devem ser `MeshStandardMaterial` ou `MeshPhysicalMaterial` para funcionar com corte/aramado/destaque emissivo. ShaderMaterials (como o halo) ficam fora dessas transformações, por design.
- O **corte** usa `renderer.localClippingEnabled = true` e um `THREE.Plane` cuja normal aponta para a câmera no momento em que a barra sai do 0 e depois fica fixa, para o usuário girar em volta do modelo cortado. Voltar a barra para 0 libera a orientação. As faces de trás ficam mais escuras por um trecho de GLSL injetado via `onBeforeCompile` em `#prepararMateriais()`.
- **Peças separadas**: não há geometria duplicada. Em `#desenhar()`, a cena é renderizada duas vezes por quadro (`autoClear = false`), cada uma com a matriz da peça no pivô e o plano invertido e transformado em `planoDesenho`, o plano que os materiais usam. `planoCorte` guarda o corte original. O raycasting testa as duas poses. O halo fica oculto enquanto as peças estão abertas. O `pointerdown` usa fase de captura para decidir antes do `OrbitControls` se o arraste é da peça ou da câmera.
- **Raycasting**: cada mesh clicável é marcada com `marcarParte(mesh, 'chave')`, que seta `userData.parte`. O método `#parteSobPonteiro` sobe pelo pai até achar essa marca, e prefere mesh opaca a transparente (importante para os brônquios dentro do pulmão translúcido).
- **Halo** usa shader próprio e `raycast = () => {}` (não captura clique) + `renderOrder = 10`.
- **Enquadramento**: `#enquadrar()` calcula a esfera envolvente, centraliza o modelo e ajusta `camera.position`, `near`, `far`, `minDistance`, `maxDistance`. Guarda `this.semieixos` para o corte (o alcance da barra é a profundidade do modelo na direção da câmera).
- **Animação de entrada**: scale de 0.6→1.0 com easing `easeOutCubic`.

### Clipping: o que o projeto cobre (e o que não)

O corte é uma aplicação do conceito de **clipping** de computação gráfica. Ao documentar ou apresentar, use os termos abaixo e não prometa mais do que o código faz.

**O que está implementado**

| Conceito de CG | Onde aparece |
|---|---|
| Plano de clipping definido pelo usuário (equação do plano, teste de semiespaço) | `planoCorte` (`THREE.Plane`): orientado pela câmera ao sair do 0, fixo no modelo, posição pela barra |
| Clipping do frustum de visão | `camera.near` e `camera.far`, calculados em `#enquadrar()`, para o modelo não ser recortado pelo volume de visão |
| Mesmo teste de semiespaço no picking | `#acertoSobPonteiro` descarta acertos com `planoDesenho.distanceToPoint(...) < 0` (na CPU) |
| Planos complementares | Separar peças: duas passagens, com o plano e o seu inverso; cada passagem mostra um semiespaço |
| Transformação do plano por matriz | `planoDesenho.applyMatrix4(this.pivo.matrix)`: cada peça leva o seu plano junto |

**Limites** (verificados em `node_modules/three/src/renderers/shaders/ShaderChunk/clipping_planes_fragment.glsl.js`, Three.js 0.186)

- O recorte é **por fragmento**: o Three.js executa `if (dot(vClipPosition, plane.xyz) > plane.w) discard;` no fragment shader. Não é clipping geométrico, que divide os triângulos que cruzam a fronteira (como o Sutherland–Hodgman do clipping do frustum), e não cria vértices novos. A extensão `WEBGL_clip_cull_distance` só entra se o material optar por ela (`material.extensions.clipCullDistance`), o que não fazemos.
- O algoritmo de recorte é do Three.js. O projeto configura, orienta e posiciona o plano e cuida de toda a interação. **Não afirmar que implementamos o algoritmo de clipping.**
- Não há tampa: a superfície cortada é oca e as paredes ficam sem espessura.
- Escurecer as faces internas (`gl_FrontFacing` em `onBeforeCompile`) é sombreamento, não clipping, mas é o que torna o corte legível.

**Como descrever:** "plano de clipping definido pelo usuário, orientado pela câmera e fixo no modelo, implementado por descarte de fragmentos (Three.js); a separação em duas peças usa duas passagens de renderização com planos complementares".

**Para tornar o clipping mais autoral** (em ordem de esforço):

1. Escrever o descarte em GLSL próprio, via `onBeforeCompile`, com um `uniform` do plano. Já injetamos código ali, então a mudança é pequena.
2. Tampa do corte com **stencil buffer** (clipping + capping): resolve as paredes ocas e acrescenta uma técnica clássica.
3. Recorte geométrico na CPU (Sutherland–Hodgman nos triângulos): é o mais fiel ao conceito, mas grande e difícil com `InstancedMesh`.

---

## 8. Geradores procedurais

Cada arquivo em `frontend/src/three/modelos/` exporta uma função:

```js
export function criarXxx(params, cores) {
  // params = modelo_params do banco (já parseado)
  // cores  = { primaria, secundaria } (hex)
  return {
    objeto,     // THREE.Object3D para adicionar na cena
    atualizar,  // (t, dt) => void chamado a cada quadro quando não pausado
    foco,       // opcional: parte que define a profundidade do corte (ex.: corpo do bacilo, sem os flagelos)
  };
}
```

Depois registre em `modelos/index.js` com o mesmo nome usado em `modelo_tipo` no banco.

### Técnicas por arquivo (para citar na apresentação)

| Arquivo | Técnicas |
|---|---|
| `utils/geometria.js` | PRNG com semente (mulberry32), ruído simplex 3D, `mergeVertices`, espiral de Fibonacci na esfera, cilindro orientado entre dois pontos, novelo de curva Catmull-Rom (aberto ou fechado), esferas instanciadas, marcação de parte |
| `shaders/fresnel.js` | ShaderMaterial GLSL próprio (efeito Fresnel), blending aditivo, uniforms animados |
| `virus.js` | Esfera deformada por ruído, InstancedMesh para espículas, distribuição Fibonacci + jitter aleatório, quaternion para orientar instâncias, "respiração" animada, genoma opcional por `nucleo.tipo`: novelo Catmull-Rom + super-hélice com referenciais de Frenet + contas instanciadas (coronavírus); bastões em grampo de dupla hélice no arranjo 7 + 1 (influenza) |
| `bacilo.js` | CapsuleGeometry, curva paramétrica própria (Hélice) + TubeGeometry para flagelos, hierarquia pivô/inclinação/giro, InstancedMesh para fímbrias com normais da superfície, interior visível no corte: membrana interna, DNA circular em curva fechada, plasmídeos e ribossomos por amostragem com rejeição |
| `coco.js` | Empacotamento esférico aleatório sem sobreposição, InstancedMesh com cores por instância (`setColorAt`), oscilação individual, interior instanciado por célula (membrana, nucleoide reaproveitado em orientações sorteadas, ribossomos) |
| `coracao.js` | Deformação de esferas, CatmullRomCurve3 + TubeGeometry para vasos, pulso gaussiano para ciclo cardíaco (átrios contraem antes dos ventrículos) |
| `pulmoes.js` | Remodelagem vértice-a-vértice para forma anatômica (incisura cardíaca, base no diafragma), árvore brônquica recursiva (fractal), TorusGeometry parcial para anéis de cartilagem, material semitransparente com `DoubleSide` |
| `cerebro.js` | Ruído em crista (`(1-|noise|)^7`) para sulcos estreitos, lâminas horizontais no cerebelo, `MeshSurfaceSampler` para distribuir pontos na superfície, Points com shader próprio para "sinapses" piscando |

### Como adicionar um modelo novo (receita)

1. `frontend/src/three/modelos/meu-modelo.js` — exportar `criarMeuModelo(params, cores)`.
2. Marcar cada mesh clicável com `marcarParte(mesh, 'chave_curta')`.
3. Registrar em `frontend/src/three/modelos/index.js`.
4. Em `backend/src/db/dados-iniciais.js`, acrescentar a entidade com `modelo_tipo: 'meu-modelo'`, `modelo_params`, e `partes` com as mesmas chaves.
5. `npm run seed`.
6. Visitar `#/especime/<slug>` e testar hover, clique, corte, aramado.

---

## 9. Convenções de código

- **Idioma**: nomes de variáveis, funções, comentários e commits em português. Classes do Three.js em inglês (API da biblioteca).
- **Estilo**: 2 espaços, ponto-e-vírgula, aspas simples, template strings para HTML.
- **Imports**: sem alias; caminhos relativos (`../util.js`). Three.js por `three/addons/...` para o conteúdo de `examples/jsm`.
- **Sem build no backend**: Node importa `.js` como ES modules direto (`"type": "module"`). Nada de Babel.
- **Sem framework de teste** por enquanto. Validação é manual via `curl` + navegador.
- **HTML por template string + esc()**: nada de bibliotecas de templating. Nunca interpole dado da API sem `esc()`.
- **Mensagens de erro visíveis para o usuário**: português, sem jargão. Exemplo: "Não foi possível falar com a API. Verifique se o backend está rodando na porta 3333."
- **Acessibilidade**: `aria-label`, `aria-pressed`, `aria-live`, skip link, foco visível, respeito a `prefers-reduced-motion`. Mantenha ao adicionar UI nova.

---

## 10. O que já está pronto

### Entidades (7)
- **Vírus**: SARS-CoV-2, Influenza A
- **Bactérias**: *Escherichia coli*, *Staphylococcus aureus*
- **Órgãos**: Coração, Pulmões, Encéfalo

### Doenças (7)
COVID-19, Gripe, Pneumonia, Infecção urinária, Intoxicação alimentar, Infarto agudo do miocárdio, AVC

### Features de CG implementadas
Iluminação PBR + IBL, raycasting com hover/clique, geometria procedural com ruído, ruído em crista, InstancedMesh, árvore fractal, curvas paramétricas, TubeGeometry, MeshSurfaceSampler, shaders GLSL próprios (Fresnel + Points), modificação de shader padrão via onBeforeCompile, plano de corte orientado pela câmera e fixo no modelo, separação em duas peças por renderização em duas passagens, modo aramado, pausa, animações por quadro (ciclo cardíaco, respiração, flagelos, sinapses).

### CRUD
Apenas `doencas` tem CRUD completo. `entidades`, `partes`, `categorias` são read-only pela API (editadas via `dados-iniciais.js` + `npm run seed`).

---

## 11. Próximos passos sugeridos (ideias para o grupo)

Em ordem crescente de esforço:

1. **Página de busca** usando `GET /api/entidades?busca=` (filtro já existe no backend).
2. **Mais órgãos**: rim, fígado, estômago, olho. Cada um é uma oportunidade de técnica nova (rim = cortes anatômicos; olho = refração; fígado = subsurface scattering).
3. **Mais agentes**: *Mycobacterium tuberculosis* (bacilo), rotavírus (icosaedro geométrico sem envelope), fungo *Candida* (hifas por L-system).
4. **Modo comparação**: dois modelos lado a lado com câmera sincronizada.
5. **Pós-processamento** com `EffectComposer`: bloom nos halos, SSAO nas dobras do cérebro, outline na parte selecionada.
6. **Painel admin** com login simples (JWT ou sessão) para cadastrar entidades e doenças pela UI.
7. **Quiz** com pontuação persistida (nova tabela, novo CRUD).
8. **Carregar .glb reais** opcionalmente, mantendo os procedurais como padrão — já há caminho para isso (`modelo_url`), falta UI de preferência e tratamento de licença.
9. **Testes**: smoke tests com Playwright nas três rotas principais, bateria de `curl` para a API.
10. **Deploy**: Dockerfile multi-stage + instruções de deploy em uma VPS simples.

---

## 12. Comportamentos esperados do Claude Code neste repo

- Antes de mexer num gerador 3D, **leia o arquivo inteiro** — eles são pequenos (<200 linhas) e as decisões se referenciam entre si.
- Ao adicionar uma técnica nova de CG, **atualize a tabela do README** ("Técnicas de computação gráfica usadas") no mesmo PR.
- Ao mudar o schema do banco, **atualize `dados-iniciais.js` e rode `npm run seed`** para verificar que o seed ainda roda sem erro, e teste pelo menos uma rota afetada com `curl`.
- Ao adicionar um gerador novo, **teste no navegador** carregando `#/especime/<slug>` — hover, clique numa parte, Pausar, Aramado, Corte=0.5.
- **Não introduza dependências pesadas** (React, Tailwind, ORM, Zod, tRPC…) sem discutir. A simplicidade da pilha é critério avaliado.
- **Não baixe modelos 3D de terceiros** sem checar licença e sem citar no README. A nota do trabalho depende de a maior parte do conteúdo 3D ser procedural.
- Textos de saúde: na dúvida, **prefira um texto genérico correto** a um número específico duvidoso. Para qualquer afirmação clínica, sinalize no PR que precisa de revisão com fonte oficial.
- Mantenha o **português do Brasil** em tudo que o usuário final e o avaliador vão ler, inclusive mensagens de erro da API.

---

## 13. Comandos úteis de verificação rápida

```bash
# Subir só a API e checar saúde + uma entidade
cd backend && npm run dev &
curl -s localhost:3333/api/saude
curl -s localhost:3333/api/entidades/sars-cov-2 | head -c 300

# Testar CRUD de doenças
curl -s -X POST localhost:3333/api/doencas \
  -H 'Content-Type: application/json' \
  -d '{"slug":"teste","nome":"T","resumo":"r","descricao":"d"}'
curl -s -X DELETE localhost:3333/api/doencas/teste -o /dev/null -w "%{http_code}\n"

# Recriar o banco do zero
rm -rf backend/data && npm run seed

# Build do front e inspeção do bundle
cd frontend && npm run build && ls -lh dist/assets/
```

---

## 14. O que esta mensagem é e o que não é

**É**: um briefing de projeto. Leia inteiro ao abrir um Claude Code novo nesta pasta. Use como fonte da verdade sobre convenções, intenções e o que está feito.

**Não é**: histórico de conversa, lista de prompts anteriores, instruções do usuário atual. Se o usuário pedir algo que conflite com este documento (ex.: "use Tailwind"), confirme antes de executar, e proponha atualizar este arquivo se a decisão mudar.
