// api/import-recipe.js
// Fonction serverless Vercel.
// Reçoit l'un de :
//   POST { url }              -> lit la légende publique du post
//   POST { text }             -> analyse une légende collée
//   POST { images: [b64...] } -> analyse des images (frames de vidéo) par vision
// Renvoie : { recipe: {...} } ou { needCaption: true } si rien d'exploitable.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Modèle utilisé. Si vous obtenez une erreur "model not found",
// changez cette valeur (ex: "claude-sonnet-4-6").
const MODEL = "claude-sonnet-5";

// Consigne commune donnée au modèle pour structurer la recette
const SYSTEM_PROMPT =
  "Tu extrais des recettes de cuisine, souvent en français, depuis des posts " +
  "Instagram/Facebook ou depuis des images (captures d'une vidéo de recette). " +
  "Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans balises markdown. " +
  'Format : {"name": string, "servings": string, "ingredients": [string], "steps": string, "isRecipe": boolean}. ' +
  "ingredients : un élément par ingrédient, avec sa quantité si elle est visible. " +
  "steps : les étapes de préparation, séparées par des retours à la ligne, numérotées si possible. " +
  "Lis attentivement TOUT le texte affiché à l'écran sur les images (surimpressions, listes). " +
  "Combine les informations de toutes les images pour reconstituer une seule recette cohérente. " +
  "Si aucune recette n'est exploitable, renvoie isRecipe: false et laisse les autres champs vides. " +
  "N'invente aucun ingrédient ni aucune étape absente du contenu fourni.";

// --- Extraction de la légende depuis la page publique Instagram / Facebook ---
async function fetchCaption(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "fr-FR,fr;q=0.9",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();

    const meta = (prop) => {
      const a = html.match(
        new RegExp(
          `<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']*)["']`,
          "i"
        )
      );
      const b = html.match(
        new RegExp(
          `<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${prop}["']`,
          "i"
        )
      );
      return (a && a[1]) || (b && b[1]) || null;
    };

    const decode = (s) =>
      s
        ? s
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        : null;

    const description = decode(meta("og:description"));
    const title = decode(meta("og:title"));

    if (!description || description.length < 40) return null;
    return { title, description };
  } catch {
    return null;
  }
}

// --- Appel à Claude (texte ou vision) ---
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

  const data = await response.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST uniquement" });
  }
  if (!ANTHROPIC_API_KEY) {
    return res
      .status(500)
      .json({ error: "ANTHROPIC_API_KEY manquante dans les variables Vercel" });
  }

  try {
    const { url, text, images } = req.body || {};

    // --- Cas 1 : images (frames de vidéo) -> vision ---
    if (Array.isArray(images) && images.length > 0) {
      const content = [];
      for (const b64 of images.slice(0, 12)) {
        // On accepte soit une dataURL, soit du base64 brut
        const data = b64.includes(",") ? b64.split(",")[1] : b64;
        content.push({
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data },
        });
      }
      content.push({
        type: "text",
        text:
          "Voici des images extraites d'une vidéo de recette. " +
          "Reconstitue la recette complète à partir de ce qui est visible et écrit à l'écran.",
      });

      const parsed = await callClaude(content);
      if (!parsed.isRecipe) {
        return res.status(200).json({ needCaption: true, noRecipeInVideo: true });
      }
      return res.status(200).json({
        recipe: {
          name: parsed.name || "",
          servings: parsed.servings || "",
          ingredients: parsed.ingredients || [],
          steps: parsed.steps || "",
          sourceUrl: url || "",
        },
      });
    }

    // --- Cas 2 : texte / lien ---
    let rawText = (text || "").trim();
    let sourceUrl = (url || "").trim();

    if (!rawText && sourceUrl) {
      const caption = await fetchCaption(sourceUrl);
      if (!caption) {
        return res.status(200).json({ needCaption: true, sourceUrl });
      }
      rawText = [caption.title, caption.description].filter(Boolean).join("\n\n");
    }

    if (!rawText) {
      return res.status(400).json({ error: "Aucune donnée fournie (lien, texte ou images)" });
    }

    const parsed = await callClaude(rawText);
    if (!parsed.isRecipe) {
      return res.status(200).json({ needCaption: true, sourceUrl });
    }

    return res.status(200).json({
      recipe: {
        name: parsed.name || "",
        servings: parsed.servings || "",
        ingredients: parsed.ingredients || [],
        steps: parsed.steps || "",
        sourceUrl,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// Autorise un corps de requête plus gros (images encodées en base64)
export const config = {
  api: {
    bodyParser: { sizeLimit: "10mb" },
  },
};
