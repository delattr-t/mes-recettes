import React, { useState, useEffect } from 'react';
import { Plus, Search, ChefHat, Trash2, Edit2, Cloud, CloudOff, LogOut, LogIn } from 'lucide-react';
import { database, auth, googleProvider } from './firebaseConfig';
import { ref, set, onValue, remove } from 'firebase/database';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';

export default function RecipeManager() {
  const [recipes, setRecipes] = useState([]);
  const [currentView, setCurrentView] = useState('home');
  const [editingRecipe, setEditingRecipe] = useState(null);
  const [viewingRecipe, setViewingRecipe] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [syncStatus, setSyncStatus] = useState('connecting');
  const [user, setUser] = useState(null);
  
  const [newRecipe, setNewRecipe] = useState({
    name: '',
    servings: '',
    types: [],
    ingredients: '',
    steps: '',
    image: ''
  });

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });

    const recipesRef = ref(database, 'recipes');
    
    const unsubscribeData = onValue(recipesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const recipesArray = Object.values(data);
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
      image: recipe.image || ''
    });
    setViewingRecipe(null);
    setCurrentView('add');
  };

  const viewRecipe = (recipe) => {
    setViewingRecipe(recipe);
    setCurrentView('view');
  };

  const resetForm = () => {
    setNewRecipe({ name: '', servings: '', types: [], ingredients: '', steps: '', image: '' });
    setEditingRecipe(null);
  };

  const toggleType = (type) => {
    if (newRecipe.types.includes(type)) {
      setNewRecipe({ ...newRecipe, types: newRecipe.types.filter(t => t !== type) });
    } else {
      setNewRecipe({ ...newRecipe, types: [...newRecipe.types, type] });
    }
  };

  const filteredRecipes = recipes.filter(recipe => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const matchesName = recipe.name.toLowerCase().includes(query);
    const matchesIngredients = recipe.ingredients && recipe.ingredients.some(ing => 
      ing.toLowerCase().includes(query)
    );
    return matchesName || matchesIngredients;
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

  if (currentView === 'home') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50">
        <div className="max-w-6xl mx-auto p-6">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-4">
                <ChefHat className="w-10 h-10 text-orange-600" />
                <div>
                  <h1 className="text-4xl font-bold text-gray-800">Mes Recettes</h1>
                  <SyncIndicator />
                </div>
              </div>
              
              <div className="flex flex-col gap-3">
                {user ? (
                  <>
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                      <p className="text-sm text-gray-600">Connecté en tant que</p>
                      <p className="text-sm font-semibold text-gray-800">{user.email}</p>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={handleLogout}
                        className="flex-1 flex items-center justify-center gap-2 bg-gray-600 text-white px-6 py-3 rounded-xl hover:bg-gray-700 transition-colors shadow-lg"
                      >
                        <LogOut className="w-5 h-5" />
                        Se déconnecter
                      </button>
                      <button
                        onClick={() => setCurrentView('add')}
                        className="flex-1 flex items-center justify-center gap-2 bg-orange-600 text-white px-6 py-3 rounded-xl hover:bg-orange-700 transition-colors shadow-lg"
                      >
                        <Plus className="w-5 h-5" />
                        Nouvelle Recette
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      onClick={handleLogin}
                      className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl hover:bg-blue-700 transition-colors shadow-lg"
                    >
                      <LogIn className="w-5 h-5" />
                      Se connecter
                    </button>
                    <button
                      onClick={() => {
                        alert('Veuillez vous connecter pour ajouter une recette');
                      }}
                      className="w-full flex items-center justify-center gap-2 bg-orange-600 text-white px-6 py-3 rounded-xl hover:bg-orange-700 transition-colors shadow-lg"
                    >
                      <Plus className="w-5 h-5" />
                      Nouvelle Recette
                    </button>
                  </>
                )}
              </div>
            </div>

            {!user && (
              <div className="mb-6 bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
                <p className="text-blue-800 text-sm">
                  ℹ️ Vous pouvez consulter les recettes, mais vous devez vous connecter pour en ajouter, modifier ou supprimer.
                </p>
              </div>
            )}

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
                  <div 
                    key={recipe.id} 
                    onClick={() => viewRecipe(recipe)}
                    className="bg-white rounded-xl overflow-hidden shadow-md hover:shadow-xl transition-shadow cursor-pointer"
                  >
                    {recipe.image && (
                      <div className="h-48 overflow-hidden bg-gray-100">
                        <img 
                          src={recipe.image} 
                          alt={recipe.name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.target.style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                    <div className="p-6">
                      <h3 className="text-xl font-bold text-gray-800 mb-3">{recipe.name}</h3>
                      
                      {recipe.servings && (
                        <p className="text-xs text-gray-500 mb-2">
                          👥 Pour {recipe.servings} personne{recipe.servings > 1 ? 's' : ''}
                        </p>
                      )}

                      {recipe.types && recipe.types.length > 0 && (
                        <div className="mb-3 flex flex-wrap gap-2">
                          {recipe.types.map((type, idx) => (
                            <span key={idx} className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
                              {type}
                            </span>
                          ))}
                        </div>
                      )}
                      
                      {recipe.ingredients && recipe.ingredients.length > 0 && (
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
                      
                      {recipe.createdBy && (
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
                {viewingRecipe.servings && (
                  <div className="flex items-center gap-2 bg-blue-50 px-4 py-2 rounded-xl">
                    <span className="text-blue-700 font-semibold">👥 {viewingRecipe.servings} personne{viewingRecipe.servings > 1 ? 's' : ''}</span>
                  </div>
                )}
                {viewingRecipe.types && viewingRecipe.types.length > 0 && viewingRecipe.types.map((type, idx) => (
                  <span key={idx} className="inline-block px-4 py-2 rounded-xl text-sm font-semibold bg-purple-100 text-purple-700">
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

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setViewingRecipe(null);
                    setCurrentView('home');
                  }}
                  className="flex-1 px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors font-semibold"
                >
                  Retour
                </button>
                {user && (
                  <>
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
                      className="px-6 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors shadow-lg font-semibold"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </>
                )}
              </div>
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
                      ? 'bg-purple-600 text-white border-purple-600'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-purple-300'
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
                  <span key={idx} className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
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
