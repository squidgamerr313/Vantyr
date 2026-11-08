import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';

// Export-only localhost gateway; no credentials and no public-network binding.
const children = [
  spawn('pnpm', ['--filter', '@workspace/api-server', 'run', 'dev'], {
    stdio: 'inherit', env: { ...process.env, PORT: '8080' },
  }),
  spawn('pnpm', ['--filter', '@workspace/safesight', 'run', 'dev'], {
    stdio: 'inherit', env: { ...process.env, PORT: '5173', BASE_PATH: '/' },
  }),
];
const target = (url) => url === '/api' || url?.startsWith('/api/') ? 8080 : 5173;
const server = http.createServer((req, res) => {
  const upstream = http.request({
    hostname: '127.0.0.1', port: target(req.url), path: req.url,
    method: req.method, headers: req.headers,
  }, (response) => {
    res.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('Development service is starting or unavailable. Check the terminal and retry.');
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
});
server.on('upgrade', (req, socket, head) => {
  const upstream = net.connect(target(req.url), '127.0.0.1', () => {
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      upstream.write(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`);
    }
    upstream.write('\r\n');
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
});
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  children.forEach((child) => child.kill('SIGTERM'));
  server.close();
  setTimeout(() => process.exit(code), 500).unref();
}
children.forEach((child) => {
  child.on('error', () => stop(1));
  child.on('exit', () => { if (!closing) stop(1); });
});
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
server.on('error', (error) => { console.error(error.message); stop(1); });
server.listen(3000, '127.0.0.1', () => console.log('VANTYR local preview: http://localhost:3000 (wait for both services to finish starting)'));
