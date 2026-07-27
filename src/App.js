import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Search, ChefHat, Trash2, Edit2, Cloud, CloudOff, LogOut, LogIn, ShoppingCart, Download, X } from 'lucide-react';
import { database, auth, googleProvider } from './firebaseConfig';
import { ref, set, onValue, remove } from 'firebase/database';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';

// ===== Extraction d'images depuis une vidéo (côté navigateur) =====
// Se positionne à plusieurs instants de la vidéo et capture chaque image
// dans un canvas, renvoyée en JPEG base64. Aucune donnée n'est envoyée
// à Instagram : tout se passe sur le téléphone.
function seekTo(video, time) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', finish);
      resolve();
    };
    video.addEventListener('seeked', finish);
    // Filet de sécurité si l'événement 'seeked' ne se déclenche pas
    setTimeout(finish, 2500);
    try { video.currentTime = time; } catch { finish(); }
  });
}

function extractFramesFromVideo(file, frameCount = 8) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.src = url;

    const fail = (msg) => {
      URL.revokeObjectURL(url);
      reject(new Error(msg));
    };

    video.onerror = () => fail("Impossible de lire cette vidéo sur le téléphone.");

    video.onloadedmetadata = async () => {
      try {
        const duration = video.duration || 0;
        if (!duration || !isFinite(duration)) {
          return fail("Durée de la vidéo introuvable.");
        }
        const maxW = 768;
        const scale = Math.min(1, maxW / (video.videoWidth || maxW));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round((video.videoWidth || maxW) * scale);
        canvas.height = Math.round((video.videoHeight || maxW) * scale);
        const ctx = canvas.getContext('2d');

        const frames = [];
        for (let i = 0; i < frameCount; i++) {
          // Instants répartis sur la durée (on évite le tout début / la toute fin)
          const t = (duration * (i + 0.5)) / frameCount;
          await seekTo(video, t);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          frames.push(dataUrl.split(',')[1]);
        }
        URL.revokeObjectURL(url);
        resolve(frames);
      } catch (e) {
        fail("Erreur pendant l'extraction des images : " + e.message);
      }
    };
  });
}
// ===== Fin extraction vidéo =====

