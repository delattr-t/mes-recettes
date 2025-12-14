import React, { useState, useEffect } from 'react';
import { Plus, Search, ChefHat, Trash2, Edit2, ShoppingCart, Menu, X, Check } from 'lucide-react';

export default function RecipeManager() {
  const [recipes, setRecipes] = useState([]);
  const [currentView, setCurrentView] = useState('home');
  const [editingRecipe, setEditingRecipe] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [shoppingMode, setShoppingMode] = useState(false);
  const [selectedRecipes, setSelectedRecipes] = useState([]);
  const [shoppingList, setShoppingList] = useState('');
  
  const [newRecipe, setNewRecipe] = useState({
    name: '',
    image: '',
    types: [],
    servings: '',
    ingredients: '',
    description: '',
    steps: ''
  });

  const recipeTypes = ['Entrée', 'Plat', 'Dessert', 'Apéritif', 'Petit-déjeuner', 'Goûter'];

  useEffect(() => {
    loadRecipes();
  }, []);

  const loadRecipes = async () => {
    try {
      const keys = await window.storage.list('recipe:');
      if (keys && keys.keys) {
        const loadedRecipes = await Promise.all(
          keys.keys.map(async (key) => {
            try {
              const result = await window.storage.get(key);
              return result ? JSON.parse(result.value) : null;
            } catch {
              return null;
            }
          })
        );
        setRecipes(loadedRecipes.filter(r => r !== null));
      }
    } catch (error) {
      console.error('Erreur de chargement:', error);
    }
  };

  const saveRecipe = async () => {
    if (!newRecipe.name.trim()) {
      alert('Le nom de la recette est obligatoire !');
      return;
    }

    const recipe = {
      ...newRecipe,
      id: editingRecipe?.id || Date.now().toString(),
      createdAt: editingRecipe?.createdAt || new Date().toISOString()
    };

    try {
      await window.storage.set(`recipe:${recipe.id}`, JSON.stringify(recipe));
      await loadRecipes();
      resetForm();
      setCurrentView('home');
    } catch (error) {
      console.error('Erreur de sauvegarde:', error);
      alert('Erreur lors de la sauvegarde');
    }
  };

  const deleteRecipe = async (id) => {
    if (window.confirm('Voulez-vous vraiment supprimer cette recette ?')) {
      try {
        await window.storage.delete(`recipe:${id}`);
        await loadRecipes();
      } catch (error) {
        console.error('Erreur de suppression:', error);
      }
    }
  };

  const editRecipe = (recipe) => {
    setEditingRecipe(recipe);
    setNewRecipe(recipe);
    setCurrentView('add');
  };

  const resetForm = () => {
    setNewRecipe({
      name: '',
      image: '',
      types: [],
      servings: '',
      ingredients: '',
      description: '',
      steps: ''
    });
    setEditingRecipe(null);
  };

  const toggleRecipeSelection = (recipeId) => {
    setSelectedRecipes(prev => 
      prev.includes(recipeId) 
        ? prev.filter(id => id !== recipeId)
        : [...prev, recipeId]
    );
  };

  const generateShoppingList = () => {
    const selectedRecipesData = recipes.filter(r => selectedRecipes.includes(r.id));
    
    let list = '🛒 LISTE DE COURSES\n\n';
    
    selectedRecipesData.forEach(recipe => {
      list += `📌 ${recipe.name}\n`;
      if (recipe.servings) {
        list += `   (${recipe.servings} personnes)\n`;
      }
      const ingredients = recipe.ingredients.split('\n').filter(i => i.trim());
      ingredients.forEach(ingredient => {
        list += `   • ${ingredient}\n`;
      });
      list += '\n';
    });

    setShoppingList(list);
    setCurrentView('shopping-list');
    setShoppingMode(false);
    setSelectedRecipes([]);
  };

  const filteredRecipes = recipes.filter(recipe => {
    const searchLower = searchQuery.toLowerCase();
    return (
      recipe.name.toLowerCase().includes(searchLower) ||
      recipe.ingredients.toLowerCase().includes(searchLower)
    );
  });

  // Vue: Liste de courses (note éditable)
  if (currentView === 'shopping-list') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-red-50 to-pink-50">
        <div className="max-w-4xl mx-auto p-6">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-3xl font-bold text-orange-600 flex items-center gap-2">
                <ShoppingCart className="w-8 h-8" />
                Liste de Courses
              </h2>
              <button
                onClick={() => setCurrentView('home')}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Retour
              </button>
            </div>
            
            <textarea
              value={shoppingList}
              onChange={(e) => setShoppingList(e.target.value)}
              className="w-full h-96 p-4 border-2 border-orange-200 rounded-xl focus:border-orange-500 focus:outline-none resize-none font-mono text-sm"
              placeholder="Votre liste de courses apparaîtra ici..."
            />
            
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(shoppingList);
                  alert('Liste copiée dans le presse-papiers !');
                }}
                className="flex-1 px-6 py-3 bg-green-500 text-white rounded-xl hover:bg-green-600 transition-colors font-semibold"
              >
                📋 Copier la liste
              </button>
              <button
                onClick={() => {
                  setShoppingList('');
                  setCurrentView('home');
                }}
                className="px-6 py-3 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors font-semibold"
              >
                🗑️ Effacer
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Vue: Ajout/Édition de recette
  if (currentView === 'add') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-red-50 to-pink-50 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-3xl font-bold text-orange-600">
                {editingRecipe ? '✏️ Modifier la recette' : '➕ Nouvelle Recette'}
              </h2>
              <button
                onClick={() => {
                  resetForm();
                  setCurrentView('home');
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Nom de la recette</label>
                <input
                  type="text"
                  value={newRecipe.name}
                  onChange={(e) => setNewRecipe({ ...newRecipe, name: e.target.value })}
                  placeholder="Ex: Tarte aux pommes"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">URL de l'image (optionnel)</label>
                <input
                  type="text"
                  value={newRecipe.image}
                  onChange={(e) => setNewRecipe({ ...newRecipe, image: e.target.value })}
                  placeholder="https://..."
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Type de plat</label>
                <div className="flex flex-wrap gap-2">
                  {recipeTypes.map((type) => (
                    <button
                      key={type}
                      onClick={() => {
                        setNewRecipe(prev => ({
                          ...prev,
                          types: prev.types.includes(type)
                            ? prev.types.filter(t => t !== type)
                            : [...prev.types, type]
                        }));
                      }}
                      className={`px-4 py-2 rounded-lg border-2 transition-colors ${
                        newRecipe.types.includes(type)
                          ? 'bg-orange-500 text-white border-orange-500'
                          : 'bg-white text-gray-700 border-gray-200 hover:border-orange-300'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Nombre de personnes</label>
                <input
                  type="number"
                  min="1"
                  value={newRecipe.servings}
                  onChange={(e) => setNewRecipe({ ...newRecipe, servings: e.target.value })}
                  placeholder="Ex: 4"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Liste des ingrédients (un par ligne)</label>
                <textarea
                  value={newRecipe.ingredients}
                  onChange={(e) => setNewRecipe({ ...newRecipe, ingredients: e.target.value })}
                  placeholder="Ex:&#10;200g de farine&#10;3 œufs&#10;100ml de lait"
                  rows="10"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Description</label>
                <textarea
                  value={newRecipe.description}
                  onChange={(e) => setNewRecipe({ ...newRecipe, description: e.target.value })}
                  placeholder="Description courte de la recette..."
                  rows="3"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Étapes de préparation</label>
                <textarea
                  value={newRecipe.steps}
                  onChange={(e) => setNewRecipe({ ...newRecipe, steps: e.target.value })}
                  placeholder="Décrivez les étapes de préparation...&#10;&#10;1. Préchauffer le four à 180°C&#10;2. Mélanger la farine..."
                  rows="10"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:outline-none resize-none"
                />
              </div>

              <button
                onClick={saveRecipe}
                className="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white py-4 rounded-xl font-bold text-lg hover:from-orange-600 hover:to-red-600 transition-all shadow-lg"
              >
                {editingRecipe ? '💾 Mettre à jour' : '✅ Enregistrer la recette'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Vue: Accueil avec liste des recettes
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-red-50 to-pink-50">
      {/* Header avec menu déroulant */}
      <div className="bg-white shadow-lg sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ChefHat className="w-8 h-8 text-orange-600" />
              <h1 className="text-2xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent">
                Mes Recettes
              </h1>
            </div>
            
            {/* Bouton Menu */}
            <div className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <Menu className="w-6 h-6 text-gray-700" />
              </button>
              
              {/* Menu déroulant */}
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => {
                      setShoppingMode(!shoppingMode);
                      setMenuOpen(false);
                      if (shoppingMode) {
                        setSelectedRecipes([]);
                      }
                    }}
                    className="w-full px-4 py-3 text-left hover:bg-orange-50 transition-colors flex items-center gap-2 text-gray-700"
                  >
                    <ShoppingCart className="w-5 h-5 text-orange-600" />
                    {shoppingMode ? 'Annuler sélection' : 'Liste de courses'}
                  </button>
                  <button
                    onClick={() => {
                      setCurrentView('add');
                      setMenuOpen(false);
                    }}
                    className="w-full px-4 py-3 text-left hover:bg-orange-50 transition-colors flex items-center gap-2 text-gray-700"
                  >
                    <Plus className="w-5 h-5 text-orange-600" />
                    Nouvelle recette
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6">
        {/* Barre de recherche */}
        <div className="mb-8">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher une recette ou un ingrédient..."
              className="w-full pl-12 pr-4 py-4 rounded-xl border-2 border-gray-200 focus:border-orange-500 focus:outline-none shadow-sm"
            />
          </div>
        </div>

        {/* Mode sélection actif */}
        {shoppingMode && (
          <div className="mb-6 bg-orange-100 border-2 border-orange-300 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ShoppingCart className="w-6 h-6 text-orange-600" />
                <span className="font-semibold text-orange-800">
                  {selectedRecipes.length} recette{selectedRecipes.length > 1 ? 's' : ''} sélectionnée{selectedRecipes.length > 1 ? 's' : ''}
                </span>
              </div>
              <button
                onClick={generateShoppingList}
                disabled={selectedRecipes.length === 0}
                className={`px-6 py-2 rounded-lg font-semibold transition-colors ${
                  selectedRecipes.length > 0
                    ? 'bg-orange-600 text-white hover:bg-orange-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                ✅ Terminé
              </button>
            </div>
          </div>
        )}

        {/* Liste des recettes */}
        {filteredRecipes.length === 0 ? (
          <div className="text-center py-20">
            <ChefHat className="w-20 h-20 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 text-lg mb-6">
              {recipes.length === 0 ? 'Aucune recette enregistrée' : 'Aucune recette trouvée'}
            </p>
            {recipes.length === 0 && (
              <button
                onClick={() => setCurrentView('add')}
                className="px-8 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-semibold hover:from-orange-600 hover:to-red-600 transition-all shadow-lg"
              >
                ➕ Ajouter ma première recette
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredRecipes.map((recipe) => (
              <div
                key={recipe.id}
                className={`bg-white rounded-2xl shadow-lg overflow-hidden hover:shadow-xl transition-all cursor-pointer ${
                  shoppingMode && selectedRecipes.includes(recipe.id)
                    ? 'ring-4 ring-orange-500'
                    : ''
                }`}
                onClick={() => shoppingMode && toggleRecipeSelection(recipe.id)}
              >
                {/* Case à cocher en mode sélection */}
                {shoppingMode && (
                  <div className="absolute top-4 right-4 z-10">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      selectedRecipes.includes(recipe.id)
                        ? 'bg-orange-500'
                        : 'bg-white border-2 border-gray-300'
                    }`}>
                      {selectedRecipes.includes(recipe.id) && (
                        <Check className="w-5 h-5 text-white" />
                      )}
                    </div>
                  </div>
                )}

                {recipe.image && (
                  <img
                    src={recipe.image}
                    alt={recipe.name}
                    className="w-full h-48 object-cover"
                  />
                )}
                
                <div className="p-6">
                  <h3 className="text-xl font-bold text-gray-800 mb-2">{recipe.name}</h3>
                  
                  {recipe.types && recipe.types.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {recipe.types.map((type, idx) => (
                        <span
                          key={idx}
                          className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-semibold"
                        >
                          {type}
                        </span>
                      ))}
                    </div>
                  )}

                  {recipe.servings && (
                    <p className="text-sm text-gray-600 mb-3">
                      👥 {recipe.servings} personne{recipe.servings > 1 ? 's' : ''}
                    </p>
                  )}

                  {recipe.description && (
                    <p className="text-gray-600 text-sm mb-4 line-clamp-2">
                      {recipe.description}
                    </p>
                  )}

                  {!shoppingMode && (
                    <div className="flex gap-2 mt-4">
                      <button
                        onClick={() => editRecipe(recipe)}
                        className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center justify-center gap-2"
                      >
                        <Edit2 className="w-4 h-4" />
                        Modifier
                      </button>
                      <button
                        onClick={() => deleteRecipe(recipe.id)}
                        className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
