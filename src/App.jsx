import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, onSnapshot, query, deleteDoc, updateDoc, addDoc } from 'firebase/firestore';
import { 
  Camera, 
  Plus, 
  Trash2, 
  ShoppingCart, 
  Package, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  X,
  Edit2
} from 'lucide-react';

// --- Configuración de Firebase y Variables Globales ---
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'pantry-manager-123';
const apiKey = ""; // La plataforma proporciona la clave en el entorno de ejecución

const App = () => {
  const [user, setUser] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState('inventory'); // 'inventory' | 'shopping'
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualItem, setManualItem] = useState({ name: '', quantity: 1, category: 'General' });

  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // 1. Autenticación inicial
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Error de autenticación:", error);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 2. Escuchar cambios en la base de datos (Firestore)
  useEffect(() => {
    if (!user) return;

    const inventoryRef = collection(db, 'artifacts', appId, 'users', user.uid, 'pantry');
    const q = query(inventoryRef);

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const pantryData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setItems(pantryData);
      setLoading(false);
    }, (error) => {
      console.error("Error en Firestore:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  // --- Lógica de la Cámara ---
  const startCamera = async () => {
    setIsScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error accediendo a la cámara:", err);
      setIsScanning(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
    }
    setIsScanning(false);
  };

  // --- Lógica de IA (Gemini) ---
  const callGeminiVision = async (base64Image) => {
    const systemPrompt = "Eres un asistente de cocina. Identifica el producto en la imagen. Responde UNICAMENTE en formato JSON: {\"name\": \"Nombre del producto\", \"category\": \"Categoría (ej: Lácteos, Frutas, Limpieza)\"}";
    
    const fetchWithRetry = async (retries = 5, delay = 1000) => {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [
                { text: "Identify this pantry item." },
                { inlineData: { mimeType: "image/png", data: base64Image } }
              ]
            }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: { responseMimeType: "application/json" }
          })
        });

        if (!response.ok) throw new Error('API Error');
        const data = await response.json();
        return JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
      } catch (err) {
        if (retries > 0) {
          await new Promise(r => setTimeout(r, delay));
          return fetchWithRetry(retries - 1, delay * 2);
        }
        throw err;
      }
    };

    return fetchWithRetry();
  };

  const captureAndIdentify = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setIsAnalyzing(true);
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

    const base64Image = canvas.toDataURL('image/png').split(',')[1];
    
    try {
      const product = await callGeminiVision(base64Image);
      if (product.name) {
        await addItemToFirestore(product.name, product.category || 'Varios');
      }
      stopCamera();
    } catch (err) {
      console.error("Error analizando imagen:", err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // --- Acciones de Datos ---
  const addItemToFirestore = async (name, category) => {
    if (!user) return;
    try {
      const inventoryRef = collection(db, 'artifacts', appId, 'users', user.uid, 'pantry');
      await addDoc(inventoryRef, {
        name,
        category,
        quantity: 1,
        inStock: true,
        updatedAt: Date.now()
      });
    } catch (err) {
      console.error("Error guardando item:", err);
    }
  };

  const toggleStock = async (item) => {
    if (!user) return;
    const itemRef = doc(db, 'artifacts', appId, 'users', user.uid, 'pantry', item.id);
    await updateDoc(itemRef, { inStock: !item.inStock });
  };

  const deleteItem = async (id) => {
    if (!user) return;
    const itemRef = doc(db, 'artifacts', appId, 'users', user.uid, 'pantry', id);
    await deleteDoc(itemRef);
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (!manualItem.name) return;
    await addItemToFirestore(manualItem.name, manualItem.category);
    setManualItem({ name: '', quantity: 1, category: 'General' });
    setShowManualModal(false);
  };

  // --- UI Components ---
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
        <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
        <p className="text-slate-600 font-medium">Sincronizando tu despensa...</p>
      </div>
    );
  }

  const inventoryItems = items.filter(i => i.inStock);
  const shoppingItems = items.filter(i => !i.inStock);

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-30 px-4 py-4">
        <div className="max-w-md mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <Package className="text-white w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight">Mi Despensa</h1>
          </div>
          <button 
            onClick={() => setShowManualModal(true)}
            className="p-2 hover:bg-slate-100 rounded-full transition-colors"
          >
            <Plus className="w-6 h-6 text-indigo-600" />
          </button>
        </div>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-6">
        {/* Tabs de Navegación */}
        <div className="flex bg-slate-200/50 p-1 rounded-xl">
          <button 
            onClick={() => setActiveTab('inventory')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'inventory' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600'}`}
          >
            <Package className="w-4 h-4" />
            En Stock ({inventoryItems.length})
          </button>
          <button 
            onClick={() => setActiveTab('shopping')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'shopping' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600'}`}
          >
            <ShoppingCart className="w-4 h-4" />
            Faltantes ({shoppingItems.length})
          </button>
        </div>

        {/* Lista de Items */}
        <div className="space-y-3">
          {(activeTab === 'inventory' ? inventoryItems : shoppingItems).length === 0 ? (
            <div className="text-center py-20 px-6">
              <div className="bg-white w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100">
                {activeTab === 'inventory' ? <Package className="w-8 h-8 text-slate-300" /> : <ShoppingCart className="w-8 h-8 text-slate-300" />}
              </div>
              <h3 className="text-slate-800 font-semibold mb-1">
                {activeTab === 'inventory' ? 'Tu despensa está vacía' : '¡Todo está en orden!'}
              </h3>
              <p className="text-slate-500 text-sm">
                {activeTab === 'inventory' ? 'Usa la cámara o el botón + para agregar productos.' : 'No tienes productos marcados como faltantes.'}
              </p>
            </div>
          ) : (
            (activeTab === 'inventory' ? inventoryItems : shoppingItems).map(item => (
              <div key={item.id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between group transition-all hover:shadow-md">
                <div className="flex-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">
                    {item.category}
                  </span>
                  <h4 className="text-slate-800 font-semibold mt-1">{item.name}</h4>
                </div>
                
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => toggleStock(item)}
                    className={`p-2 rounded-xl transition-colors ${item.inStock ? 'text-slate-400 hover:bg-amber-50 hover:text-amber-600' : 'text-emerald-500 hover:bg-emerald-50'}`}
                    title={item.inStock ? "Marcar como faltante" : "Agregar al stock"}
                  >
                    {item.inStock ? <ShoppingCart className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
                  </button>
                  <button 
                    onClick={() => deleteItem(item.id)}
                    className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      {/* Botón Flotante para Escanear */}
      <div className="fixed bottom-8 left-0 right-0 px-4 flex justify-center pointer-events-none">
        <button 
          onClick={startCamera}
          className="pointer-events-auto bg-indigo-600 text-white flex items-center gap-3 px-8 py-4 rounded-full shadow-xl shadow-indigo-200 hover:bg-indigo-700 transition-all transform active:scale-95"
        >
          <Camera className="w-6 h-6" />
          <span className="font-bold">Escanear Producto</span>
        </button>
      </div>

      {/* Modal de Cámara */}
      {isScanning && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center">
          <div className="relative w-full max-w-lg aspect-[3/4] overflow-hidden">
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              className="w-full h-full object-cover"
            />
            {/* Overlay de la cámara */}
            <div className="absolute inset-0 border-[40px] border-black/40 pointer-events-none">
              <div className="w-full h-full border-2 border-white/50 rounded-lg relative">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-indigo-500 -mt-1 -ml-1"></div>
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-indigo-500 -mt-1 -mr-1"></div>
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-indigo-500 -mb-1 -ml-1"></div>
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-indigo-500 -mb-1 -mr-1"></div>
              </div>
            </div>
            
            {isAnalyzing && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 text-white">
                <Loader2 className="w-12 h-12 animate-spin mb-4" />
                <p className="font-medium animate-pulse">Identificando producto...</p>
              </div>
            )}
          </div>

          <div className="w-full max-w-lg p-8 flex justify-between items-center bg-zinc-900">
            <button 
              onClick={stopCamera}
              className="p-4 text-white hover:bg-white/10 rounded-full transition-colors"
            >
              <X className="w-8 h-8" />
            </button>
            <button 
              disabled={isAnalyzing}
              onClick={captureAndIdentify}
              className="w-20 h-20 bg-white rounded-full flex items-center justify-center p-1 border-4 border-indigo-500 disabled:opacity-50"
            >
              <div className="w-full h-full bg-white rounded-full border-2 border-slate-200"></div>
            </button>
            <div className="w-14"></div> {/* Spacer */}
          </div>
          
          <canvas ref={canvasRef} className="hidden" />
        </div>
      )}

      {/* Modal de Entrada Manual */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl animate-in slide-in-from-bottom duration-300">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-800">Agregar Producto</h2>
              <button onClick={() => setShowManualModal(false)} className="p-1 hover:bg-slate-100 rounded-lg">
                <X className="w-6 h-6 text-slate-400" />
              </button>
            </div>

            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Nombre</label>
                <input 
                  autoFocus
                  type="text"
                  placeholder="Ej: Leche deslactosada"
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  value={manualItem.name}
                  onChange={e => setManualItem({...manualItem, name: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Categoría</label>
                <select 
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  value={manualItem.category}
                  onChange={e => setManualItem({...manualItem, category: e.target.value})}
                >
                  <option>General</option>
                  <option>Lácteos</option>
                  <option>Frutas y Verduras</option>
                  <option>Cereales</option>
                  <option>Limpieza</option>
                  <option>Bebidas</option>
                  <option>Carnes</option>
                </select>
              </div>
              <button 
                type="submit"
                disabled={!manualItem.name}
                className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 disabled:opacity-50 transition-all"
              >
                Guardar Producto
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;