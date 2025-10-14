// server.js — Compapol backend con CORS para gtd-tfs GitHub Pages

import express from "express";
import multer from "multer";
import fs from "fs";
import cors from "cors";
import OpenAI from "openai";

// Crear carpeta de subidas si no existe
fs.mkdirSync("uploads", { recursive: true });

const app = express();

// CORS permitido para tu GitHub Pages (gtd-tfs)
app.use(cors({
  origin: [
    "https://gtd-tfs.github.io",
    "https://gtd-tfs.github.io/compapol-movil"
  ],
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));
app.options("*", cors());

app.use(express.json({ limit: "25mb" }));

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 25 * 1024 * 1024 }
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// (Opcional) salud
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Transcripción de audio → texto
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
    const msg = err?.message || "Error en Whisper";
    res.status(500).json({ error: msg });
  }
});

// Redacción estilo policial
app.post("/api/police-draft", async (req, res) => {
  try {
    const { texto = "", filiaciones = [], objetos = [] } = req.body || {};
    const prompt = `
Redacta una Comparecencia de Funcionarios policial según formato español.
Tono impersonal y formal. No inventes datos.
Contexto:
Filiaciones: ${JSON.stringify(filiaciones)}
Objetos: ${JSON.stringify(objetos)}
Texto dictado: """${texto}"""
Salida en HTML con cierre: “Y para que así conste, firman la presente en el lugar y fecha ut supra.”
`.trim();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });
    const html = completion?.choices?.[0]?.message?.content || "";
    res.json({ html });
  } catch (err) {
    const msg = err?.message || "Error en redacción";
    res.status(500).json({ error: msg });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend Compapol escuchando en :${PORT}`));
