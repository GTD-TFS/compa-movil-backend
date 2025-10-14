// server.js — Compapol backend (Groq gratis, estilo policial fijo + few-shots)

import express from "express";
import multer from "multer";
import fs from "node:fs";
import cors from "cors";

// ======== Estilo fijo (system) + few-shots compactos ========
const ESTILO_POLICIAL = `
Objetivo: redactar una "Comparecencia de Funcionarios" (España) fiel a lo dictado.
Reglas:
- Tono: impersonal, objetivo y formal. Tercera persona del plural (“los funcionarios actuantes…”, “estos agentes…”).
- Inicio: comisión por Sala CIMACC-091 o patrullaje ordinario, según se desprenda del dictado (no inventar).
- Estructura en párrafos HTML (<p>...</p>) sin bloques de código:
  <p><strong>Comparecencia de Funcionarios</strong></p>
  <p>— Que ... [exposición de hechos iniciales: comisión/patrullaje, lugar y hora si constan].</p>
  <p><strong>Entrevistas/Manifiestos:</strong> — Que ...</p>
  <p><strong>Actuación policial:</strong> — Que ... (se procede a ... informando de derechos, fuerza mínima indispensable, etc.)</p>
  <p><strong>Efectos intervenidos:</strong> — Que ...</p>
  <p><strong>Asistencia/Traslado:</strong> — Que ...</p>
  <p><strong>Autoridad/Judicial:</strong> — Que ...</p>
  <p>Y para que así conste, se firma la presente en [LOCALIDAD], a [FECHA].</p>
- Formato: fechas dd/mm/aaaa; horas 24 h (09:05, 17:30).
- Si un dato no aparece en el dictado, indicar [NO CONSTA] o [DATOS RESERVADOS]. No inventar.
- Mantener expresiones típicas: “— Que …”, “se procede… no sin antes informar…”, “utilizando la fuerza mínima indispensable…”.
- Salida: EXCLUSIVAMENTE HTML válido (sin \`\`\`, sin narración externa).
`.trim();

const FEW_SHOTS = [
  {
    entrada: `Comisionados por 091 a centro educativo por posible agresión a menor; docente observa lesión; menor dice “chupetón”; se informa de 016; se detiene al varón relacionado.`,
    salida: `
<p><strong>Comparecencia de Funcionarios</strong></p>
<p>— Que, comisionados por la Sala CIMACC-091, los funcionarios actuantes se personan en un centro educativo ante aviso de posible agresión a una menor, en fecha [NO CONSTA] y siendo las [NO CONSTA] horas.</p>
<p><strong>Entrevistas/Manifiestos:</strong> — Que la docente refiere observar lesión compatible con moratón; la menor manifiesta que se trata de un “chupetón”.</p>
<p><strong>Actuación policial:</strong> — Que se informa de recursos (016) y derechos; por indicios de malos tratos se procede a la detención del varón relacionado, informándole de derechos y motivo de la detención.</p>
<p><strong>Efectos intervenidos:</strong> — Que [NO CONSTA].</p>
<p><strong>Asistencia/Traslado:</strong> — Que se valora asistencia facultativa.</p>
<p><strong>Autoridad/Judicial:</strong> — Que se instruyen diligencias y se pone lo actuado a disposición judicial.</p>
`.trim()
  },
  {
    entrada: `Patrullaje por zona de ocio; observan manipulación de sustancia en bolsitas; 7 bolsas zip; refieren “vender a 30–50 €”; detención; pesaje en comisaría.`,
    salida: `
<p><strong>Comparecencia de Funcionarios</strong></p>
<p>— Que, realizando labores propias de su cargo en servicio de prevención por zona de ocio, estos agentes observan a dos varones fraccionando sustancia pulverulenta en bolsas tipo zip, en fecha [NO CONSTA] y siendo las [NO CONSTA] horas.</p>
<p><strong>Efectos intervenidos:</strong> — Que se incautan SIETE (7) bolsas tipo zip y útiles de fraccionamiento.</p>
<p><strong>Entrevistas/Manifiestos:</strong> — Que los reseñados refieren “vender a 30–50 €”.</p>
<p><strong>Actuación policial:</strong> — Que se procede a la detención por presunto delito contra la salud pública, informando de derechos.</p>
<p><strong>Autoridad/Judicial:</strong> — Que en dependencias se realiza pesaje aproximado y se continúan diligencias.</p>
`.trim()
  }
];
// ============================================================

// --- Arranque / preparación
fs.mkdirSync("uploads", { recursive: true });

const app = express();

// CORS (en pruebas abierto; si quieres, restringe a tu GitHub Pages)
app.use(cors());
// app.use(cors({ origin: ["https://gtd-tfs.github.io", "https://gtd-tfs.github.io/compapol-movil"] }));

app.use(express.json({ limit: "25mb" }));

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB
});

// ---------- HEALTH ----------
app.get("/healthz", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---------- TRANSCRIPCIÓN (Groq Whisper gratis) ----------
app.post("/api/whisper", upload.single("file"), async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: "Falta GROQ_API_KEY en el servidor" });
    }
    if (!req.file) return res.status(400).json({ error: "No se recibió audio" });

    const { path: filePath, originalname, mimetype, size } = req.file;
    if (!size || size < 1000) {
      fs.unlink(filePath, () => {});
      return res.status(400).json({ error: "Audio demasiado corto o vacío" });
    }

    // Node 20+: FormData/Blob nativos -> necesitan Blob/File, no stream
    const buf = fs.readFileSync(filePath);
    const filename = originalname || "grabacion.m4a";
    const type = mimetype || "audio/m4a";
    const blob = new Blob([buf], { type });

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

// ---------- REDACCIÓN POLICIAL (Groq Llama3 gratis + estilo) ----------
app.post("/api/police-draft", async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: "Falta GROQ_API_KEY en el servidor" });
    }

    const { texto = "", filiaciones = [], objetos = [] } = req.body || {};

    const userPrompt = `
Dictado del agente (texto libre, puede incluir fechas/horas/lugares o no):
"""${texto}"""

Datos estructurados de apoyo (si existen; no inventar):
- Filiaciones: ${JSON.stringify(filiaciones)}
- Objetos: ${JSON.stringify(objetos)}

Instrucciones:
- Redacta la comparecencia siguiendo la guía de estilo y los ejemplos.
- Usa SOLAMENTE la información aportada. Si falta un dato, pon [NO CONSTA].
- Si del dictado se desprende comisión por 091, indícalo; si se desprende patrullaje, indícalo (no asumas ambos).
- Salida: solo HTML válido, con párrafos “— Que …” y bloques en <strong>...</strong>. Sin \`\`\`.
`.trim();

    const messages = [
      { role: "system", content: ESTILO_POLICIAL },
      ...FEW_SHOTS.flatMap(ej => ([
        { role: "user", content: `Entrada:\n${ej.entrada}` },
        { role: "assistant", content: ej.salida }
      ])),
      { role: "user", content: userPrompt }
    ];

    const body = {
      model: "llama-3.3-70b-versatile",
      temperature: 0.1,
      messages
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

    let html = (data.choices?.[0]?.message?.content || "").trim();
    // Limpieza por si el modelo añadiera fences por accidente
    html = html.replace(/```html|```/g, "").trim();

    res.json({ html });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Error en redacción (Groq)" });
  }
});

// ---------- Inicio ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend Compapol (Groq) escuchando en :${PORT}`));
