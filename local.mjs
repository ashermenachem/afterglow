if (process.argv.includes("--production")) process.env.NODE_ENV = "production";
import app from "./server.mjs";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*path}", (_q, r) =>
    r.sendFile(path.join(root, "dist/index.html")),
  );
} else if (process.env.NODE_ENV !== "test") {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.listen(Number(process.env.PORT) || 4173, "127.0.0.1", () =>
  console.log("Afterglow · http://localhost:" + (process.env.PORT || 4173)),
);
