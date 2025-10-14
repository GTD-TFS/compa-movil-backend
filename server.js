// server.js — Compapol backend (Render, versión estable corregida)

import express from "express";
import multer from "multer";
import fs from "fs";
import cors from "cors";
import OpenAI from "openai";

// Crear carpeta de subidas si no existe
fs.mkdirSync("uploads", { recursive: true });

const app = express();

// CORS (dominios permitidos para tu GitHub Pages)
app.use(
  cors({
    origin: [
      "https://gtd-tfs.github.io",
      "https://gtd-tfs.github.io/compapol-movil"
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"]
  })
);

app.use(express.json({ limit: "25mb" }));

// Subidas de audio (hasta 25 MB)
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 25 * 1024 * 1024 }
});

// Cliente de OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- Health check (Render) ----
app.get("/healthz", (_req, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);

// ---- Transcripción (Whisper) ----
app.post("/api/whisper", upload.single("file"), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ error: "No se recibió audio" });

    const { path: filePath, mimetype, size } = req.file;
    if (!size || size < 1000) {
      fs.unlink(filePath, () => {});
      return res
        .status(400)
        .json({ error: "Audio demasiado corto o vacío" });
    }

    const tr = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "whisper-1",
      language: "es"
    });

    fs.unlink(filePath, () => {});
    res.json({ text: tr.text || "" });
  } catch (err) {
    const msg =
      err?.message || err?.error || String(err) || "Error en Whisper";
    res.status(500).json({ error: msg });
  }
});

// ---- Redacción estilo policial ----
app.post("/api/police-draft", async (req, res) => {
  try {
    const { texto = "", filiaciones = [], objetos = [] } = req.body || {};

    const prompt = `
Redacta una Comparecencia de Funcionarios policial según formato español.
Tono impersonal, objetivo y formal. No inventes datos.
Contexto:
Filiaciones: ${JSON.stringify(filiaciones)}
Objetos: ${JSON.stringify(objetos)}
Texto dictado: """${texto}"""
Estructura con párrafos HTML (<p>...</p>) y cierre oficial.
`.trim();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });

    const html = completion?.choices?.[0]?.message?.content || "";
    res.json({ html });
  } catch (err) {
    const msg =
      err?.message || err?.error || String(err) || "Error en redacción";
    res.status(500).json({ error: msg });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Backend Compapol escuchando en :${PORT}`)
);
