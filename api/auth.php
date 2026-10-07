<?php
// api/auth.php
require_once __DIR__ . '/db.php';

const LOGIN_MAX_FAILS = 5;       // po tolika neúspěšných pokusech se přihlášení zablokuje
const LOGIN_LOCK_SECONDS = 60;   // na jak dlouho
const LOGIN_FAIL_WINDOW = 900;   // po 15 minutách klidu se počítadlo vynuluje

$action = $_GET['action'] ?? '';

// --- OMEZENÍ POKUSŮ O PŘIHLÁŠENÍ ---
// Počítadlo je uložené na serveru podle IP adresy i e-mailu, ne v session –
// tu by útočník obešel jednoduše tím, že neposílá cookie.

function throttle_path(string $key): string {
    return sys_get_temp_dir() . '/fuelflow_login_' . hash('sha256', $key);
}

function throttle_read(string $key): array {
    $raw = @file_get_contents(throttle_path($key));
    $data = $raw ? json_decode($raw, true) : null;
    if (!is_array($data) || (time() - ($data['last'] ?? 0)) > LOGIN_FAIL_WINDOW) {
        return ['fails' => 0, 'last' => 0];
    }
    return $data;
}

function throttle_wait_seconds(array $keys): int {
    $wait = 0;
    foreach ($keys as $key) {
        $data = throttle_read($key);
        if ($data['fails'] >= LOGIN_MAX_FAILS) {
            $wait = max($wait, LOGIN_LOCK_SECONDS - (time() - $data['last']));
        }
    }
    return $wait;
}

function throttle_register_fail(array $keys): void {
    foreach ($keys as $key) {
        $data = throttle_read($key);
        $data['fails']++;
        $data['last'] = time();
        file_put_contents(throttle_path($key), json_encode($data), LOCK_EX);
    }
}

function throttle_reset(array $keys): void {
    foreach ($keys as $key) {
        @unlink(throttle_path($key));
    }
}

function fetch_user(PDO $pdo, int $userId): ?array {
    $stmt = $pdo->prepare("SELECT id, email, monthly_budget, is_admin FROM users WHERE id = :id");
    $stmt->execute([':id' => $userId]);
    return $stmt->fetch() ?: null;
}

function user_payload(array $user): array {
    return [
        'id'     => (int)$user['id'],
        'email'  => $user['email'],
        'budget' => (float)$user['monthly_budget'],
        'isAdmin' => (int)($user['is_admin'] ?? 0) === 1,
    ];
}

function start_user_session(array $user): void {
    global $pdo;
    session_regenerate_id(true);
    $_SESSION['user_id'] = (int)$user['id'];
    $pdo->prepare("UPDATE users SET last_login_at = NOW() WHERE id = ?")->execute([(int)$user['id']]);
}

function verify_user_password(PDO $pdo, int $userId, string $password): bool {
    $stmt = $pdo->prepare("SELECT password_hash FROM users WHERE id = :id");
    $stmt->execute([':id' => $userId]);
    $hash = $stmt->fetchColumn();
    return $hash && $password !== '' && password_verify($password, $hash);
}

function validate_credentials(array $input): array {
    $email = trim((string)($input['email'] ?? ''));
    $password = (string)($input['password'] ?? '');

    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 191) {
        json_error('Zadejte platný e-mail.');
    }
    if ($password === '') {
        json_error('Zadejte heslo.');
    }
    return [mb_strtolower($email), $password];
}

