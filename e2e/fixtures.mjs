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
  '/dark.html': `<!doctype html><html><head><title>어두운 페이지</title><style>
    html{background:#121212;color:#eee}body{margin:0;font:16px sans-serif}
    p{height:400px;margin:0;padding:20px}
  </style></head><body>${Array.from({ length: 6 }, (_, i) => `<p>문단 ${i + 1}</p>`).join('')}</body></html>`,
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
