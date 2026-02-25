import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, query, deleteDoc, updateDoc, addDoc } from 'firebase/firestore';
import { 
  Camera, Plus, Trash2, ShoppingCart, Package, 
  Loader2, CheckCircle2, X 
} from 'lucide-react';
import './App.css'



// --- CONFIGURACIÓN DE CLAVES DESDE .ENV ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// Inicializamos Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- ESTILOS INTEGRADOS ---

const App = () => {
  const [user, setUser] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('inventory');
  const [isScanning, setIsScanning] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualName, setManualName] = useState('');

  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        try {
          await signInAnonymously(auth);
        } catch (error) {
          console.error("Error en autenticación anónima:", error);
        }
      }
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'pantry'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(item => item.userId === user.uid);
      setItems(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user]);

  const startCamera = async () => {
    setIsScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      console.error("No se pudo acceder a la cámara:", err);
      setIsScanning(false);
      alert("No se pudo acceder a la cámara. Revisa los permisos.");
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
    setIsScanning(false);
  };

  const captureAndIdentify = async () => {
    if (!videoRef.current || isAnalyzing) return;
    
    if (!GEMINI_API_KEY || GEMINI_API_KEY === "TU_NUEVA_CLAVE_GEMINI_AQUI") {
      alert("Por favor, configura tu API Key de Gemini en el archivo .env");
      return;
    }

    setIsAnalyzing(true);

    const canvas = canvasRef.current;
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
    const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];

    try {
      const modelsToTry = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash-latest'];
      let data = null;
      let lastError = null;

      for (const model of modelsToTry) {
        try {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [
                { text: "Identify the pantry item in Spanish. Respond ONLY in valid JSON format exactly like this: {\"name\": \"name\", \"category\": \"category\"}" },
                { inlineData: { mimeType: "image/jpeg", data: base64 } }
              ]}]
            })
          });

          if (response.ok) {
            data = await response.json();
            break; // Si tiene éxito, salimos del bucle
          } else {
            lastError = await response.text();
          }
        } catch (e) {
          lastError = e.message;
        }
      }

      if (!data || !data.candidates || !data.candidates[0].content.parts[0].text) {
        throw new Error(`Todos los modelos fallaron. Último error: ${lastError}`);
      }

      const text = data.candidates[0].content.parts[0].text;
      const result = JSON.parse(text.replace(/```json|```/g, ''));
      
      await addItem(result.name, result.category);
      stopCamera();
    } catch (err) {
      console.error("Error Gemini:", err);
      alert("Hubo un error al identificar el producto. Intenta de nuevo.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const addItem = async (name, category = 'General') => {
    if (!user) return;
    await addDoc(collection(db, 'pantry'), {
      name,
      category,
      inStock: true,
      userId: user.uid,
      createdAt: Date.now()
    });
  };

  const toggleStock = async (item) => {
    await updateDoc(doc(db, 'pantry', item.id), { inStock: !item.inStock });
  };

  const deleteItem = async (id) => {
    await deleteDoc(doc(db, 'pantry', id));
  };

  if (loading) return (
    <div style={{display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f8fafc', fontFamily: 'sans-serif', color: '#64748b'}}>
      <Loader2 className="animate-spin" style={{marginBottom: '10px'}} size={32} color="#4f46e5" />
      <p>Cargando despensa...</p>
    </div>
  );

  const filteredItems = items.filter(i => activeTab === 'inventory' ? i.inStock : !i.inStock);

  return (
    <div className="app-container">
      
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon"><Package size={20}/></div>
          <h1>Mi Despensa</h1>
        </div>
        <button className="btn-add" onClick={() => setShowManual(true)}>
          <Plus />
        </button>
      </header>

      <div className="tabs-container">
        <div className="tabs">
          <button 
            className={`tab-btn ${activeTab === 'inventory' ? 'active' : ''}`}
            onClick={() => setActiveTab('inventory')}
          >
            En Stock ({items.filter(i => i.inStock).length})
          </button>
          <button 
            className={`tab-btn ${activeTab === 'shopping' ? 'active' : ''}`}
            onClick={() => setActiveTab('shopping')}
          >
            Faltantes ({items.filter(i => !i.inStock).length})
          </button>
        </div>
      </div>

      <div className="pantry-list">
        {filteredItems.length === 0 ? (
          <div style={{textAlign: 'center', padding: '40px 20px', color: '#64748b'}}>
            No hay productos aquí. Usa el botón + o escanea un producto para empezar.
          </div>
        ) : (
          filteredItems.map(item => (
            <div key={item.id} className="item-card">
              <div className="item-info">
                <span className="category">{item.category}</span>
                <h3>{item.name}</h3>
              </div>
              <div className="item-actions">
                <button className="action-btn check" onClick={() => toggleStock(item)}>
                  {item.inStock ? <ShoppingCart size={20}/> : <CheckCircle2 size={20}/>}
                </button>
                <button className="action-btn delete" onClick={() => deleteItem(item.id)}>
                  <Trash2 size={20}/>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="fab-container">
        <button className="fab" onClick={startCamera}>
          <Camera /> Escanear Producto
        </button>
      </div>

      {isScanning && (
        <div className="camera-view">
          <video ref={videoRef} autoPlay playsInline className="video-element" />
          <div className="camera-controls">
            <button className="close-camera" onClick={stopCamera}><X /></button>
            <button className="capture-btn" onClick={captureAndIdentify} disabled={isAnalyzing}>
              {isAnalyzing && <Loader2 className="animate-spin" color="#4f46e5" size={32} />}
            </button>
            <div style={{width: 50}}></div>
          </div>
          <canvas ref={canvasRef} style={{display:'none'}} />
        </div>
      )}

      {showManual && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Añadir Manualmente</h2>
            <div className="form-group">
              <label>Producto</label>
              <input 
                autoFocus
                type="text" 
                placeholder="Ej. Arroz" 
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && manualName) {
                    addItem(manualName);
                    setManualName('');
                    setShowManual(false);
                  }
                }}
              />
            </div>
            <div style={{display:'flex', gap: 10}}>
              <button className="btn-submit" onClick={() => {
                if(manualName) {
                  addItem(manualName);
                  setManualName('');
                  setShowManual(false);
                }
              }}>Guardar</button>
              <button 
                className="btn-submit" 
                style={{background: '#e2e8f0', color: '#64748b'}}
                onClick={() => setShowManual(false)}
              >Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;