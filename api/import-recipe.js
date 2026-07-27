// api/import-recipe.js
// Fonction serverless Vercel.
// Reçoit l'un / une combinaison de :
//   POST { url }                    -> lit la légende publique du post
//   POST { text }                   -> analyse une légende collée
//   POST { images: [b64...] }       -> lit le texte affiché dans la vidéo (vision)
//   POST { audio: b64 }             -> transcrit la voix de la vidéo (Groq/Whisper)
// images + audio peuvent être envoyés ensemble : l'IA combine tout.
// Renvoie : { recipe: {...} } ou { needCaption: true } si rien d'exploitable.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY; // pour la transcription audio

// Modèle Claude. En cas d'erreur "model not found", remplacez cette valeur
// par le modèle utilisé par votre import image existant.
const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT =
  "Tu extrais des recettes de cuisine, souvent en français, à partir de trois " +
  "sources possibles : le texte affiché à l'écran d'une vidéo (images fournies), " +
  "la transcription de la voix de la vidéo, et/ou la légende écrite d'un post. " +
  "Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans markdown. " +
  'Format : {"name": string, "servings": string, "ingredients": [string], "steps": string, "isRecipe": boolean}. ' +
  "ingredients : un élément par ingrédient, avec sa quantité si elle est mentionnée. " +
  "steps : étapes de préparation séparées par des retours à la ligne, numérotées si possible. " +
  "Combine toutes les sources fournies pour reconstituer UNE seule recette cohérente : " +
  "les quantités précises viennent souvent du texte à l'écran, les gestes et astuces de la voix. " +
  "Si aucune recette n'est exploitable, renvoie isRecipe: false et laisse les champs vides. " +
  "N'invente aucun ingrédient ni aucune étape absente des sources.";

// --- Légende publique Instagram / Facebook ---
// Instagram bloque souvent la lecture directe (mur de connexion). On essaie
// donc, dans l'ordre : (1) la page "embed" du post (publique, contient la
// légende), (2) la page normale avec un user-agent de robot d'aperçu.
function htmlDecode(s) {
  if (!s) return null;
  return s
    .replace(/\\u0026/g, "&")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ").trim();
}

function extractShortcode(url) {
  const m = url.match(/instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

async function fetchHtml(url, ua) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": ua,
        "Accept-Language": "fr-FR,fr;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// Cherche la légende dans le HTML de la page embed
function captionFromEmbed(html) {
  if (!html) return null;
  // 1) Dans le JSON embarqué : "caption": ... "text":"..."
  let m = html.match(/"edge_media_to_caption".*?"text":"((?:[^"\\]|\\.)*)"/s);
  if (m && m[1]) return htmlDecode(m[1]);
  // 2) Bloc <div class="Caption">
  m = html.match(/class="Caption"[^>]*>([\s\S]*?)<\/div>/i);
  if (m && m[1]) {
    const txt = htmlDecode(m[1]);
    if (txt && txt.length > 20) return txt;
  }
  return null;
}

async function fetchCaption(url) {
  const CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
  const BROWSER_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

  // Stratégie 1 : page embed d'Instagram (la plus fiable)
  const shortcode = extractShortcode(url);
  if (shortcode) {
    for (const path of [
      `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
      `https://www.instagram.com/reel/${shortcode}/embed/captioned/`,
    ]) {
      const html = await fetchHtml(path, BROWSER_UA);
      const caption = captionFromEmbed(html);
      if (caption && caption.length > 30) {
        return { title: "", description: caption };
      }
    }
  }

  // Stratégie 2 : page normale, lue comme un robot d'aperçu de lien
  for (const ua of [CRAWLER_UA, BROWSER_UA]) {
    const html = await fetchHtml(url, ua);
    if (!html) continue;
    const meta = (prop) => {
      const a = html.match(
        new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i")
      );
      const b = html.match(
        new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${prop}["']`, "i")
      );
      return (a && a[1]) || (b && b[1]) || null;
    };
    const description = htmlDecode(meta("og:description"));
    const title = htmlDecode(meta("og:title"));
    if (description && description.length > 40) return { title, description };
  }

  return null;
}

// --- Transcription de l'audio via Groq (Whisper). Best effort. ---
async function transcribeAudio(base64) {
  if (!GROQ_API_KEY) return null; // pas de clé -> on ignore simplement l'audio
  try {
    const data = base64.includes(",") ? base64.split(",")[1] : base64;
    const buffer = Buffer.from(data, "base64");
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: "audio/mpeg" }), "audio.mp3");
    form.append("model", "whisper-large-v3");
    form.append("language", "fr");
    form.append("response_format", "text");

    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: "Bearer " + GROQ_API_KEY },
      body: form,
    });
    if (!r.ok) return null; // transcription indisponible -> on continue sans
    const txt = (await r.text()).trim();
    return txt.length > 3 ? txt : null;
  } catch {
    return null;
  }
}

// --- Appel Claude (accepte du texte ou un contenu multimodal) ---
async function callClaude(content) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error("Erreur API Claude : " + err.slice(0, 300));
  }
  const dataR = await response.json();
  const text = (dataR.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

function formatRecipe(parsed, sourceUrl) {
  return {
    name: parsed.name || "",
    servings: parsed.servings || "",
    ingredients: parsed.ingredients || [],
    steps: parsed.steps || "",
    sourceUrl: sourceUrl || "",
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST uniquement" });
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY manquante dans Vercel" });
  }

  try {
    const { url, text, images, audio } = req.body || {};
    const sourceUrl = (url || "").trim();

    // 1) Transcription audio (si fournie et si clé Groq configurée)
    const transcript = audio ? await transcribeAudio(audio) : null;

    // 2) Cas vidéo : images (texte à l'écran) et/ou transcription (voix)
    const hasImages = Array.isArray(images) && images.length > 0;
    if (hasImages || transcript) {
      const content = [];
      if (hasImages) {
        for (const b64 of images.slice(0, 12)) {
          const d = b64.includes(",") ? b64.split(",")[1] : b64;
          content.push({
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: d },
          });
        }
      }
      let instruction =
        "Voici les éléments d'une vidéo de recette. Reconstitue la recette complète.";
      if (hasImages) instruction += "\n- Les images montrent le texte affiché à l'écran.";
      if (transcript)
        instruction += "\n- Transcription de la voix de la vidéo :\n\"\"\"\n" + transcript + "\n\"\"\"";
      content.push({ type: "text", text: instruction });

      const parsed = await callClaude(content);
      if (!parsed.isRecipe) {
        return res.status(200).json({ needCaption: true, noRecipeInVideo: true });
      }
      return res.status(200).json({ recipe: formatRecipe(parsed, sourceUrl) });
    }

    // 3) Cas texte / lien
    let rawText = (text || "").trim();
    if (!rawText && sourceUrl) {
      const caption = await fetchCaption(sourceUrl);
      if (!caption) return res.status(200).json({ needCaption: true, sourceUrl });
      rawText = [caption.title, caption.description].filter(Boolean).join("\n\n");
    }
    if (!rawText) {
      return res.status(400).json({ error: "Aucune donnée fournie (lien, texte, images ou audio)" });
    }
    const parsed = await callClaude(rawText);
    if (!parsed.isRecipe) return res.status(200).json({ needCaption: true, sourceUrl });
    return res.status(200).json({ recipe: formatRecipe(parsed, sourceUrl) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// Corps plus gros (images + audio en base64) et délai plus long (transcription)
export const config = {
  api: { bodyParser: { sizeLimit: "12mb" } },
  maxDuration: 60,
};
