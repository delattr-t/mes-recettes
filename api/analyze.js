// À placer dans : api/analyze.js  (à la racine du projet, PAS dans src/)
// Vercel expose automatiquement ce fichier sur /api/analyze

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "La variable d'environnement ANTHROPIC_API_KEY n'est pas configurée sur Vercel."
    });
  }

  const { imageBase64, mediaType } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: 'Image manquante' });
  }

  const consigne = `Cette image est une recette de cuisine (capture d'écran, photo de livre, page web…).
Extrais son contenu et réponds UNIQUEMENT avec cet objet JSON, sans texte avant ni après,
sans balises Markdown :

{
  "name": "nom de la recette",
  "servings": "nombre de personnes, uniquement le chiffre",
  "ingredients": ["un ingrédient par entrée, avec sa quantité"],
  "steps": "étapes de préparation rédigées, séparées par des retours à la ligne"
}

Si une information est absente de l'image, mets une chaîne vide ou un tableau vide.
N'invente aucun ingrédient et aucune étape.`;

  try {
    const reponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType || 'image/jpeg',
                  data: imageBase64
                }
              },
              { type: 'text', text: consigne }
            ]
          }
        ]
      })
    });

    const donnees = await reponse.json();

    if (!reponse.ok) {
      console.error('Erreur API Anthropic :', donnees);
      return res.status(reponse.status).json({
        error: donnees?.error?.message || "L'analyse a échoué côté API."
      });
    }

    // Récupérer le texte, quel que soit l'ordre des blocs renvoyés
    const texte = (donnees.content || [])
      .filter((bloc) => bloc.type === 'text')
      .map((bloc) => bloc.text)
      .join('\n')
      .replace(/```json\s*|```/g, '')
      .trim();

    // Isoler l'objet JSON même si le modèle a ajouté une phrase
    const debut = texte.indexOf('{');
    const fin = texte.lastIndexOf('}');
    if (debut === -1 || fin === -1) {
      console.error('Réponse inattendue :', texte);
      return res.status(502).json({ error: "La réponse ne contenait pas de recette exploitable." });
    }

    let recette;
    try {
      recette = JSON.parse(texte.slice(debut, fin + 1));
    } catch (e) {
      console.error('JSON illisible :', texte);
      return res.status(502).json({ error: "La recette extraite était illisible." });
    }

    return res.status(200).json({
      name: recette.name || '',
      servings: recette.servings || '',
      ingredients: Array.isArray(recette.ingredients) ? recette.ingredients : [],
      steps: recette.steps || ''
    });
  } catch (erreur) {
    console.error('Erreur serveur :', erreur);
    return res.status(500).json({ error: "Le serveur n'a pas pu joindre l'API." });
  }
}
