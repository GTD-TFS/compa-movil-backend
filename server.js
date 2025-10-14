// server.js — Compapol backend (Render, estable y limpio)

import express from "express";
import multer from "multer";
import fs from "node:fs";
import cors from "cors";
import OpenAI from "openai";

// --- Logs de arranque
console.log("🔧 Iniciando Compapol backend...");
console.log("• NODE_ENV:", process.env.NODE_ENV || "undefined");
console.log("• PORT (Render asigna uno):", process.env.PORT || "(no definido)");
console.log("• OPENAI_API_KEY presente:", process.env.OPENAI_API_KEY ? "sí" : "NO");

// --- Carpeta de subidas
try {
  fs.mkdirSync("uploads", { recursive: true });
  console.log("• Carpeta uploads lista");
} catch (e) {
  console.error("❌ No se pudo crear uploads:", e);
}

// --- App principal
const app = express();

// --- CORS abierto (para pruebas; cuando funcione, se restringe al dominio de GitHub Pages)
app.use(cors());
app.options("*", cors());

// --- Body parser
app.use(express.json({ limit: "25mb" }));

// --- Configuración de multer (archivos de audio, hasta 25 MB)
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 25 * 1024 * 1024 }
});

// --- Inicialización de OpenAI
let openai = null;
try {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log("• Cliente OpenAI inicializado correctamente");
} catch (e) {
  console.error("❌ Error creando cliente OpenAI:", e?.message || e);
}

// --- Health checks (para Render)
app.get("/", (_req, res) => res.json({ ok: true, service: "compapol-backend" }));
app.get("/healthz", (_req, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);

// --- Transcripción de audio → texto
app.post("/api/whisper", upload.single("file"), async (req, res) => {
  try {
    if (!openai) return res.status(500).json({ error: "OpenAI no inicializado" });
    if (!req.file) return res.status(400).json({ error: "No se recibió audio" });

    const { path: filePath, size, mimetype } = req.file;
    if (!size || size < 1000) {
      fs.unlink(filePath, () => {});
      return res.status(400).json({ error: "Audio demasiado corto o vacío" });
    }

    console.log("🎧 /api/whisper ->", mimetype, size, "bytes");

    const rs = fs.createReadStream(filePath);
    const tr = await openai.audio.transcriptions.create({
      file: rs,
      model: "whisper-1",
      language: "es"
    });

    fs.unlink(filePath, () => {});
    res.json({ text: tr.text || "" });
  } catch (err) {
    console.error("❌ Whisper error:", err);
    const msg =
      (err && (err.message || err.error || String(err))) ||
      "Error en Whisper";
    res.status(500).json({ error: msg });
  }
});

// --- Redacción estilo policial
app.post("/api/police-draft", async (req, res) => {
  try {
    if (!openai) return res.status(500).json({ error: "OpenAI no inicializado" });

    const { texto = "", filiaciones = [], objetos = [] } = req.body || {};
    const prompt =
      "Redacta una Comparecencia de Funcionarios policial según formato español.\n" +
      "Tono impersonal, objetivo y formal. No inventes datos.\n" +
      "Contexto:\n" +
      "Filiaciones: " +
      JSON.stringify(filiaciones) +
      "\n" +
      "Objetos: " +
      JSON.stringify(objetos) +
      "\n" +
      'Texto dictado: """' +
      texto +
      '"""\n' +
      "Salida en HTML con <p>...</p> y cierre: Y para que así conste, firman la presente en el lugar y fecha ut supra.";

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });

    const html = completion?.choices?.[0]?.message?.content || "";
    res.json({ html });
  } catch (err) {
    console.error("❌ Redacción error:", err);
    const msg =
      (err && (err.message || err.error || String(err))) ||
      "Error en redacción";
    res.status(500).json({ error: msg });
  }
});

// --- Errores no capturados (para depuración)
process.on("unhandledRejection", (r) =>
  console.error("UNHANDLED REJECTION:", r)
);
process.on("uncaughtException", (e) =>
  console.error("UNCAUGHT EXCEPTION:", e)
);

// --- Inicio del servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Backend Compapol escuchando en :${PORT}`)
);
