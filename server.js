import express from "express";
import multer from "multer";
import fs from "fs";
import cors from "cors";
import OpenAI from "openai";
fs.mkdirSync("uploads", { recursive: true });

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(cors()); // de momento abierto; luego afinamos orígenes
app.use(express.json({ limit: "20mb" }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- Transcripción (Whisper) ----
app.post("/api/whisper", upload.single("file"), async (req, res) => {
  try {
    const filePath = req.file?.path;
    if (!filePath) return res.status(400).json({ error: "No se recibió audio" });
    const tr = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "whisper-1",
      language: "es"
    });
    fs.unlink(filePath, () => {});
    res.json({ text: tr.text || "" });
  } catch (err) {
    res.status(500).json({ error: err.message || "Error en Whisper" });
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
    res.status(500).json({ error: err.message || "Error en redacción" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend Compapol escuchando en :${PORT}`));
