'use client';
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';

const IP_AGENTE = process.env.NEXT_PUBLIC_IP_AGENTE?.trim() ?? '';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? '';

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
  const [videoVolteado, setVideoVolteado] = useState(false); // Estado real del video (para la tecla V)
  const videoVolteadoRef = useRef(false); // Referencia para mantener el estado del video volteado
  const [videoPausado, setVideoPausado] = useState(false);
  const [stick, setStick] = useState({ x: 0, y: 0 });
  const joystickRef = useRef<HTMLDivElement | null>(null);
  const ultimaDireccionRef = useRef('');

  const construirApiUrl = (ruta: string) => {
    if (API_BASE_URL) return `${API_BASE_URL}${ruta}`;
    if (typeof window !== 'undefined') {
      return `${window.location.protocol}//${window.location.hostname}:4000${ruta}`;
    }
    return `http://127.0.0.1:4000${ruta}`;
  };

  // Estados de calibración óptica
  const [brillo, setBrillo] = useState(0);
  const [contraste, setContraste] = useState(0);
  const [saturacion, setSaturacion] = useState(0);

  // --- 1. CONTROLADORES DE TRACCIÓN (Con Detonador y Reintentos) ---
  const moverAgente = async (accion: string, reintentos = 0) => {
    if (!IP_AGENTE) return;

    // Creamos una bomba de tiempo de 250ms
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 250);

    try {
      await fetch(`http://${IP_AGENTE}:82/${accion}`, { 
        cache: 'no-store',
        signal: controller.signal // Conectamos el detonador
      });
      clearTimeout(timeoutId); // Si el carrito respondió rápido, desactivamos la bomba
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (accion === 'detener' && reintentos < 5) {
        console.warn(`[-] Freno perdido. Reintento ${reintentos + 1}/5...`);
        setTimeout(() => moverAgente('detener', reintentos + 1), 100);
      } else if (accion === 'detener') {
        console.error('[!] Abortando freno definitivo. ESP32 bloqueado.');
      }
    }
  };

  const ajustarLente = async (variable: string, valor: number) => {
    if (!IP_AGENTE) return;
    await fetch(`http://${IP_AGENTE}/control?var=${variable}&val=${valor}`, { mode: 'no-cors' }).catch((error) => {
      console.error(`Error ajustando ${variable}`, error);
    });
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
      const res = await fetch(construirApiUrl('/biometria/analizar'), {
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

  const voltearVideo = async () => {
    videoVolteadoRef.current = !videoVolteadoRef.current;
    setVideoVolteado(videoVolteadoRef.current);

    await fetch(`http://${IP_AGENTE}/control?var=vflip&val=${videoVolteadoRef.current ? 1 : 0}`, { mode: 'no-cors' }).catch((error) => {
      console.error('Error al voltear el video', error);
    });

    await fetch(`http://${IP_AGENTE}/xclk?xclk=10`, { mode: 'no-cors' }).catch((error) => {
      console.error('Error al reactivar el video después de voltear', error);
    });
  };

  const obtenerDireccionJoystick = (x: number, y: number) => {
    const deadzone = 0.3;
    if (Math.abs(x) < deadzone && Math.abs(y) < deadzone) return 'detener';
    if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'derecha' : 'izquierda';
    return y > 0 ? 'atras' : 'avanzar';
  };

  const actualizarJoystick = (clientX: number, clientY: number) => {
    const container = joystickRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const max = rect.width / 2;
    const normX = Math.max(-1, Math.min(1, dx / max));
    const normY = Math.max(-1, Math.min(1, dy / max));

    setStick({ x: normX, y: normY });

    const direccion = obtenerDireccionJoystick(normX, normY);
    if (direccion !== ultimaDireccionRef.current) {
      ultimaDireccionRef.current = direccion;
      if (direccion === 'detener') moverAgente('detener');
      else moverAgente(direccion);
    }
  };

  const handleJoystickStart = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    actualizarJoystick(e.clientX, e.clientY);
  };

  const handleJoystickMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0) return;
    actualizarJoystick(e.clientX, e.clientY);
  };

  const handleJoystickEnd = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.releasePointerCapture(e.pointerId);
    setStick({ x: 0, y: 0 });
    ultimaDireccionRef.current = '';
    moverAgente('detener');
  };

  useEffect(() => {
    // 1. EVENTO: CUANDO PRESIONAS LA TECLA
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      
      // ¡Magia anti-spam! Si dejas la tecla presionada, 
      // el navegador solo manda la orden UNA vez.
      if (e.repeat) return; 

      const tecla = e.key.toLowerCase();

      if (tecla === 'w') moverAgente('avanzar');
      if (tecla === 's') moverAgente('atras');
      if (tecla === 'a') moverAgente('izquierda');
      if (tecla === 'd') moverAgente('derecha');
      if (tecla === 'f') capturarYAnalizar();
      if (tecla === 'l') toggleLed();
      if (tecla === 'v') voltearVideo();
    };

    // 2. EVENTO: CUANDO SUELTAS LA TECLA
    const handleKeyUp = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;

      const tecla = e.key.toLowerCase();      
      if (['w', 'a', 's', 'd'].includes(tecla)) {
        moverAgente('detener');        
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
      const res = await fetch(construirApiUrl('/biometria/preguntar'), {
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
          <img 
            ref={videoRef} 
            src={`http://${IP_AGENTE}:81/stream`} 
            crossOrigin="anonymous"
            alt="Transmisión en vivo del carrito"
            className="border-2 border-gray-700 rounded-lg shadow-lg w-[640px] h-[480px] object-cover" 
          />
        ) : (
          <div className="flex h-120 w-160 items-center justify-center rounded-lg border-2 border-gray-700 bg-gray-800 text-sm text-gray-400">
            {IP_AGENTE ? 'Transmisión en pausa mientras el carrito se mueve...' : 'Configura NEXT_PUBLIC_IP_AGENTE para ver la transmisión.'}
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* CONTROLES RÁPIDOS */}
      <div className="flex flex-col items-center gap-4 mb-4 md:flex-row md:justify-center">
        <button 
          onClick={toggleLed}
          className={`px-4 py-2 rounded font-bold border w-48 ${
            ledUI 
            ? 'bg-yellow-500 text-black border-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.5)]' 
            : 'bg-gray-800 text-gray-400 border-gray-600 hover:bg-gray-700'
          }`}
        >
          {ledUI ? '🔦 Linterna ON (L)' : '🔦 Linterna OFF (L)'}
        </button>
        <button 
          onClick={capturarYAnalizar}
          className="px-4 py-2 rounded font-bold border w-48 bg-green-600 text-white border-green-500 hover:bg-green-500"
        >
          📸 Tomar Foto (F)
        </button>
        <button 
          onClick={voltearVideo}
          className={`px-4 py-2 rounded font-bold border w-48 ${
            videoVolteado 
            ? 'bg-blue-600 text-white border-blue-400 shadow-[0_0_15px_rgba(37,99,235,0.5)]' 
            : 'bg-gray-800 text-gray-400 border-gray-600 hover:bg-gray-700'
          }`}
        >
          {videoVolteado ? '↕️ Visión Invertida (V)' : '↕️ Visión Normal (V)'}
        </button>
      </div>

      {/* JOYSTICK TÁCTIL */}
      <div className="md:hidden bg-gray-800 p-4 rounded-lg border border-gray-700 shadow mb-4 max-w-4xl mx-auto">
        <h5 className="text-gray-400 border-b border-gray-600 pb-2 mb-4 text-sm tracking-widest">🎮 Control Táctil</h5>
        <div className="flex flex-col items-center gap-4">
          <div
            ref={joystickRef}
            className="relative h-48 w-48 rounded-full border-2 border-gray-600 bg-gray-900/80 touch-none"
            onPointerDown={handleJoystickStart}
            onPointerMove={handleJoystickMove}
            onPointerUp={handleJoystickEnd}
            onPointerLeave={handleJoystickEnd}
            style={{ touchAction: 'none' }}
          >
            <div
              className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/80 shadow-lg"
              style={{ transform: `translate(${stick.x * 40}px, ${stick.y * 40}px)` }}
            />
          </div>
          <div className="space-y-2 text-sm text-gray-300 max-w-xs">
            <p className="text-white">Arrastra dentro del círculo para mover el carrito.</p>
            <p>↑ Avanza</p>
            <p>↓ Retrocede</p>
            <p>← Gira izquierda</p>
            <p>→ Gira derecha</p>
            <p className="text-xs text-gray-500">La dirección se envía mientras mantienes tocado el joystick.</p>
          </div>
        </div>
      </div>

      {/* ¡NUEVO! PANEL DE CALIBRACIÓN ÓPTICA */}
      <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 shadow mb-4 max-w-4xl mx-auto">
        <h5 className="text-gray-400 border-b border-gray-600 pb-2 mb-4 text-sm tracking-widest">🎛️ CALIBRACIÓN DEL SENSOR OV2640</h5>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="flex flex-col">
            <label className="text-xs text-gray-400 mb-2 flex justify-between">
              <span>Brillo</span> <span className="text-blue-400 font-bold">{brillo}</span>
            </label>
            <input type="range" min="-2" max="2" value={brillo} 
              onChange={(e) => setBrillo(Number(e.target.value))} 
              onMouseUp={() => ajustarLente('brightness', brillo)}
              onTouchEnd={() => ajustarLente('brightness', brillo)}
              className="accent-blue-500 cursor-pointer" />
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-gray-400 mb-2 flex justify-between">
              <span>Contraste</span> <span className="text-yellow-400 font-bold">{contraste}</span>
            </label>
            <input type="range" min="-2" max="2" value={contraste} 
              onChange={(e) => setContraste(Number(e.target.value))} 
              onMouseUp={() => ajustarLente('contrast', contraste)}
              onTouchEnd={() => ajustarLente('contrast', contraste)}
              className="accent-yellow-500 cursor-pointer" />
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-gray-400 mb-2 flex justify-between">
              <span>Saturación</span> <span className="text-green-400 font-bold">{saturacion}</span>
            </label>
            <input type="range" min="-2" max="2" value={saturacion} 
              onChange={(e) => setSaturacion(Number(e.target.value))} 
              onMouseUp={() => ajustarLente('saturation', saturacion)}
              onTouchEnd={() => ajustarLente('saturation', saturacion)}
              className="accent-green-500 cursor-pointer" />
          </div>
        </div>
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

          <form onSubmit={enviarPregunta} className="flex flex-col gap-2 sm:flex-row">
            <input 
              type="text" 
              value={inputPregunta}
              onChange={(e) => setInputPregunta(e.target.value)}
              className="w-full bg-gray-900 text-white border border-gray-600 rounded px-3 py-2 outline-none focus:border-blue-500" 
              placeholder="Hazle una pregunta a la IA sobre este sujeto..." 
              required autoComplete="off"
            />
            <button 
              type="submit" 
              disabled={cargando}
              className={`w-full sm:w-auto px-4 py-2 rounded font-bold ${cargando ? 'bg-gray-600' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}
            >
              Consultar
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}