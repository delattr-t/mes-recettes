import React, { useState, useEffect } from 'react';
import { Plus, Search, ChefHat, Trash2, Edit2, Cloud, CloudOff } from 'lucide-react';

// Configuration Firebase - À REMPLACER avec vos propres identifiants
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDyhJKh9-nElxZ6bpK5EFk7r2wy0oy8u1M",
  authDomain: "mes-recettes-1bd22.firebaseapp.com",
  databaseURL: "https://mes-recettes-1bd22-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "mes-recettes-1bd22",
  storageBucket: "mes-recettes-1bd22.firebasestorage.app",
  messagingSenderId: "813094403524",
  appId: "1:813094403524:web:6413eb377c018ff419f891",
  measurementId: "G-TV87LZRMC8"
};

export default function RecipeManager() {
  const [recipes, setRecipes] = useState([]);
  const [currentView, setCurrentView] = useState('home');
  const [editingRecipe, setEditingRecipe] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState('connecting');
  const [db, setDb] = useState(null);
  
  const [newRecipe, setNewRecipe] = useState({
    name: '',
    ingredients: '',
    description: '',
    steps: '',
    image: ''
  });
  const [activeTab, setActiveTab] = useState('ingredients');

  // Initialisation Firebase
  useEffect(() => {
    const initFirebase = async () => {
      try {
        // Charger Firebase depuis CDN
        const firebaseApp = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const firebaseDatabase = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
        
        // Vérifier si la config est valide
        if (FIREBASE_CONFIG.apiKey === "VOTRE_API_KEY") {
          setSyncStatus('no-config');
          // Utiliser localStorage comme fallback
          loadFromLocalStorage();
          return;
        }

        // Initialiser Firebase
        const app = firebaseApp.initializeApp(FIREBASE_CONFIG);
        const database = firebaseDatabase.getDatabase(app);
        setDb(database);
        
        // Écouter les changements en temps réel
        const recipesRef = firebaseDatabase.ref(database, 'recipes');
        firebaseDatabase.onValue(recipesRef, (snapshot) => {
          const data = snapshot.val();
          if (data) {
            const recipesArray = Object.values(data);
            setRecipes(recipesArray);
            setSyncStatus('synced');
          } else {
            setRecipes([]);
            setSyncStatus('synced');
          }
        });

        setFirebaseReady(true);
      } catch (error) {
        console.error('Erreur Firebase:', error);
        setSyncStatus('error');
        loadFromLocalStorage();
      }
    };

    initFirebase();
  }, []);

  const loadFromLocalStorage = () => {
    try {
      const stored = localStorage.getItem('recipes');
      if (stored) {
        setRecipes(JSON.parse(stored));
      }
      setSyncStatus('local');
    } catch (error) {
      console.error('Erreur localStorage:', error);
    }
  };

  const saveToLocalStorage = (recipesData) => {
    try {
      localStorage.setItem('recipes', JSON.stringify(recipesData));
    } catch (error) {
      console.error('Erreur sauvegarde locale:', error);
    }
  };

  const saveRecipe = async () => {
    if (!newRecipe.name.trim()) {
      alert('Veuillez entrer un nom pour la recette');
      return;
    }

    const recipe = {
      id: editingRecipe?.id || Date.now().toString(),
      name: newRecipe.name,
      ingredients: newRecipe.ingredients.split('\n').filter(i => i.trim()),
      description: newRecipe.description,
      steps: newRecipe.steps,
      image: newRecipe.image,
      createdAt: editingRecipe?.createdAt || new Date().toISOString()
    };

    try {
      if (firebaseReady && db) {
        // Sauvegarder sur Firebase
        const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
        const recipeRef = ref(db, `recipes/${recipe.id}`);
        await set(recipeRef, recipe);
        setSyncStatus('synced');
      } else {
        // Sauvegarder localement
        const updatedRecipes = editingRecipe
          ? recipes.map(r => r.id === recipe.id ? recipe : r)
          : [...recipes, recipe];
        setRecipes(updatedRecipes);
        saveToLocalStorage(updatedRecipes);
      }
      
      resetForm();
      setCurrentView('home');
    } catch (error) {
      console.error('Erreur lors de la sauvegarde:', error);
      alert('Erreur lors de la sauvegarde de la recette');
    }
  };

  const deleteRecipe = async (id) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette recette ?')) return;

    try {
      if (firebaseReady && db) {
        const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
        const recipeRef = ref(db, `recipes/${id}`);
        await remove(recipeRef);
      } else {
        const updatedRecipes = recipes.filter(r => r.id !== id);
        setRecipes(updatedRecipes);
        saveToLocalStorage(updatedRecipes);
      }
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
    }
  };

  const editRecipe = (recipe) => {
    setEditingRecipe(recipe);
    setNewRecipe({
      name: recipe.name,
      ingredients: recipe.ingredients.join('\n'),
      description: recipe.description,
      steps: recipe.steps,
      image: recipe.image || ''
    });
    setCurrentView('add');
  };

  const resetForm = () => {
    setNewRecipe({ name: '', ingredients: '', description: '', steps: '', image: '' });
    setEditingRecipe(null);
    setActiveTab('ingredients');
  };

  const filteredRecipes = recipes.filter(recipe => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const matchesName = recipe.name.toLowerCase().includes(query);
    const matchesIngredients = recipe.ingredients.some(ing => 
      ing.toLowerCase().includes(query)
    );
    return matchesName || matchesIngredients;
  });

  const SyncIndicator = () => {
    const statusConfig = {
      'connecting': { icon: Cloud, color: 'text-gray-400', text: 'Connexion...' },
      'synced': { icon: Cloud, color: 'text-green-500', text: 'Synchronisé' },
      'local': { icon: CloudOff, color: 'text-blue-500', text: 'Local uniquement' },
      'no-config': { icon: CloudOff, color: 'text-yellow-500', text: 'Config Firebase manquante' },
      'error': { icon: CloudOff, color: 'text-red-500', text: 'Erreur de connexion' }
    };

    const config = statusConfig[syncStatus] || statusConfig.local;
    const Icon = config.icon;

    return (
      <div className={`flex items-center gap-2 ${config.color} text-sm`}>
        <Icon className="w-4 h-4" />
        <span>{config.text}</span>
      </div>
    );
  };

  // Vue d'accueil
  if (currentView === 'home') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50">
        <div className="max-w-6xl mx-auto p-6">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <ChefHat className="w-10 h-10 text-orange-600" />
                <div>
                  <h1 className="text-4xl font-bold text-gray-800">Mes Recettes</h1>
                  <SyncIndicator />
                </div>
              </div>
              <button
                onClick={() => setCurrentView('add')}
                className="flex items-center gap-2 bg-orange-600 text-white px-6 py-3 rounded-xl hover:bg-orange-700 transition-colors shadow-lg"
              >
                <Plus className="w-5 h-5" />
                Nouvelle Recette
              </button>
            </div>

            <div className="mb-6">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  placeholder="Rechercher par nom ou ingrédient..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none"
                />
              </div>
            </div>

            {filteredRecipes.length === 0 ? (
              <div className="text-center py-16">
                <ChefHat className="w-20 h-20 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 text-lg">
                  {searchQuery ? 'Aucune recette trouvée' : 'Aucune recette enregistrée. Commencez par en ajouter une !'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredRecipes.map((recipe) => (
                  <div key={recipe.id} className="bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl transition-shadow">
                    {recipe.image && (
                      <div className="h-48 overflow-hidden bg-gray-100">
                        <img 
                          src={recipe.image} 
                          alt={recipe.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <div className="p-6">
                      <div className="flex justify-between items-start mb-3">
                        <h3 className="text-xl font-bold text-gray-800 flex-1">{recipe.name}</h3>
                        <div className="flex gap-2">
                          <button
                            onClick={() => editRecipe(recipe)}
                            className="text-blue-600 hover:text-blue-700 p-2"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => deleteRecipe(recipe.id)}
                            className="text-red-600 hover:text-red-700 p-2"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      
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
                      
                      {recipe.description && (
                        <p className="text-sm text-gray-600 line-clamp-3">
                          {recipe.description}
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

  // Vue d'ajout/édition de recette
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
              Photo de la recette (URL)
            </label>
            <input
              type="url"
              value={newRecipe.image}
              onChange={(e) => setNewRecipe({ ...newRecipe, image: e.target.value })}
              placeholder="Ex: https://example.com/image.jpg"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none"
            />
            {newRecipe.image && (
              <div className="mt-3 rounded-xl overflow-hidden border-2 border-gray-200">
                <img 
                  src={newRecipe.image} 
                  alt="Aperçu" 
                  className="w-full h-64 object-cover"
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
              </div>
            )}
          </div>

          <div className="border-b border-gray-200 mb-6">
            <div className="flex gap-4">
              <button
                onClick={() => setActiveTab('ingredients')}
                className={`pb-3 px-4 font-semibold transition-colors ${
                  activeTab === 'ingredients'
                    ? 'border-b-2 border-orange-600 text-orange-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Ingrédients
              </button>
              <button
                onClick={() => setActiveTab('preparation')}
                className={`pb-3 px-4 font-semibold transition-colors ${
                  activeTab === 'preparation'
                    ? 'border-b-2 border-orange-600 text-orange-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Préparation
              </button>
            </div>
          </div>

          {activeTab === 'ingredients' ? (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Liste des ingrédients (un par ligne)
              </label>
              <textarea
                value={newRecipe.ingredients}
                onChange={(e) => setNewRecipe({ ...newRecipe, ingredients: e.target.value })}
                placeholder="Ex:&#10;200g de farine&#10;3 œufs&#10;100ml de lait"
                rows="12"
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none resize-none"
              />
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  value={newRecipe.description}
                  onChange={(e) => setNewRecipe({ ...newRecipe, description: e.target.value })}
                  placeholder="Décrivez brièvement votre recette..."
                  rows="4"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none resize-none"
                />
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Étapes de préparation
                </label>
                <textarea
                  value={newRecipe.steps}
                  onChange={(e) => setNewRecipe({ ...newRecipe, steps: e.target.value })}
                  placeholder="Décrivez les étapes de préparation...&#10;&#10;1. Préchauffer le four à 180°C&#10;2. Mélanger les ingrédients secs..."
                  rows="12"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none resize-none"
                />
              </div>
            </div>
          )}

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
