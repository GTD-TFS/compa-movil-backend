// server.js — Compapol backend (Render, estable)

import express from "express";
import multer from "multer";
import fs from "fs";
import cors from "cors";
import OpenAI from "openai";

// --- Seguridad: crea carpeta de subidas si no existe
try { fs.mkdirSync("uploads", { recursive: true }); } catch {}

// --- App
const app = express();

// --- CORS abierto para pruebas (luego restringimos a tu dominio)
app.use(cors());
app.options("*", cors());

// --- Body parser
app.use(express.json({ limit: "25mb" }));

// --- Subidas (hasta 25 MB)
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 25 * 1024 * 1024 }
});

// --- OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Health simple
app.get("/", (_req, res) => res.json({ ok: true, service: "compapol-backend" }));
app.get("/healthz", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// --- Transcripción: /api/whisper
app.post("/api/whisper", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No se recibió audio" });

    const { path: filePath, size } = req.file;
    if (!size || size < 1000) {
      fs.unlink(filePath, () => {});
      return res.status(400).json({ error: "Audio demasiado corto o vacío" });
    }

    const rs = fs.createReadStream(filePath);

    const tr = await openai.audio.transcriptions.create({
      file: rs,
      model: "whisper-1",
      language: "es"
    });

    fs.unlink(filePath, () => {});
    res.json({ text: tr.text || "" });
  } catch (err) {
    const msg = (err && (err.message || err.error || String(err))) || "Error en Whisper";
    res.status(500).json({ error: msg });
  }
});

// --- Redacción: /api/police-draft
app.post("/api/police-draft", async (req, res) => {
  try {
    const { texto = "", filiaciones = [], objetos = [] } = req.body || {};

    const prompt =
      "Redacta una Comparecencia de Funcionarios policial según formato español.\n" +
      "Tono impersonal, objetivo y formal. No inventes datos.\n" +
      "Contexto:\n" +
      "Filiaciones: " + JSON.stringify(filiaciones) + "\n" +
      "Objetos: " + JSON.stringify(objetos) + "\n" +
      'Texto dictado: """' + texto + '"""\n' +
      "Salida en HTML con <p>...</p> y cierre: Y para que así conste, firman la presente en el lugar y fecha ut supra.";

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });

    const html = completion?.choices?.[0]?.message?.content || "";
    res.json({ html });
  } catch (err) {
    const msg = (err && (err.message || err.error || String(err))) || "Error en redacción";
    res.status(500).json({ error: msg });
  }
});

// --- Errores no capturados (para verlos en logs)
process.on("unhandledRejection", (r) => console.error("UNHANDLED REJECTION:", r));
process.on("uncaughtException", (e) => console.error("UNCAUGHT EXCEPTION:", e));

// --- Inicio
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend Compapol escuchando en :${PORT}`));
