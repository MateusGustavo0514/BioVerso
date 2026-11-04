import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { aplicarSchema, bancoVazio } from './db/database.js';
import { popularBanco } from './db/seed.js';
import rotas from './routes/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3333;

aplicarSchema();
if (bancoVazio()) popularBanco();

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

app.get('/api/saude', (req, res) => res.json({ status: 'ok', horario: new Date().toISOString() }));
app.use('/api', rotas);

app.use('/api', (req, res) => res.status(404).json({ erro: `Rota ${req.method} ${req.originalUrl} não existe.` }));

// Em produção, o Express também entrega o front compilado (npm run build)
const dist = path.resolve(__dirname, '../../frontend/dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Tratamento de erros
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erro: 'Erro interno no servidor.' });
});

app.listen(PORT, () => console.log(`API do BioVerso em http://localhost:${PORT}/api`));
