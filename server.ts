import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import puppeteer from "puppeteer";
import Database from "better-sqlite3";

const db = new Database("scans.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    logs TEXT,
    network TEXT,
    screenshot TEXT,
    error_count INTEGER DEFAULT 0,
    warn_count INTEGER DEFAULT 0
  )
`);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);
  const PORT = 3000;

  app.use(express.json());

  app.get("/api/history", (req, res) => {
    try {
      const scans = db.prepare("SELECT id, url, timestamp, error_count, warn_count FROM scans ORDER BY timestamp DESC LIMIT 50").all();
      res.json(scans);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch history" });
    }
  });

  app.get("/api/history/:id", (req, res) => {
    try {
      const scan = db.prepare("SELECT * FROM scans WHERE id = ?").get(req.params.id) as any;
      if (scan) {
        scan.logs = JSON.parse(scan.logs);
        scan.network = JSON.parse(scan.network);
        res.json(scan);
      } else {
        res.status(404).json({ error: "Scan not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch scan" });
    }
  });

  // Socket.IO logic for real-time console streaming
  io.on("connection", (socket) => {
    console.log("Client connected");

    socket.on("scan-url", async (url) => {
      console.log(`Scanning URL: ${url}`);
      let browser;
      const logs: any[] = [];
      const networkLogs: any[] = [];
      let screenshotBase64 = "";

      try {
        browser = await puppeteer.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        // Capture console logs
        page.on("console", (msg) => {
          const logEntry = {
            type: msg.type(),
            text: msg.text(),
            args: msg.args().map(arg => arg.toString()),
            timestamp: new Date().toISOString(),
          };
          logs.push(logEntry);
          socket.emit("console-log", logEntry);
        });

        // Capture page errors
        page.on("pageerror", (err) => {
          const logEntry = {
            type: "error",
            text: err.toString(),
            timestamp: new Date().toISOString(),
          };
          logs.push(logEntry);
          socket.emit("console-log", logEntry);
        });

        // Capture network responses
        page.on("response", (response) => {
          const req = response.request();
          const netEntry = {
            url: response.url(),
            status: response.status(),
            method: req.method(),
            type: req.resourceType(),
            timestamp: new Date().toISOString(),
          };
          if (!netEntry.url.startsWith("data:")) {
            networkLogs.push(netEntry);
            socket.emit("network-log", netEntry);
          }
        });

        page.on("requestfailed", (request) => {
          const netEntry = {
            url: request.url(),
            status: 0,
            method: request.method(),
            type: request.resourceType(),
            errorText: request.failure()?.errorText || "Failed",
            timestamp: new Date().toISOString(),
          };
          if (!netEntry.url.startsWith("data:")) {
            networkLogs.push(netEntry);
            socket.emit("network-log", netEntry);
          }
        });

        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
        
        screenshotBase64 = await page.screenshot({ encoding: "base64" }) as string;
        socket.emit("screenshot", screenshotBase64);

        const errorCount = logs.filter(l => l.type === 'error').length;
        const warnCount = logs.filter(l => l.type === 'warn').length;

        // Save to DB
        const stmt = db.prepare("INSERT INTO scans (url, logs, network, screenshot, error_count, warn_count) VALUES (?, ?, ?, ?, ?, ?)");
        const info = stmt.run(url, JSON.stringify(logs), JSON.stringify(networkLogs), screenshotBase64, errorCount, warnCount);

        socket.emit("scan-complete", { status: "success", scanId: info.lastInsertRowid });

      } catch (error: any) {
        console.error("Scan error:", error);
        socket.emit("console-log", {
          type: "error",
          text: `Failed to load page: ${error.message}`,
          timestamp: new Date().toISOString(),
        });
        socket.emit("scan-complete", { status: "error", message: error.message });
      } finally {
        if (browser) {
          await browser.close();
        }
      }
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected");
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production (if built)
    app.use(express.static("dist"));
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
