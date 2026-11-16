# BioVerso

Site informativo de saúde com modelos 3D interativos de vírus, bactérias e órgãos do corpo humano. Projeto acadêmico de computação gráfica.

O visitante gira, aproxima e clica em cada parte de um modelo 3D para ler o que ela faz e ver quais doenças estão ligadas a ela. Todo o conteúdo (textos, partes clicáveis, parâmetros dos modelos e relações com doenças) vem do banco de dados.

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Front-end | Vite, JavaScript puro (ES modules), Three.js, simplex-noise |
| Back-end | Node.js 20+, Express 5 |
| Banco de dados | SQLite (better-sqlite3) |

## Como rodar

Pré-requisito: Node.js 20 ou mais recente.

```bash
npm run instalar     # instala as dependências da raiz, do backend e do frontend
npm run dev          # sobe a API (porta 3333) e o site (porta 5173) juntos
```

Abra http://localhost:5173.

Na primeira execução, o banco é criado e populado automaticamente em `backend/data/bioverso.db`. Depois de editar `backend/src/db/dados-iniciais.js`, rode `npm run seed` para recriar o conteúdo.

Para simular produção: `npm run build` e depois `npm start`. O Express passa a servir o site compilado em http://localhost:3333.

## Estrutura

```
bioverso/
├── backend/
│   ├── .env.example
│   └── src/
│       ├── server.js              # Express: API + arquivos do front compilado
│       ├── routes/index.js        # rotas da API
│       └── db/
│           ├── schema.sql         # tabelas
│           ├── database.js        # conexão SQLite
│           ├── dados-iniciais.js  # conteúdo (textos, partes, doenças)
│           └── seed.js            # popula o banco
└── frontend/
    ├── index.html
    ├── public/models/             # coloque aqui modelos .glb opcionais
    └── src/
        ├── main.js, router.js, api.js, util.js, estilo.css
        ├── pages/                 # início, espécime, doenças
        └── three/
            ├── Visualizador.js    # cena, câmera, luzes, controles, raycasting, corte
            ├── shaders/fresnel.js # shader GLSL próprio (halo)
            ├── utils/geometria.js # ruído, Fibonacci, cilindros, tubos de raio variável, árvores, sementes
            └── modelos/           # geradores procedurais de cada modelo
```

## Banco de dados

```
categorias 1──N entidades 1──N partes
                    │   1──N curiosidades
                    N
             entidade_doenca (relacao: 'causa' | 'afeta')
                    N
                 doencas
```

Uma **entidade** é qualquer coisa com modelo 3D (vírus, bactéria ou órgão). A coluna `modelo_tipo` escolhe o gerador procedural no front, e `modelo_params` guarda em JSON os parâmetros dele (número de espículas, batimentos por minuto, profundidade dos sulcos…). A tabela **partes** liga cada malha clicável do Three.js (`userData.parte`) ao seu texto explicativo.

