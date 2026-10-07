<?php
// api/admin.php – administrace uživatelů (přístup jen pro účty s rolí administrátora)
require_once __DIR__ . '/db.php';

// Roli ověřujeme při každém požadavku přímo v databázi – odebrání práv platí okamžitě
function require_admin(PDO $pdo): array {
    $userId = require_login();
    $stmt = $pdo->prepare("SELECT id, email, is_admin FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $admin = $stmt->fetch();
    if (!$admin || (int)$admin['is_admin'] !== 1) {
        json_error('Tato sekce je dostupná pouze administrátorům.', 403);
    }
    return $admin;
}

function audit(PDO $pdo, int $adminId, string $action, ?int $targetId, ?string $targetEmail, ?string $detail = null): void {
    $stmt = $pdo->prepare("INSERT INTO admin_audit (admin_id, action, target_user_id, target_email, detail) VALUES (?, ?, ?, ?, ?)");
    $stmt->execute([$adminId, $action, $targetId, $targetEmail, $detail]);
}

function find_user(PDO $pdo, int $id): array {
    $stmt = $pdo->prepare("SELECT id, email, is_admin FROM users WHERE id = ?");
    $stmt->execute([$id]);
    $user = $stmt->fetch();
    if (!$user) {
        json_error('Uživatel nebyl nalezen.', 404);
    }
    return $user;
}

function require_target_id(): int {
    $id = filter_var($_GET['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$id) {
        json_error('Chybí ID uživatele.');
    }
    return $id;
}

$admin = require_admin($pdo);
$adminId = (int)$admin['id'];
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

switch ($action) {
    case 'me':
        require_method('GET');
        json_response(['id' => $adminId, 'email' => $admin['email']]);
        break;

    // --- PŘEHLED ---
    case 'stats':
        require_method('GET');
        $totals = $pdo->query("
            SELECT
              (SELECT COUNT(*) FROM users) AS users,
              (SELECT COUNT(*) FROM users WHERE is_admin = 1) AS admins,
              (SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL 30 DAY) AS newUsers30,
              (SELECT COUNT(*) FROM users WHERE last_login_at >= NOW() - INTERVAL 30 DAY) AS activeUsers30,
              (SELECT COUNT(*) FROM vehicles) AS vehicles,
              (SELECT COUNT(*) FROM fuel_records) AS records,
              (SELECT COALESCE(SUM(amount), 0) FROM fuel_records) AS totalAmount,
              (SELECT COALESCE(SUM(litres), 0) FROM fuel_records) AS totalLitres,
              (SELECT COUNT(*) FROM service_reminders WHERE done = 0) AS openReminders
        ")->fetch();

        // Posledních 12 měsíců: nové registrace a počet tankování
        $signups = $pdo->query("
            SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, COUNT(*) AS count
            FROM users WHERE created_at >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 11 MONTH)
            GROUP BY month
        ")->fetchAll(PDO::FETCH_KEY_PAIR);
        $refuels = $pdo->query("
            SELECT DATE_FORMAT(refuel_date, '%Y-%m') AS month, COUNT(*) AS count
            FROM fuel_records WHERE refuel_date >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 11 MONTH)
            GROUP BY month
        ")->fetchAll(PDO::FETCH_KEY_PAIR);

        $months = [];
        for ($i = 11; $i >= 0; $i--) {
            $key = date('Y-m', strtotime("first day of -$i month"));
            $months[] = ['month' => $key, 'signups' => (int)($signups[$key] ?? 0), 'refuels' => (int)($refuels[$key] ?? 0)];
        }

        $audit = $pdo->query("
            SELECT a.id, a.action, a.target_email AS targetEmail, a.detail, a.created_at AS createdAt, u.email AS adminEmail
            FROM admin_audit a LEFT JOIN users u ON u.id = a.admin_id
            ORDER BY a.id DESC LIMIT 12
        ")->fetchAll();

        json_response(['totals' => $totals, 'months' => $months, 'audit' => $audit]);
        break;

    // --- SEZNAM UŽIVATELŮ ---
    case 'users':
        require_method('GET');
        $search = trim((string)($_GET['q'] ?? ''));
        $role = $_GET['role'] ?? 'all';
        $page = max(1, (int)($_GET['page'] ?? 1));
        $perPage = 15;

        // Řazení jen podle povolených sloupců – nikdy nevkládáme vstup přímo do SQL
        $sorts = [
            'created' => 'u.created_at',
            'email' => 'u.email',
            'login' => 'u.last_login_at',
            'records' => 'records',
            'amount' => 'totalAmount',
        ];
        $sortKey = $sorts[$_GET['sort'] ?? 'created'] ?? 'u.created_at';
        $dir = ($_GET['dir'] ?? 'desc') === 'asc' ? 'ASC' : 'DESC';

        $where = [];
        $params = [];
        if ($search !== '') {
            $where[] = 'u.email LIKE ?';
            $params[] = '%' . addcslashes($search, '%_\\') . '%';
        }
        if ($role === 'admin') {
            $where[] = 'u.is_admin = 1';
        } elseif ($role === 'user') {
            $where[] = 'u.is_admin = 0';
        }
        $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $countStmt = $pdo->prepare("SELECT COUNT(*) FROM users u $whereSql");
        $countStmt->execute($params);
        $total = (int)$countStmt->fetchColumn();

        $offset = ($page - 1) * $perPage;
        $stmt = $pdo->prepare("
            SELECT u.id, u.email, u.is_admin AS isAdmin, u.created_at AS createdAt, u.last_login_at AS lastLoginAt,
                   u.monthly_budget AS budget,
                   (SELECT COUNT(*) FROM vehicles v WHERE v.user_id = u.id) AS vehicles,
                   (SELECT COUNT(*) FROM fuel_records r WHERE r.user_id = u.id) AS records,
                   (SELECT COALESCE(SUM(r.amount), 0) FROM fuel_records r WHERE r.user_id = u.id) AS totalAmount,
                   (SELECT MAX(r.refuel_date) FROM fuel_records r WHERE r.user_id = u.id) AS lastRefuel
            FROM users u
            $whereSql
            ORDER BY $sortKey $dir, u.id DESC
            LIMIT $perPage OFFSET $offset
        ");
        $stmt->execute($params);

        json_response([
            'users' => $stmt->fetchAll(),
            'total' => $total,
            'page' => $page,
            'pages' => max(1, (int)ceil($total / $perPage)),
        ]);
        break;

    // --- DETAIL / ÚPRAVA / SMAZÁNÍ UŽIVATELE ---
    case 'user':
        $id = require_target_id();

        if ($method === 'GET') {
            $stmt = $pdo->prepare("
                SELECT u.id, u.email, u.is_admin AS isAdmin, u.created_at AS createdAt, u.last_login_at AS lastLoginAt,
                       u.monthly_budget AS budget,
                       (SELECT COUNT(*) FROM fuel_records r WHERE r.user_id = u.id) AS records,
                       (SELECT COALESCE(SUM(r.amount), 0) FROM fuel_records r WHERE r.user_id = u.id) AS totalAmount,
                       (SELECT COALESCE(SUM(r.litres), 0) FROM fuel_records r WHERE r.user_id = u.id) AS totalLitres,
                       (SELECT COUNT(*) FROM service_reminders s WHERE s.user_id = u.id AND s.done = 0) AS openReminders
                FROM users u WHERE u.id = ?
            ");
            $stmt->execute([$id]);
            $user = $stmt->fetch();
            if (!$user) {
                json_error('Uživatel nebyl nalezen.', 404);
            }

            $vehicles = $pdo->prepare("
                SELECT v.id, v.name, v.plate, v.color, v.monthly_budget AS budget,
                       (SELECT COUNT(*) FROM fuel_records r WHERE r.vehicle_id = v.id) AS records
                FROM vehicles v WHERE v.user_id = ? ORDER BY v.id
            ");
            $vehicles->execute([$id]);

            $records = $pdo->prepare("
                SELECT r.id, r.refuel_date AS date, r.amount, r.litres, r.fuel_type AS fuelType, r.station,
                       v.name AS vehicleName, v.color AS vehicleColor
                FROM fuel_records r LEFT JOIN vehicles v ON v.id = r.vehicle_id
                WHERE r.user_id = ? ORDER BY r.refuel_date DESC, r.id DESC LIMIT 8
            ");
            $records->execute([$id]);

            json_response(['user' => $user, 'vehicles' => $vehicles->fetchAll(), 'records' => $records->fetchAll()]);
        }

        if ($method === 'PUT') {
            $target = find_user($pdo, $id);
            $data = read_json_body();
            $changes = [];

            if (array_key_exists('email', $data)) {
                $email = mb_strtolower(trim((string)$data['email']));
                if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 191) {
                    json_error('Zadejte platný e-mail.');
                }
                if ($email !== $target['email']) {
                    try {
                        $pdo->prepare("UPDATE users SET email = ? WHERE id = ?")->execute([$email, $id]);
                    } catch (\PDOException $e) {
                        if ($e->getCode() === '23000') {
                            json_error('Tento e-mail už používá jiný účet.', 409);
                        }
                        throw $e;
                    }
                    $changes[] = "e-mail: {$target['email']} → {$email}";
                    $target['email'] = $email;
                }
            }

            if (array_key_exists('budget', $data)) {
                $budget = filter_var($data['budget'], FILTER_VALIDATE_FLOAT);
                if ($budget === false || $budget <= 0 || $budget > 10000000) {
                    json_error('Zadejte platný měsíční rozpočet.');
                }
                $pdo->prepare("UPDATE users SET monthly_budget = ? WHERE id = ?")->execute([$budget, $id]);
                $changes[] = 'rozpočet: ' . number_format($budget, 0, ',', ' ') . ' Kč';
            }

            if (array_key_exists('isAdmin', $data)) {
                $isAdmin = !empty($data['isAdmin']) ? 1 : 0;
                // Pojistka: administrátor si nemůže sám odebrat práva (a zamknout se venku)
                if ($id === $adminId && $isAdmin === 0) {
                    json_error('Sami sobě nemůžete odebrat roli administrátora.');
                }
                if ($isAdmin !== (int)$target['is_admin']) {
                    $pdo->prepare("UPDATE users SET is_admin = ? WHERE id = ?")->execute([$isAdmin, $id]);
                    $changes[] = $isAdmin ? 'přidělena role administrátora' : 'odebrána role administrátora';
                }
            }

            if ($changes) {
                audit($pdo, $adminId, 'update_user', $id, $target['email'], implode('; ', $changes));
            }
            json_response(['success' => true]);
        }

        if ($method === 'DELETE') {
            if ($id === $adminId) {
                json_error('Vlastní účet nelze smazat z administrace.');
            }
            $target = find_user($pdo, $id);
            $pdo->prepare("DELETE FROM users WHERE id = ?")->execute([$id]);
            audit($pdo, $adminId, 'delete_user', null, $target['email'], 'účet a všechna data smazána');
            json_response(['success' => true]);
        }

        require_method('GET', 'PUT', 'DELETE');
        break;

    case 'reset_password':
        require_method('POST');
        $id = require_target_id();
        $target = find_user($pdo, $id);
        $data = read_json_body();
        $password = (string)($data['password'] ?? '');
        if (mb_strlen($password) < 6 || strlen($password) > 72) {
            json_error('Heslo musí mít 6 až 72 znaků.');
        }
        $pdo->prepare("UPDATE users SET password_hash = ? WHERE id = ?")
            ->execute([password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]), $id]);
        audit($pdo, $adminId, 'reset_password', $id, $target['email'], 'heslo nastaveno administrátorem');
        json_response(['success' => true]);
        break;

    case 'audit':
        require_method('GET');
        $audit = $pdo->query("
            SELECT a.id, a.action, a.target_email AS targetEmail, a.detail, a.created_at AS createdAt, u.email AS adminEmail
            FROM admin_audit a LEFT JOIN users u ON u.id = a.admin_id
            ORDER BY a.id DESC LIMIT 100
        ")->fetchAll();
        json_response($audit);
        break;

    default:
        json_error('Neznámá akce', 404);
}
