import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { registerIpcHandlers } from "./handlers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Load DATABASE_URL for the desktop app. The app only needs the DB connection
 * (no Telegram/provider secrets), so we deliberately do NOT import src/lib/env,
 * whose schema requires the worker's secrets. Prefer a desktop-specific file,
 * fall back to the repo .env in dev.
 */
function loadDatabaseEnv(): void {
  if (process.env.DATABASE_URL) return;
  for (const file of [".env.desktop", ".env"]) {
    try {
      process.loadEnvFile(path.resolve(process.cwd(), file));
      if (process.env.DATABASE_URL) return;
    } catch {
      // file missing — try the next candidate
    }
  }
}

loadDatabaseEnv();

const prisma = new PrismaClient();

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: "Flight Tracker",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  registerIpcHandlers(prisma);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void prisma.$disconnect();
});
