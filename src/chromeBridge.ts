import http from "http";
import net from "net";
import fs from "fs";

let bridgeServer: http.Server | null = null;

/**
 * Initializes a transparent CDP bridge inside Docker containers.
 * Forwards CDP HTTP and WebSocket requests from 127.0.0.1:9222 -> host.docker.internal:9222
 * with Host header rewritten to 'localhost:9222' to satisfy Chrome DevTools security restrictions.
 */
export function startChromeBridge(): void {
  const isDocker = fs.existsSync("/.dockerenv") || process.env.DOCKER === "true" || process.env.CHROME_DEBUG_HOST === "host.docker.internal";
  if (!isDocker) return;

  const targetHost = process.env.CHROME_HOST || "host.docker.internal";
  const targetPort = parseInt(process.env.CHROME_DEBUG_PORT || "9222", 10);
  const localPort = targetPort;

  try {
    bridgeServer = http.createServer((clientReq, clientRes) => {
      const options = {
        hostname: targetHost,
        port: targetPort,
        path: clientReq.url,
        method: clientReq.method,
        headers: { ...clientReq.headers, host: `localhost:${targetPort}` },
      };
      const proxyReq = http.request(options, (proxyRes) => {
        clientRes.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(clientRes, { end: true });
      });
      clientReq.pipe(proxyReq, { end: true });
      proxyReq.on("error", (e) => {
        if (!clientRes.headersSent) {
          clientRes.writeHead(502, { "Content-Type": "application/json" });
          clientRes.end(JSON.stringify({ error: `Chrome bridge connection error: ${e.message}` }));
        }
      });
    });

    bridgeServer.on("upgrade", (req, socket, head) => {
      const proxySocket = net.connect(targetPort, targetHost, () => {
        let rawReq = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const key = req.rawHeaders[i];
          let val = req.rawHeaders[i + 1];
          if (key.toLowerCase() === "host") val = `localhost:${targetPort}`;
          rawReq += `${key}: ${val}\r\n`;
        }
        rawReq += "\r\n";
        proxySocket.write(rawReq);
        if (head && head.length) proxySocket.write(head);
        proxySocket.pipe(socket);
        socket.pipe(proxySocket);
      });
      proxySocket.on("error", () => socket.destroy());
    });

    bridgeServer.listen(localPort, "127.0.0.1", () => {
      console.log(`🔌 [ChromeBridge] Active: Forwarding 127.0.0.1:${localPort} -> ${targetHost}:${targetPort} (Host: localhost)`);
    });

    bridgeServer.on("error", (err: any) => {
      console.warn(`⚠️  [ChromeBridge] Could not bind port ${localPort} (possibly already in use): ${err.message}`);
    });
  } catch (err: any) {
    console.warn(`⚠️  [ChromeBridge] Failed to start bridge: ${err.message}`);
  }
}
