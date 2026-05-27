import { createReadStream, existsSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnvFile, readConfig } from "./config.js";
import { configureLogger } from "./logger.js";
import { createProviders } from "./providers/index.js";
import { searchParts } from "./search-service.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(__dirname, "../public");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

export function createServer({ config, providers } = {}) {
  const appConfig = config || readConfig();
  const providerList = providers || createProviders(appConfig);
  return createHttpServer(createRequestHandler({ config: appConfig, providers: providerList }));
}

export function createRequestHandler({ config, providers }) {
  const appConfig = config || readConfig();
  const providerList = providers || createProviders(appConfig);

  return async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

      if (url.pathname === "/api/health") {
        sendJson(res, 200, {
          ok: true,
          build: appConfig.build,
          providers: providerList.map((provider) => ({
            id: provider.id,
            name: provider.name,
            configured:
              typeof provider.isConfigured === "function"
                ? provider.isConfigured()
                : true
          }))
        });
        return;
      }

      if (url.pathname === "/api/parts/search") {
        const result = await searchParts({
          query: Object.fromEntries(url.searchParams),
          providers: providerList,
          includeImages: appConfig.includeSupplierImages,
          logLevel: appConfig.searchLogLevel
        });
        sendJson(res, result.status, result.body);
        return;
      }

      serveStatic(url.pathname, res);
    } catch (error) {
      sendJson(res, 500, {
        error: {
          code: "server_error",
          message: error?.message || "Unexpected server error"
        }
      });
    }
  };
}

function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(publicDir, requested));

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    sendJson(res, 404, {
      error: {
        code: "not_found",
        message: "Not found"
      }
    });
    return;
  }

  const type = contentTypes[extname(filePath)] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  createReadStream(filePath).pipe(res);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnvFile();
  const config = readConfig();
  configureLogger(config.logging);
  const server = createServer({ config });

  server.on("error", (error) => {
    console.error(`Failed to start server: ${error.message}`);
    process.exitCode = 1;
  });

  server.listen(config.port, config.host, () => {
    console.log(`Parts search prototype: http://${config.host}:${config.port}`);
  });
}