export default function RecipeManager() {
  // Configuration des teams
  const TEAMS = {
    'papa-maman': { name: 'Papa & Maman', color: '#3B82F6' },
    'camille-maxime': { name: 'Camille & Maxime', color: '#10B981' },
    'florent-maniola': { name: 'Florent & Maniola', color: '#F59E0B' },
    'thibaut-mathilde': { name: 'Thibaut & Mathilde', color: '#8B5CF6' }
  };

  // Email de l'administrateur
  const ADMIN_EMAIL = 'votre-email@gmail.com'; // À MODIFIER avec votre vrai email

  const [recipes, setRecipes] = useState([]);
  const [currentView, setCurrentView] = useState('home');
  const [editingRecipe, setEditingRecipe] = useState(null);
  const [viewingRecipe, setViewingRecipe] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterTeam, setFilterTeam] = useState(''); // Nouveau filtre team
  const [gridView, setGridView] = useState('single');
  const [syncStatus, setSyncStatus] = useState('connecting');
  const [user, setUser] = useState(null);
  const [userTeam, setUserTeam] = useState(null); // Team de l'utilisateur
  const [isAdmin, setIsAdmin] = useState(false); // Si l'utilisateur est admin
  const [showTeamSelector, setShowTeamSelector] = useState(false); // Afficher le sélecteur de team
  const [allUsers, setAllUsers] = useState({}); // Tous les utilisateurs pour l'admin
  const [shoppingMode, setShoppingMode] = useState(false);
  const [selectedRecipes, setSelectedRecipes] = useState([]);
  const [shoppingList, setShoppingList] = useState(null);
  const [editableShoppingList, setEditableShoppingList] = useState('');
  const [checkedLines, setCheckedLines] = useState([]);
  
  const [newRecipe, setNewRecipe] = useState({
    name: '',
    servings: '',
    types: [],
    ingredients: '',
    steps: '',
    image: '',
    tested: false
  });

  // ===== Import de recettes depuis Instagram / Facebook =====
  // importStatus : 'idle' | 'loading' | 'needCaption' | 'error'
  const [importStatus, setImportStatus] = useState('idle');
  const [importError, setImportError] = useState(null);
  const [importPendingUrl, setImportPendingUrl] = useState(null);
  const [captionInput, setCaptionInput] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const videoInputRef = useRef(null);

  // Trouve un lien Instagram / Facebook dans un texte partagé
  const extractLink = (text) => {
    if (!text) return null;
    const m = text.match(
      /https?:\/\/(?:www\.)?(?:instagram\.com|facebook\.com|fb\.watch)\/\S+/i
    );
    return m ? m[0] : null;
  };

  // Pré-remplit le formulaire "Nouvelle recette" avec la recette analysée
  const fillFormWithRecipe = useCallback((recipe) => {
    setEditingRecipe(null);
    setNewRecipe({
      name: recipe.name || '',
      servings: recipe.servings || '',
      types: [],
      ingredients: Array.isArray(recipe.ingredients)
        ? recipe.ingredients.join('\n')
        : (recipe.ingredients || ''),
      steps: recipe.steps || '',
      image: '',
      tested: false
    });
    setCurrentView('add');
  }, []);

  // Appelle la fonction serverless /api/import-recipe
  const callImportApi = useCallback(async (payload) => {
    setImportStatus('loading');
    setImportError(null);
    try {
      const res = await fetch('/api/import-recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      // On lit d'abord en texte brut pour diagnostiquer les réponses non-JSON
      const raw = await res.text();

      if (!raw) {
        throw new Error(
          "Le serveur a répondu sans contenu (statut " + res.status + "). " +
          "La fonction /api/import-recipe est peut-être absente ou en erreur. " +
          "Vérifiez qu'elle est bien déployée et que la clé API est configurée sur Vercel."
        );
      }

      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        // Réponse non-JSON (page 404 HTML de Vercel, message d'erreur brut, etc.)
        const apercu = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
        throw new Error(
          "Réponse inattendue du serveur (statut " + res.status + ") : " + apercu
        );
      }

      if (!res.ok) {
        throw new Error(data.error || ("Erreur serveur (statut " + res.status + ")"));
      }

      if (data.recipe) {
        setImportStatus('idle');
        setCaptionInput('');
        fillFormWithRecipe(data.recipe);
      } else if (data.needCaption) {
        setImportPendingUrl(data.sourceUrl || payload.url || null);
        setImportStatus('needCaption');
      } else {
        throw new Error(data.error || 'Réponse inattendue du serveur');
      }
    } catch (e) {
      setImportError(e.message);
      setImportStatus('error');
    }
  }, [fillFormWithRecipe]);

  // Analyse une vidéo : extrait les images puis les envoie à l'IA vision
  const importFromVideo = useCallback(async (file) => {
    if (!file) return;
    setImportStatus('loading');
    setImportMessage('Extraction des images de la vidéo…');
    setImportError(null);
    try {
      const frames = await extractFramesFromVideo(file, 8);
      if (!frames.length) throw new Error("Aucune image n'a pu être extraite.");
      setImportMessage("Analyse de la recette par l'IA…");
      await callImportApi({ images: frames });
    } catch (e) {
      setImportError(e.message);
      setImportStatus('error');
    } finally {
      setImportMessage('');
    }
  }, [callImportApi]);

  // Lancé quand l'utilisateur colle un lien ou une légende (iPhone / manuel)
  const importFromInput = useCallback((input) => {
    if (!input || !input.trim()) return;
    const link = extractLink(input);
    if (link && input.trim() === link) {
      callImportApi({ url: link });
    } else {
      callImportApi({ text: input, url: link || undefined });
    }
  }, [callImportApi]);

  // Chemin Android : partage reçu (vidéo depuis la galerie, ou lien/texte)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // 1) Vidéo partagée depuis la galerie (via le service worker)
    if (params.get('shared') === 'video') {
      window.history.replaceState({}, '', window.location.pathname);
      (async () => {
        try {
          const cache = await caches.open('shared-media');
          const resp = await cache.match('/shared-video');
          if (resp) {
            const blob = await resp.blob();
            await cache.delete('/shared-video');
            const file = new File([blob], 'partage.mp4', {
              type: blob.type || 'video/mp4',
            });
            importFromVideo(file);
          }
        } catch (e) {
          setImportError("Vidéo partagée introuvable : " + e.message);
          setImportStatus('error');
        }
      })();
      return;
    }

    // 2) Lien ou texte partagé
    const sharedUrl = params.get('url');
    const sharedText = params.get('text');
    const link = sharedUrl || extractLink(sharedText);
    if (link || (sharedText && sharedText.length > 60)) {
      window.history.replaceState({}, '', window.location.pathname);
      if (link) {
        callImportApi({ url: link });
      } else {
        callImportApi({ text: sharedText });
      }
    }
  }, [callImportApi, importFromVideo]);
  // Enregistre le service worker qui reçoit les vidéos partagées (Android)
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/share-sw.js').catch(() => {
        // Sans service worker, le partage de vidéo depuis la galerie ne
        // fonctionnera pas, mais le bouton "Choisir une vidéo" reste opérationnel.
      });
    }
  }, []);
  // ===== Fin import Instagram / Facebook =====

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      if (currentUser) {
        // Vérifier si l'utilisateur est admin
        const adminCheck = currentUser.email === ADMIN_EMAIL;
        setIsAdmin(adminCheck);
        
        // Charger les données de l'utilisateur
        const userRef = ref(database, `users/${currentUser.email.replace(/\./g, '_')}`);
        
        try {
          const snapshot = await new Promise((resolve, reject) => {
            onValue(userRef, resolve, reject, { onlyOnce: true });
          });
          
          const userData = snapshot.val();
          
          if (userData && userData.teamId) {
            // Vérifier si l'utilisateur est révoqué
            if (userData.isRevoked) {
              alert('Votre accès a été révoqué. Contactez l\'administrateur.');
              signOut(auth);
              return;
            }
            
            setUserTeam(userData.teamId);
            setShowTeamSelector(false);
          } else {
            // Utilisateur non enregistré ou sans team, afficher le sélecteur
            console.log('Nouvel utilisateur détecté, affichage du sélecteur de team');
            setUserTeam(null);
            setShowTeamSelector(true);
          }
        } catch (error) {
          console.error('Erreur lors du chargement des données utilisateur:', error);
          // En cas d'erreur, afficher le sélecteur par sécurité
          setShowTeamSelector(true);
        }
        
        // Si admin, charger tous les utilisateurs
        if (adminCheck) {
          const usersRef = ref(database, 'users');
          onValue(usersRef, (snapshot) => {
            const usersData = snapshot.val();
            console.log('Données utilisateurs chargées:', usersData);
            setAllUsers(usersData || {});
          });
        }
      } else {
        setUserTeam(null);
        setIsAdmin(false);
        setShowTeamSelector(false);
      }
    });

    const recipesRef = ref(database, 'recipes');
    
    const unsubscribeData = onValue(recipesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const recipesArray = Object.values(data).map(recipe => {
          // Si la recette n'a pas de teamId, lui assigner "thibaut-mathilde" par défaut
          if (!recipe.teamId) {
            return { ...recipe, teamId: 'thibaut-mathilde' };
          }
          return recipe;
        });
        setRecipes(recipesArray);
        setSyncStatus('synced');
      } else {
        setRecipes([]);
        setSyncStatus('synced');
      }
    }, (error) => {
      console.error('Erreur Firebase:', error);
      setSyncStatus('error');
    });

    return () => {
      unsubscribeAuth();
      unsubscribeData();
    };
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Erreur de connexion:', error);
      alert('Erreur lors de la connexion');
    }
  };

  const handleTeamSelection = async (teamId) => {
    if (!user) {
      console.error('Pas d\'utilisateur connecté');
      return;
    }
    
    console.log('Sélection de team pour:', user.email, '→', teamId);
    
    try {
      setSyncStatus('syncing');
      
      // Formater l'email pour Firebase (remplacer . par _)
      const userKey = user.email.replace(/\./g, '_');
      console.log('Clé utilisateur:', userKey);
      
      const userData = {
        email: user.email,
        teamId: teamId,
        name: user.displayName || user.email.split('@')[0],
        isRevoked: false,
        joinedAt: new Date().toISOString()
      };
      
      console.log('Données à enregistrer:', userData);
      
      const userRef = ref(database, `users/${userKey}`);
      await set(userRef, userData);
      
      console.log('✅ Team sélectionnée avec succès !');
      
      setUserTeam(teamId);
      setShowTeamSelector(false);
      setSyncStatus('synced');
      
      alert(`Bienvenue dans ${TEAMS[teamId].name} ! 🎉`);
    } catch (error) {
      console.error('❌ Erreur lors de la sélection de team:', error);
      console.error('Détails de l\'erreur:', error.message);
      alert(`Erreur lors de la sélection de votre famille: ${error.message}`);
      setSyncStatus('error');
    }
  };

  const handleRevokeUser = async (userEmail) => {
    if (!window.confirm(`Êtes-vous sûr de vouloir révoquer l'accès de ${userEmail} ?`)) return;
    
    try {
      setSyncStatus('syncing');
      const userRef = ref(database, `users/${userEmail.replace(/\./g, '_')}`);
      const userData = allUsers[userEmail.replace(/\./g, '_')];
      await set(userRef, { ...userData, isRevoked: true });
      setSyncStatus('synced');
      alert('Utilisateur révoqué avec succès');
    } catch (error) {
      console.error('Erreur lors de la révocation:', error);
      alert('Erreur lors de la révocation');
      setSyncStatus('error');
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Erreur de déconnexion:', error);
    }
  };

  const saveRecipe = async () => {
    if (!user) {
      alert('Veuillez vous connecter pour ajouter une recette');
      return;
    }

    if (!userTeam) {
      alert('Veuillez sélectionner votre famille d\'abord');
      return;
    }

    if (!newRecipe.name.trim()) {
      alert('Veuillez entrer un nom pour la recette');
      return;
    }

    const recipe = {
      id: editingRecipe?.id || Date.now().toString(),
      name: newRecipe.name,
      servings: newRecipe.servings,
      types: newRecipe.types,
      ingredients: newRecipe.ingredients.split('\n').filter(i => i.trim()),
      steps: newRecipe.steps,
      image: newRecipe.image,
      tested: newRecipe.tested || false,
      teamId: userTeam, // Ajouter automatiquement le teamId de l'utilisateur
      createdAt: editingRecipe?.createdAt || new Date().toISOString(),
      createdBy: user.email
    };

    try {
      setSyncStatus('syncing');
      const recipeRef = ref(database, `recipes/${recipe.id}`);
      await set(recipeRef, recipe);
      setSyncStatus('synced');
      resetForm();
      setCurrentView('home');
    } catch (error) {
      console.error('Erreur lors de la sauvegarde:', error);
      alert('Erreur lors de la sauvegarde de la recette');
      setSyncStatus('error');
    }
  };

  const deleteRecipe = async (id) => {
    if (!user) {
      alert('Veuillez vous connecter pour supprimer une recette');
      return;
    }

    if (!window.confirm('Êtes-vous sûr de vouloir supprimer cette recette ?')) return;

    try {
      setSyncStatus('syncing');
      const recipeRef = ref(database, `recipes/${id}`);
      await remove(recipeRef);
      setSyncStatus('synced');
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
      setSyncStatus('error');
    }
  };

  const editRecipe = (recipe) => {
    if (!user) {
      alert('Veuillez vous connecter pour modifier une recette');
      return;
    }
    setEditingRecipe(recipe);
    setNewRecipe({
      name: recipe.name,
      servings: recipe.servings || '',
      types: recipe.types || [],
      ingredients: recipe.ingredients.join('\n'),
      steps: recipe.steps,
      image: recipe.image || '',
      tested: recipe.tested || false
    });
    setViewingRecipe(null);
    setCurrentView('add');
  };

  const viewRecipe = (recipe) => {
    setViewingRecipe(recipe);
    setCurrentView('view');
  };

  const resetForm = () => {
    setNewRecipe({ name: '', servings: '', types: [], ingredients: '', steps: '', image: '', tested: false });
    setEditingRecipe(null);
  };

  const toggleType = (type) => {
    if (newRecipe.types.includes(type)) {
      setNewRecipe({ ...newRecipe, types: newRecipe.types.filter(t => t !== type) });
    } else {
      setNewRecipe({ ...newRecipe, types: [...newRecipe.types, type] });
    }
  };

  const toggleRecipeSelection = (recipeId) => {
    if (selectedRecipes.includes(recipeId)) {
      setSelectedRecipes(selectedRecipes.filter(id => id !== recipeId));
    } else {
      setSelectedRecipes([...selectedRecipes, recipeId]);
    }
  };

  const startShoppingMode = () => {
    setShoppingMode(true);
    setSelectedRecipes([]);
    setCurrentView('home');
  };

  const generateShoppingList = () => {
    if (selectedRecipes.length === 0) {
      alert('Veuillez sélectionner au moins une recette');
      return;
    }

    const selectedRecipesData = recipes.filter(r => selectedRecipes.includes(r.id));
    
    // Parser et regrouper les ingrédients
    const ingredientMap = new Map();
    
    selectedRecipesData.forEach(recipe => {
      (recipe.ingredients || []).forEach(ing => {
        const parsed = parseIngredient(ing);
        const key = parsed.name.toLowerCase();
        
        if (ingredientMap.has(key)) {
          const existing = ingredientMap.get(key);
          existing.quantity += parsed.quantity;
          existing.recipes.push(recipe.name);
        } else {
          ingredientMap.set(key, {
            name: parsed.name,
            quantity: parsed.quantity,
            unit: parsed.unit,
            recipes: [recipe.name],
            originalText: ing
          });
        }
      });
    });
    
    // Créer la liste formatée SANS les noms de recettes
    const allIngredientsSimple = Array.from(ingredientMap.values()).map(item => {
      let text = '• ';
      if (item.quantity > 0) {
        text += `${item.quantity}`;
        if (item.unit) text += item.unit;
        text += ' ';
      }
      text += item.name;
      return text;
    });
    
    // Créer la liste avec recettes pour référence interne
    const allIngredientsWithRecipes = Array.from(ingredientMap.values()).map(item => {
      let text = '• ';
      if (item.quantity > 0) {
        text += `${item.quantity}`;
        if (item.unit) text += item.unit;
        text += ' ';
      }
      text += item.name;
      text += ` (${item.recipes.join(', ')})`;
      return text;
    });
    
    const listText = allIngredientsSimple.join('\n');
    setEditableShoppingList(listText);
    setCheckedLines([]);
    setShoppingList({
      recipes: selectedRecipesData,
      ingredients: allIngredientsSimple,
      ingredientsWithRecipes: allIngredientsWithRecipes
    });
    setCurrentView('shopping');
    setShoppingMode(false);
  };

  // Fonction pour compresser et redimensionner une image
  const compressImage = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
          // Définir la taille maximale
          const MAX_WIDTH = 1200;
          const MAX_HEIGHT = 1200;
          
          let width = img.width;
          let height = img.height;
          
          // Calculer les nouvelles dimensions en conservant le ratio
          if (width > height) {
            if (width > MAX_WIDTH) {
              height = height * (MAX_WIDTH / width);
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width = width * (MAX_HEIGHT / height);
              height = MAX_HEIGHT;
            }
          }
          
          // Créer un canvas pour redimensionner
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          
          // Convertir en base64 avec compression (qualité 0.8 = 80%)
          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8);
          
          // Vérifier la taille finale
          const sizeInMB = (compressedBase64.length * 0.75) / (1024 * 1024);
          console.log(`Image compressée : ${sizeInMB.toFixed(2)} MB`);
          
          if (sizeInMB > 2) {
            // Si encore trop grosse, réduire davantage la qualité
            const extraCompressed = canvas.toDataURL('image/jpeg', 0.6);
            resolve(extraCompressed);
          } else {
            resolve(compressedBase64);
          }
        };
        img.onerror = reject;
      };
      reader.onerror = reject;
    });
  };

  // Fonction pour parser un ingrédient et extraire quantité, unité et nom
  const parseIngredient = (ingredient) => {
    // Nettoyer l'ingrédient
    const cleaned = ingredient.trim();
    
    // Regex pour capturer: quantité (nombre ou fraction) + unité optionnelle + nom
    const patterns = [
      // Ex: "200g de farine", "2 kg de tomates"
      /^(\d+(?:[.,]\d+)?)\s*([a-zµ]+)?\s+(?:de?\s+)?(.+)$/i,
      // Ex: "1/2 tasse de sucre"
      /^(\d+\/\d+)\s*([a-zµ]+)?\s+(?:de?\s+)?(.+)$/i,
      // Ex: "2 courgettes"
      /^(\d+(?:[.,]\d+)?)\s+(.+)$/i,
    ];
    
    for (const pattern of patterns) {
      const match = cleaned.match(pattern);
      if (match) {
        let quantity = match[1];
        
        // Convertir les fractions en décimales
        if (quantity.includes('/')) {
          const [num, den] = quantity.split('/').map(Number);
          quantity = num / den;
        } else {
          quantity = parseFloat(quantity.replace(',', '.'));
        }
        
        // Si pattern avec 3 groupes (quantité, unité, nom)
        if (match.length === 4) {
          return {
            quantity: quantity,
            unit: match[2] || '',
            name: match[3].trim()
          };
        }
        // Si pattern avec 2 groupes (quantité, nom)
        else {
          return {
            quantity: quantity,
            unit: '',
            name: match[2].trim()
          };
        }
      }
    }
    
    // Si aucun pattern ne correspond, retourner l'ingrédient tel quel
    return {
      quantity: 0,
      unit: '',
      name: cleaned
    };
  };

  const filteredRecipes = recipes.filter(recipe => {
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const matchesName = recipe.name.toLowerCase().includes(query);
      const matchesIngredients = recipe.ingredients && recipe.ingredients.some(ing => 
        ing.toLowerCase().includes(query)
      );
      if (!matchesName && !matchesIngredients) return false;
    }
    
    if (filterType && recipe.types && recipe.types.length > 0) {
      if (!recipe.types.includes(filterType)) return false;
    }
    
    // Filtre par team
    if (filterTeam && recipe.teamId !== filterTeam) {
      return false;
    }
    
    return true;
  });

  const SyncIndicator = () => {
    const statusConfig = {
      'connecting': { icon: Cloud, color: 'text-gray-400', text: 'Connexion...' },
      'syncing': { icon: Cloud, color: 'text-blue-500', text: 'Synchronisation...' },
      'synced': { icon: Cloud, color: 'text-green-500', text: 'Synchronisé ✓' },
      'error': { icon: CloudOff, color: 'text-red-500', text: 'Erreur de connexion' }
    };

    const config = statusConfig[syncStatus] || statusConfig.connecting;
    const Icon = config.icon;

    return (
      <div className={`flex items-center gap-2 ${config.color} text-sm`}>
        <Icon className="w-4 h-4" />
        <span>{config.text}</span>
      </div>
    );
  };

  if (showTeamSelector && user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
          <div className="text-center mb-8">
            <ChefHat className="w-16 h-16 text-orange-600 mx-auto mb-4" />
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Bienvenue !</h1>
            <p className="text-gray-600">À quelle famille appartenez-vous ?</p>
          </div>

          <div className="space-y-3">
            {Object.entries(TEAMS).map(([teamId, team]) => (
              <button
                key={teamId}
                onClick={() => handleTeamSelection(teamId)}
                className="w-full p-4 border-2 border-gray-200 rounded-xl hover:border-orange-500 hover:bg-orange-50 transition-all text-left font-semibold text-gray-800"
                style={{ borderLeftWidth: '6px', borderLeftColor: team.color }}
              >
                {team.name}
              </button>
            ))}
          </div>

          <button
            onClick={handleLogout}
            className="mt-6 w-full text-gray-500 hover:text-gray-700 text-sm"
          >
            Se déconnecter
          </button>
        </div>
      </div>
    );
  }

  if (currentView === 'home') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50">
        {/* Overlay d'import Instagram / Facebook */}
        {importStatus !== 'idle' && (
          <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
              {importStatus === 'loading' && (
                <div className="text-center py-4">
                  <div className="w-12 h-12 border-4 border-pink-200 border-t-pink-600 rounded-full animate-spin mx-auto mb-4"></div>
                  <p className="text-lg font-semibold text-gray-800">
                    {importMessage || 'Analyse de la recette…'}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">Cela prend quelques secondes</p>
                </div>
              )}

              {importStatus === 'needCaption' && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-bold text-gray-800">Recette non détectée</h3>
                    <button
                      onClick={() => { setImportStatus('idle'); setCaptionInput(''); }}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <p className="text-sm text-gray-600 mb-3">
                    L'IA n'a pas trouvé de recette lisible (peu de texte à l'écran dans
                    la vidéo, ou post privé). Vous pouvez coller ici la légende ou la
                    recette écrite :
                  </p>
                  <textarea
                    value={captionInput}
                    onChange={(e) => setCaptionInput(e.target.value)}
                    rows={6}
                    placeholder="Collez ici la légende du post…"
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-pink-500 focus:outline-none resize-none"
                  />
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => { setImportStatus('idle'); setCaptionInput(''); }}
                      className="flex-1 bg-gray-200 text-gray-700 px-4 py-2 rounded-xl hover:bg-gray-300 font-semibold"
                    >
                      Annuler
                    </button>
                    <button
                      onClick={() => callImportApi({ text: captionInput, url: importPendingUrl || undefined })}
                      disabled={!captionInput.trim()}
                      className="flex-1 bg-pink-600 text-white px-4 py-2 rounded-xl hover:bg-pink-700 font-semibold disabled:opacity-40"
                    >
                      Analyser
                    </button>
                  </div>
                </div>
              )}

              {importStatus === 'error' && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-bold text-red-600">Erreur</h3>
                    <button
                      onClick={() => setImportStatus('idle')}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <p className="text-sm text-gray-600 mb-4">{importError}</p>
                  <button
                    onClick={() => setImportStatus('idle')}
                    className="w-full bg-gray-200 text-gray-700 px-4 py-2 rounded-xl hover:bg-gray-300 font-semibold"
                  >
                    Fermer
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="max-w-6xl mx-auto p-6">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="mb-8">
              <div className="flex items-center justify-center gap-3 mb-4">
                <ChefHat className="w-10 h-10 text-orange-600" />
                <div className="text-center">
                  <h1 className="text-3xl font-bold text-gray-800">Mes Recettes</h1>
                  <SyncIndicator />
                </div>
              </div>
              
              <div className="flex flex-col gap-3 max-w-md mx-auto">
                {user ? (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
                    <p className="text-sm text-gray-600">Connecté en tant que</p>
                    <p className="text-sm font-semibold text-gray-800">{user.email}</p>
                    <button
                      onClick={handleLogout}
                      className="mt-2 w-full flex items-center justify-center gap-2 bg-gray-600 text-white px-4 py-2 rounded-xl hover:bg-gray-700 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      Se déconnecter
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleLogin}
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl hover:bg-blue-700 transition-colors shadow-lg"
                  >
                    <LogIn className="w-5 h-5" />
                    Se connecter
                  </button>
                )}
              </div>
            </div>

            {/* Boutons Flottants */}
            {user && !shoppingMode && (
              <button
                onClick={() => setCurrentView('add')}
                className="fixed bottom-6 right-6 bg-orange-600 text-white p-4 rounded-full hover:bg-orange-700 transition-all shadow-2xl hover:scale-110 z-50"
                title="Ajouter une recette"
              >
                <Plus className="w-7 h-7" />
              </button>
            )}

            {user && !shoppingMode && (
              <>
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) importFromVideo(file);
                    e.target.value = ''; // permet de re-sélectionner la même vidéo
                  }}
                />
                <button
                  onClick={() => videoInputRef.current?.click()}
                  className="fixed bottom-24 right-6 bg-pink-600 text-white p-4 rounded-full hover:bg-pink-700 transition-all shadow-2xl hover:scale-110 z-50"
                  title="Importer une vidéo de recette"
                >
                  <Download className="w-7 h-7" />
                </button>
              </>
            )}

            {!shoppingMode && (
              <button
                onClick={startShoppingMode}
                className="fixed bottom-6 right-24 bg-green-600 text-white p-4 rounded-full hover:bg-green-700 transition-all shadow-2xl hover:scale-110 z-50"
                title="Liste de courses"
              >
                <ShoppingCart className="w-7 h-7" />
              </button>
            )}

            {isAdmin && !shoppingMode && (
              <button
                onClick={() => setCurrentView('admin')}
                className="fixed bottom-6 left-6 bg-purple-600 text-white p-4 rounded-full hover:bg-purple-700 transition-all shadow-2xl hover:scale-110 z-50"
                title="Administration"
              >
                ⚙️
              </button>
            )}

            {shoppingMode && (
              <div className="mb-6 bg-green-50 border-2 border-green-200 rounded-xl p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <p className="text-green-800 font-semibold">
                    🛒 Mode sélection : {selectedRecipes.length} recette{selectedRecipes.length > 1 ? 's' : ''} sélectionnée{selectedRecipes.length > 1 ? 's' : ''}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={generateShoppingList}
                      disabled={selectedRecipes.length === 0}
                      className={`px-6 py-2 rounded-xl transition-colors shadow-lg font-semibold ${
                        selectedRecipes.length === 0
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-green-600 text-white hover:bg-green-700'
                      }`}
                    >
                      Terminé
                    </button>
                    <button
                      onClick={() => {
                        setShoppingMode(false);
                        setSelectedRecipes([]);
                      }}
                      className="px-6 py-2 rounded-xl border-2 border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors font-semibold"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!user && !shoppingMode && (
              <div className="mb-6 bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
                <p className="text-blue-800 text-sm">
                  ℹ️ Vous pouvez consulter les recettes, mais vous devez vous connecter pour en ajouter, modifier ou supprimer.
                </p>
              </div>
            )}

            <div className="mb-6 space-y-3">
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="text"
                    placeholder="Rechercher par nom ou ingrédient..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none"
                  />
                </div>
                {!shoppingMode && (
                  <button
                    onClick={() => setGridView(gridView === 'single' ? 'double' : 'single')}
                    className="px-4 py-3 border-2 border-gray-200 rounded-xl hover:border-orange-500 transition-colors bg-white"
                    title={gridView === 'single' ? '2 colonnes' : '1 colonne'}
                  >
                    {gridView === 'single' ? (
                      <svg className="w-5 h-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                    )}
                  </button>
                )}
              </div>
              
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-gray-700 whitespace-nowrap">Filtrer par :</span>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none bg-white font-semibold"
                >
                  <option value="">Tous les types</option>
                  <option value="Entrée">Entrée</option>
                  <option value="Plat">Plat</option>
                  <option value="Dessert">Dessert</option>
                  <option value="Petit-déjeuner">Petit-déjeuner</option>
                  <option value="Goûter">Goûter</option>
                </select>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-gray-700 whitespace-nowrap">Famille :</span>
                <select
                  value={filterTeam}
                  onChange={(e) => setFilterTeam(e.target.value)}
                  className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none bg-white font-semibold"
                >
                  <option value="">Toutes les familles</option>
                  {Object.entries(TEAMS).map(([teamId, team]) => (
                    <option key={teamId} value={teamId}>{team.name}</option>
                  ))}
                </select>
              </div>

              {(searchQuery || filterType || filterTeam) && (
                <div className="flex items-center gap-2 text-sm text-gray-600 flex-wrap">
                  <span className="font-semibold">Filtres actifs :</span>
                  {searchQuery && (
                    <span className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full">
                      "{searchQuery}"
                    </span>
                  )}
                  {filterType && (
                    <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full">
                      {filterType}
                    </span>
                  )}
                  {filterTeam && (
                    <span className="px-3 py-1 rounded-full text-white font-semibold" style={{ backgroundColor: TEAMS[filterTeam].color }}>
                      {TEAMS[filterTeam].name}
                    </span>
                  )}
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setFilterType('');
                      setFilterTeam('');
                    }}
                    className="text-red-600 hover:text-red-700 font-semibold"
                  >
                    ✕ Effacer
                  </button>
                </div>
              )}
            </div>

            {filteredRecipes.length === 0 ? (
              <div className="text-center py-16">
                <ChefHat className="w-20 h-20 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 text-lg">
                  {searchQuery ? 'Aucune recette trouvée' : 'Aucune recette enregistrée. Commencez par en ajouter une !'}
                </p>
              </div>
            ) : (
              <div className={`grid gap-4 ${gridView === 'single' ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'}`}>
                {filteredRecipes.map((recipe) => (
                  <div 
                    key={recipe.id} 
                    onClick={() => !shoppingMode && viewRecipe(recipe)}
                    className={`bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl transition-all relative ${
                      shoppingMode ? 'cursor-default' : 'cursor-pointer'
                    } ${selectedRecipes.includes(recipe.id) ? 'ring-4 ring-green-500' : ''}`}
                  >
                    {shoppingMode && (
                      <div className="absolute top-2 right-2 z-10">
                        <input
                          type="checkbox"
                          checked={selectedRecipes.includes(recipe.id)}
                          onChange={() => toggleRecipeSelection(recipe.id)}
                          className="w-6 h-6 text-green-600 border-2 border-gray-300 rounded focus:ring-green-500"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    )}
                    {recipe.image && (
                      <div className={`overflow-hidden bg-gray-100 ${gridView === 'single' ? 'h-48' : 'h-24'} relative`}>
                        <img 
                          src={recipe.image} 
                          alt={recipe.name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.target.style.display = 'none';
                          }}
                        />
                        {!recipe.tested && (
                          <div className="absolute top-2 left-2 bg-yellow-500 text-white px-2 py-1 rounded-lg text-xs font-bold shadow-lg">
                            À tester
                          </div>
                        )}
                      </div>
                    )}
                    <div className={gridView === 'single' ? 'p-6' : 'p-3'}>
                      {!recipe.image && !recipe.tested && (
                        <div className="mb-2">
                          <span className="inline-block bg-yellow-500 text-white px-2 py-1 rounded-lg text-xs font-bold">
                            À tester
                          </span>
                        </div>
                      )}
                      
                      {/* Badge Team */}
                      {recipe.teamId && TEAMS[recipe.teamId] && (
                        <div className="mb-2">
                          <span 
                            className="inline-block text-white px-3 py-1 rounded-full text-xs font-bold"
                            style={{ backgroundColor: TEAMS[recipe.teamId].color }}
                          >
                            {TEAMS[recipe.teamId].name}
                          </span>
                        </div>
                      )}
                      
                      <h3 className={`font-bold text-gray-800 mb-2 ${gridView === 'single' ? 'text-xl' : 'text-sm'}`}>{recipe.name}</h3>
                      
                      {recipe.servings && (
                        <p className={`text-gray-500 mb-2 ${gridView === 'single' ? 'text-xs' : 'text-xs'}`}>
                          👥 {recipe.servings}p
                        </p>
                      )}

                      {recipe.types && recipe.types.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1">
                          {recipe.types.slice(0, gridView === 'single' ? 3 : 2).map((type, idx) => (
                            <span key={idx} className={`inline-block px-2 py-1 rounded-full font-semibold bg-green-100 text-green-700 ${gridView === 'single' ? 'text-xs' : 'text-xs'}`}>
                              {type}
                            </span>
                          ))}
                          {recipe.types.length > (gridView === 'single' ? 3 : 2) && (
                            <span className="inline-block px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                              +{recipe.types.length - (gridView === 'single' ? 3 : 2)}
                            </span>
                          )}
                        </div>
                      )}
                      
                      {gridView === 'single' && recipe.ingredients && recipe.ingredients.length > 0 && (
                        <div className="mb-3">
                          <p className="text-sm font-semibold text-orange-700 mb-2">Ingrédients:</p>
                          <div className="flex flex-wrap gap-2">
                            {recipe.ingredients.slice(0, 3).map((ing, idx) => (
                              <span key={idx} className="text-xs bg-orange-50 px-3 py-1 rounded-full text-gray-700">
                                {ing}
                              </span>
                            ))}
                            {recipe.ingredients.length > 3 && (
                              <span className="text-xs bg-orange-50 px-3 py-1 rounded-full text-gray-500">
                                +{recipe.ingredients.length - 3}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {recipe.createdBy && gridView === 'single' && (
                        <p className="text-xs text-gray-400 mt-3">
                          Par {recipe.createdBy}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (currentView === 'view' && viewingRecipe) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50">
        <div className="max-w-4xl mx-auto p-6">
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
            {viewingRecipe.image && (
              <div className="h-96 overflow-hidden bg-gray-100">
                <img 
                  src={viewingRecipe.image} 
                  alt={viewingRecipe.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
              </div>
            )}
            
            <div className="p-8">
              <div className="flex items-center justify-between mb-6">
                <h1 className="text-4xl font-bold text-gray-800">{viewingRecipe.name}</h1>
                <button
                  onClick={() => {
                    setViewingRecipe(null);
                    setCurrentView('home');
                  }}
                  className="text-gray-600 hover:text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-100"
                >
                  ✕
                </button>
              </div>

              <div className="flex flex-wrap gap-3 mb-6">
                {!viewingRecipe.tested && (
                  <div className="bg-yellow-500 text-white px-4 py-2 rounded-xl font-bold shadow-lg">
                    À tester
                  </div>
                )}
                
                {/* Badge Team */}
                {viewingRecipe.teamId && TEAMS[viewingRecipe.teamId] && (
                  <div 
                    className="text-white px-4 py-2 rounded-xl font-bold shadow-lg"
                    style={{ backgroundColor: TEAMS[viewingRecipe.teamId].color }}
                  >
                    {TEAMS[viewingRecipe.teamId].name}
                  </div>
                )}
                
                {viewingRecipe.servings && (
                  <div className="flex items-center gap-2 bg-blue-50 px-4 py-2 rounded-xl">
                    <span className="text-blue-700 font-semibold">👥 {viewingRecipe.servings} personne{viewingRecipe.servings > 1 ? 's' : ''}</span>
                  </div>
                )}
                {viewingRecipe.types && viewingRecipe.types.length > 0 && viewingRecipe.types.map((type, idx) => (
                  <span key={idx} className="inline-block px-4 py-2 rounded-xl text-sm font-semibold bg-green-100 text-green-700">
                    {type}
                  </span>
                ))}
              </div>

              {viewingRecipe.ingredients && viewingRecipe.ingredients.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                    🥘 Ingrédients
                  </h2>
                  <div className="bg-orange-50 rounded-xl p-6">
                    <ul className="space-y-2">
                      {viewingRecipe.ingredients.map((ing, idx) => (
                        <li key={idx} className="flex items-start gap-3">
                          <span className="text-orange-600 font-bold">•</span>
                          <span className="text-gray-700">{ing}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {viewingRecipe.steps && (
                <div className="mb-8">
                  <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                    👨‍🍳 Préparation
                  </h2>
                  <div className="bg-gray-50 rounded-xl p-6">
                    <p className="text-gray-700 whitespace-pre-line leading-relaxed">{viewingRecipe.steps}</p>
                  </div>
                </div>
              )}

              {viewingRecipe.createdBy && (
                <p className="text-sm text-gray-500 mb-6">
                  Créée par {viewingRecipe.createdBy}
                </p>
              )}

              <div className="flex flex-col gap-3">
                {!viewingRecipe.tested && user && (
                  <button
                    onClick={async () => {
                      try {
                        setSyncStatus('syncing');
                        const recipeRef = ref(database, `recipes/${viewingRecipe.id}`);
                        await set(recipeRef, { ...viewingRecipe, tested: true });
                        setViewingRecipe({ ...viewingRecipe, tested: true });
                        setSyncStatus('synced');
                      } catch (error) {
                        console.error('Erreur:', error);
                        setSyncStatus('error');
                      }
                    }}
                    className="w-full flex items-center justify-center gap-2 bg-green-600 text-white px-6 py-3 rounded-xl hover:bg-green-700 transition-colors shadow-lg font-semibold"
                  >
                    ✓ Marquer comme testée et validée
                  </button>
                )}
                <button
                  onClick={() => {
                    setViewingRecipe(null);
                    setCurrentView('home');
                  }}
                  className="w-full px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors font-semibold"
                >
                  ← Retour
                </button>
                {user && (
                  <div className="flex gap-3">
                    <button
                      onClick={() => editRecipe(viewingRecipe)}
                      className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl hover:bg-blue-700 transition-colors shadow-lg font-semibold"
                    >
                      <Edit2 className="w-5 h-5" />
                      Modifier
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm('Êtes-vous sûr de vouloir supprimer cette recette ?')) {
                          deleteRecipe(viewingRecipe.id);
                          setViewingRecipe(null);
                          setCurrentView('home');
                        }
                      }}
                      className="flex items-center justify-center gap-2 bg-red-600 text-white px-6 py-3 rounded-xl hover:bg-red-700 transition-colors shadow-lg font-semibold"
                    >
                      <Trash2 className="w-5 h-5" />
                      Supprimer
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Vue liste de courses avec zone de texte modifiable
  if (currentView === 'shopping' && shoppingList) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50">
        <div className="max-w-4xl mx-auto p-6">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex items-center justify-between mb-8">
              <h1 className="text-3xl font-bold text-gray-800">🛒 Liste de courses</h1>
              <button
                onClick={() => {
                  setCurrentView('home');
                  setShoppingList(null);
                  setSelectedRecipes([]);
                }}
                className="text-gray-600 hover:text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-100"
              >
                ✕
              </button>
            </div>

            <div className="mb-6 bg-blue-50 rounded-xl p-4">
              <p className="text-sm font-semibold text-blue-800 mb-2">Recettes sélectionnées :</p>
              <div className="flex flex-wrap gap-2">
                {shoppingList.recipes.map((recipe) => (
                  <span key={recipe.id} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-semibold">
                    {recipe.name}
                  </span>
                ))}
              </div>
            </div>

            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xl font-bold text-gray-800">Liste de courses</h2>
                <button
                  onClick={() => {
                    if (shoppingList.ingredientsWithRecipes) {
                      const currentText = editableShoppingList;
                      const hasRecipes = currentText.includes('(');
                      
                      if (hasRecipes) {
                        // Passer à la version sans recettes
                        setEditableShoppingList(shoppingList.ingredients.join('\n'));
                      } else {
                        // Passer à la version avec recettes
                        setEditableShoppingList(shoppingList.ingredientsWithRecipes.join('\n'));
                      }
                    }
                  }}
                  className="text-xs bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg hover:bg-blue-200 transition-colors font-semibold"
                >
                  {editableShoppingList.includes('(') ? '👁️ Masquer recettes' : '👁️ Voir recettes'}
                </button>
              </div>

              <div className="bg-white border-2 border-gray-200 rounded-xl p-4 space-y-2 max-h-96 overflow-y-auto">
                {editableShoppingList.split('\n').map((line, index) => (
                  <div
                    key={index}
                    onClick={() => {
                      if (checkedLines.includes(index)) {
                        setCheckedLines(checkedLines.filter(i => i !== index));
                      } else {
                        setCheckedLines([...checkedLines, index]);
                      }
                    }}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                      checkedLines.includes(index)
                        ? 'bg-gray-100 opacity-50'
                        : 'bg-white hover:bg-orange-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checkedLines.includes(index)}
                      onChange={() => {}}
                      className="w-5 h-5 text-green-600 border-2 border-gray-300 rounded focus:ring-green-500"
                    />
                    <span className={`flex-1 ${checkedLines.includes(index) ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                      {line}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-gray-600">
                  {checkedLines.length} / {editableShoppingList.split('\n').length} articles cochés
                </span>
                {checkedLines.length > 0 && (
                  <button
                    onClick={() => setCheckedLines([])}
                    className="text-orange-600 hover:text-orange-700 font-semibold"
                  >
                    ✕ Tout décocher
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4 mb-4">
                <p className="text-sm text-yellow-800">
                  💡 <strong>Astuce :</strong> Cochez les articles au fur et à mesure de vos achats. Vous pouvez aussi copier la liste pour l'utiliser ailleurs !
                </p>
              </div>

              <button
                onClick={() => {
                  const uncheckedItems = editableShoppingList
                    .split('\n')
                    .filter((_, index) => !checkedLines.includes(index))
                    .join('\n');
                  navigator.clipboard.writeText(uncheckedItems || editableShoppingList);
                  alert('Liste copiée dans le presse-papier !');
                }}
                className="w-full bg-orange-600 text-white px-6 py-3 rounded-xl hover:bg-orange-700 transition-colors shadow-lg font-semibold"
              >
                📋 Copier la liste
              </button>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => {
                    // Copier seulement les noms sans quantités
                    const simpleList = editableShoppingList
                      .split('\n')
                      .filter((_, index) => !checkedLines.includes(index))
                      .map(line => {
                        const match = line.match(/•\s*(?:\d+[^a-zA-Z]*)?(.+?)\s*\(/);
                        return match ? match[1].trim() : line.replace('•', '').trim();
                      })
                      .join('\n');
                    navigator.clipboard.writeText(simpleList);
                    alert('Liste simplifiée copiée (sans quantités) !');
                  }}
                  className="bg-purple-600 text-white px-4 py-3 rounded-xl hover:bg-purple-700 transition-colors font-semibold text-sm"
                >
                  📝 Copier sans quantités
                </button>
                <button
                  onClick={() => {
                    const uncheckedItems = editableShoppingList
                      .split('\n')
                      .filter((_, index) => !checkedLines.includes(index));
                    const cleanList = uncheckedItems.map(line => line.replace(/•/g, '-')).join('\n');
                    navigator.clipboard.writeText(`🛒 Liste de courses:\n\n${cleanList}`);
                    alert('Liste copiée pour SMS/WhatsApp !');
                  }}
                  className="bg-green-600 text-white px-4 py-3 rounded-xl hover:bg-green-700 transition-colors font-semibold text-sm"
                >
                  💬 Copier pour SMS
                </button>
              </div>

              <button
                onClick={() => {
                  setCurrentView('home');
                  setShoppingList(null);
                  setSelectedRecipes([]);
                  setCheckedLines([]);
                }}
                className="w-full px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors font-semibold"
              >
                Retour aux recettes
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Vue admin
  if (currentView === 'admin' && isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50">
        <div className="max-w-6xl mx-auto p-6">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-3xl font-bold text-gray-800">⚙️ Administration</h2>
              <button
                onClick={() => setCurrentView('home')}
                className="text-gray-600 hover:text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-100"
              >
                ← Retour
              </button>
            </div>

            <div className="mb-8">
              <h3 className="text-xl font-bold text-gray-800 mb-4">Gestion des utilisateurs</h3>
              
              {Object.keys(allUsers).length === 0 ? (
                <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4 mb-4">
                  <p className="text-sm text-yellow-800">
                    ⚠️ Aucun utilisateur trouvé dans la base de données. Les utilisateurs apparaîtront ici après leur première connexion et sélection de famille.
                  </p>
                </div>
              ) : (
                Object.entries(TEAMS).map(([teamId, team]) => {
                  const teamUsers = Object.entries(allUsers).filter(([userKey, userData]) => {
                    // userKey est déjà formaté avec underscores depuis Firebase
                    return userData && userData.teamId === teamId;
                  });
                  
                  return (
                    <div key={teamId} className="mb-6">
                      <div 
                        className="text-white px-4 py-2 rounded-xl font-bold mb-3 inline-block"
                        style={{ backgroundColor: team.color }}
                      >
                        {team.name}
                      </div>
                      
                      {teamUsers.length === 0 ? (
                        <p className="text-gray-500 text-sm ml-4">Aucun utilisateur</p>
                      ) : (
                        <div className="space-y-2 ml-4">
                          {teamUsers.map(([userKey, userData]) => {
                            // Reconvertir la clé avec underscores en email avec points pour l'affichage
                            const displayEmail = userData.email || userKey.replace(/_/g, '.');
                            
                            return (
                              <div key={userKey} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                <div>
                                  <p className="font-semibold text-gray-800">{displayEmail}</p>
                                  <p className="text-xs text-gray-500">
                                    {userData.name} • Rejoint le {new Date(userData.joinedAt).toLocaleDateString('fr-FR')}
                                    {userData.isRevoked && <span className="text-red-600 font-bold ml-2">• RÉVOQUÉ</span>}
                                  </p>
                                </div>
                                {!userData.isRevoked && displayEmail !== ADMIN_EMAIL && (
                                  <button
                                    onClick={() => handleRevokeUser(displayEmail)}
                                    className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors text-sm font-semibold"
                                  >
                                    Révoquer
                                  </button>
                                )}
                                {displayEmail === ADMIN_EMAIL && (
                                  <span className="bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-xs font-bold">
                                    ADMIN
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
              <p className="text-sm text-blue-800">
                💡 <strong>Info :</strong> Les utilisateurs révoqués ne pourront plus se connecter. Leurs recettes restent visibles mais ne peuvent plus être modifiées par eux.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50">
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-3xl font-bold text-gray-800">
              {editingRecipe ? 'Modifier la Recette' : 'Nouvelle Recette'}
            </h2>
            <button
              onClick={() => {
                resetForm();
                setCurrentView('home');
              }}
              className="text-gray-600 hover:text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-100"
            >
              Annuler
            </button>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Nom de la recette
            </label>
            <input
              type="text"
              value={newRecipe.name}
              onChange={(e) => setNewRecipe({ ...newRecipe, name: e.target.value })}
              placeholder="Ex: Tarte aux pommes"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none"
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Photo de la recette
            </label>
            
            <div className="space-y-3">
              {/* Upload depuis la galerie */}
              <div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      try {
                        const compressedImage = await compressImage(file);
                        setNewRecipe({ ...newRecipe, image: compressedImage });
                      } catch (error) {
                        console.error('Erreur compression:', error);
                        alert('Erreur lors du traitement de l\'image');
                      }
                    }
                  }}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none bg-white file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100"
                />
                <p className="text-xs text-gray-500 mt-1">
                  📸 L'image sera automatiquement redimensionnée et compressée
                </p>
              </div>
            </div>
            
            {/* Aperçu de l'image */}
            {newRecipe.image && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-gray-700">Aperçu :</span>
                  <button
                    type="button"
                    onClick={() => setNewRecipe({ ...newRecipe, image: '' })}
                    className="text-xs text-red-600 hover:text-red-700 font-semibold"
                  >
                    ✕ Supprimer l'image
                  </button>
                </div>
                <div className="rounded-xl overflow-hidden border-2 border-gray-200">
                  <img 
                    src={newRecipe.image} 
                    alt="Aperçu" 
                    className="w-full h-64 object-cover"
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Types de plat (sélection multiple)
            </label>
            <div className="grid grid-cols-2 gap-3">
              {['Entrée', 'Plat', 'Dessert', 'Petit-déjeuner', 'Goûter'].map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  className={`px-4 py-3 rounded-xl border-2 font-semibold transition-all ${
                    newRecipe.types.includes(type)
                      ? 'bg-green-600 text-white border-green-600'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-green-300'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
            {newRecipe.types.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="text-sm text-gray-600">Sélectionné :</span>
                {newRecipe.types.map((type, idx) => (
                  <span key={idx} className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                    {type}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Nombre de personnes
            </label>
            <input
              type="number"
              min="1"
              value={newRecipe.servings}
              onChange={(e) => setNewRecipe({ ...newRecipe, servings: e.target.value })}
              placeholder="Ex: 4"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none"
            />
          </div>

          <div className="mb-6">
            <label className="flex items-center gap-3 p-4 border-2 border-gray-200 rounded-xl cursor-pointer hover:border-orange-300 transition-colors">
              <input
                type="checkbox"
                checked={newRecipe.tested}
                onChange={(e) => setNewRecipe({ ...newRecipe, tested: e.target.checked })}
                className="w-5 h-5 text-green-600 border-2 border-gray-300 rounded focus:ring-green-500"
              />
              <div>
                <span className="font-semibold text-gray-800">✓ Recette testée et validée</span>
                <p className="text-xs text-gray-500 mt-1">Cochez si vous avez déjà préparé cette recette</p>
              </div>
            </label>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Liste des ingrédients (un par ligne)
            </label>
            <textarea
              value={newRecipe.ingredients}
              onChange={(e) => setNewRecipe({ ...newRecipe, ingredients: e.target.value })}
              placeholder="Ex:&#10;200g de farine&#10;3 œufs&#10;100ml de lait"
              rows="10"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none resize-none"
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Étapes de préparation
            </label>
            <textarea
              value={newRecipe.steps}
              onChange={(e) => setNewRecipe({ ...newRecipe, steps: e.target.value })}
              placeholder="Décrivez les étapes de préparation...&#10;&#10;1. Préchauffer le four à 180°C&#10;2. Mélanger les ingrédients secs..."
              rows="10"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none resize-none"
            />
          </div>

          <div className="mt-8 flex gap-4">
            <button
              onClick={saveRecipe}
              className="flex-1 bg-orange-600 text-white px-6 py-3 rounded-xl hover:bg-orange-700 transition-colors shadow-lg font-semibold"
            >
              {editingRecipe ? 'Mettre à jour' : 'Enregistrer la recette'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
