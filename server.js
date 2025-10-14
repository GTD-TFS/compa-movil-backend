// server.js — Compapol backend (Groq gratis, estilo “— Que …”, inserción de fichas en “el/la llamado/a”)

import express from "express";
import multer from "multer";
import fs from "node:fs";
import cors from "cors";

const ESTILO_POLICIAL = `
Objetivo: redactar comparecencia fiel a lo dictado, en tercera persona del plural (“estos agentes…”, “los funcionarios actuantes…”), tono impersonal, objetivo y formal.

Reglas estrictas:
- NO insertar fecha ni hora (ni placeholders). Si aparecen en el dictado, OMITIRLAS.
- NO usar rótulos (“Entrevistas/…”, “Actuación…”, etc.). NUNCA.
- Salida SOLO en párrafos HTML: <p>— Que …</p>, tantos como sean necesarios.
- Inicio: “— Que …” indicando comisión por 091 o patrullaje SOLO si se desprende del dictado (no inventar).
- Describir entrevistas, actuaciones, aprehensiones, etc., en “— Que …”.
- Fórmula preferente en detención: “se procede a su detención, informándole de sus derechos y de los motivos de ésta”.
- Nada de coletillas finales (“se instruyen diligencias…”, “Y para que así conste…”). Termina cuando acaben los hechos/actuaciones.
- Si un dato esencial falta, omitir el fragmento (no usar [NO CONSTA]).
- Salida: exclusivamente HTML válido, sin bloques de código ni comillas invertidas.
`.trim();

// === Few-shots sin rótulos ===
const FEW_SHOTS = [
  {
    entrada: `Comisionados por 091 a centro educativo; posible agresión; docente observa lesión; menor dice “chupetón”; se informa 016; detención del varón.`,
    salida: `
<p>— Que, comisionados por la Sala CIMACC-091, estos agentes se personan en un centro educativo ante aviso de posible agresión a una menor.</p>
<p>— Que la docente refiere observar lesión compatible con moratón; la menor manifiesta que se trata de un “chupetón”.</p>
<p>— Que se informa a la posible víctima de recursos (016) y derechos; por indicios de malos tratos se procede a la detención del varón relacionado, informándole de sus derechos y de los motivos de ésta.</p>
`.trim()
  },
  {
    entrada: `Patrullaje; observan fraccionamiento de sustancia; 7 bolsas zip; refieren que venden a 30–50 €; detención; pesaje en dependencia.`,
    salida: `
<p>— Que, realizando labores propias de su cargo en servicio de prevención por zona de ocio, estos agentes observan a dos varones fraccionando sustancia pulverulenta en bolsas tipo zip.</p>
<p>— Que se intervienen SIETE (7) bolsas tipo zip y útiles de fraccionamiento; los reseñados refieren “vender a 30–50 €”.</p>
<p>— Que se procede a su detención, informándoles de sus derechos y de los motivos de ésta, continuando con las diligencias en dependencia policial para pesaje aproximado.</p>
`.trim()
  }
];

// ======== Configuración base ========
fs.mkdirSync("uploads", { recursive: true });
const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 25 * 1024 * 1024 }
});

app.get("/healthz", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ======== Transcripción (Whisper Groq) ========
app.post("/api/whisper", upload.single("file"), async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: "Falta GROQ_API_KEY" });
    if (!req.file) return res.status(400).json({ error: "No se recibió audio" });

    const buf = fs.readFileSync(req.file.path);
    const blob = new Blob([buf], { type: req.file.mimetype || "audio/m4a" });
    const form = new FormData();
    form.append("file", blob, req.file.originalname || "grabacion.m4a");
    form.append("model", "whisper-large-v3");
    form.append("language", "es");

    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: form
    });

    const data = await r.json();
    fs.unlink(req.file.path, () => {});
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || "Error en transcripción (Groq)" });

    res.json({ text: data.text || "" });
  } catch (err) {
    res.status(500).json({ error: err.message || "Error en Whisper" });
  }
});

// ======== Redacción policial (Groq) ========
app.post("/api/police-draft", async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: "Falta GROQ_API_KEY" });

    const { texto = "", filiaciones = [], objetos = [], fichas_resueltas = [] } = req.body || {};

    // --- Nueva lógica: inserción literal en “el/la llamado/a + nombre” ---
    const instruccionesFichas = `
Si en el texto aparece una expresión del tipo:
- “el llamado [nombre]” o “la llamada [nombre]”,
busca en las fichas resueltas si existe alguna con ese nombre (ignorando mayúsculas/minúsculas y acentos).

Cuando se detecte:
- Sustituye esa expresión completa (“el llamado Conor”, “la llamada María”) por:
  - "el llamado" o "la llamada" + la ficha literal correspondiente en formato:
    Nombre APELLIDOS, indocumentado/a (o documento), nacido/a en [lugar] el [fecha], hijo/a de [padres], domicilio en [calle], teléfono [número].
- Si faltan datos en la ficha (por ejemplo no hay teléfono o padres), omite esas partes sin dejar huecos ni etiquetas.

Si no hay coincidencia, deja la expresión tal como está.
`.trim();

    const userPrompt = `
Dictado del agente:
"""${texto}"""

Datos de apoyo:
- Filiaciones: ${JSON.stringify(filiaciones)}
- Objetos: ${JSON.stringify(objetos)}
- Fichas resueltas:
${fichas_resueltas.map(x => `• ${x}`).join("\n")}

Instrucciones:
${instruccionesFichas}

Reglas de redacción:
- Redacta exclusivamente en párrafos <p>— Que …</p>.
- Sin rótulos, sin fecha/hora, sin coletillas finales.
- No inventes nada. Si falta algo, omítelo.
- Salida: HTML válido, sin \`\`\`.
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
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || "Error en redacción" });

    let html = (data.choices?.[0]?.message?.content || "").trim();
    html = html.replace(/```html|```/g, "").trim();

    html = html
      .split(/\n+/)
      .filter(l => !/^<p><strong>/i.test(l) && !/Y para que as[ií] conste/i.test(l) && !/se instruyen diligencias/i.test(l))
      .join("\n")
      .trim();

    res.json({ html });
  } catch (err) {
    res.status(500).json({ error: err.message || "Error en redacción" });
  }
});

// ======== Inicio ========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend Compapol (Groq) escuchando en :${PORT}`));
