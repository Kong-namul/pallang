// Vercel 배포용 빌드: 정적 파일을 dist/ 로 복사하고,
// index.html 에는 <!doctype html> 을 앞에 붙임 (claude.ai 갤러리는 이 틀을 자동으로 붙여 줘서 원본엔 없음)
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
for (const p of ['assets', 'examples']) cpSync(p, `dist/${p}`, { recursive: true });
cpSync('gallery-data.js', 'dist/gallery-data.js');
const page = readFileSync('index.html', 'utf8');
writeFileSync('dist/index.html', `<!doctype html>\n<html lang="ko">\n${page}\n</html>\n`);
console.log('dist/ 준비 완료');
