import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, ZoomControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  Activity,
  RadioReceiver,
  Layers,
  Maximize2,
  Moon,
  Sun,
  MapPin,
  ExternalLink,
  Crosshair,
  Settings,
  X,
  Check,
  RotateCcw,
  FileText,
  Download,
  Printer,
  Route,
  Calendar,
  Clock,
  Search,
  Compass,
  Eye,
  RefreshCw,
  Database
} from 'lucide-react';
import './index.css';

// Corregir rutas de iconos por defecto de Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Configuración de capas basadas en OpenStreetMap
const OSM_LAYERS = {
  standard: {
    id: 'standard',
    name: 'OpenStreetMap Estándar',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  hot: {
    id: 'hot',
    name: 'OpenStreetMap Humanitario (HOT)',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors, Tiles por <a href="https://www.hotosm.org/" target="_blank" rel="noreferrer">HOT</a>',
    maxZoom: 19,
  },
  topo: {
    id: 'topo',
    name: 'OpenTopoMap (Topografía OSM)',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: 'Datos: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> | Cartografía: &copy; <a href="https://opentopomap.org" target="_blank" rel="noreferrer">OpenTopoMap</a>',
    maxZoom: 17,
  }
};

// Generador de marcador personalizado en tiempo real
const createMarkerIcon = (deviceId, isActive) => {
  return L.divIcon({
    className: `custom-marker ${isActive ? 'is-active' : ''}`,
    html: `
      <div class="marker-container">
        <div class="marker-pulse"></div>
        <div class="marker-dot"></div>
        <div class="marker-label">${deviceId}</div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18]
  });
};

// Marcador especial para inicio de ruta
const createRoutePointIcon = (label, color = '#22c55e') => {
  return L.divIcon({
    className: 'route-special-marker',
    html: `
      <div style="background: ${color}; color: #fff; font-weight: bold; font-size: 11px; padding: 3px 8px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.5); border: 2px solid #fff; white-space: nowrap; transform: translate(-50%, -50%);">
        ${label}
      </div>
    `,
    iconSize: [20, 20],
    iconAnchor: [0, 0]
  });
};

// Componente para actualizar vista y enfocar coordenadas o rutas completas
function MapViewController({ targetCenter, allBoundsTrigger, devices, routeBounds }) {
  const map = useMap();

  useEffect(() => {
    if (targetCenter) {
      map.flyTo(targetCenter, 16, { animate: true, duration: 1.2 });
    }
  }, [targetCenter, map]);

  useEffect(() => {
    if (allBoundsTrigger && devices.length > 0) {
      if (devices.length === 1) {
        map.flyTo([devices[0].lat, devices[0].lon], 15, { animate: true, duration: 1.2 });
      } else {
        const bounds = L.latLngBounds(devices.map(d => [d.lat, d.lon]));
        map.fitBounds(bounds, { padding: [60, 60], animate: true, duration: 1.2 });
      }
    }
  }, [allBoundsTrigger, devices, map]);

  useEffect(() => {
    if (routeBounds && routeBounds.length > 0) {
      const bounds = L.latLngBounds(routeBounds);
      map.fitBounds(bounds, { padding: [80, 80], animate: true, duration: 1.2 });
    }
  }, [routeBounds, map]);

  return null;
}

function App() {
  const [locations, setLocations] = useState({});
  const [activeDevice, setActiveDevice] = useState(null);
  const [socketStatus, setSocketStatus] = useState('Conectando...');
  const [currentLayer, setCurrentLayer] = useState('standard');
  const [darkMode, setDarkMode] = useState(false);
  const [boundsTrigger, setBoundsTrigger] = useState(0);

  // Configuración persistente de Nombre y Servidor
  const [appName, setAppName] = useState(() => {
    return localStorage.getItem('tracker_web_app_name') || 'Rastreo OSM';
  });
  const [serverHost, setServerHost] = useState(() => {
    return localStorage.getItem('tracker_web_server_host') || `${window.location.hostname || 'localhost'}:8000`;
  });

  // Estado del Modal de Configuración
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [tempName, setTempName] = useState(appName);
  const [tempHost, setTempHost] = useState(serverHost);
  const [saveNotice, setSaveNotice] = useState('');

  // ---------------- ESTADOS DEL SISTEMA DE REPORTES ----------------
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [reportDevices, setReportDevices] = useState([]);
  const [reportFilterDevice, setReportFilterDevice] = useState('');
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');
  const [reportLimit, setReportLimit] = useState(500);
  const [reportData, setReportData] = useState(null);
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [reportSearchTerm, setReportSearchTerm] = useState('');

  // Estado para la Ruta Histórica trazada en el Mapa
  const [activeRoute, setActiveRoute] = useState(null); // Array de [lat, lon]
  const [activeRouteInfo, setActiveRouteInfo] = useState(null); // { deviceId, pointsCount, distanceKm, start, end }
  const [routeBounds, setRouteBounds] = useState(null);

  // Sincronizar título de ventana con el nombre configurado
  useEffect(() => {
    document.title = appName;
  }, [appName]);

  // WebSocket en Vivo
  useEffect(() => {
    let ws = null;
    let reconnectTimeout = null;
    let isDisposed = false;

    const connectWs = () => {
      let raw = (serverHost || '').trim();
      if (!raw) raw = `${window.location.hostname || 'localhost'}:8000`;

      let wsUrl = '';
      if (raw.startsWith('ws://') || raw.startsWith('wss://')) {
        wsUrl = raw.endsWith('/ws') ? raw : `${raw}/ws`;
      } else {
        const cleanHost = raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        wsUrl = `ws://${cleanHost}/ws`;
      }

      setSocketStatus('Conectando...');
      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        console.error('Error al inicializar WebSocket:', err);
        setSocketStatus('Error URL');
        return;
      }

      ws.onopen = () => {
        if (!isDisposed) setSocketStatus('En línea');
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === 'initialLocations') {
            const locMap = {};
            message.data.forEach(loc => {
              locMap[loc.deviceId] = loc;
            });
            setLocations(locMap);
          } else if (message.type === 'locationUpdate') {
            setLocations(prev => ({
              ...prev,
              [message.data.deviceId]: message.data
            }));
          } else if (message.type === 'deviceOffline') {
            setLocations(prev => {
              const copy = { ...prev };
              delete copy[message.deviceId];
              return copy;
            });
            setActiveDevice(current => current === message.deviceId ? null : current);
          }
        } catch (err) {
          console.error('Error parseando mensaje WebSocket:', err);
        }
      };

      ws.onclose = () => {
        if (!isDisposed) {
          setSocketStatus('Reconectando...');
          reconnectTimeout = setTimeout(connectWs, 3000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connectWs();

    return () => {
      isDisposed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, [serverHost]);

  // Purgar periódicamente dispositivos desconectados (5 minutos = 300,000 ms para soportar intervalos de 2 a 3 min)
  useEffect(() => {
    const pruneTimer = setInterval(() => {
      const now = Date.now();
      setLocations(prev => {
        let changed = false;
        const fresh = {};
        for (const [id, dev] of Object.entries(prev)) {
          const diff = now - new Date(dev.timestamp).getTime();
          if (diff <= 300000) { // 5 minutos
            fresh[id] = dev;
          } else {
            changed = true;
          }
        }
        return changed ? fresh : prev;
      });
    }, 10000);

    return () => clearInterval(pruneTimer);
  }, []);

  const deviceList = Object.values(locations);
  const selectedOsmConfig = OSM_LAYERS[currentLayer] || OSM_LAYERS.standard;

  // Centro por defecto: si hay dispositivos usar el primero, sino coordenadas por defecto
  const defaultCenter = deviceList.length > 0
    ? [deviceList[0].lat, deviceList[0].lon]
    : [-12.0463, -77.0427];

  const handleFitAll = () => {
    setBoundsTrigger(prev => prev + 1);
  };

  const handleOpenSettings = () => {
    setTempName(appName);
    setTempHost(serverHost);
    setSaveNotice('');
    setIsSettingsOpen(true);
  };

  const handleSaveSettings = () => {
    const finalName = tempName.trim() || 'Rastreo OSM';
    let finalHost = tempHost.trim() || `${window.location.hostname || 'localhost'}:8000`;
    finalHost = finalHost.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '').replace(/\/.*$/, '');

    setAppName(finalName);
    setServerHost(finalHost);
    localStorage.setItem('tracker_web_app_name', finalName);
    localStorage.setItem('tracker_web_server_host', finalHost);

    setSaveNotice('✅ ¡Configuración guardada! Reconectando al servidor...');
    setTimeout(() => {
      setSaveNotice('');
      setIsSettingsOpen(false);
    }, 1100);
  };

  const handleResetDefaults = () => {
    const defName = 'Rastreo OSM';
    const defHost = `${window.location.hostname || 'localhost'}:8000`;
    setTempName(defName);
    setTempHost(defHost);
  };

  // ---------------- FUNCIONES DE REPORTES ----------------
  const fetchReport = async (devId = reportFilterDevice, start = reportStartDate, end = reportEndDate, limit = reportLimit) => {
    setIsReportLoading(true);
    try {
      const cleanHost = serverHost.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const queryParams = new URLSearchParams();
      if (devId) queryParams.append('device_id', devId);
      if (start) queryParams.append('start_date', start);
      if (end) queryParams.append('end_date', end);
      queryParams.append('limit', limit);

      const res = await fetch(`http://${cleanHost}/api/report?${queryParams.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setReportData(data);
      } else {
        console.error('Error al obtener reporte del backend:', res.statusText);
      }
    } catch (err) {
      console.error('Error de conexión al solicitar reporte:', err);
    } finally {
      setIsReportLoading(false);
    }
  };

  const fetchDevices = async () => {
    try {
      const cleanHost = serverHost.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const res = await fetch(`http://${cleanHost}/api/devices`);
      if (res.ok) {
        const list = await res.json();
        setReportDevices(list);
      }
    } catch (err) {
      console.error('Error obteniendo lista de dispositivos:', err);
    }
  };

  const handleOpenReport = (initialDeviceId = '') => {
    const selectedDev = typeof initialDeviceId === 'string' && initialDeviceId ? initialDeviceId : reportFilterDevice;
    setReportFilterDevice(selectedDev);
    setIsReportOpen(true);
    fetchDevices();
    fetchReport(selectedDev, reportStartDate, reportEndDate, reportLimit);
  };

  // Atajos rápidos de fecha
  const setQuickDate = (mode) => {
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (mode === 'today') {
      const dStr = toDateStr(today);
      setReportStartDate(dStr);
      setReportEndDate(dStr);
      fetchReport(reportFilterDevice, dStr, dStr, reportLimit);
    } else if (mode === 'week') {
      const past = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const startStr = toDateStr(past);
      const endStr = toDateStr(today);
      setReportStartDate(startStr);
      setReportEndDate(endStr);
      fetchReport(reportFilterDevice, startStr, endStr, reportLimit);
    } else if (mode === 'all') {
      setReportStartDate('');
      setReportEndDate('');
      fetchReport(reportFilterDevice, '', '', reportLimit);
    }
  };

  // Exportar reporte a formato CSV compatible con Microsoft Excel
  const handleExportCSV = () => {
    if (!reportData || !reportData.records || reportData.records.length === 0) {
      alert('No hay registros en el reporte para exportar.');
      return;
    }

    const headers = ['ID', 'Dispositivo', 'Fecha', 'Hora', 'Latitud', 'Longitud', 'Enlace_OpenStreetMap'];
    const rows = reportData.records.map((r, index) => {
      const dt = r.timestamp ? new Date(r.timestamp) : null;
      const datePart = dt ? dt.toLocaleDateString() : '';
      const timePart = dt ? dt.toLocaleTimeString() : '';
      const mapUrl = `https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lon}#map=17/${r.lat}/${r.lon}`;
      return [
        r.id || (index + 1),
        `"${r.deviceId}"`,
        `"${datePart}"`,
        `"${timePart}"`,
        r.lat,
        r.lon,
        `"${mapUrl}"`
      ].join(';');
    });

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const devName = reportFilterDevice || 'TODOS';
    const nowStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.setAttribute('download', `reporte_ubicaciones_${devName}_${nowStamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Imprimir reporte o guardar como PDF
  const handlePrintReport = () => {
    window.print();
  };

  // Trazar recorrido histórico en el mapa
  const handleDrawRouteOnMap = (routePoints, devId, distanceKm) => {
    if (!routePoints || routePoints.length === 0) {
      alert('No hay puntos suficientes para trazar una ruta.');
      return;
    }
    const coords = routePoints.map(p => [p[0], p[1]]);
    setActiveRoute(coords);
    setActiveRouteInfo({
      deviceId: devId || 'Dispositivo',
      pointsCount: coords.length,
      distanceKm: distanceKm || 0,
      startTime: routePoints[0][3],
      endTime: routePoints[routePoints.length - 1][3]
    });
    setRouteBounds(coords);
    setIsReportOpen(false); // Cerrar modal para ver el mapa
  };

  const handleClearRoute = () => {
    setActiveRoute(null);
    setActiveRouteInfo(null);
    setRouteBounds(null);
  };

  const handleFocusSinglePoint = (lat, lon) => {
    setIsReportOpen(false);
    setBoundsTrigger(0);
    setTimeout(() => {
      setBoundsTrigger(prev => prev + 1);
    }, 100);
  };

  // Filtrado de la tabla del reporte en tiempo real
  const filteredRecords = (reportData && reportData.records)
    ? reportData.records.filter(r => {
      if (!reportSearchTerm) return true;
      const term = reportSearchTerm.toLowerCase();
      return (
        r.deviceId.toLowerCase().includes(term) ||
        (r.timestamp && r.timestamp.toLowerCase().includes(term)) ||
        String(r.lat).includes(term) ||
        String(r.lon).includes(term)
      );
    })
    : [];

  return (
    <div className="dashboard-container">
      {/* Sidebar lateral */}
      <aside className="sidebar glass-effect">
        <header className="logo-area">
          <div className="glow-orb"></div>
          <h1 title={appName}>{appName}</h1>
          <button
            className="settings-trigger-btn"
            onClick={handleOpenSettings}
            title="Configurar Nombre y Servidor de la App Web"
          >
            <Settings size={18} />
          </button>
        </header>

        <div className="stats-card">
          <p>Dispositivos en línea</p>
          <h2>{deviceList.length}</h2>
          <div className={`socket-status ${socketStatus === 'En línea' ? 'online' : 'offline'}`}>
            {socketStatus === 'En línea' ? <Activity size={14} /> : <RadioReceiver size={14} />}
            <span>{socketStatus}</span>
          </div>
          <div className="server-info-badge" title="Servidor WebSocket configurado">
            <span>Servidor: {serverHost}</span>
          </div>
        </div>

        {/* BOTÓN PRINCIPAL DE REPORTES */}
        <button
          className="report-trigger-btn"
          onClick={() => handleOpenReport()}
          title="Ver reporte detallado de ubicaciones y recorridos históricos"
        >
          <FileText size={17} />
          <span>Reportes de Ubicación</span>
        </button>

        {/* Controles de Vista de OpenStreetMap */}
        <div className="osm-controls-panel">
          <div className="control-group">
            <label className="control-label">
              <Layers size={14} /> Capa OpenStreetMap
            </label>
            <select
              value={currentLayer}
              onChange={(e) => setCurrentLayer(e.target.value)}
              className="layer-select"
            >
              <option value="standard">OpenStreetMap Estándar</option>
              <option value="hot">OSM Humanitario (HOT)</option>
              <option value="topo">OpenTopoMap (Topografía)</option>
            </select>
          </div>

          <div className="control-buttons-row">
            <button
              className={`tool-btn ${darkMode ? 'active' : ''}`}
              onClick={() => setDarkMode(!darkMode)}
              title={darkMode ? 'Cambiar a modo mapa claro' : 'Cambiar a modo mapa noche'}
            >
              {darkMode ? <Sun size={15} /> : <Moon size={15} />}
              <span>{darkMode ? 'Modo Claro' : 'Modo Noche'}</span>
            </button>

            {deviceList.length > 0 && (
              <button
                className="tool-btn"
                onClick={handleFitAll}
                title="Enfocar todos los dispositivos en el mapa"
              >
                <Maximize2 size={15} />
                <span>Enfocar Todos</span>
              </button>
            )}
          </div>
        </div>

        <h3 className="list-title">Dispositivos en Vivo</h3>
        <ul className="device-list">
          {deviceList.length === 0 ? (
            <li className="empty-state">
              <Crosshair size={28} className="empty-icon" />
              <p>Esperando coordenadas GPS...</p>
              <span>El backend está listo en http://localhost:8000</span>
            </li>
          ) : (
            <>
              {activeDevice && (
                <div className="filter-badge" onClick={() => setActiveDevice(null)}>
                  Filtrando: <b>{activeDevice}</b> ✕ (Click para ver todos)
                </div>
              )}
              {deviceList
                .filter(device => activeDevice ? device.deviceId === activeDevice : true)
                .map(device => (
                  <li
                    key={device.deviceId}
                    className={`device-item ${activeDevice === device.deviceId ? 'active' : ''}`}
                    onClick={() => setActiveDevice(activeDevice === device.deviceId ? null : device.deviceId)}
                  >
                    <div className="device-header">
                      <span className="device-name">
                        <MapPin size={15} className="device-pin-icon" />
                        {device.deviceId}
                      </span>
                      <button
                        className="history-quick-icon-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenReport(device.deviceId);
                        }}
                        title={`Ver reporte e historial de ${device.deviceId}`}
                      >
                        <FileText size={13} />
                      </button>
                      <div className="device-status"></div>
                    </div>
                    <div className="device-coords">
                      Lat: {device.lat.toFixed(5)} | Lon: {device.lon.toFixed(5)}
                    </div>
                    <div className="device-time">
                      {device.timestamp ? `Última señal: ${new Date(device.timestamp).toLocaleTimeString()}` : 'Señal recibida'}
                    </div>
                  </li>
                ))}
            </>
          )}
        </ul>
      </aside>

      {/* Contenedor del Mapa OpenStreetMap */}
      <main className={`map-wrapper ${darkMode ? 'osm-dark-mode' : ''}`}>
        {/* Banner flotante de Ruta Histórica activa */}
        {activeRoute && activeRouteInfo && (
          <div className="active-route-banner">
            <Route size={16} color="#38bdf8" />
            <span>
              Ruta trazada: <b>{activeRouteInfo.deviceId}</b> ({activeRouteInfo.pointsCount} puntos, ~{activeRouteInfo.distanceKm} km)
            </span>
            <button
              className="route-dismiss-btn"
              onClick={handleClearRoute}
              title="Quitar ruta trazada del mapa"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <MapContainer
          center={defaultCenter}
          zoom={deviceList.length > 0 ? 14 : 3}
          zoomControl={false}
          style={{ width: '100%', height: '100%', background: darkMode ? '#0f172a' : '#f1f5f9' }}
        >
          <ZoomControl position="bottomright" />

          {/* Capa OpenStreetMap configurable */}
          <TileLayer
            key={selectedOsmConfig.id}
            url={selectedOsmConfig.url}
            attribution={selectedOsmConfig.attribution}
            maxZoom={selectedOsmConfig.maxZoom}
          />

          {/* Controlador de navegación y centrado */}
          <MapViewController
            targetCenter={activeDevice && locations[activeDevice] ? [locations[activeDevice].lat, locations[activeDevice].lon] : null}
            allBoundsTrigger={boundsTrigger}
            devices={deviceList}
            routeBounds={routeBounds}
          />

          {/* TRAZADO DE RUTA HISTÓRICA EN EL MAPA */}
          {activeRoute && activeRoute.length > 1 && (
            <>
              <Polyline
                positions={activeRoute}
                pathOptions={{
                  color: '#38bdf8',
                  weight: 5,
                  opacity: 0.9,
                  dashArray: '8, 8',
                  lineCap: 'round',
                  lineJoin: 'round'
                }}
              />
              {/* Marcador Inicio de Ruta */}
              <Marker
                position={activeRoute[0]}
                icon={createRoutePointIcon('🚩 INICIO', '#22c55e')}
              >
                <Popup>
                  <div>
                    <strong>Inicio de Ruta</strong><br />
                    Hora: {activeRouteInfo?.startTime ? new Date(activeRouteInfo.startTime).toLocaleString() : ''}
                  </div>
                </Popup>
              </Marker>
              {/* Marcador Fin de Ruta */}
              <Marker
                position={activeRoute[activeRoute.length - 1]}
                icon={createRoutePointIcon('🏁 FIN', '#ef4444')}
              >
                <Popup>
                  <div>
                    <strong>Fin de Ruta</strong><br />
                    Hora: {activeRouteInfo?.endTime ? new Date(activeRouteInfo.endTime).toLocaleString() : ''}
                  </div>
                </Popup>
              </Marker>
            </>
          )}

          {/* Marcadores de los dispositivos en vivo */}
          {deviceList.map(device => {
            const isSelected = activeDevice === device.deviceId;
            return (
              <Marker
                key={device.deviceId}
                position={[device.lat, device.lon]}
                icon={createMarkerIcon(device.deviceId, isSelected)}
              >
                <Popup className="custom-popup">
                  <div className="popup-card">
                    <h4>{device.deviceId}</h4>
                    <div className="popup-row">
                      <strong>Latitud:</strong> <span>{device.lat.toFixed(6)}</span>
                    </div>
                    <div className="popup-row">
                      <strong>Longitud:</strong> <span>{device.lon.toFixed(6)}</span>
                    </div>
                    {device.timestamp && (
                      <div className="popup-row">
                        <strong>Hora:</strong> <span>{new Date(device.timestamp).toLocaleTimeString()}</span>
                      </div>
                    )}
                    <button
                      className="popup-report-btn"
                      onClick={() => handleOpenReport(device.deviceId)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        width: '100%',
                        padding: '6px 10px',
                        background: '#0284c7',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        marginTop: '8px'
                      }}
                    >
                      <FileText size={14} />
                      Ver Reporte Histórico
                    </button>
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${device.lat}&mlon=${device.lon}#map=16/${device.lat}/${device.lon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="popup-osm-link"
                    >
                      <ExternalLink size={12} />
                      Ver en OpenStreetMap.org
                    </a>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>

        {/* Badge superior informativo */}
        <div className="map-overlay">
          <div className="osm-brand-tag">
            <span className="osm-tag-label">API Cartográfica</span>
            <span className="osm-tag-name">OpenStreetMap</span>
          </div>
          <div className="pulse-dot" title="Rastreo en vivo activo"></div>
        </div>
      </main>

      {/* =========================================================================
          MODAL DE REPORTES DE UBICACIÓN DE CELULARES
          ========================================================================= */}
      {isReportOpen && (
        <div className="modal-backdrop" onClick={() => setIsReportOpen(false)}>
          <div className="modal-card-wide" onClick={(e) => e.stopPropagation()}>
            {/* Header del Modal */}
            <div className="report-modal-header">
              <div className="report-title-block">
                <FileText size={24} color="#38bdf8" />
                <div>
                  <h3>Reporte de Ubicación de Celulares Rastreados</h3>
                  <p>Consulta de historial, rutas recorridas y exportación de datos guardados en el servidor</p>
                </div>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setIsReportOpen(false)}
                title="Cerrar Reportes"
              >
                <X size={20} />
              </button>
            </div>

            {/* Contenido del Reporte */}
            <div className="report-modal-body">
              {/* Barra de Filtros */}
              <div className="report-filters-bar">
                <div className="filter-item">
                  <label>Dispositivo / Celular</label>
                  <select
                    className="filter-select"
                    value={reportFilterDevice}
                    onChange={(e) => setReportFilterDevice(e.target.value)}
                  >
                    <option value="">-- Todos los dispositivos --</option>
                    {reportDevices.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.deviceId} ({d.totalPoints} registros)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="filter-item">
                  <label>Desde Fecha</label>
                  <input
                    type="date"
                    className="filter-input"
                    value={reportStartDate}
                    onChange={(e) => setReportStartDate(e.target.value)}
                  />
                </div>

                <div className="filter-item">
                  <label>Hasta Fecha</label>
                  <input
                    type="date"
                    className="filter-input"
                    value={reportEndDate}
                    onChange={(e) => setReportEndDate(e.target.value)}
                  />
                </div>

                <div className="filter-item" style={{ minWidth: '100px', flex: '0.6' }}>
                  <label>Límite</label>
                  <select
                    className="filter-select"
                    value={reportLimit}
                    onChange={(e) => setReportLimit(Number(e.target.value))}
                  >
                    <option value={100}>100 puntos</option>
                    <option value={250}>250 puntos</option>
                    <option value={500}>500 puntos</option>
                    <option value={1000}>1000 puntos</option>
                    <option value={2000}>2000 puntos</option>
                  </select>
                </div>

                <button
                  className="filter-submit-btn"
                  onClick={() => fetchReport()}
                  title="Actualizar consulta"
                  disabled={isReportLoading}
                >
                  <RefreshCw size={15} className={isReportLoading ? 'spin' : ''} />
                  <span>Consultar</span>
                </button>

                {/* Atajos Rápidos */}
                <div className="filter-quick-chips">
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Filtros rápidos:</span>
                  <button className="quick-chip-btn" onClick={() => setQuickDate('today')}>Hoy</button>
                  <button className="quick-chip-btn" onClick={() => setQuickDate('week')}>7 Días</button>
                  <button className="quick-chip-btn" onClick={() => setQuickDate('all')}>Todo</button>
                </div>
              </div>

              {/* Tarjetas de Métricas Estadísticas */}
              {reportData && (
                <div className="report-metrics-grid">
                  <div className="metric-card">
                    <div className="metric-icon-box">
                      <MapPin size={22} />
                    </div>
                    <div className="metric-info">
                      <p>Puntos Registrados</p>
                      <h4>{reportData.totalRecords}</h4>
                      <span>Ubicaciones GPS</span>
                    </div>
                  </div>

                  <div className="metric-card">
                    <div className="metric-icon-box" style={{ background: 'rgba(34, 197, 94, 0.12)', color: '#22c55e' }}>
                      <Compass size={22} />
                    </div>
                    <div className="metric-info">
                      <p>Distancia Recorrida</p>
                      <h4>{reportData.totalDistanceKm} km</h4>
                      <span>Aprox. acumulada</span>
                    </div>
                  </div>

                  <div className="metric-card">
                    <div className="metric-icon-box" style={{ background: 'rgba(234, 179, 8, 0.12)', color: '#eab308' }}>
                      <Clock size={22} />
                    </div>
                    <div className="metric-info">
                      <p>Primer Registro</p>
                      <h4 style={{ fontSize: '0.95rem' }}>
                        {reportData.firstSeen ? new Date(reportData.firstSeen).toLocaleTimeString() : 'N/A'}
                      </h4>
                      <span>{reportData.firstSeen ? new Date(reportData.firstSeen).toLocaleDateString() : ''}</span>
                    </div>
                  </div>

                  <div className="metric-card">
                    <div className="metric-icon-box" style={{ background: 'rgba(168, 85, 247, 0.12)', color: '#a855f7' }}>
                      <Clock size={22} />
                    </div>
                    <div className="metric-info">
                      <p>Último Registro</p>
                      <h4 style={{ fontSize: '0.95rem' }}>
                        {reportData.lastSeen ? new Date(reportData.lastSeen).toLocaleTimeString() : 'N/A'}
                      </h4>
                      <span>{reportData.lastSeen ? new Date(reportData.lastSeen).toLocaleDateString() : ''}</span>
                    </div>
                  </div>

                  <div className="metric-card">
                    <div className="metric-icon-box" style={{ background: 'rgba(14, 165, 233, 0.12)', color: '#0ea5e9' }}>
                      <Database size={22} />
                    </div>
                    <div className="metric-info">
                      <p>Base de Datos</p>
                      <h4 style={{ fontSize: '0.95rem' }}>{reportData.databaseEngine}</h4>
                      <span>Almacenamiento servidor</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Barra de Acciones del Reporte */}
              <div className="report-toolbar">
                <div className="report-search-wrap">
                  <Search size={15} />
                  <input
                    type="text"
                    className="report-search-input"
                    placeholder="Buscar en el reporte por dispositivo, hora o coordenadas..."
                    value={reportSearchTerm}
                    onChange={(e) => setReportSearchTerm(e.target.value)}
                  />
                </div>

                <div className="report-actions-group">
                  {reportData && reportData.routePoints && reportData.routePoints.length > 1 && (
                    <button
                      className="action-pill-btn accent"
                      onClick={() => handleDrawRouteOnMap(reportData.routePoints, reportData.deviceId, reportData.totalDistanceKm)}
                      title="Dibuja la ruta recorrida en el mapa OpenStreetMap"
                    >
                      <Route size={15} />
                      <span>Trazar Ruta en Mapa</span>
                    </button>
                  )}

                  <button
                    className="action-pill-btn"
                    onClick={handleExportCSV}
                    title="Descargar datos en formato CSV para Microsoft Excel"
                  >
                    <Download size={15} />
                    <span>Exportar Excel (CSV)</span>
                  </button>

                  <button
                    className="action-pill-btn"
                    onClick={handlePrintReport}
                    title="Imprimir informe o Guardar como PDF"
                  >
                    <Printer size={15} />
                    <span>Imprimir / PDF</span>
                  </button>
                </div>
              </div>

              {/* Tabla de Ubicaciones Detallada */}
              <div className="report-table-card">
                <div className="table-scroll-container">
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th style={{ width: '60px' }}>#</th>
                        <th>Dispositivo</th>
                        <th>Fecha y Hora</th>
                        <th>Latitud</th>
                        <th>Longitud</th>
                        <th>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {isReportLoading ? (
                        <tr>
                          <td colSpan="6" style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>
                            <RefreshCw size={24} className="spin" style={{ margin: '0 auto 8px', display: 'block' }} />
                            Cargando reporte de ubicaciones desde el servidor...
                          </td>
                        </tr>
                      ) : filteredRecords.length === 0 ? (
                        <tr>
                          <td colSpan="6" style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>
                            No se encontraron registros de ubicación para los filtros seleccionados.
                          </td>
                        </tr>
                      ) : (
                        filteredRecords.map((item, idx) => {
                          const dt = item.timestamp ? new Date(item.timestamp) : null;
                          return (
                            <tr key={item.id || idx}>
                              <td style={{ color: '#64748b' }}>{idx + 1}</td>
                              <td>
                                <span className="device-badge-tag">
                                  <MapPin size={11} />
                                  {item.deviceId}
                                </span>
                              </td>
                              <td>
                                {dt ? `${dt.toLocaleDateString()} ${dt.toLocaleTimeString()}` : item.timestamp}
                              </td>
                              <td style={{ fontFamily: 'monospace' }}>{item.lat.toFixed(6)}</td>
                              <td style={{ fontFamily: 'monospace' }}>{item.lon.toFixed(6)}</td>
                              <td>
                                <a
                                  href={`https://www.openstreetmap.org/?mlat=${item.lat}&mlon=${item.lon}#map=17/${item.lat}/${item.lon}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="table-action-link"
                                  title="Ver punto exacto en OpenStreetMap"
                                >
                                  <ExternalLink size={13} />
                                  Ver OSM
                                </a>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Footer del Modal */}
            <div className="modal-footer">
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                Mostrando {filteredRecords.length} de {reportData ? reportData.totalRecords : 0} registros grabados
              </span>
              <button
                className="btn-primary"
                onClick={() => setIsReportOpen(false)}
              >
                Cerrar Reporte
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Configuración de la App Web */}
      {isSettingsOpen && (
        <div className="modal-backdrop" onClick={() => setIsSettingsOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <Settings size={20} className="modal-icon" />
                <h3>Configuración de la Aplicación</h3>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setIsSettingsOpen(false)}
                title="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Nombre de la App / Plataforma:</label>
                <input
                  type="text"
                  className="form-input"
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  placeholder="Ej. Rastreo OSM, Mi Rastreador"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Dirección del Servidor Backend (Host y Puerto):</label>
                <input
                  type="text"
                  className="form-input"
                  value={tempHost}
                  onChange={(e) => setTempHost(e.target.value)}
                  placeholder="Ej. localhost:8000 o 192.168.1.200:8000"
                />
                <span className="form-hint">
                  Conexión WebSocket: ws://{tempHost || 'localhost:8000'}/ws
                </span>
              </div>

              <div className="quick-hosts">
                <span className="quick-label">Atajos rápidos:</span>
                <div className="quick-buttons">
                  <button
                    type="button"
                    className="quick-chip"
                    onClick={() => setTempHost(`${window.location.hostname || 'localhost'}:8000`)}
                  >
                    Localhost (:8000)
                  </button>
                  <button
                    type="button"
                    className="quick-chip"
                    onClick={() => setTempHost('192.168.1.200:8000')}
                  >
                    WiFi (192.168.1.200:8000)
                  </button>
                  <button
                    type="button"
                    className="quick-chip"
                    onClick={() => setTempHost('127.0.0.1:8000')}
                  >
                    ADB USB (127.0.0.1:8000)
                  </button>
                </div>
              </div>

              {saveNotice && (
                <div className="save-notice">
                  <Check size={16} />
                  <span>{saveNotice}</span>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={handleResetDefaults}
                title="Restablecer valores por defecto"
              >
                <RotateCcw size={15} />
                <span>Restablecer</span>
              </button>
              <div className="footer-right">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setIsSettingsOpen(false)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSaveSettings}
                >
                  <Check size={16} />
                  <span>Guardar</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
