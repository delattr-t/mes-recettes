// À placer dans : api/analyze-video.js  (à côté de analyze.js)
// Reçoit plusieurs images extraites d'un Reel et en reconstitue une recette.

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

  const { frames, description } = req.body || {};
  if (!Array.isArray(frames) || frames.length === 0) {
    return res.status(400).json({ error: 'Aucune image reçue' });
  }

  // Les images arrivent déjà en JPEG compressé depuis le navigateur
  const blocsImages = frames.slice(0, 8).map((data, i) => ([
    { type: 'text', text: `— Image ${i + 1} —` },
    {
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data }
    }
  ])).flat();

  const consigne = `Ces images sont des arrêts sur image d'une même vidéo de recette (un Reel),
pris dans l'ordre chronologique. Le texte incrusté à l'écran change d'une image à l'autre :
il contient généralement la liste des ingrédients au début, puis les étapes au fil de la vidéo.

${description ? `Voici en complément la description publiée sous la vidéo :\n"""\n${description}\n"""\n` : ''}
Reconstitue la recette complète en croisant toutes les sources.
Fusionne les informations répétées d'une image à l'autre : ne liste pas deux fois le même ingrédient.
Rédige les étapes dans l'ordre, en phrases complètes.

Réponds UNIQUEMENT avec cet objet JSON, sans texte avant ni après, sans balises Markdown :

{
  "name": "nom de la recette",
  "servings": "nombre de personnes, uniquement le chiffre",
  "ingredients": ["un ingrédient par entrée, avec sa quantité"],
  "steps": "étapes rédigées, séparées par des retours à la ligne"
}

Si une information n'apparaît nulle part, mets une chaîne vide ou un tableau vide.
N'invente aucun ingrédient et aucune étape qui ne soit pas visible ou écrit.`;

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
        max_tokens: 3000,
        messages: [
          { role: 'user', content: [...blocsImages, { type: 'text', text: consigne }] }
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

    const texte = (donnees.content || [])
      .filter((bloc) => bloc.type === 'text')
      .map((bloc) => bloc.text)
      .join('\n')
      .replace(/```json\s*|```/g, '')
      .trim();

    const debut = texte.indexOf('{');
    const fin = texte.lastIndexOf('}');
    if (debut === -1 || fin === -1) {
      console.error('Réponse inattendue :', texte);
      return res.status(502).json({
        error: "Aucune recette n'a pu être lue dans cette vidéo."
      });
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
