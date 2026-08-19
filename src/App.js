import React, { useState, useEffect, useRef } from 'react';
import { Plus, Search, Sprout, Leaf, Trash2, Edit2, Cloud, CloudOff, LogOut, LogIn, ShoppingCart, Users, SlidersHorizontal, Bell, X, Image as ImageIcon, Clipboard, Video, PenLine, ArrowLeft } from 'lucide-react';
import { database, auth, googleProvider } from './firebaseConfig';
import { ref, set, onValue, remove } from 'firebase/database';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';

// Palette "Potager"
const C = {
  ink: '#10241A',      // kale profond — titres
  stem: '#2F6B45',     // vert tige — primaire
  sprout: '#B7D14A',   // jeune pousse — accent
  linen: '#F3F5EC',    // fond
  sage: '#7B8A6F',     // texte secondaire
  line: '#DDE3D2'      // filets et bordures
};

// Méthodes d'ajout proposées dans le modal
const METHODES = {
  image: {
    nom: 'Capture d\'écran',
    court: 'L\'IA lit l\'image et en extrait la recette',
    tag: '~5 s',
    gratuit: false,
    Icone: ImageIcon,
    titre: 'Depuis une image',
    aide: 'Déposez une capture d\'écran d\'un Reel ou d\'une page de recette. L\'IA en extrait le nom, les ingrédients et les étapes.'
  },
  text: {
    nom: 'Copier-coller',
    court: 'Depuis Instagram, un site, un message…',
    tag: 'Gratuit',
    gratuit: true,
    Icone: Clipboard,
    titre: 'Depuis un texte',
    aide: 'Collez la description Instagram ou le texte d\'un site. Le découpage en ingrédients et étapes est automatique.'
  },
  video: {
    nom: 'Vidéo',
    court: 'Transcription de l\'audio + description',
    tag: '~30 s',
    gratuit: false,
    Icone: Video,
    titre: 'Depuis une vidéo',
    aide: 'La bande son est transcrite pour reconstituer les étapes de préparation.'
  },
  manuel: {
    nom: 'Saisie manuelle',
    court: 'Remplir le formulaire soi-même',
    tag: 'Gratuit',
    gratuit: true,
    Icone: PenLine,
    titre: 'Saisie manuelle',
    aide: ''
  }
};

