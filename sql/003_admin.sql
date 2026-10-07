-- Fuel Flow – administrace: role administrátora, poslední přihlášení a auditní log
USE fuelflow_db;

ALTER TABLE users
  ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER monthly_budget,
  ADD COLUMN last_login_at DATETIME NULL AFTER is_admin;

-- Záznam každé akce v administraci (kdo, co, komu, kdy)
CREATE TABLE IF NOT EXISTS admin_audit (
    id INT AUTO_INCREMENT PRIMARY KEY,
    admin_id INT NULL,
    action VARCHAR(50) NOT NULL,
    target_user_id INT NULL,
    target_email VARCHAR(191) NULL,
    detail VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_audit_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- První administrátor: doplňte svůj e-mail a spusťte
-- UPDATE users SET is_admin = 1 WHERE email = 'vas@email.cz';
