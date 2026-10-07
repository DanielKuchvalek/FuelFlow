<?php
// api/db.php – připojení k databázi, session a společné pomocné funkce API

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

const DEFAULT_BUDGET = 5000.00;

function json_response($data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function json_error(string $message, int $status = 400): void {
    json_response(['error' => $message], $status);
}

// Neošetřené chyby se zalogují, klient dostane jen obecnou hlášku bez detailů o serveru
set_exception_handler(function (\Throwable $e) {
    error_log('[FuelFlow] ' . $e);
    json_error('Na serveru došlo k chybě. Zkuste to prosím znovu.', 500);
});

function require_method(string ...$methods): void {
    if (!in_array($_SERVER['REQUEST_METHOD'], $methods, true)) {
        header('Allow: ' . implode(', ', $methods));
        json_error('Nepovolená metoda požadavku.', 405);
    }
}

// Tělo požadavku musí být JSON – formulář z cizího webu takový požadavek bez CORS preflightu neodešle
function read_json_body(): array {
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($contentType, 'application/json') !== 0) {
        json_error('Očekáván obsah typu application/json.', 415);
    }
    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) {
        json_error('Neplatná data požadavku.');
    }
    return $data;
}

function require_login(): int {
    if (empty($_SESSION['user_id'])) {
        json_error('Neautorizováno', 401);
    }
    return (int)$_SESSION['user_id'];
}

// Přihlašovací údaje k DB jsou v api/config.php (vzor: api/config.example.php)
$configFile = __DIR__ . '/config.php';
if (!is_file($configFile)) {
    error_log('[FuelFlow] Chybí api/config.php – zkopírujte api/config.example.php');
    json_error('Server není nakonfigurován.', 500);
}
$config = require $configFile;

$dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s',
    $config['db_host'], $config['db_name'], $config['db_charset'] ?? 'utf8mb4');
$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false, // Zajišťuje 100% ochranu proti SQL injection
    PDO::MYSQL_ATTR_FOUND_ROWS   => true,  // rowCount() u UPDATE vrací nalezené řádky, ne jen změněné
];

try {
    $pdo = new PDO($dsn, $config['db_user'], $config['db_pass'], $options);
} catch (\PDOException $e) {
    error_log('[FuelFlow] Připojení k DB selhalo: ' . $e->getMessage());
    json_error('Databáze je momentálně nedostupná.', 503);
}

// Spuštění bezpečné session
if (session_status() === PHP_SESSION_NONE) {
    $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');

    ini_set('session.use_only_cookies', 1);
    ini_set('session.use_strict_mode', 1);
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => $isHttps,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}