export default function RecipeManager() {
  // Configuration des teams
  const TEAMS = {
    'papa-maman': { name: 'Papa & Maman', color: '#6B3A62' },        // aubergine
    'camille-maxime': { name: 'Camille & Maxime', color: '#C0503A' }, // tomate
    'florent-maniola': { name: 'Florent & Maniola', color: '#C98A2E' },// courge
    'thibaut-mathilde': { name: 'Thibaut & Mathilde', color: '#3E7D52' }// kale
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
  const [showFilters, setShowFilters] = useState(false);

  // Notifications de nouvelles recettes
  const [toast, setToast] = useState(null);
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const knownRecipeIds = useRef(null);   // null tant que le premier chargement n'a pas eu lieu
  const currentUserEmail = useRef(null); // évite une valeur périmée dans l'écouteur Firebase
  const toastTimer = useRef(null);
  const annoncerRef = useRef(null); // évite de relancer l'écouteur Firebase à chaque rendu
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

  // États pour l'import hybride
  const [showImportModal, setShowImportModal] = useState(false);
  const [importMethod, setImportMethod] = useState(null); // 'image', 'text', 'video', 'manual'
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [importText, setImportText] = useState('');
  const [importImage, setImportImage] = useState(null);
  const [importVideo, setImportVideo] = useState(null);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      currentUserEmail.current = currentUser ? currentUser.email : null;
      
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

        // Repérer les recettes apparues depuis le dernier instantané
        const ids = new Set(recipesArray.map(r => r.id));
        if (knownRecipeIds.current === null) {
          // Premier chargement : on mémorise sans notifier
          knownRecipeIds.current = ids;
        } else {
          const nouvelles = recipesArray.filter(r =>
            !knownRecipeIds.current.has(r.id) &&
            r.createdBy &&
            r.createdBy !== currentUserEmail.current
          );
          knownRecipeIds.current = ids;
          if (nouvelles.length > 0 && annoncerRef.current) {
            annoncerRef.current(nouvelles[nouvelles.length - 1]);
          }
        }

        setRecipes(recipesArray);
        setSyncStatus('synced');
      } else {
        knownRecipeIds.current = new Set();
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

  const LOGO = '/web-app-manifest-192x192.png';

  // Compose le message et déclenche bannière + notification système
  const annoncerRecette = (recipe) => {
    const team = TEAMS[recipe.teamId];
    const auteur = team ? team.name : 'Quelqu\'un';
    const titre = `${auteur} ${team ? 'ont' : 'a'} ajouté une nouvelle recette !`;

    setToast({ recipe, titre, color: team ? team.color : C.stem });

    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 8000);

    // Notification système : ne part que si l'utilisateur l'a autorisée
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        const notif = new Notification(titre, {
          body: `${recipe.name}\nÀ découvrir dans Recettes de famille`,
          icon: LOGO,
          badge: LOGO,
          tag: `recette-${recipe.id}`
        });
        notif.onclick = () => {
          window.focus();
          notif.close();
        };
      } catch (e) {
        console.warn('Notification indisponible :', e);
      }
    }
  };

  // Garde la référence à jour sans redéclencher l'effet ci-dessus
  annoncerRef.current = annoncerRecette;

  const demanderNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    const perm = await Notification.requestPermission();
    setNotifPermission(perm);
    if (perm === 'granted') {
      new Notification('C\'est noté !', {
        body: 'Vous serez prévenu à chaque nouvelle recette de la famille.',
        icon: LOGO
      });
    }
  };

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

  // Analyse d'une image via la fonction serverless /api/analyze
  // (la clé API reste côté serveur, jamais dans le navigateur)
  const analyzeImage = async (imageDataUrl) => {
    // Une capture d'écran est souvent en PNG : il faut annoncer le bon type,
    // sinon l'API rejette l'image.
    const correspondance = imageDataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,/);
    const mediaType = correspondance ? correspondance[1] : 'image/jpeg';
    const imageBase64 = imageDataUrl.split(',')[1];

    const reponse = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, mediaType })
    });

    const donnees = await reponse.json();
    if (!reponse.ok) {
      throw new Error(donnees.error || "L'analyse de l'image a échoué.");
    }
    return donnees;
  };

  // Fonction pour analyser du texte (copier-coller)
  const analyzeText = (text) => {
    const result = {
      name: '',
      servings: '',
      ingredients: [],
      steps: ''
    };

    // Extraire le nom (première ligne ou titre)
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      result.name = lines[0].replace(/^#+\s*/, '').trim();
    }

    // Extraire le nombre de personnes
    const servingsMatch = text.match(/(\d+)\s*(?:personnes?|parts?|portions?|p\b)/i);
    if (servingsMatch) {
      result.servings = servingsMatch[1];
    }

    // Extraire les ingrédients (lignes avec -, •, *, ou chiffres)
    const ingredientLines = text.split('\n').filter(line => {
      const trimmed = line.trim();
      return trimmed.match(/^[-•*]\s*\w/) || 
             trimmed.match(/^\d+[g|ml|cl|kg|l]\s/) ||
             (trimmed.includes('g ') || trimmed.includes('ml ') || trimmed.includes('cl '));
    });
    
    if (ingredientLines.length > 0) {
      result.ingredients = ingredientLines.map(line => 
        line.trim().replace(/^[-•*]\s*/, '')
      );
    }

    // Extraire les étapes (le reste après les ingrédients)
    const stepsSection = text.split(/(?:préparation|instructions|étapes|recette):/i);
    if (stepsSection.length > 1) {
      result.steps = stepsSection[1].trim();
    } else {
      // Si pas de section clairement identifiée, prendre tout sauf les ingrédients
      const allText = text.split('\n').filter(line => {
        const trimmed = line.trim();
        return !trimmed.match(/^[-•*]\s*\w/) && 
               !trimmed.match(/^\d+[g|ml|cl|kg|l]\s/) &&
               trimmed.length > 20; // Lignes substantielles
      }).join('\n');
      result.steps = allText;
    }

    return result;
  };

  // Fonction pour analyser une vidéo (nécessite API Claude avec vidéo)
  const analyzeVideo = async (videoFile, descriptionText) => {
    try {
      // Note: Cette fonctionnalité nécessiterait l'upload de la vidéo vers un service
      // Pour l'instant, on va juste parser la description fournie
      alert('⚠️ Analyse vidéo : Pour l\'instant, veuillez coller la description de la vidéo dans le champ texte.');
      return analyzeText(descriptionText);
    } catch (error) {
      console.error('Erreur analyse vidéo:', error);
      throw error;
    }
  };

  // Fonction pour gérer l'import selon la méthode choisie
  const handleImport = async () => {
    setIsAnalyzing(true);
    
    try {
      let result = null;

      if (importMethod === 'image' && importImage) {
        result = await analyzeImage(importImage);
      } else if (importMethod === 'text' && importText) {
        result = analyzeText(importText);
      } else if (importMethod === 'video' && importVideo) {
        result = await analyzeVideo(importVideo, importText);
      } else {
        alert('Veuillez fournir les données nécessaires');
        setIsAnalyzing(false);
        return;
      }

      // Pré-remplir le formulaire avec les résultats
      setNewRecipe({
        ...newRecipe,
        name: result.name || newRecipe.name,
        servings: result.servings || newRecipe.servings,
        ingredients: Array.isArray(result.ingredients) 
          ? result.ingredients.join('\n') 
          : result.ingredients || newRecipe.ingredients,
        steps: result.steps || newRecipe.steps,
        image: importMethod === 'image' ? importImage : newRecipe.image
      });

      // Fermer le modal et aller au formulaire
      setShowImportModal(false);
      setCurrentView('add');
      
      alert('✅ Analyse terminée ! Vérifiez et complétez les informations.');
    } catch (error) {
      console.error('Erreur import:', error);
      alert(
        (error.message || "L'analyse a échoué.") +
        '\n\nVous pouvez réessayer, ou passer par la saisie manuelle.'
      );
    } finally {
      setIsAnalyzing(false);
    }
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

  // Le bouton d'analyse reste inactif tant que la source manque
  const importDesactive = isAnalyzing ||
    (importMethod === 'image' && !importImage) ||
    (importMethod === 'text' && !importText.trim()) ||
    (importMethod === 'video' && !importVideo);

  // Nombre de filtres actifs (hors recherche texte)
  const activeFilterCount = (filterType ? 1 : 0) + (filterTeam ? 1 : 0);

  // Prénom affiché dans l'en-tête
  const firstName = user
    ? (user.displayName ? user.displayName.split(' ')[0] : user.email.split('@')[0])
    : '';

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
            <Sprout className="w-16 h-16 mx-auto mb-4" style={{ color: C.stem }} />
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
      <div className="min-h-screen" style={{ backgroundColor: C.linen }}>
        <div className="max-w-6xl mx-auto p-4 sm:p-6">
          <div className="bg-white rounded-2xl p-5 sm:p-8" style={{ boxShadow: '0 1px 2px rgba(16,36,26,.06), 0 12px 32px -18px rgba(16,36,26,.35)' }}>
            <div className="mb-6">
              <div className="flex items-center gap-3 pb-5 mb-5" style={{ borderBottom: `1px solid ${C.line}` }}>
                <div className="min-w-0 flex-1">
                  <h1 className="text-2xl sm:text-3xl leading-tight" style={{ color: C.ink, fontFamily: "'Fraunces', Georgia, serif", fontWeight: 600 }}>Recettes de famille</h1>
                  <SyncIndicator />
                </div>

                {user ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="hidden sm:block text-right">
                      <p className="text-sm font-semibold leading-tight" style={{ color: C.ink }}>{firstName}</p>
                      {userTeam && TEAMS[userTeam] && (
                        <p className="text-[10px] uppercase tracking-[0.12em] font-semibold" style={{ color: TEAMS[userTeam].color }}>
                          {TEAMS[userTeam].name}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-center w-9 h-9 rounded-full text-white text-sm font-semibold shrink-0"
                         style={{ backgroundColor: userTeam && TEAMS[userTeam] ? TEAMS[userTeam].color : C.stem }}>
                      {firstName.charAt(0).toUpperCase()}
                    </div>
                    {notifPermission === 'default' && (
                      <button
                        onClick={demanderNotifications}
                        className="w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-black/5 shrink-0"
                        style={{ color: C.sage, border: `1px solid ${C.line}` }}
                        title="Être prévenu des nouvelles recettes"
                        aria-label="Activer les notifications"
                      >
                        <Bell className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={handleLogout}
                      className="w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-black/5 shrink-0"
                      style={{ color: C.sage, border: `1px solid ${C.line}` }}
                      title="Se déconnecter"
                      aria-label="Se déconnecter"
                    >
                      <LogOut className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleLogin}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-full text-white text-sm font-semibold transition-opacity hover:opacity-90 shrink-0"
                    style={{ backgroundColor: C.stem }}
                  >
                    <LogIn className="w-4 h-4" />
                    <span className="hidden sm:inline">Se connecter</span>
                  </button>
                )}
              </div>
            </div>

            {/* Bannière : nouvelle recette d'un autre foyer */}
            {toast && (
              <div
                className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white overflow-hidden cursor-pointer"
                style={{
                  border: `1px solid ${C.line}`,
                  boxShadow: '0 18px 40px -14px rgba(16,36,26,.45)',
                  animation: 'toastIn .35s cubic-bezier(.2,.8,.3,1)'
                }}
                onClick={() => {
                  viewRecipe(toast.recipe);
                  setToast(null);
                }}
              >
                <div className="h-1" style={{ backgroundColor: toast.color }} />
                <div className="flex items-center gap-3 p-3.5">
                  <img
                    src={LOGO}
                    alt=""
                    className="w-11 h-11 rounded-xl shrink-0"
                    style={{ border: `1px solid ${C.line}` }}
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold leading-snug" style={{ color: C.ink }}>
                      {toast.titre}
                    </p>
                    <p className="text-[15px] leading-snug truncate mt-0.5"
                       style={{ color: toast.color, fontFamily: "'Fraunces', Georgia, serif", fontWeight: 600 }}>
                      {toast.recipe.name}
                    </p>
                    <p className="text-[11px] mt-1" style={{ color: C.sage }}>Appuyez pour la découvrir</p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setToast(null); }}
                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 hover:bg-black/5"
                    style={{ color: C.sage }}
                    aria-label="Fermer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Boutons Flottants */}
            {user && !shoppingMode && (
              <button
                onClick={() => setShowImportModal(true)}
                className="fixed bottom-6 right-6 text-white p-4 rounded-full transition-all shadow-2xl hover:scale-110 z-50"
                style={{ backgroundColor: C.stem }}
                title="Ajouter une recette"
              >
                <Plus className="w-7 h-7" />
              </button>
            )}

            {!shoppingMode && (
              <button
                onClick={startShoppingMode}
                className="fixed bottom-6 right-24 text-white p-4 rounded-full transition-all shadow-2xl hover:scale-110 z-50"
                style={{ backgroundColor: C.ink }}
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

            <div className="mb-6 space-y-4">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px]" style={{ color: C.sage }} />
                  <input
                    type="text"
                    placeholder="Rechercher par nom ou ingrédient…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 rounded-xl outline-none text-[15px] transition-colors focus:bg-white"
                    style={{ backgroundColor: C.linen, border: `1px solid ${C.line}`, color: C.ink }}
                    onFocus={(e) => { e.target.style.borderColor = C.stem; }}
                    onBlur={(e) => { e.target.style.borderColor = C.line; }}
                  />
                </div>
                {!shoppingMode && (
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className="flex items-center gap-1.5 px-3.5 rounded-xl transition-colors shrink-0 text-[13px] font-medium"
                    style={{
                      backgroundColor: activeFilterCount > 0 ? C.ink : C.linen,
                      border: `1px solid ${activeFilterCount > 0 ? C.ink : C.line}`,
                      color: activeFilterCount > 0 ? '#fff' : C.sage
                    }}
                    aria-expanded={showFilters}
                    title="Filtres"
                  >
                    <SlidersHorizontal className="w-[18px] h-[18px]" />
                    <span className="hidden sm:inline">Filtres</span>
                    {activeFilterCount > 0 && (
                      <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold"
                            style={{ backgroundColor: C.sprout, color: C.ink }}>
                        {activeFilterCount}
                      </span>
                    )}
                  </button>
                )}
              </div>

              {/* Panneau de filtres rétractable */}
              {showFilters && (
                <div className="space-y-4 p-4 rounded-xl" style={{ backgroundColor: C.linen, border: `1px solid ${C.line}` }}>
                  {/* Types : pastilles */}
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.16em] font-semibold mb-2" style={{ color: C.sage }}>Type</p>
                    <div className="flex flex-wrap gap-1.5">
                      {['', 'Entrée', 'Plat', 'Dessert', 'Petit-déjeuner', 'Goûter'].map((type) => {
                        const active = filterType === type;
                        return (
                          <button
                            key={type || 'tous'}
                            onClick={() => setFilterType(type)}
                            className="px-3 py-1.5 rounded-full text-[13px] font-medium transition-all"
                            style={{
                              backgroundColor: active ? C.ink : '#fff',
                              color: active ? '#fff' : C.sage,
                              border: `1px solid ${active ? C.ink : C.line}`
                            }}
                          >
                            {type || 'Tout'}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Foyers : pastilles teintées */}
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.16em] font-semibold mb-2" style={{ color: C.sage }}>Foyer</p>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => setFilterTeam('')}
                        className="px-3 py-1.5 rounded-full text-[13px] font-medium transition-all"
                        style={{
                          backgroundColor: filterTeam === '' ? C.ink : '#fff',
                          color: filterTeam === '' ? '#fff' : C.sage,
                          border: `1px solid ${filterTeam === '' ? C.ink : C.line}`
                        }}
                      >
                        Tous
                      </button>
                      {Object.entries(TEAMS).map(([teamId, team]) => {
                        const active = filterTeam === teamId;
                        return (
                          <button
                            key={teamId}
                            onClick={() => setFilterTeam(active ? '' : teamId)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium transition-all"
                            style={{
                              backgroundColor: active ? team.color : '#fff',
                              color: active ? '#fff' : C.sage,
                              border: `1px solid ${active ? team.color : C.line}`
                            }}
                          >
                            <span className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: active ? 'rgba(255,255,255,.85)' : team.color }} />
                            {team.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Rappel discret quand le panneau est replié */}
              {!showFilters && activeFilterCount > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {filterType && (
                    <span className="px-2.5 py-1 rounded-full text-[12px] font-medium"
                          style={{ backgroundColor: C.linen, color: C.ink, border: `1px solid ${C.line}` }}>
                      {filterType}
                    </span>
                  )}
                  {filterTeam && TEAMS[filterTeam] && (
                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium text-white"
                          style={{ backgroundColor: TEAMS[filterTeam].color }}>
                      {TEAMS[filterTeam].name}
                    </span>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between gap-3 pt-1 text-xs" style={{ color: C.sage }}>
                <span>
                  {filteredRecipes.length} recette{filteredRecipes.length > 1 ? 's' : ''}
                  {(searchQuery || filterType || filterTeam) ? ' trouvée' + (filteredRecipes.length > 1 ? 's' : '') : ''}
                </span>
                {(searchQuery || filterType || filterTeam) && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setFilterType('');
                      setFilterTeam('');
                    }}
                    className="font-semibold underline underline-offset-2 hover:opacity-70"
                    style={{ color: C.stem }}
                  >
                    Effacer les filtres
                  </button>
                )}
              </div>
            </div>

            {filteredRecipes.length === 0 ? (
              <div className="text-center py-20">
                <Sprout className="w-14 h-14 mx-auto mb-4" style={{ color: C.line }} />
                <p className="text-lg" style={{ color: C.ink, fontFamily: "'Fraunces', Georgia, serif" }}>
                  {searchQuery || filterType || filterTeam ? 'Rien ne pousse ici' : 'Aucune recette pour l\'instant'}
                </p>
                <p className="text-sm mt-1" style={{ color: C.sage }}>
                  {searchQuery || filterType || filterTeam
                    ? 'Essayez avec moins de filtres.'
                    : 'Ajoutez la première recette avec le bouton +.'}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {filteredRecipes.map((recipe) => {
                  const teamColor = (recipe.teamId && TEAMS[recipe.teamId]) ? TEAMS[recipe.teamId].color : C.stem;
                  const selected = selectedRecipes.includes(recipe.id);
                  return (
                  <div
                    key={recipe.id}
                    onClick={() => !shoppingMode && viewRecipe(recipe)}
                    className={`group relative flex items-stretch bg-white rounded-lg overflow-hidden transition-all h-[116px] sm:h-[136px] ${
                      shoppingMode ? 'cursor-default' : 'cursor-pointer'
                    }`}
                    style={{
                      border: `1px solid ${selected ? C.stem : C.line}`,
                      boxShadow: selected ? `0 0 0 3px ${C.sprout}` : '0 1px 2px rgba(16,36,26,.04)'
                    }}
                  >
                    {/* Tige : filet vertical + nœud, dans la couleur du foyer */}
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] z-10" style={{ backgroundColor: teamColor }} />
                    <div className="absolute left-[-3px] top-3 w-[9px] h-[9px] rounded-full z-20 ring-2 ring-white" style={{ backgroundColor: teamColor }} />

                    {shoppingMode && (
                      <div className="flex items-center pl-4 pr-1 z-20">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleRecipeSelection(recipe.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-5 h-5 rounded"
                          style={{ accentColor: C.stem }}
                        />
                      </div>
                    )}

                    {/* Bannière photo */}
                    <div
                      className="flex-none w-[116px] sm:w-[136px] flex items-center justify-center overflow-hidden"
                      style={{ backgroundColor: recipe.image ? C.linen : '#EDF1E4', borderRight: `1px solid ${C.line}` }}
                    >
                      {recipe.image ? (
                        <img
                          src={recipe.image}
                          alt=""
                          className="w-full h-full transition-transform duration-500 group-hover:scale-105"
                          style={{ objectFit: 'cover', objectPosition: 'center' }}
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      ) : (
                        <Leaf className="w-7 h-7 opacity-40" style={{ color: C.stem }} />
                      )}
                    </div>

                    <div className={`flex-1 min-w-0 px-4 py-3.5 sm:px-5 sm:py-4 flex flex-col justify-center ${!recipe.tested ? 'pr-8 sm:pr-32' : ''}`}>
                      <h3 className="text-[17px] sm:text-[21px] leading-snug mb-1"
                          style={{
                            color: C.ink,
                            fontFamily: "'Fraunces', Georgia, serif",
                            fontWeight: 600,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden'
                          }}>
                        {recipe.name}
                      </h3>
                      {recipe.teamId && TEAMS[recipe.teamId] && (
                        <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.14em] font-semibold mb-1.5 truncate"
                           style={{ color: teamColor }}>
                          {TEAMS[recipe.teamId].name}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] sm:text-[13px]"
                           style={{ color: C.sage }}>
                        {recipe.servings && <span>👥 {recipe.servings}</span>}
                        {recipe.types && recipe.types.slice(0, 2).map((type, idx) => (
                          <React.Fragment key={idx}>
                            <span style={{ color: C.line }}>—</span>
                            <span>{type}</span>
                          </React.Fragment>
                        ))}
                        {recipe.ingredients && recipe.ingredients.length > 0 && (
                          <>
                            <span style={{ color: C.line }} className="hidden sm:inline">—</span>
                            <span className="hidden sm:inline">{recipe.ingredients.length} ingrédients</span>
                          </>
                        )}
                      </div>
                    </div>

                    {!recipe.tested && (
                      <>
                        <span className="hidden sm:inline-flex absolute top-1/2 right-3 -translate-y-1/2 items-center gap-1 px-2 py-1 rounded-full text-[9.5px] font-bold uppercase tracking-wider"
                              style={{ backgroundColor: C.sprout, color: C.ink }}>
                          <Sprout className="w-3 h-3" /> À tester
                        </span>
                        <span className="sm:hidden absolute top-2 right-2 w-2 h-2 rounded-full ring-2 ring-white"
                              style={{ backgroundColor: C.sprout }} title="À tester" />
                      </>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Modal d'import */}
        {showImportModal && (
          <div className="fixed inset-0 flex items-end sm:items-center justify-center z-50 p-0 sm:p-6"
               style={{ backgroundColor: 'rgba(16,36,26,.45)' }}>
            <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[88vh] overflow-y-auto"
                 style={{ boxShadow: '0 -8px 40px -12px rgba(16,36,26,.4)' }}>
              <div className="p-5">

                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-xl leading-tight"
                      style={{ color: C.ink, fontFamily: "'Fraunces', Georgia, serif", fontWeight: 600 }}>
                    {importMethod ? METHODES[importMethod].titre : 'Ajouter une recette'}
                  </h2>
                  <button
                    onClick={() => {
                      setShowImportModal(false);
                      setImportMethod(null);
                      setImportText('');
                      setImportImage(null);
                      setImportVideo(null);
                    }}
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 hover:bg-black/5"
                    style={{ color: C.sage }}
                    aria-label="Fermer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {!importMethod ? (
                  <>
                    <p className="text-[13px] mb-4" style={{ color: C.sage }}>
                      Comment souhaitez-vous l&apos;ajouter&nbsp;?
                    </p>

                    <div className="flex flex-col gap-2">
                      {Object.entries(METHODES).map(([cle, m]) => (
                        <button
                          key={cle}
                          onClick={() => {
                            if (cle === 'manuel') {
                              setShowImportModal(false);
                              setCurrentView('add');
                            } else {
                              setImportMethod(cle);
                            }
                          }}
                          className="group flex items-center gap-3 p-3 rounded-xl text-left transition-all hover:bg-black/[.02]"
                          style={{ border: `1px solid ${C.line}` }}
                        >
                          <div className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0"
                               style={{ backgroundColor: C.linen }}>
                            <m.Icone className="w-[18px] h-[18px]" style={{ color: C.stem }} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[15px] font-semibold leading-tight" style={{ color: C.ink }}>
                              {m.nom}
                            </p>
                            <p className="text-[12px] leading-snug mt-0.5" style={{ color: C.sage }}>
                              {m.court}
                            </p>
                          </div>
                          <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded-full shrink-0"
                                style={{ backgroundColor: m.gratuit ? C.sprout : C.linen, color: m.gratuit ? C.ink : C.sage }}>
                            {m.tag}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div>
                    <button
                      onClick={() => {
                        setImportMethod(null);
                        setImportText('');
                        setImportImage(null);
                        setImportVideo(null);
                      }}
                      className="inline-flex items-center gap-1 text-[12px] font-semibold mb-4 hover:opacity-70"
                      style={{ color: C.stem }}
                    >
                      <ArrowLeft className="w-3.5 h-3.5" /> Retour
                    </button>

                    <p className="text-[13px] mb-3 leading-relaxed" style={{ color: C.sage }}>
                      {METHODES[importMethod].aide}
                    </p>

                    {importMethod === 'image' && (
                      <>
                        <label className="flex flex-col items-center justify-center gap-2 py-8 rounded-xl cursor-pointer transition-colors hover:bg-black/[.02]"
                               style={{ border: `1px dashed ${C.line}`, backgroundColor: C.linen }}>
                          <ImageIcon className="w-6 h-6" style={{ color: C.stem }} />
                          <span className="text-[13px] font-semibold" style={{ color: C.ink }}>
                            Choisir une image
                          </span>
                          <span className="text-[11px]" style={{ color: C.sage }}>JPG, PNG ou capture d&apos;écran</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onloadend = () => setImportImage(reader.result);
                                reader.readAsDataURL(file);
                              }
                            }}
                          />
                        </label>

                        {importImage && (
                          <div className="mt-3 rounded-xl overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
                            <img src={importImage} alt="" className="w-full h-40"
                                 style={{ objectFit: 'cover', objectPosition: 'center' }} />
                          </div>
                        )}
                      </>
                    )}

                    {importMethod === 'text' && (
                      <textarea
                        value={importText}
                        onChange={(e) => setImportText(e.target.value)}
                        placeholder={"Collez ici le texte de la recette…\n\nDahl de lentilles corail\nPour 4 personnes\n\nIngrédients\n- 200 g de lentilles corail\n- 400 ml de lait de coco\n\nPréparation\nÉmincez les oignons…"}
                        rows="9"
                        className="w-full px-3.5 py-3 rounded-xl outline-none resize-none text-[14px] leading-relaxed"
                        style={{ backgroundColor: C.linen, border: `1px solid ${C.line}`, color: C.ink }}
                        onFocus={(e) => { e.target.style.borderColor = C.stem; }}
                        onBlur={(e) => { e.target.style.borderColor = C.line; }}
                      />
                    )}

                    {importMethod === 'video' && (
                      <>
                        <div className="flex gap-2.5 p-3 rounded-xl mb-3"
                             style={{ backgroundColor: C.linen, border: `1px solid ${C.line}` }}>
                          <Sprout className="w-4 h-4 shrink-0 mt-0.5" style={{ color: C.stem }} />
                          <p className="text-[12px] leading-snug" style={{ color: C.sage }}>
                            Téléchargez d&apos;abord la vidéo avec une app tierce (SnapInsta, SaveFrom…), puis déposez-la ici.
                          </p>
                        </div>

                        <label className="flex flex-col items-center justify-center gap-2 py-6 rounded-xl cursor-pointer transition-colors hover:bg-black/[.02] mb-3"
                               style={{ border: `1px dashed ${C.line}`, backgroundColor: C.linen }}>
                          <Video className="w-6 h-6" style={{ color: C.stem }} />
                          <span className="text-[13px] font-semibold" style={{ color: C.ink }}>
                            {importVideo ? importVideo.name : 'Choisir une vidéo'}
                          </span>
                          <span className="text-[11px]" style={{ color: C.sage }}>50 Mo maximum</span>
                          <input
                            type="file"
                            accept="video/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                if (file.size > 50 * 1024 * 1024) {
                                  alert('Vidéo trop volumineuse (50 Mo maximum)');
                                  return;
                                }
                                setImportVideo(file);
                              }
                            }}
                          />
                        </label>

                        <textarea
                          value={importText}
                          onChange={(e) => setImportText(e.target.value)}
                          placeholder="Collez aussi la description, c'est là que sont listés les ingrédients…"
                          rows="4"
                          className="w-full px-3.5 py-3 rounded-xl outline-none resize-none text-[14px] leading-relaxed"
                          style={{ backgroundColor: C.linen, border: `1px solid ${C.line}`, color: C.ink }}
                          onFocus={(e) => { e.target.style.borderColor = C.stem; }}
                          onBlur={(e) => { e.target.style.borderColor = C.line; }}
                        />
                      </>
                    )}

                    <button
                      onClick={handleImport}
                      disabled={importDesactive}
                      className="w-full mt-4 py-3.5 rounded-xl font-semibold text-[15px] text-white transition-opacity"
                      style={{
                        backgroundColor: importDesactive ? C.line : C.stem,
                        color: importDesactive ? C.sage : '#fff',
                        cursor: importDesactive ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {isAnalyzing ? 'Analyse en cours…' : 'Analyser et importer'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (currentView === 'view' && viewingRecipe) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: C.linen }}>
        <div className="max-w-4xl mx-auto p-4 sm:p-6">
          <div className="bg-white rounded-2xl overflow-hidden" style={{ border: `1px solid ${C.line}`, boxShadow: '0 12px 32px -18px rgba(16,36,26,.35)' }}>
            {viewingRecipe.image && (
              <div className="h-64 sm:h-96 overflow-hidden" style={{ backgroundColor: C.linen }}>
                <img 
                  src={viewingRecipe.image} 
                  alt={viewingRecipe.name}
                  className="w-full h-full"
                  style={{ objectFit: 'cover', objectPosition: 'center' }}
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
              </div>
            )}
            
            <div className="p-6 sm:p-10">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="min-w-0">
                  <h1 className="text-3xl sm:text-4xl leading-tight"
                      style={{ color: C.ink, fontFamily: "'Fraunces', Georgia, serif", fontWeight: 600 }}>
                    {viewingRecipe.name}
                  </h1>
                  {viewingRecipe.teamId && TEAMS[viewingRecipe.teamId] && (
                    <p className="text-[11px] uppercase tracking-[0.16em] font-semibold mt-2"
                       style={{ color: TEAMS[viewingRecipe.teamId].color }}>
                      {TEAMS[viewingRecipe.teamId].name}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => {
                    setViewingRecipe(null);
                    setCurrentView('home');
                  }}
                  className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors"
                  style={{ color: C.sage, border: `1px solid ${C.line}` }}
                  aria-label="Fermer la recette"
                >
                  ✕
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-8 pb-6 text-sm"
                   style={{ color: C.sage, borderBottom: `1px solid ${C.line}` }}>
                {viewingRecipe.servings && (
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="w-4 h-4" />
                    {viewingRecipe.servings} personne{viewingRecipe.servings > 1 ? 's' : ''}
                  </span>
                )}
                {viewingRecipe.types && viewingRecipe.types.map((type, idx) => (
                  <React.Fragment key={idx}>
                    <span style={{ color: C.line }}>—</span>
                    <span>{type}</span>
                  </React.Fragment>
                ))}
                {!viewingRecipe.tested && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
                        style={{ backgroundColor: C.sprout, color: C.ink }}>
                    <Sprout className="w-3 h-3" /> À tester
                  </span>
                )}
              </div>

              <div className="grid md:grid-cols-[minmax(0,1fr)_1.4fr] gap-8 mb-8">
                {viewingRecipe.ingredients && viewingRecipe.ingredients.length > 0 && (
                  <div>
                    <h2 className="text-[11px] uppercase tracking-[0.18em] font-semibold mb-4" style={{ color: C.sage }}>
                      Ingrédients
                    </h2>
                    <ul className="space-y-2.5">
                      {viewingRecipe.ingredients.map((ing, idx) => (
                        <li key={idx} className="flex items-start gap-2.5 pb-2.5"
                            style={{ borderBottom: idx < viewingRecipe.ingredients.length - 1 ? `1px solid ${C.line}` : 'none' }}>
                          <Leaf className="w-3.5 h-3.5 mt-1 shrink-0" style={{ color: C.stem }} />
                          <span style={{ color: C.ink }}>{ing}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {viewingRecipe.steps && (
                  <div>
                    <h2 className="text-[11px] uppercase tracking-[0.18em] font-semibold mb-4" style={{ color: C.sage }}>
                      Préparation
                    </h2>
                    <p className="whitespace-pre-line leading-[1.75] text-[15px]" style={{ color: C.ink }}>
                      {viewingRecipe.steps}
                    </p>
                  </div>
                )}
              </div>

              {viewingRecipe.createdBy && (
                <p className="text-xs mb-6 pt-4" style={{ color: C.sage, borderTop: `1px solid ${C.line}` }}>
                  Ajoutée par {viewingRecipe.createdBy}
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
                    className="w-full flex items-center justify-center gap-2 text-white px-6 py-3 rounded-xl transition-opacity hover:opacity-90 font-semibold"
                    style={{ backgroundColor: C.stem }}
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
