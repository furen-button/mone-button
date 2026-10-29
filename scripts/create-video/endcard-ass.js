import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from './config.js';

// 完成動画の指定に関係なく、エンドカードのアニメーション用の土台を取得する。
export function readEndcardAss(configPath, outDir) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (config.endcaps?.ending) {
    delete config.endcaps.ending.video;
  }
  const tempDir = fs.mkdtempSync(path.join(outDir, '.endcard-config-'));
  try {
    const tempPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(tempPath, JSON.stringify(config));
    // 素材の相対パスは config.js でプロジェクトルート基準に解決されるため、移動しても変わらない。
    return execFileSync(process.execPath, [
      path.join(projectRoot, 'scripts/create-video/preview.js'),
      '--config', tempPath, '--still', 'ending', '--print-ass',
    ], { cwd: projectRoot, encoding: 'utf8' });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
