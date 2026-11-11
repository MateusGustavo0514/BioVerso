import './estilo.css';
import { iniciarRotas } from './router.js';
import { iniciarTema } from './tema.js';

iniciarTema(document.querySelector('[data-botao-tema]')); // o <html> também tem data-tema
iniciarRotas(document.getElementById('conteudo'));
