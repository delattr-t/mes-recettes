// useShareImport.js
// Hook à ajouter dans src/ puis à brancher dans App.js.
//
// Il gère les deux chemins :
//  - ANDROID : l'appli reçoit le partage Instagram/Facebook via share_target
//    (les infos arrivent dans l'URL : ?url=... ou ?text=...)
//  - IPHONE : l'utilisateur colle un lien (ou une légende) via importFromInput()
//
// Statuts renvoyés : "idle" | "loading" | "done" | "needCaption" | "error"

import { useState, useEffect, useCallback } from "react";

// Trouve un lien Instagram/Facebook dans un texte partagé
function extractLink(text) {
  if (!text) return null;
  const m = text.match(
    /https?:\/\/(?:www\.)?(?:instagram\.com|facebook\.com|fb\.watch)\/\S+/i
  );
  return m ? m[0] : null;
}

export default function useShareImport(onRecipeReady) {
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [pendingUrl, setPendingUrl] = useState(null);

  const callApi = useCallback(
    async (payload) => {
      setStatus("loading");
      setError(null);
      try {
        const res = await fetch("/api/import-recipe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (data.recipe) {
          setStatus("done");
          onRecipeReady(data.recipe); // -> pré-remplit le formulaire de l'appli
        } else if (data.needCaption) {
          // La légende n'a pas pu être lue automatiquement :
          // l'appli doit afficher un champ "Collez la légende du post"
          setPendingUrl(data.sourceUrl || payload.url || null);
          setStatus("needCaption");
        } else {
          throw new Error(data.error || "Réponse inattendue");
        }
      } catch (e) {
        setError(e.message);
        setStatus("error");
      }
    },
    [onRecipeReady]
  );

  // --- Chemin ANDROID : partage reçu via share_target ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedUrl = params.get("url");
    const sharedText = params.get("text");
    // Instagram met souvent le lien dans "text" plutôt que "url"
    const link = sharedUrl || extractLink(sharedText);

    if (link || (sharedText && sharedText.length > 60)) {
      // Nettoie l'URL du navigateur pour éviter un ré-import au refresh
      window.history.replaceState({}, "", window.location.pathname);
      if (link) {
        callApi({ url: link });
      } else {
        callApi({ text: sharedText });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Chemin IPHONE / manuel : lien ou légende collés dans l'appli ---
  const importFromInput = useCallback(
    (input) => {
      const link = extractLink(input);
      if (link && input.trim() === link) {
        callApi({ url: link });
      } else {
        // Texte collé = légende (avec ou sans lien dedans)
        callApi({ text: input, url: link || undefined });
      }
    },
    [callApi]
  );

  // À utiliser quand l'appli est en statut "needCaption" et que
  // l'utilisateur colle la légende
  const submitCaption = useCallback(
    (caption) => {
      callApi({ text: caption, url: pendingUrl || undefined });
    },
    [callApi, pendingUrl]
  );

  return { status, error, pendingUrl, importFromInput, submitCaption };
}
