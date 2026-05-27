'use client';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';

const IP_AGENTE = process.env.NEXT_PUBLIC_IP_AGENTE?.trim() ?? '';

type Mensaje = { id: string; rol: 'Catedrático' | 'IA' | 'Sistema', msg: string };
type SubmitLikeEvent = { preventDefault: () => void };

const crearIdMensaje = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export default function PanelBiometrico() {
  const videoRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reanudarVideoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reporte, setReporte] = useState('Esperando a que el Agente escanee un objetivo...');
  
  // Nuevos estados para el chat
  const [chat, setChat] = useState<Mensaje[]>([]);
  const [inputPregunta, setInputPregunta] = useState('');
  const [cargando, setCargando] = useState(false);

  const [ledUI, setLedUI] = useState(false); // Solo para que el botón cambie de color
  const ledEstado = useRef(false); // La memoria real para el teclado
  const [videoPausado, setVideoPausado] = useState(false);

  // --- 1. CONTROLADORES DE TRACCIÓN ---
  const moverAgente = async (accion: string) => {
    if (!IP_AGENTE) return;

    await fetch(`http://${IP_AGENTE}:82/${accion}`, { mode: 'no-cors' }).catch((error) => {
      console.error('No se pudo enviar el comando al agente.', error);
    });
  };

  const pausarVideo = () => {
    if (reanudarVideoTimeoutRef.current) {
      clearTimeout(reanudarVideoTimeoutRef.current);
      reanudarVideoTimeoutRef.current = null;
    }

    setVideoPausado(true);
  };

  const programarReanudacionVideo = () => {
    if (reanudarVideoTimeoutRef.current) {
      clearTimeout(reanudarVideoTimeoutRef.current);
    }

    reanudarVideoTimeoutRef.current = setTimeout(() => {
      setVideoPausado(false);
      reanudarVideoTimeoutRef.current = null;
    }, 5000);
  };

  const capturarYAnalizar = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    setReporte('Enviando datos biométricos al Cerebro Seguro... espere.');
    setChat([{ id: crearIdMensaje(), rol: 'Sistema', msg: 'Nuevo objetivo escaneado. Base de datos actualizada.' }]);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    canvas.width = videoRef.current.width || 640;
    canvas.height = videoRef.current.height || 480;
    ctx?.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    
    const imagenBase64 = canvas.toDataURL('image/jpeg').split(',')[1];

    try {
      const res = await fetch('http://127.0.0.1:4000/biometria/analizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagen: imagenBase64 }),
      });
      const data = await res.json();
      setReporte(data.reporte);
    } catch (error) {
      console.error(error);
      setReporte('Error: No se pudo conectar con el servidor.');
    }
  }, []);

  const toggleLed = async () => {
    ledEstado.current = !ledEstado.current;
    setLedUI(ledEstado.current);
    
    const intensidad = ledEstado.current ? 100 : 0; 
    
    await fetch(`http://${IP_AGENTE}/control?var=led_intensity&val=${intensidad}`, { mode: 'no-cors' }).catch((error) => {
      console.error('Error al accionar la linterna', error);
    });
  };

  useEffect(() => {
    // 1. EVENTO: CUANDO PRESIONAS LA TECLA
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      
      // ¡Magia anti-spam! Si dejas la tecla presionada, 
      // el navegador solo manda la orden UNA vez.
      if (e.repeat) return; 

      const tecla = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(tecla)) {
        pausarVideo();
      }

      if (tecla === 'w') moverAgente('avanzar');
      if (tecla === 's') moverAgente('atras');
      if (tecla === 'a') moverAgente('izquierda');
      if (tecla === 'd') moverAgente('derecha');
      if (tecla === 'f') capturarYAnalizar();
      if (tecla === 'l') toggleLed();
    };

    // 2. EVENTO: CUANDO SUELTAS LA TECLA
    const handleKeyUp = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;

      const tecla = e.key.toLowerCase();
      // Si la tecla que soltaste fue una de movimiento, manda a detener.
      if (['w', 'a', 's', 'd'].includes(tecla)) {
        moverAgente('detener');
        programarReanudacionVideo();
      }
    };

    // Activamos los dos micrófonos del navegador
    globalThis.addEventListener('keydown', handleKeyDown);
    globalThis.addEventListener('keyup', handleKeyUp);

    // Limpieza cuando cierras el componente
    return () => {
      globalThis.removeEventListener('keydown', handleKeyDown);
      globalThis.removeEventListener('keyup', handleKeyUp);

        if (reanudarVideoTimeoutRef.current) {
          clearTimeout(reanudarVideoTimeoutRef.current);
        }
    };
  }, [capturarYAnalizar]);

  // --- 3. ENVÍO DE PREGUNTAS (CHAT) ---
  const enviarPregunta = async (e: SubmitLikeEvent) => {
    e.preventDefault();
    if (!inputPregunta.trim() || cargando) return;

    const preguntaTemp = inputPregunta;
    setInputPregunta('');
    setCargando(true);

    // Agregamos la pregunta al UI instantáneamente
    setChat(prev => [...prev, { id: crearIdMensaje(), rol: 'Catedrático', msg: preguntaTemp }]);

    try {
      const res = await fetch('http://127.0.0.1:4000/biometria/preguntar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pregunta: preguntaTemp }),
      });
      const data = await res.json();
      
      setChat(prev => [...prev, { id: crearIdMensaje(), rol: 'IA', msg: data.respuesta }]);
    } catch (error) {
      console.error(error);
      setChat(prev => [...prev, { id: crearIdMensaje(), rol: 'Sistema', msg: 'Error de red al consultar a la IA.' }]);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="container mx-auto p-4 bg-gray-900 text-gray-300 min-h-screen font-mono">
      <h2 className="text-2xl mb-4 border-b border-blue-500 pb-2 text-blue-400">🛡️ Sistema de Telemetría Biometríca</h2>
      
      {/* VIDEO */}
      <div className="flex justify-center mb-6">
        {IP_AGENTE && !videoPausado ? (
          <Image 
            ref={videoRef} src={`http://${IP_AGENTE}:81/stream`} crossOrigin="anonymous"
            alt="Transmisión en vivo del carrito"
            className="border-2 border-gray-700 rounded-lg shadow-lg" width="640" height="480" unoptimized loading="eager"
          />
        ) : (
          <div className="flex h-120 w-160 items-center justify-center rounded-lg border-2 border-gray-700 bg-gray-800 text-sm text-gray-400">
            {IP_AGENTE ? 'Transmisión en pausa mientras el carrito se mueve...' : 'Configura NEXT_PUBLIC_IP_AGENTE para ver la transmisión.'}
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* CONTROLES RÁPIDOS */}
      <div className="flex justify-center gap-4 mb-4">
        <button 
          onClick={toggleLed}
          className={`px-4 py-2 rounded font-bold border ${
            ledUI 
            ? 'bg-yellow-500 text-black border-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.5)]' 
            : 'bg-gray-800 text-gray-400 border-gray-600 hover:bg-gray-700'
          }`}
        >
          {ledUI ? '🔦 Linterna ON (L)' : '🔦 Linterna OFF (L)'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* REPORTE TÉCNICO */}
        <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 shadow">
          <h5 className="text-blue-400 border-b border-gray-600 pb-2 mb-3">DATOS DEL ESCÁNER</h5>
          <pre className="whitespace-pre-wrap text-sm text-green-400">{reporte}</pre>
        </div>

        {/* INTERROGATORIO Y CHAT */}
        <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 shadow flex flex-col justify-between">
          <div>
            <h5 className="text-yellow-400 border-b border-gray-600 pb-2 mb-3">INTERROGATORIO EN CURSO</h5>
            <div className="h-64 overflow-y-auto mb-4 text-sm space-y-2">
              {chat.map((c) => (
                <p key={c.id}>
                  {c.rol === 'Catedrático' && <strong className="text-yellow-400">[{c.rol}] {'> '}</strong>}
                  {c.rol === 'IA' && <strong className="text-green-400">[IA del Agente] {'> '}</strong>}
                  {c.rol === 'Sistema' && <strong className="text-red-400">[{c.rol}] {'> '}</strong>}
                  {c.msg}
                </p>
              ))}
              {cargando && <p className="text-gray-500 animate-pulse">Procesando respuesta...</p>}
            </div>
          </div>

          <form onSubmit={enviarPregunta} className="flex gap-2">
            <input 
              type="text" 
              value={inputPregunta}
              onChange={(e) => setInputPregunta(e.target.value)}
              className="flex-1 bg-gray-900 text-white border border-gray-600 rounded px-3 py-2 outline-none focus:border-blue-500" 
              placeholder="Hazle una pregunta a la IA sobre este sujeto..." 
              required autoComplete="off"
            />
            <button 
              type="submit" 
              disabled={cargando}
              className={`px-4 py-2 rounded font-bold ${cargando ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}
            >
              Consultar
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}