## API

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/saude` | Verifica se a API está no ar |
| GET | `/api/categorias` | Categorias com total de itens |
| GET | `/api/entidades?categoria=virus&busca=corona` | Lista, com filtros opcionais |
| GET | `/api/entidades/:slug` | Detalhe com partes, curiosidades e doenças |
| GET | `/api/doencas` | Lista de doenças |
| GET | `/api/doencas/:slug` | Detalhe com agentes causadores e órgãos afetados |
| POST | `/api/doencas` | Cria doença (`slug`, `nome`, `resumo`, `descricao` obrigatórios) |
| PUT | `/api/doencas/:slug` | Atualiza doença |
| DELETE | `/api/doencas/:slug` | Remove doença |

## Conteúdo inicial

| Categoria | Modelos |
|---|---|
| Vírus (10) | SARS-CoV-2, Influenza A, HIV, dengue, rotavírus, HPV, hepatite B, raiva (em bala), sarampo, Ebola (filamentoso) |
| Bactérias (10) | *Escherichia coli* (bacilo com flagelos), *Staphylococcus aureus* (cocos em cacho), *Mycobacterium tuberculosis* (parede cerosa), *Vibrio cholerae* (vírgula), *Helicobacter pylori* (hélice com tufo de flagelos), *Leptospira interrogans* e *Treponema pallidum* (espiroquetas com endoflagelos), *Streptococcus pneumoniae* e *Neisseria meningitidis* (diplococos com cápsula), *Clostridium tetani* (esporo terminal) |
| Órgãos (10) | Coração (com ciclo cardíaco), pulmões (com respiração e árvore brônquica), estômago (peristaltismo e mucosa), intestino delgado (vilosidades), fígado (lóbulos e vias biliares), rim (corte anatômico), encéfalo (sulcos, lobos e sinapses), olho (refração e pupila), pele (camadas e glândulas), fêmur (osso esponjoso e canal medular) |
| Doenças (26) | COVID-19, gripe, pneumonia, infecção urinária, intoxicação alimentar, infarto, HIV e aids, dengue, diarreia por rotavírus, infecção pelo HPV, hepatite B, raiva, sarampo, Ebola, tuberculose, cólera, gastrite e úlcera péptica, tétano, meningite bacteriana, leptospirose, sífilis, doença renal crônica, AVC, catarata, câncer de pele, osteoporose |

Os textos são educativos e resumidos. Revisem com fontes oficiais (OMS, Ministério da Saúde) antes da entrega.

## Técnicas de computação gráfica usadas

Nenhum modelo é baixado pronto: todos são gerados por código, o que deixa as técnicas visíveis na apresentação.

| Técnica | Onde |
|---|---|
| Pipeline de renderização WebGL, câmera perspectiva, tone mapping ACES e espaço de cor sRGB | `Visualizador.js` |
| Iluminação: direcional, pontual, hemisférica e ambiente baseada em imagem (PMREM) | `Visualizador.js` |
| Materiais físicos (PBR): rugosidade, clearcoat, sheen, transparência | todos os modelos |
| Grafo de cena e transformações hierárquicas (flagelo: pivô → inclinação → giro) | `bacilo.js`, `espiral.js` |
| Geometria procedural: deformação de vértices por ruído simplex 3D | `geometria.js`, `pulmoes.js`, `cerebro.js` |
| Ruído em crista (ridged noise) para giros e sulcos; cor por vértice suavizada pela média dos vizinhos da malha (divisas dos lobos) e fendas escurecidas (oclusão ambiente falsa) | `cerebro.js` |
| Distribuição uniforme em esfera (espiral de Fibonacci) | `virus.js` |
| Instanciamento na GPU (`InstancedMesh`): espículas, fímbrias, anéis, cocos, ribossomos, toxinas, vilosidades, lóbulos hepáticos, pirâmides e glomérulos do rim, hemácias, adipócitos, trabéculas | `virus.js`, `bacilo.js`, `espiral.js`, `pulmoes.js`, `coco.js`, `intestino.js`, `figado.js`, `rim.js`, `pele.js`, `osso.js` |
| Curvas paramétricas (hélice, Catmull-Rom, super-hélice com referenciais de Frenet) e extrusão de tubos | `virus.js`, `bacilo.js`, `coracao.js`, `cerebro.js` |
| Estrutura recursiva (fractal) da árvore brônquica, a partir dos brônquios lobares; vasos e alvéolos derivados dos mesmos ramos | `pulmoes.js` |
| Malha dividida por um plano (septo), cavidades com malha virada do avesso e valvas em dobradiça animadas pelo ciclo cardíaco | `coracao.js` |
| Tubo de raio variável com posições recalculadas a cada quadro (peristaltismo por onda de constrição), de duas paredes: a de dentro virada do avesso, com rugas ou pregas; fatiado em trechos clicáveis que dividem os mesmos vértices | `geometria.js`, `estomago.js`, `intestino.js`, `rim.js`, `osso.js` |
| Árvores ramificadas recursivas de vasos e ductos, com vasos vizinhos deslocados por Gram-Schmidt (tríade portal, veias hepáticas, vasos renais) | `geometria.js`, `figado.js`, `rim.js` |
| Remodelagem de vértices em forma anatômica e aproximação de espalhamento subsuperficial: cor por vértice mais clara e quente onde o órgão é fino | `figado.js`, `rim.js` |
| Pontos com shader próprio que piscam e aceitam o plano de corte (trechos de clipping do Three.js no GLSL, `userData.recortavel`); artérias que acompanham a superfície por raycasting | `cerebro.js`, `Visualizador.js` |
| Material físico com transmissão e índice de refração (córnea), íris refeita a cada quadro (pupila), fibras por ruído em coordenadas polares e vasos por caminhada sorteada sobre a esfera | `olho.js` |
| Camadas translúcidas com relevo por ruído em crista, hemácias que percorrem curvas e receptores em camadas concêntricas | `pele.js` |
| Osso esponjoso por hastes instanciadas orientadas pelas linhas de força, e canal medular com revestimento virado do avesso | `osso.js` |
| Amostragem de pontos na superfície da malha (`MeshSurfaceSampler`): espículas da raiva, hexâmeros do capsídeo do HIV | `bala.js`, `genomas.js` |
| Capsídeo icosaédrico: `IcosahedronGeometry` facetado, capsômeros nos vértices únicos (pentons e hexons por cor de instância) e camadas concêntricas aninhadas | `genomas.js`, `virus.js` |
| Superfície de revolução (`LatheGeometry`): capsídeo cônico do HIV, partícula em bala da raiva e bacilo com esporo terminal (união suave de dois perfis por máximo suave) | `genomas.js`, `bala.js`, `bacilo.js` |
| Referenciais de Frenet ao longo de curvas: super-hélices dos genomas, espículas do vírus filamentoso e corpo das bactérias espiraladas (tubo enrolado num eixo, com ganchos na Leptospira; endoflagelos, nucleoide e ribossomos posicionados na seção transversal) | `genomas.js`, `filamento.js`, `espiral.js` |
| Remodelagem de vértices por uma função de molde (célula em lança ou em grão de café), aplicada à malha e aos pontos do interior, e geometrias de várias células unidas por `mergeGeometries` | `diplococo.js` |
| Shaders GLSL próprios: efeito Fresnel (halo esférico ou com a forma do corpo, pela malha inflada ao longo das normais) | `fresnel.js` |
| Modificação do shader padrão via `onBeforeCompile` (faces internas escurecidas) | `Visualizador.js` |
| Plano de corte (clipping) orientado pela câmera e fixo no modelo, permitindo girar a peça cortada | `Visualizador.js` |
| Renderização em duas passagens: o modelo é partido em duas peças sem duplicar geometria, com plano de corte invertido e transformado por matriz | `Visualizador.js` |
| Renderização fora da tela para gerar imagens: um único contexto WebGL fotografa cada modelo, recortado pelo canal alfa, para os cartões da página inicial | `miniaturas.js` |
| Modo aramado (wireframe) | `Visualizador.js` |
| Raycasting para seleção de partes com o mouse | `Visualizador.js` |
| Animação por quadro: ciclo cardíaco, respiração, flagelos, pulsos | modelos |
| Blending aditivo e ordem de renderização para transparência | `fresnel.js`, `pulmoes.js`, `diplococo.js`, `cerebro.js`, `olho.js`, `pele.js` |

## Como adicionar um modelo

1. Crie `frontend/src/three/modelos/meu-modelo.js` exportando uma função `(params, cores) => ({ objeto, atualizar })`.
2. Marque as malhas clicáveis com `marcarParte(malha, 'chave')`.
3. Registre a função em `modelos/index.js`.
4. Cadastre a entidade em `dados-iniciais.js` com `modelo_tipo` igual ao nome registrado e as `partes` com as mesmas chaves.
5. Rode `npm run seed`.

Para usar um arquivo pronto (Blender, Sketchfab), salve o `.glb` em `frontend/public/models/` e preencha `modelo_url` com `/models/arquivo.glb`. O nome de cada malha no arquivo vira a chave da parte. Confira a licença do modelo antes de usar.

## Próximos passos sugeridos

- Página de busca usando `GET /api/entidades?busca=`
- Painel administrativo com login para cadastrar conteúdo
- Pós-processamento (bloom, SSAO) com `EffectComposer`
- Novos órgãos: rim, fígado, estômago
- Quiz com pontuação salva no banco

---

Conteúdo educativo. Não substitui orientação de profissionais de saúde. Em emergências, ligue 192.
