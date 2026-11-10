import sys
import os

# Asegurar que las dependencias instaladas en el venv local se carguen siempre
VENV_PACKAGES = os.path.join(os.path.dirname(__file__), "venv", "Lib", "site-packages")
if os.path.exists(VENV_PACKAGES) and VENV_PACKAGES not in sys.path:
    sys.path.insert(0, VENV_PACKAGES)

import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional
import json
import datetime
import sqlite3
import math

# Importar pymysql para la conexión con MySQL / MariaDB
try:
    import pymysql
    from pymysql.cursors import DictCursor
    PYMYSQL_AVAILABLE = True
except ImportError:
    PYMYSQL_AVAILABLE = False
    print("[ADVERTENCIA] pymysql no está disponible. Se usará SQLite como motor principal.")

app = FastAPI(title="Rastreador GPS Backend (MySQL & WebSocket)")

# Habilitar CORS para que React pueda conectarse
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Tiempo de gracia en segundos para considerar un dispositivo "en línea" (5 minutos = 300s para intervalos de 2 a 3 min)
ONLINE_TIMEOUT_SECONDS = 300

# ---------------- CONFIGURACIÓN DE BASE DE DATOS MYSQL ----------------
MYSQL_HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", 3306))
MYSQL_USER = os.getenv("MYSQL_USER", "root")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "")
MYSQL_DATABASE = os.getenv("MYSQL_DATABASE", "rastreador_gps")

# Base de datos SQLite de respaldo automático por si MySQL está apagado
SQLITE_PATH = os.path.join(os.path.dirname(__file__), "ubicaciones.db")

mysql_activo = False

def get_mysql_connection(con_base_datos=True):
    """Retorna una conexión a MySQL; si falla, devuelve None."""
    if not PYMYSQL_AVAILABLE:
        return None
    try:
        kwargs = {
            "host": MYSQL_HOST,
            "port": MYSQL_PORT,
            "user": MYSQL_USER,
            "password": MYSQL_PASSWORD,
            "connect_timeout": 3,
            "charset": "utf8mb4",
        }
        if con_base_datos:
            kwargs["database"] = MYSQL_DATABASE
            kwargs["cursorclass"] = DictCursor
        return pymysql.connect(**kwargs)
    except Exception as e:
        return None

