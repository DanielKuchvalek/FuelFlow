-- Fuel Flow – rozšíření o spotřebu (tachometr) a připomínky servisu
USE fuelflow_db;

-- Stav tachometru a příznak plné nádrže u tankování (výpočet l/100 km metodou „plná–plná“)
ALTER TABLE fuel_records
  ADD COLUMN odometer INT UNSIGNED NULL AFTER litres,
  ADD COLUMN full_tank TINYINT(1) NOT NULL DEFAULT 0 AFTER odometer;

-- Připomínky servisu (STK, olej, dálniční známka…) – termín datem a/nebo kilometry
CREATE TABLE IF NOT EXISTS service_reminders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    vehicle_id INT NULL,
    title VARCHAR(100) NOT NULL,
    due_date DATE NULL,
    due_km INT UNSIGNED NULL,
    done TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_reminder_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_reminder_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
    INDEX idx_reminder_user (user_id, done)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
