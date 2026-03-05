import express, { Response } from "express";
import { createServer as createViteServer } from "vite";



async function startServer() {
  const app = express();
  const PORT = 3000;

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Example SSE endpoint
  app.get("/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
      res.write("data: connected\n\n");
      
      const interval = setInterval(() => {
        res.write(`data: ${new Date().toISOString()}\n\n`);
      }, 1000);

      req.on("close", () => {
        clearInterval(interval);
      });
    } catch (err) {
      console.error("SSE Error:", err);
      res.write(`event: error\ndata: ${JSON.stringify({ message: (err as any).message || "Unknown error" })}\n\n`);
      res.end();
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production static file serving would go here
    // app.use(express.static('dist'));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