def init_mysql_db():
    """Crea la base de datos y la tabla en MySQL si no existen."""
    global mysql_activo
    if not PYMYSQL_AVAILABLE:
        init_sqlite_fallback()
        return

    try:
        # 1. Crear base de datos si no existe
        root_conn = get_mysql_connection(con_base_datos=False)
        if root_conn:
            with root_conn.cursor() as cursor:
                cursor.execute(f"CREATE DATABASE IF NOT EXISTS `{MYSQL_DATABASE}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;")
            root_conn.close()

            # 2. Conectar a la base de datos y crear la tabla de historial
            conn = get_mysql_connection(con_base_datos=True)
            if conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        CREATE TABLE IF NOT EXISTS `historial_ubicaciones` (
                            `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
                            `device_id` VARCHAR(100) NOT NULL,
                            `lat` DECIMAL(11, 8) NOT NULL,
                            `lon` DECIMAL(11, 8) NOT NULL,
                            `timestamp` DATETIME NOT NULL,
                            `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            INDEX `idx_device_time` (`device_id`, `timestamp`),
                            INDEX `idx_timestamp` (`timestamp`)
                        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                    """)
                conn.commit()
                conn.close()
                mysql_activo = True
                print(f"[MYSQL OK] Conectado exitosamente a MySQL ({MYSQL_HOST}:{MYSQL_PORT}) - BD: '{MYSQL_DATABASE}'")
                return

        print(f"[MYSQL AVISO] No se pudo conectar a MySQL en {MYSQL_HOST}:{MYSQL_PORT}. Se activará SQLite como respaldo.")
        init_sqlite_fallback()
    except Exception as e:
        print(f"[MYSQL ERROR] Fallo al inicializar MySQL ({e}). Usando SQLite de respaldo.")
        init_sqlite_fallback()

def init_sqlite_fallback():
    """Inicializa la base de datos SQLite como respaldo automático."""
    try:
        conn = sqlite3.connect(SQLITE_PATH)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS historial_ubicaciones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                lat REAL NOT NULL,
                lon REAL NOT NULL,
                timestamp TEXT NOT NULL
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_device_time ON historial_ubicaciones(device_id, timestamp)")
        conn.commit()
        conn.close()
        print(f"[SQLITE RESPALDO] Base SQLite activa en: {SQLITE_PATH}")
    except Exception as e:
        print(f"[SQLITE ERROR] {e}")

def guardar_ubicacion(device_id: str, lat: float, lon: float, timestamp_iso: str):
    """Guarda en MySQL con fallback automático a SQLite si MySQL no está disponible."""
    global mysql_activo
    guardado_en_mysql = False

    # Intentar guardar en MySQL
    try:
        conn = get_mysql_connection(con_base_datos=True)
        if conn:
            # Formatear timestamp ISO a formato DATETIME compatible con MySQL
            dt_obj = datetime.datetime.fromisoformat(timestamp_iso)
            sql_dt = dt_obj.strftime("%Y-%m-%d %H:%M:%S")

            with conn.cursor() as cursor:
                cursor.execute(
                    "INSERT INTO `historial_ubicaciones` (`device_id`, `lat`, `lon`, `timestamp`) VALUES (%s, %s, %s, %s)",
                    (device_id, lat, lon, sql_dt)
                )
            conn.commit()
            conn.close()
            guardado_en_mysql = True
            mysql_activo = True
    except Exception as e:
        mysql_activo = False

    # Si MySQL no respondió, guardar en SQLite de respaldo
    if not guardado_en_mysql:
        try:
            conn = sqlite3.connect(SQLITE_PATH)
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO historial_ubicaciones (device_id, lat, lon, timestamp) VALUES (?, ?, ?, ?)",
                (device_id, lat, lon, timestamp_iso)
            )
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[ERROR BD] No se pudo guardar ni en MySQL ni en SQLite: {e}")

# Memoria temporal de ubicaciones para el estado en vivo
device_locations: Dict[str, dict] = {}

# Conexiones WebSocket activas (Clientes React)
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        # Enviar únicamente dispositivos que estén actualmente en línea (< 300s)
        active_devices = get_active_devices()
        await websocket.send_json({"type": "initialLocations", "data": active_devices})

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                pass

manager = ConnectionManager()

def get_active_devices() -> List[dict]:
    now = datetime.datetime.now()
    active = []
    for loc in device_locations.values():
        t = datetime.datetime.fromisoformat(loc["timestamp"])
        if (now - t).total_seconds() <= ONLINE_TIMEOUT_SECONDS:
            active.append(loc)
    return active

# Tarea en segundo plano para purgar dispositivos desconectados y avisar a React
async def monitor_offline_devices():
    while True:
        await asyncio.sleep(5)
        now = datetime.datetime.now()
        expired_ids = []
        for dev_id, loc in list(device_locations.items()):
            t = datetime.datetime.fromisoformat(loc["timestamp"])
            if (now - t).total_seconds() > ONLINE_TIMEOUT_SECONDS:
                expired_ids.append(dev_id)

        for dev_id in expired_ids:
            del device_locations[dev_id]
            print(f"[OFFLINE] Dispositivo desconectado por inactividad (> {ONLINE_TIMEOUT_SECONDS}s): {dev_id}")
            await manager.broadcast({
                "type": "deviceOffline",
                "deviceId": dev_id
            })

@app.on_event("startup")
async def startup_event():
    init_mysql_db()
    asyncio.create_task(monitor_offline_devices())

class LocationData(BaseModel):
    deviceId: str
    lat: float
    lon: float

@app.post("/api/location")
async def receive_location(data: LocationData):
    now_iso = datetime.datetime.now().isoformat()
    loc = {
        "deviceId": data.deviceId,
        "lat": data.lat,
        "lon": data.lon,
        "timestamp": now_iso
    }
    device_locations[data.deviceId] = loc
    
    # 1. Grabar en MySQL (o fallback SQLite si MySQL estuviera inactivo)
    guardar_ubicacion(data.deviceId, data.lat, data.lon, now_iso)

    # 2. Notificar a los clientes React en vivo vía WebSocket
    await manager.broadcast({"type": "locationUpdate", "data": loc})
    motor = "MySQL" if mysql_activo else "SQLite (Respaldo)"
    print(f"[{motor} GUARDADO + EN LÍNEA] {data.deviceId}: lat={data.lat:.5f}, lon={data.lon:.5f}")
    return {"success": True, "saved_db": True, "motor": motor, "timestamp": now_iso}

@app.get("/api/locations")
async def get_locations():
    return get_active_devices()

@app.delete("/api/locations")
async def clear_locations():
    device_locations.clear()
    await manager.broadcast({"type": "initialLocations", "data": []})
    return {"success": True, "message": "Dispositivos activos en memoria limpiados"}

# Endpoint para consultar el estado del motor de base de datos
@app.get("/api/db-status")
async def get_db_status():
    global mysql_activo
    conn_mysql = get_mysql_connection(con_base_datos=True)
    total_mysql = None
    if conn_mysql:
        try:
            with conn_mysql.cursor() as cursor:
                cursor.execute("SELECT COUNT(*) as total FROM `historial_ubicaciones`")
                row = cursor.fetchone()
                total_mysql = row["total"] if row else 0
            conn_mysql.close()
            mysql_activo = True
        except Exception:
            mysql_activo = False

    return {
        "mysql_conectado": mysql_activo,
        "mysql_host": MYSQL_HOST,
        "mysql_port": MYSQL_PORT,
        "mysql_database": MYSQL_DATABASE,
        "total_registros_mysql": total_mysql,
        "sqlite_respaldo_activo": os.path.exists(SQLITE_PATH),
    }

# Función para calcular distancia geodésica entre dos coordenadas (Haversine)
def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0  # Radio terrestre en kilómetros
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c

# Endpoint para listar todos los celulares / dispositivos registrados en la base de datos
@app.get("/api/devices")
async def get_all_devices():
    """Retorna lista de celulares rastreados con métricas de primer/último reporte y total de puntos."""
    devices_dict = {}

    # 1. Intentar consultar en MySQL
    conn_mysql = get_mysql_connection(con_base_datos=True)
    if conn_mysql:
        try:
            with conn_mysql.cursor() as cursor:
                cursor.execute("""
                    SELECT 
                        `device_id` as deviceId, 
                        COUNT(*) as totalPoints, 
                        MIN(`timestamp`) as firstSeen, 
                        MAX(`timestamp`) as lastSeen 
                    FROM `historial_ubicaciones` 
                    GROUP BY `device_id` 
                    ORDER BY lastSeen DESC
                """)
                rows = cursor.fetchall()
            conn_mysql.close()
            for r in rows:
                if isinstance(r.get("firstSeen"), (datetime.datetime, datetime.date)):
                    r["firstSeen"] = r["firstSeen"].isoformat()
                if isinstance(r.get("lastSeen"), (datetime.datetime, datetime.date)):
                    r["lastSeen"] = r["lastSeen"].isoformat()
                devices_dict[r["deviceId"]] = r
        except Exception as e:
            print(f"[ERROR DEVICES MYSQL] {e}")

    # 2. Complementar o fallback con SQLite
    if os.path.exists(SQLITE_PATH):
        try:
            conn = sqlite3.connect(SQLITE_PATH)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("""
                SELECT 
                    device_id as deviceId, 
                    COUNT(*) as totalPoints, 
                    MIN(timestamp) as firstSeen, 
                    MAX(timestamp) as lastSeen 
                FROM historial_ubicaciones 
                GROUP BY device_id 
                ORDER BY lastSeen DESC
            """)
            sqlite_rows = cursor.fetchall()
            conn.close()
            for sr in sqlite_rows:
                dev_id = sr["deviceId"]
                if dev_id not in devices_dict:
                    devices_dict[dev_id] = {
                        "deviceId": dev_id,
                        "totalPoints": sr["totalPoints"],
                        "firstSeen": sr["firstSeen"],
                        "lastSeen": sr["lastSeen"]
                    }
        except Exception as e:
            print(f"[ERROR DEVICES SQLITE] {e}")

    # 3. Incluir dispositivos activos en memoria si no estuvieran aún registrados
    for dev_id, loc in device_locations.items():
        if dev_id not in devices_dict:
            devices_dict[dev_id] = {
                "deviceId": dev_id,
                "totalPoints": 1,
                "firstSeen": loc["timestamp"],
                "lastSeen": loc["timestamp"]
            }

    return list(devices_dict.values())

# Endpoint avanzado para consultar el historial con filtros de fecha y dispositivo
@app.get("/api/history")
async def get_all_history(
    device_id: Optional[str] = None, 
    start_date: Optional[str] = None, 
    end_date: Optional[str] = None, 
    limit: int = 1000,
    order: str = "DESC"
):
    order_sql = "ASC" if order.upper() == "ASC" else "DESC"
    records = []

    # Probar primero en MySQL
    conn_mysql = get_mysql_connection(con_base_datos=True)
    if conn_mysql:
        try:
            conditions = []
            params = []
            if device_id:
                conditions.append("`device_id` = %s")
                params.append(device_id)
            if start_date:
                conditions.append("`timestamp` >= %s")
                params.append(start_date if " " in start_date or "T" in start_date else f"{start_date} 00:00:00")
            if end_date:
                conditions.append("`timestamp` <= %s")
                params.append(end_date if " " in end_date or "T" in end_date else f"{end_date} 23:59:59")

            where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
            sql = f"SELECT id, device_id as deviceId, lat, lon, timestamp FROM `historial_ubicaciones` {where_clause} ORDER BY id {order_sql} LIMIT %s"
            params.append(limit)

            with conn_mysql.cursor() as cursor:
                cursor.execute(sql, tuple(params))
                rows = cursor.fetchall()
            conn_mysql.close()

            for r in rows:
                if isinstance(r.get("timestamp"), (datetime.datetime, datetime.date)):
                    r["timestamp"] = r["timestamp"].isoformat()
                r["lat"] = float(r["lat"])
                r["lon"] = float(r["lon"])
            return rows
        except Exception as e:
            print(f"[ERROR QUERY MYSQL] {e}")

    # Fallback a SQLite
    try:
        conn = sqlite3.connect(SQLITE_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        conditions = []
        params = []
        if device_id:
            conditions.append("device_id = ?")
            params.append(device_id)
        if start_date:
            conditions.append("timestamp >= ?")
            params.append(start_date if " " in start_date or "T" in start_date else f"{start_date} 00:00:00")
        if end_date:
            conditions.append("timestamp <= ?")
            params.append(end_date if " " in end_date or "T" in end_date else f"{end_date} 23:59:59")

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        sql = f"SELECT id, device_id as deviceId, lat, lon, timestamp FROM historial_ubicaciones {where_clause} ORDER BY id {order_sql} LIMIT ?"
        params.append(limit)

        cursor.execute(sql, tuple(params))
        rows = cursor.fetchall()
        conn.close()

        for r in rows:
            d = dict(r)
            d["lat"] = float(d["lat"])
            d["lon"] = float(d["lon"])
            records.append(d)
        return records
    except Exception as e:
        return {"error": str(e), "data": []}

@app.get("/api/history/{device_id}")
async def get_device_history(
    device_id: str, 
    start_date: Optional[str] = None, 
    end_date: Optional[str] = None, 
    limit: int = 500,
    order: str = "DESC"
):
    return await get_all_history(device_id=device_id, start_date=start_date, end_date=end_date, limit=limit, order=order)

# Endpoint completo para generar el REPORTE con estadísticas (Total km, fechas, puntos)
@app.get("/api/report")
async def generate_location_report(
    device_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = 2000
):
    """Genera un reporte consolidado con estadísticas de distancia y ubicaciones en orden cronológico."""
    # Obtenemos en orden cronológico ASC para trazar rutas y calcular distancias adecuadamente
    raw_points = await get_all_history(
        device_id=device_id,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        order="ASC"
    )

    if isinstance(raw_points, dict) and "error" in raw_points:
        return raw_points

    total_records = len(raw_points)
    total_distance_km = 0.0

    # Calcular distancia acumulada entre puntos consecutivos
    for i in range(1, total_records):
        prev = raw_points[i - 1]
        curr = raw_points[i]
        # Solo calcular distancia continua si es del mismo dispositivo
        if prev.get("deviceId") == curr.get("deviceId"):
            d = haversine_km(prev["lat"], prev["lon"], curr["lat"], curr["lon"])
            total_distance_km += d

    first_timestamp = raw_points[0]["timestamp"] if total_records > 0 else None
    last_timestamp = raw_points[-1]["timestamp"] if total_records > 0 else None

    # Devolvemos también la lista invertida (más recientes primero) para mostrar en tabla
    table_records = list(reversed(raw_points))

    motor = "MySQL" if mysql_activo else "SQLite"

    return {
        "success": True,
        "deviceId": device_id or "TODOS",
        "totalRecords": total_records,
        "totalDistanceKm": round(total_distance_km, 2),
        "firstSeen": first_timestamp,
        "lastSeen": last_timestamp,
        "databaseEngine": motor,
        "records": table_records,
        "routePoints": [[p["lat"], p["lon"], p["deviceId"], p["timestamp"]] for p in raw_points]
    }

# Endpoint para eliminar historial de un dispositivo si se desea limpiar pruebas
@app.delete("/api/history/{device_id}")
async def delete_device_history(device_id: str):
    eliminados_mysql = 0
    eliminados_sqlite = 0

    conn_mysql = get_mysql_connection(con_base_datos=True)
    if conn_mysql:
        try:
            with conn_mysql.cursor() as cursor:
                cursor.execute("DELETE FROM `historial_ubicaciones` WHERE `device_id` = %s", (device_id,))
                eliminados_mysql = cursor.rowcount
            conn_mysql.commit()
            conn_mysql.close()
        except Exception:
            pass

    if os.path.exists(SQLITE_PATH):
        try:
            conn = sqlite3.connect(SQLITE_PATH)
            cursor = conn.cursor()
            cursor.execute("DELETE FROM historial_ubicaciones WHERE device_id = ?", (device_id,))
            eliminados_sqlite = cursor.rowcount
            conn.commit()
            conn.close()
        except Exception:
            pass

    return {
        "success": True, 
        "deviceId": device_id, 
        "deletedMySQL": eliminados_mysql, 
        "deletedSQLite": eliminados_sqlite
    }

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Mantener la conexión abierta
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