switch ($action) {
    case 'register':
        require_method('POST');
        [$email, $password] = validate_credentials(read_json_body());

        if (mb_strlen($password) < 6) {
            json_error('Heslo musí mít minimálně 6 znaků.');
        }
        // bcrypt zpracuje jen prvních 72 bajtů, delší heslo by se tiše zkrátilo
        if (strlen($password) > 72) {
            json_error('Heslo je příliš dlouhé (maximálně 72 znaků).');
        }

        $passwordHash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);

        $pdo->beginTransaction();
        try {
            $insert = $pdo->prepare("INSERT INTO users (email, password_hash, monthly_budget) VALUES (:email, :hash, :budget)");
            $insert->execute([':email' => $email, ':hash' => $passwordHash, ':budget' => DEFAULT_BUDGET]);
            $userId = (int)$pdo->lastInsertId();

            $vehStmt = $pdo->prepare("INSERT INTO vehicles (user_id, name, plate, color, monthly_budget) VALUES (:uid, 'Moje Auto', NULL, '#c6ff34', :budget)");
            $vehStmt->execute([':uid' => $userId, ':budget' => DEFAULT_BUDGET]);

            $pdo->commit();
        } catch (\PDOException $e) {
            $pdo->rollBack();
            // 23000 = porušení UNIQUE indexu na e-mailu (řeší i souběžné registrace)
            if ($e->getCode() === '23000') {
                json_error('Uživatel s tímto e-mailem již existuje.', 409);
            }
            throw $e;
        }

        $user = fetch_user($pdo, $userId);
        start_user_session($user);
        json_response(['success' => true, 'user' => user_payload($user)]);
        break;

    case 'login':
        require_method('POST');
        [$email, $password] = validate_credentials(read_json_body());

        $throttleKeys = ['ip:' . ($_SERVER['REMOTE_ADDR'] ?? ''), 'email:' . $email];
        $wait = throttle_wait_seconds($throttleKeys);
        if ($wait > 0) {
            header('Retry-After: ' . $wait);
            json_error("Příliš mnoho neúspěšných pokusů. Zkuste to za {$wait} s.", 429);
        }

        $stmt = $pdo->prepare("SELECT id, email, password_hash, monthly_budget, is_admin FROM users WHERE email = :email LIMIT 1");
        $stmt->execute([':email' => $email]);
        $user = $stmt->fetch();

        if (!$user || !password_verify($password, $user['password_hash'])) {
            throttle_register_fail($throttleKeys);
            json_error('Nesprávný e-mail nebo heslo.', 401);
        }

        throttle_reset($throttleKeys);

        if (password_needs_rehash($user['password_hash'], PASSWORD_BCRYPT, ['cost' => 12])) {
            $rehash = $pdo->prepare("UPDATE users SET password_hash = :hash WHERE id = :id");
            $rehash->execute([':hash' => password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]), ':id' => $user['id']]);
        }

        start_user_session($user);
        json_response(['success' => true, 'user' => user_payload($user)]);
        break;

    case 'check':
        require_method('GET');
        $user = !empty($_SESSION['user_id']) ? fetch_user($pdo, (int)$_SESSION['user_id']) : null;

        if (!$user) {
            // Účet mezitím mohl být smazán – neplatnou session rovnou zahodíme
            $_SESSION = [];
            json_response(['authenticated' => false]);
        }

        json_response(['authenticated' => true, 'user' => user_payload($user)]);
        break;

    case 'update_budget':
        require_method('POST');
        $userId = require_login();
        $input = read_json_body();

        $budget = filter_var($input['budget'] ?? null, FILTER_VALIDATE_FLOAT);
        if ($budget === false || $budget <= 0 || $budget > 10000000) {
            json_error('Zadejte platnou částku rozpočtu.');
        }

        $stmt = $pdo->prepare("UPDATE users SET monthly_budget = :b WHERE id = :id");
        $stmt->execute([':b' => $budget, ':id' => $userId]);

        json_response(['success' => true, 'budget' => $budget]);
        break;

    case 'change_password':
        require_method('POST');
        $userId = require_login();
        $input = read_json_body();
        $current = (string)($input['currentPassword'] ?? '');
        $new = (string)($input['newPassword'] ?? '');

        if (mb_strlen($new) < 6) {
            json_error('Nové heslo musí mít minimálně 6 znaků.');
        }
        if (strlen($new) > 72) {
            json_error('Heslo je příliš dlouhé (maximálně 72 znaků).');
        }
        if (!verify_user_password($pdo, $userId, $current)) {
            json_error('Současné heslo není správné.', 403);
        }

        $stmt = $pdo->prepare("UPDATE users SET password_hash = :hash WHERE id = :id");
        $stmt->execute([':hash' => password_hash($new, PASSWORD_BCRYPT, ['cost' => 12]), ':id' => $userId]);
        session_regenerate_id(true);
        json_response(['success' => true]);
        break;

    case 'delete_account':
        // Právo na výmaz (GDPR čl. 17): smaže účet i všechna data (ON DELETE CASCADE)
        require_method('POST');
        $userId = require_login();
        $input = read_json_body();
        if (!verify_user_password($pdo, $userId, (string)($input['password'] ?? ''))) {
            json_error('Heslo není správné.', 403);
        }

        $stmt = $pdo->prepare("DELETE FROM users WHERE id = :id");
        $stmt->execute([':id' => $userId]);

        $_SESSION = [];
        session_destroy();
        json_response(['success' => true]);
        break;

    case 'logout':
        require_method('POST');
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', [
                'expires'  => time() - 42000,
                'path'     => $params['path'],
                'domain'   => $params['domain'],
                'secure'   => $params['secure'],
                'httponly' => $params['httponly'],
                'samesite' => $params['samesite'] ?? 'Lax',
            ]);
        }
        session_destroy();
        json_response(['success' => true]);
        break;

    default:
        json_error('Neznámá akce', 404);
}
