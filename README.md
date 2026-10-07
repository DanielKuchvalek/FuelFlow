# FuelFlow

Webová aplikace pro evidenci tankování a nákladů na auto. Uživatel si zapisuje jednotlivá tankování
(částka, litry, stav tachometru, typ paliva, čerpací stanice), sleduje spotřebu v l/100 km,
měsíční rozpočet, statistiky a grafy, spravuje více vozidel a připomínky servisu (STK, olej,
dálniční známka). Součástí je administrace uživatelů s auditním logem.

## Technologie

- **Backend:** PHP 8 (PDO), MySQL / MariaDB
- **Frontend:** HTML, CSS, vanilla JavaScript (ES moduly)
- **Knihovny** (v `vendor/`): Chart.js, Lenis, canvas-confetti, font Outfit

## Spuštění lokálně v XAMPP

1. Naklonujte repozitář do složky `htdocs`:
   ```bash
   cd /Applications/XAMPP/xamppfiles/htdocs   # na Windows: C:\xampp\htdocs
   git clone https://github.com/DanielKuchvalek/FuelFlow.git Tankovani
   ```
2. V XAMPP spusťte **Apache** a **MySQL**.
3. Vytvořte konfiguraci zkopírováním vzoru a doplňte přihlašovací údaje k DB
   (výchozí XAMPP: uživatel `root`, prázdné heslo):
   ```bash
   cp api/config.example.php api/config.php
   ```
4. Importujte strukturu databáze `sql/schema.sql` – přes phpMyAdmin (záložka *Import*)
   nebo z terminálu:
   ```bash
   /Applications/XAMPP/xamppfiles/bin/mysql -u root < sql/schema.sql
   ```
   Skript sám vytvoří databázi `fuelflow_db`.
5. Otevřete <http://localhost/Tankovani/> a zaregistrujte se.

Administrace je na <http://localhost/Tankovani/admin/>. Účet administrátora nastavíte v SQL:

```sql
UPDATE users SET is_admin = 1 WHERE email = 'vas@email.cz';
```

> Soubory `sql/002_*.sql` a `sql/003_*.sql` jsou migrace pro starší instalace –
> při nové instalaci je nespouštějte, `schema.sql` je už obsahuje.
