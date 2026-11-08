import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import fs from 'node:fs/promises';

const root = fileURLToPath(new URL('.', import.meta.url));

// 开发期专用：标定工具点"保存"时，把 JSON 直接写进 src/data/calibration/
function calibrationSaver() {
  return {
    name: 'calibration-saver',
    configureServer(server) {
      server.middlewares.use('/__calibration', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json');
          try {
            const payload = JSON.parse(body);
            const kind = payload.kind === 'implant' ? 'implant' : 'patient';
            const id = String(payload.id || '').replace(/[^a-z0-9_-]/gi, '');
            if (!id) throw new Error('缺少 id');
            const dir = resolve(root, 'src/data/calibration');
            await fs.mkdir(dir, { recursive: true });
            const file = resolve(dir, `${kind}_${id}.json`);
            await fs.writeFile(file, JSON.stringify(payload.data, null, 2) + '\n');
            res.end(JSON.stringify({ ok: true, file: `src/data/calibration/${kind}_${id}.json` }));
          } catch (err) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: err.message }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  // 相对路径：打包结果放在任意子路径（如 GitHub Pages 的 /仓库名/）都能跑
  base: './',
  plugins: [calibrationSaver()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        calibrate: resolve(root, 'calibrate.html'),
      },
    },
  },
});
