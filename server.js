// server.js — Compapol backend (Render, versión gratuita con Groq)

import express from "express";
import multer from "multer";
import fs from "fs";
import cors from "cors";
import fetch from "node-fetch"; // para llamadas a la API Groq

// Crear carpeta de subidas si no existe
fs.mkdirSync("uploads", { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB
});

// =================== TRANSCRIPCIÓN (Whisper gratis Groq) ===================
app.post("/api/whisper", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No se recibió audio" });

    const filePath = req.file.path;
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath));
    form.append("model", "whisper-large-v3");
    form.append("language", "es");

    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: form
    });

    const data = await r.json();
    fs.unlink(filePath, () => {});
    if (!r.ok) throw new Error(data.error?.message || "Error en transcripción");

    res.json({ text: data.text });
  } catch (err) {
    res.status(500).json({ error: err.message || "Error en Whisper (Groq)" });
  }
});

// =================== REDACCIÓN POLICIAL (Llama3-70B gratis Groq) ===================
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

    const body = {
      model: "llama3-70b-8192",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4
    };

    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || "Error en redacción");

    const html = data.choices?.[0]?.message?.content || "";
    res.json({ html });
  } catch (err) {
    res.status(500).json({ error: err.message || "Error en redacción (Groq)" });
  }
});

// =================== HEALTH ===================
app.get("/healthz", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend Compapol (Groq) escuchando en :${PORT}`));
