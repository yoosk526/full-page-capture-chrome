// E2E용 테스트 페이지를 내보내는 작은 서버
import { createServer } from 'node:http';

export const PAGES = {
  '/long.html': `<!doctype html><html><head><title>긴 테스트 페이지</title><style>
    body{margin:0;font:16px sans-serif}
    header{position:sticky;top:0;height:60px;background:#111111;color:#fff;display:flex;align-items:center;padding:0 16px;z-index:10}
    .band{height:500px;display:flex;align-items:center;justify-content:center;font-size:48px;color:#fff}
    a{color:#fff}
  </style></head><body>
  <header>고정 머리글 <a href="https://example.com/link">링크</a></header>
  ${Array.from({ length: 7 }, (_, i) => `<div class="band" style="background:hsl(${i * 50},60%,45%)">구역 ${i + 1}</div>`).join('')}
  </body></html>`,
  // 부드러운 스크롤을 쓰는 페이지 (요즘 사이트에 흔함): 영역 고르기 자동 스크롤 확인용
  '/smooth.html': `<!doctype html><html style="scroll-behavior:smooth"><head><title>부드러운 스크롤</title></head><body style="margin:0">
  ${Array.from({ length: 8 }, (_, i) => `<div style="height:500px;background:hsl(${i * 45},60%,50%)"></div>`).join('')}</body></html>`,
  '/dark.html': `<!doctype html><html><head><title>어두운 페이지</title><style>
    html{background:#121212;color:#eee}body{margin:0;font:16px sans-serif}
    p{height:400px;margin:0;padding:20px}
  </style></head><body>${Array.from({ length: 6 }, (_, i) => `<p>문단 ${i + 1}</p>`).join('')}</body></html>`,
  // 압축이 잘 안 되는 무작위 점 이미지 → PNG가 수 MB가 된다 (큰 파일 저장 확인용)
  '/noise.html': `<!doctype html><html><head><title>큰 파일 페이지</title><style>body{margin:0}canvas{display:block}</style></head><body>
  <canvas id="c" width="1000" height="9000"></canvas><script>
  const c = document.getElementById('c').getContext('2d');
  const img = c.createImageData(1000, 9000);
  let x = 12345;
  for (let i = 0; i < img.data.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; img.data[i] = i % 4 === 3 ? 255 : x >> 23; }
  c.putImageData(img, 0, 0);
  </script></body></html>`,
  // 본문(body)이 스크롤되는 페이지: html,body 높이 100% + body overflow-x:hidden
  '/bodyscroll.html': `<!doctype html><html><head><title>본문 스크롤</title><style>
    html,body{margin:0;height:100%}body{overflow-x:hidden;font:16px sans-serif}
    .b{height:600px;font-size:40px}
  </style></head><body>${Array.from({ length: 5 }, (_, i) => `<div class="b" style="background:hsl(${i * 70},55%,50%)">블록 ${i + 1}</div>`).join('')}</body></html>`,
  '/inner.html': `<!doctype html><html><head><title>내부 스크롤</title><style>
    html,body{margin:0;height:100%;overflow:hidden;font:16px sans-serif}
    .top{height:80px;background:#1565c0;color:#fff}
    .scroller{height:calc(100% - 120px);overflow-y:auto}
    .item{height:300px;border-bottom:4px solid #333;font-size:32px}
    .bottom{height:40px;background:#2e7d32}
  </style></head><body><div class="top">앱 머리글</div><div class="scroller">
  ${Array.from({ length: 8 }, (_, i) => `<div class="item">항목 ${i + 1}</div>`).join('')}
  </div><div class="bottom"></div></body></html>`,
};

export function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const body = PAGES[req.url];
      if (!body) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}
