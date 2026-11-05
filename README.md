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
            ├── utils/geometria.js # ruído, Fibonacci, cilindros, sementes
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
| Vírus | SARS-CoV-2, Influenza A |
| Bactérias | *Escherichia coli* (bacilo com flagelos), *Staphylococcus aureus* (cocos em cacho) |
| Órgãos | Coração (com ciclo cardíaco), pulmões (com respiração e árvore brônquica), encéfalo (com sulcos e atividade elétrica) |
| Doenças | COVID-19, gripe, pneumonia, infecção urinária, intoxicação alimentar, infarto, AVC |

Os textos são educativos e resumidos. Revisem com fontes oficiais (OMS, Ministério da Saúde) antes da entrega.

## Técnicas de computação gráfica usadas

Nenhum modelo é baixado pronto: todos são gerados por código, o que deixa as técnicas visíveis na apresentação.

| Técnica | Onde |
|---|---|
| Pipeline de renderização WebGL, câmera perspectiva, tone mapping ACES e espaço de cor sRGB | `Visualizador.js` |
| Iluminação: direcional, pontual, hemisférica e ambiente baseada em imagem (PMREM) | `Visualizador.js` |
| Materiais físicos (PBR): rugosidade, clearcoat, sheen, transparência | todos os modelos |
| Grafo de cena e transformações hierárquicas (flagelo: pivô → inclinação → giro) | `bacilo.js` |
| Geometria procedural: deformação de vértices por ruído simplex 3D | `geometria.js`, `pulmoes.js`, `cerebro.js` |
| Ruído em crista (ridged noise) para giros e sulcos | `cerebro.js` |
| Distribuição uniforme em esfera (espiral de Fibonacci) | `virus.js` |
| Instanciamento na GPU (`InstancedMesh`): espículas, fímbrias, anéis, cocos | `virus.js`, `bacilo.js`, `pulmoes.js`, `coco.js` |
| Curvas paramétricas (hélice, Catmull-Rom, super-hélice com referenciais de Frenet) e extrusão de tubos | `virus.js`, `bacilo.js`, `coracao.js`, `cerebro.js` |
| Estrutura recursiva (fractal) da árvore brônquica | `pulmoes.js` |
| Amostragem de pontos na superfície da malha | `cerebro.js` |
| Shaders GLSL próprios: efeito Fresnel e pontos animados | `fresnel.js`, `cerebro.js` |
| Modificação do shader padrão via `onBeforeCompile` (faces internas escurecidas) | `Visualizador.js` |
| Plano de corte (clipping) orientado pela câmera e fixo no modelo, permitindo girar a peça cortada | `Visualizador.js` |
| Renderização em duas passagens: o modelo é partido em duas peças sem duplicar geometria, com plano de corte invertido e transformado por matriz | `Visualizador.js` |
| Modo aramado (wireframe) | `Visualizador.js` |
| Raycasting para seleção de partes com o mouse | `Visualizador.js` |
| Animação por quadro: ciclo cardíaco, respiração, flagelos, pulsos | modelos |
| Blending aditivo e ordem de renderização para transparência | `fresnel.js`, `pulmoes.js` |

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
