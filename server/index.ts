import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const reqPath = req.path;
  let capturedJsonResponse: Record<string, any> | undefined;

  const originalJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (reqPath.startsWith("/api")) {
      let logLine = `${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) logLine = logLine.slice(0, 79) + "…";
      console.log(logLine);
    }
  });

  next();
});

async function startServer() {
  const server = await registerRoutes(app);

  // if (process.env.NODE_ENV === "production") {
  //   // This is the key fix: Adjusting the path to go from `dist/server`
  //   // UP to the project root, then INTO `client/dist`.
  //   const clientDistPath = path.resolve(__dirname, "..", "..", "dist", "client");
  //   console.log(`Serving static client files from ${clientDistPath}`);

  //   app.use(express.static(clientDistPath));

  //   app.get("*", (req, res) => {
  //     res.sendFile(path.join(clientDistPath, "index.html"));
  //   });
  // }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error(`Error: ${status} - ${message}`, err.stack);
    res.status(status).json({ message });
  });

  const port = process.env.PORT || (process.env.NODE_ENV === "production" ? 3000 : 8000);
  server.listen(port, () => {
    console.log(`Server running in ${process.env.NODE_ENV || "development"} mode on port ${port}`);
    console.log(`__dirname is ${__dirname}`);
  });

  return server;
}

export default app;

if (process.env.NODE_ENV !== "test") {
  startServer().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}