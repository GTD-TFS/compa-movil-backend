// server.js — Compapol backend (Groq gratis, Node 20+, sin node-fetch)

import express from "express";
import multer from "multer";
import fs from "node:fs";
import cors from "cors";

// --- Preparación
fs.mkdirSync("uploads", { recursive: true });

const app = express();
app.use(cors()); // abierto en pruebas; luego puedes restringir a tu GitHub Pages
app.use(express.json({ limit: "25mb" }));

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

// =====================================================
// ===============  TRANSCRIPCIÓN (GROQ)  ==============
// =====================================================
app.post("/api/whisper", upload.single("file"), async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: "Falta GROQ_API_KEY en el servidor" });
    }
    if (!req.file) return res.status(400).json({ error: "No se recibió audio" });

    const { path: filePath, size } = req.file;
    if (!size || size < 1000) {
      fs.unlink(filePath, () => {});
      return res.status(400).json({ error: "Audio demasiado corto o vacío" });
    }

    // Leer el archivo y crear un Blob (FormData de Node requiere Blob/File, no streams)
    const buf = fs.readFileSync(filePath);
    // Intenta deducir extensión; si no, usa m4a por defecto (válido para Whisper)
    const filename = req.file.originalname || "grabacion.m4a";
    const mime = req.file.mimetype || "audio/m4a";
    const blob = new Blob([buf], { type: mime });

    const form = new FormData();
    form.append("file", blob, filename);
    form.append("model", "whisper-large-v3");
    form.append("language", "es");

    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: form
    });

    const data = await r.json();
    fs.unlink(filePath, () => {});

    if (!r.ok) {
      return res.status(r.status).json({ error: data?.error?.message || "Error en transcripción (Groq)" });
    }

    res.json({ text: data.text || "" });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Error en Whisper (Groq)" });
  }
});

// =====================================================
// ==============  REDACCIÓN POLICIAL (GROQ) ===========
// =====================================================
app.post("/api/police-draft", async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: "Falta GROQ_API_KEY en el servidor" });
    }

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
    if (!r.ok) {
      return res.status(r.status).json({ error: data?.error?.message || "Error en redacción (Groq)" });
    }

    const html = data.choices?.[0]?.message?.content || "";
    res.json({ html });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Error en redacción (Groq)" });
  }
});

// Health
app.get("/healthz", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend Compapol (Groq) escuchando en :${PORT}`));
