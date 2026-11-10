"""
Script de prueba para enviar coordenadas GPS simuladas al backend de Rastreador Web
y ver el movimiento en tiempo real sobre OpenStreetMap.
"""
import time
import requests
import random

API_URL = "http://localhost:8000/api/location"

# Coordenadas iniciales (por ejemplo, centro de una ciudad)
devices = [
    {"deviceId": "VEHICULO-01", "lat": -12.046374, "lon": -77.042793},
    {"deviceId": "MOTO-02", "lat": -12.052000, "lon": -77.035000},
    {"deviceId": "CAMION-03", "lat": -12.038000, "lon": -77.050000},
]

print("Iniciando simulación GPS hacia OpenStreetMap...")
print(f"Enviando datos a: {API_URL}")

try:
    while True:
        for dev in devices:
            # Simular pequeño desplazamiento
            dev["lat"] += (random.random() - 0.5) * 0.001
            dev["lon"] += (random.random() - 0.5) * 0.001
            
            payload = {
                "deviceId": dev["deviceId"],
                "lat": dev["lat"],
                "lon": dev["lon"]
            }
            try:
                res = requests.post(API_URL, json=payload, timeout=2)
                print(f"[OK] {dev['deviceId']} -> Lat: {dev['lat']:.5f}, Lon: {dev['lon']:.5f}")
            except Exception as e:
                print(f"[!] Error enviando {dev['deviceId']}: {e}")

        time.sleep(3)
except KeyboardInterrupt:
    print("\nSimulación finalizada.")
