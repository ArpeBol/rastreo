-- Esquema de Base de Datos MySQL para el Sistema de Rastreo GPS
-- Base de datos: rastreador_gps

CREATE DATABASE IF NOT EXISTS `rastreador_gps`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `rastreador_gps`;

-- Tabla de Historial de Ubicaciones por Dispositivo
CREATE TABLE IF NOT EXISTS `historial_ubicaciones` (
    `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `device_id` VARCHAR(100) NOT NULL COMMENT 'Identificador del dispositivo móvil o vehículo',
    `lat` DECIMAL(11, 8) NOT NULL COMMENT 'Latitud GPS',
    `lon` DECIMAL(11, 8) NOT NULL COMMENT 'Longitud GPS',
    `timestamp` DATETIME NOT NULL COMMENT 'Fecha y hora exacta del reporte',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Fecha de inserción en el servidor',
    INDEX `idx_device_time` (`device_id`, `timestamp`),
    INDEX `idx_timestamp` (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

