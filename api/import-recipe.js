// api/import-recipe.js
// Fonction serverless Vercel.
// Reçoit : POST { url } OU POST { text } (légende collée manuellement)
// Renvoie : { recipe: {...} } ou { needCaption: true } si la légende est introuvable.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// --- Extraction de la légende depuis la page publique Instagram / Facebook ---
async function fetchCaption(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        // User-Agent de navigateur classique : les pages publiques renvoient
        // alors les balises og: avec la légende du post.
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

    if (!description || description.length < 40) {
      // Légende absente ou tronquée (post privé, page de connexion, etc.)
      return null;
    }
    return { title, description };
  } catch {
    return null;
  }
}

// --- Analyse par Claude : légende -> recette structurée ---
async function parseWithClaude(rawText) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system:
        "Tu extrais des recettes de cuisine depuis des légendes de posts Instagram ou Facebook, souvent en français. " +
        "Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans balises markdown. " +
        'Format : {"name": string, "servings": string, "ingredients": [string], "steps": string, "isRecipe": boolean}. ' +
        "ingredients : un élément par ingrédient avec sa quantité si présente. " +
        "steps : les étapes de préparation, séparées par des retours à la ligne. " +
        "Si le texte ne contient pas de recette exploitable, renvoie isRecipe: false et laisse les autres champs vides. " +
        "N'invente aucun ingrédient ni aucune étape absente du texte.",
      messages: [{ role: "user", content: rawText }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error("Erreur API Claude : " + err.slice(0, 200));
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
    const { url, text } = req.body || {};
    let rawText = (text || "").trim();
    let sourceUrl = (url || "").trim();

    // Si on a reçu un lien, on tente de récupérer la légende publique
    if (!rawText && sourceUrl) {
      const caption = await fetchCaption(sourceUrl);
      if (!caption) {
        // Impossible de lire la légende -> l'appli demandera de la coller
        return res.status(200).json({ needCaption: true, sourceUrl });
      }
      rawText = [caption.title, caption.description].filter(Boolean).join("\n\n");
    }

    if (!rawText) {
      return res.status(400).json({ error: "Aucun texte ni lien fourni" });
    }

    const parsed = await parseWithClaude(rawText);

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
