// Local TCP port -> Neon over WebSocket (port 443), for networks that block port 5432.
// Usage: PGHOST=<endpoint host> node neon-bridge.mjs 5433   (needs: npm i ws), then
//        PGHOST=127.0.0.1 PGPORT=5433 PGSSLMODE=disable psql ...  (the WebSocket itself is TLS)
import WebSocket, { createWebSocketStream } from 'ws'
const host = process.env.PGHOST, port = Number(process.argv[2] ?? 5433)
net.createServer((sock) => {
  const ws = new WebSocket(`wss://${host}/v2?address=${host}:5432`)
  const stream = createWebSocketStream(ws)
  sock.pipe(stream).pipe(sock)
  const end = () => { sock.destroy(); stream.destroy() }
  sock.on('error', end); stream.on('error', end); ws.on('error', end)
}).listen(port, '127.0.0.1', () => console.log('bridge on', port))
