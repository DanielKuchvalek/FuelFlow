-- Fuel Flow – kompletní struktura databáze (bez dat)
-- Pro novou instalaci stačí importovat jen tento soubor.

CREATE DATABASE IF NOT EXISTS fuelflow_db
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE fuelflow_db;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(191) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    monthly_budget DECIMAL(10,2) NOT NULL DEFAULT 5000.00,
    is_admin TINYINT(1) NOT NULL DEFAULT 0,
    last_login_at DATETIME NULL,
    UNIQUE KEY email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    plate VARCHAR(20) NULL,
    color VARCHAR(10) NOT NULL DEFAULT '#10b981',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    monthly_budget DECIMAL(10,2) NOT NULL DEFAULT 5000.00,
    CONSTRAINT fk_vehicle_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fuel_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    refuel_date DATE NOT NULL,
    litres DECIMAL(10,2) NULL,
    odometer INT UNSIGNED NULL,
    full_tank TINYINT(1) NOT NULL DEFAULT 0,
    fuel_type VARCHAR(50) NOT NULL DEFAULT 'Natural 95',
    station VARCHAR(100) NULL,
    note TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    vehicle_id INT NULL,
    INDEX idx_user_date (user_id, refuel_date),
    CONSTRAINT fk_fuel_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
    CONSTRAINT fk_user_records FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Připomínky servisu (STK, olej, dálniční známka…) – termín datem a/nebo kilometry
CREATE TABLE IF NOT EXISTS service_reminders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    vehicle_id INT NULL,
    title VARCHAR(100) NOT NULL,
    due_date DATE NULL,
    due_km INT UNSIGNED NULL,
    done TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_reminder_user (user_id, done),
    CONSTRAINT fk_reminder_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_reminder_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Záznam každé akce v administraci (kdo, co, komu, kdy)
CREATE TABLE IF NOT EXISTS admin_audit (
    id INT AUTO_INCREMENT PRIMARY KEY,
    admin_id INT NULL,
    action VARCHAR(50) NOT NULL,
    target_user_id INT NULL,
    target_email VARCHAR(191) NULL,
    detail VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_created (created_at),
    CONSTRAINT fk_audit_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- První administrátor: po registraci doplňte svůj e-mail a spusťte
-- UPDATE users SET is_admin = 1 WHERE email = 'vas@email.cz';
