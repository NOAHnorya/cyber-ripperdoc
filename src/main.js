import './ui/ui.css';
import { Game } from './game/Game.js';

const game = new Game(document.getElementById('app'));
game
  .init()
  .then(() => game.start())
  .catch((err) => {
    console.error(err);
    const box = document.createElement('pre');
    box.style.cssText = 'position:fixed;inset:20px;color:#ff2a6d;background:#0a0a12;padding:20px;white-space:pre-wrap;z-index:99';
    box.textContent = `启动失败：\n${err?.stack ?? err}`;
    document.body.append(box);
  });
