import React, { useState, useEffect } from 'react';
import { Plus, Search, ChefHat, Trash2, Edit2, Cloud, CloudOff, LogOut, LogIn, ShoppingCart } from 'lucide-react';
import { database, auth, googleProvider } from './firebaseConfig';
import { ref, set, onValue, remove } from 'firebase/database';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';

export default function RecipeManager() {
  const [recipes, setRecipes] = useState([]);
  const [currentView, setCurrentView] = useState('home');
  const [editingRecipe, setEditingRecipe] = useState(null);
  const [viewingRecipe, setViewingRecipe] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('');
  const [gridView, setGridView] = useState('single');
  const [syncStatus, setSyncStatus] = useState('connecting');
  const [user, setUser] = useState(null);
  const [shoppingMode, setShoppingMode] = useState(false);
  const [selectedRecipes, setSelectedRecipes] = useState([]);
  const [shoppingList, setShoppingList] = useState(null);
  const [editableShoppingList, setEditableShoppingList] = useState('');
  
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
    
    // Créer la liste formatée
    const allIngredients = Array.from(ingredientMap.values()).map(item => {
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
    
    const listText = allIngredients.join('\n');
    setEditableShoppingList(listText);
    setShoppingList({
      recipes: selectedRecipesData,
      ingredients: allIngredients
    });
    setCurrentView('shopping');
    setShoppingMode(false);
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

  if (currentView === 'home') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50">
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

            {!shoppingMode && (
              <button
                onClick={startShoppingMode}
                className="fixed bottom-6 right-24 bg-green-600 text-white p-4 rounded-full hover:bg-green-700 transition-all shadow-2xl hover:scale-110 z-50"
                title="Liste de courses"
              >
                <ShoppingCart className="w-7 h-7" />
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

              {(searchQuery || filterType) && (
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
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setFilterType('');
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
                      <div className={`overflow-hidden bg-gray-100 ${gridView === 'single' ? 'h-48' : 'h-32'} relative`}>
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
                    <div className={gridView === 'single' ? 'p-6' : 'p-3'}>
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
    const copyList = () => {
      navigator.clipboard.writeText(editableShoppingList);
      alert('Liste copiée dans le presse-papier !');
    };

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
                <h2 className="text-xl font-bold text-gray-800">Liste modifiable</h2>
                <span className="text-sm text-gray-500">Vous pouvez modifier le texte ci-dessous</span>
              </div>
              <textarea
                value={editableShoppingList}
                onChange={(e) => setEditableShoppingList(e.target.value)}
                className="w-full h-96 px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none resize-none font-mono text-sm"
                placeholder="Votre liste de courses apparaîtra ici..."
              />
            </div>

            <div className="space-y-3">
              <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4 mb-4">
                <p className="text-sm text-yellow-800">
                  💡 <strong>Astuce :</strong> Copiez la liste ci-dessus, puis collez-la dans la barre de recherche de votre drive préféré. Vous pourrez ensuite chercher et ajouter chaque produit rapidement !
                </p>
              </div>

              <button
                onClick={copyList}
                className="w-full bg-orange-600 text-white px-6 py-3 rounded-xl hover:bg-orange-700 transition-colors shadow-lg font-semibold"
              >
                📋 Copier la liste complète
              </button>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => {
                    // Copier seulement les noms sans quantités
                    const simpleList = editableShoppingList
                      .split('\n')
                      .map(line => {
                        // Extraire juste le nom de l'ingrédient (entre la quantité et la parenthèse)
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
                    // Copier pour envoi SMS/WhatsApp
                    const cleanList = editableShoppingList.replace(/•/g, '-');
                    navigator.clipboard.writeText(`🛒 Liste de courses:\n\n${cleanList}`);
                    alert('Liste copiée pour SMS/WhatsApp !');
                  }}
                  className="bg-green-600 text-white px-4 py-3 rounded-xl hover:bg-green-700 transition-colors font-semibold text-sm"
                >
                  💬 Copier pour SMS
                </button>
              </div>

              <div className="border-t-2 border-gray-200 pt-4">
                <p className="text-sm font-semibold text-gray-700 mb-3 text-center">Ouvrir un drive :</p>
                <div className="grid grid-cols-2 gap-3">
                  <a
                    href="https://www.carrefour.fr/drive"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center bg-blue-600 text-white px-4 py-3 rounded-xl hover:bg-blue-700 transition-colors font-semibold"
                  >
                    🏪 Carrefour
                  </a>
                  <a
                    href="https://www.auchan.fr/magasins-et-drives"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center bg-red-600 text-white px-4 py-3 rounded-xl hover:bg-red-700 transition-colors font-semibold"
                  >
                    🏪 Auchan
                  </a>
                  <a
                    href="https://www.leclercdrive.fr"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center bg-green-600 text-white px-4 py-3 rounded-xl hover:bg-green-700 transition-colors font-semibold"
                  >
                    🏪 Leclerc
                  </a>
                  <a
                    href="https://www.coursesu.com/drive"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center bg-yellow-600 text-white px-4 py-3 rounded-xl hover:bg-yellow-700 transition-colors font-semibold"
                  >
                    🏪 U
                  </a>
                </div>
              </div>

              <button
                onClick={() => {
                  setCurrentView('home');
                  setShoppingList(null);
                  setSelectedRecipes([]);
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
              {/* Option 1: Upload depuis la galerie */}
              <div>
                <label className="block text-xs text-gray-600 mb-2">Option 1 : Depuis votre galerie</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      // Vérifier la taille (max 5MB)
                      if (file.size > 5 * 1024 * 1024) {
                        alert('L\'image est trop grande (max 5MB)');
                        return;
                      }
                      
                      // Convertir en base64
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        setNewRecipe({ ...newRecipe, image: reader.result });
                      };
                      reader.readAsDataURL(file);
                    }
                  }}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none bg-white file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100"
                />
              </div>
              
              {/* Option 2: URL */}
              <div>
                <label className="block text-xs text-gray-600 mb-2">Option 2 : Depuis une URL</label>
                <input
                  type="url"
                  value={newRecipe.image?.startsWith('data:') ? '' : newRecipe.image}
                  onChange={(e) => setNewRecipe({ ...newRecipe, image: e.target.value })}
                  placeholder="Ex: https://example.com/image.jpg"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none"
                />
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
