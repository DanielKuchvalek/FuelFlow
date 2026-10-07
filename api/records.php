<?php
// api/records.php
require_once __DIR__ . '/db.php';

$userId = require_login();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

const FUEL_TYPES = ['Natural 95', 'Natural 98', 'Diesel', 'LPG', 'Elektro'];
const MAX_BUDGET = 10000000;
const MAX_AMOUNT = 1000000;
const MAX_LITRES = 10000;
const MAX_ODOMETER = 9999999;

// --- VALIDACE VSTUPŮ ---

function positive_number($value, float $max): ?float {
    $number = filter_var($value, FILTER_VALIDATE_FLOAT);
    return ($number !== false && $number > 0 && $number <= $max) ? $number : null;
}

function valid_date(string $date): bool {
    $d = DateTime::createFromFormat('!Y-m-d', $date);
    return $d && $d->format('Y-m-d') === $date && $date >= '1990-01-01' && $date <= date('Y-m-d', strtotime('+1 day'));
}

// Ořízne text; prázdný vrátí jako NULL, příliš dlouhý odmítne
function optional_text($value, int $maxLength, string $fieldLabel): ?string {
    $text = trim((string)($value ?? ''));
    if ($text === '') {
        return null;
    }
    if (mb_strlen($text) > $maxLength) {
        json_error("{$fieldLabel} může mít nejvýše {$maxLength} znaků.");
    }
    return $text;
}

// Termín připomínky může být i daleko v budoucnu
function valid_due_date(string $date): bool {
    $d = DateTime::createFromFormat('!Y-m-d', $date);
    return $d && $d->format('Y-m-d') === $date && $date >= '2000-01-01' && $date <= '2100-12-31';
}

function optional_odometer($value, string $fieldLabel): ?int {
    if (!isset($value) || $value === '' || $value === null) {
        return null;
    }
    $km = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => MAX_ODOMETER]]);
    if ($km === false) {
        json_error("{$fieldLabel} musí být celé číslo v kilometrech.");
    }
    return $km;
}

function require_id(): int {
    $id = filter_var($_GET['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$id) {
        json_error('Chybí nebo je neplatné ID záznamu.');
    }
    return $id;
}

function vehicle_belongs_to_user(PDO $pdo, int $vehicleId, int $userId): bool {
    $stmt = $pdo->prepare("SELECT 1 FROM vehicles WHERE id = ? AND user_id = ?");
    $stmt->execute([$vehicleId, $userId]);
    return (bool)$stmt->fetchColumn();
}

function optional_vehicle(PDO $pdo, $value, int $userId): ?int {
    if (empty($value)) {
        return null;
    }
    $vehicleId = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$vehicleId || !vehicle_belongs_to_user($pdo, $vehicleId, $userId)) {
        json_error('Vybrané vozidlo neexistuje.');
    }
    return $vehicleId;
}

function parse_fuel_record(PDO $pdo, array $input, int $userId): array {
    $amount = positive_number($input['amount'] ?? null, MAX_AMOUNT);
    if ($amount === null) {
        json_error('Zadejte platnou částku.');
    }

    $date = trim((string)($input['date'] ?? ''));
    if (!valid_date($date)) {
        json_error('Zadejte platné datum tankování.');
    }

    $litres = null;
    if (isset($input['litres']) && $input['litres'] !== '') {
        $litres = positive_number($input['litres'], MAX_LITRES);
        if ($litres === null) {
            json_error('Zadejte platný počet litrů.');
        }
    }

    $fuelType = (string)($input['fuelType'] ?? 'Natural 95');
    if (!in_array($fuelType, FUEL_TYPES, true)) {
        json_error('Neznámý druh paliva.');
    }

    $vehicleId = optional_vehicle($pdo, $input['vehicleId'] ?? null, $userId);

    return [
        'vehicle_id'  => $vehicleId,
        'amount'      => $amount,
        'refuel_date' => $date,
        'litres'      => $litres,
        'odometer'    => optional_odometer($input['odometer'] ?? null, 'Stav tachometru'),
        'full_tank'   => !empty($input['fullTank']) ? 1 : 0,
        'fuel_type'   => $fuelType,
        'station'     => optional_text($input['station'] ?? null, 100, 'Název stanice'),
        'note'        => optional_text($input['note'] ?? null, 500, 'Poznámka'),
    ];
}

// --- OBSLUHA AUT (VOZOVÉHO PARKU) ---
if ($action === 'vehicles') {
    switch ($method) {
        case 'GET':
            $stmt = $pdo->prepare("SELECT id, name, plate, color, monthly_budget AS budget FROM vehicles WHERE user_id = ? ORDER BY id ASC");
            $stmt->execute([$userId]);
            json_response($stmt->fetchAll());
            break;

        case 'POST':
            $data = read_json_body();
            $name = optional_text($data['name'] ?? null, 100, 'Název auta');
            $plate = optional_text($data['plate'] ?? null, 20, 'SPZ');
            $color = (string)($data['color'] ?? '#c6ff34');
            $budget = positive_number($data['budget'] ?? DEFAULT_BUDGET, MAX_BUDGET);

            if ($name === null) {
                json_error('Zadejte název auta.');
            }
            if (!preg_match('/^#[0-9a-fA-F]{6}$/', $color)) {
                json_error('Neplatná barva vozidla.');
            }
            if ($budget === null) {
                json_error('Zadejte platný měsíční limit.');
            }

            $stmt = $pdo->prepare("INSERT INTO vehicles (user_id, name, plate, color, monthly_budget) VALUES (?, ?, ?, ?, ?)");
            $stmt->execute([$userId, $name, $plate, strtolower($color), $budget]);
            json_response(['success' => true, 'id' => (int)$pdo->lastInsertId()], 201);
            break;

        case 'PUT':
            $id = require_id();
            $data = read_json_body();
            $budget = positive_number($data['budget'] ?? null, MAX_BUDGET);
            if ($budget === null) {
                json_error('Zadejte platný měsíční limit.');
            }

            $stmt = $pdo->prepare("UPDATE vehicles SET monthly_budget = ? WHERE id = ? AND user_id = ?");
            $stmt->execute([$budget, $id, $userId]);
            if ($stmt->rowCount() === 0) {
                json_error('Vozidlo nebylo nalezeno.', 404);
            }
            json_response(['success' => true, 'budget' => $budget]);
            break;

        case 'DELETE':
            $id = require_id();
            // Tankování smazaného auta zůstanou zachována (ON DELETE SET NULL)
            $stmt = $pdo->prepare("DELETE FROM vehicles WHERE id = ? AND user_id = ?");
            $stmt->execute([$id, $userId]);
            if ($stmt->rowCount() === 0) {
                json_error('Vozidlo nebylo nalezeno.', 404);
            }
            json_response(['success' => true]);
            break;

        default:
            require_method('GET', 'POST', 'PUT', 'DELETE');
    }
}

// --- PŘIPOMÍNKY SERVISU ---
if ($action === 'reminders') {
    switch ($method) {
        case 'GET':
            $stmt = $pdo->prepare("
                SELECT r.id, r.title, r.due_date AS dueDate, r.due_km AS dueKm, r.done,
                       r.vehicle_id AS vehicleId, v.name AS vehicleName, v.color AS vehicleColor
                FROM service_reminders r
                LEFT JOIN vehicles v ON v.id = r.vehicle_id AND v.user_id = r.user_id
                WHERE r.user_id = ?
                ORDER BY r.done ASC, r.due_date IS NULL, r.due_date ASC, r.id ASC
            ");
            $stmt->execute([$userId]);
            json_response($stmt->fetchAll());
            break;

        case 'POST':
            $data = read_json_body();
            $title = optional_text($data['title'] ?? null, 100, 'Název připomínky');
            if ($title === null) {
                json_error('Zadejte název připomínky.');
            }

            $dueDate = trim((string)($data['dueDate'] ?? ''));
            if ($dueDate === '') {
                $dueDate = null;
            } elseif (!valid_due_date($dueDate)) {
                json_error('Zadejte platné datum termínu.');
            }
            $dueKm = optional_odometer($data['dueKm'] ?? null, 'Termín v kilometrech');
            if ($dueDate === null && $dueKm === null) {
                json_error('Zadejte termín – datum, kilometry, nebo obojí.');
            }

            $vehicleId = optional_vehicle($pdo, $data['vehicleId'] ?? null, $userId);

            $stmt = $pdo->prepare("INSERT INTO service_reminders (user_id, vehicle_id, title, due_date, due_km) VALUES (?, ?, ?, ?, ?)");
            $stmt->execute([$userId, $vehicleId, $title, $dueDate, $dueKm]);
            json_response(['success' => true, 'id' => (int)$pdo->lastInsertId()], 201);
            break;

        case 'PUT':
            $id = require_id();
            $data = read_json_body();
            $stmt = $pdo->prepare("UPDATE service_reminders SET done = ? WHERE id = ? AND user_id = ?");
            $stmt->execute([!empty($data['done']) ? 1 : 0, $id, $userId]);
            if ($stmt->rowCount() === 0) {
                json_error('Připomínka nebyla nalezena.', 404);
            }
            json_response(['success' => true]);
            break;

        case 'DELETE':
            $id = require_id();
            $stmt = $pdo->prepare("DELETE FROM service_reminders WHERE id = ? AND user_id = ?");
            $stmt->execute([$id, $userId]);
            if ($stmt->rowCount() === 0) {
                json_error('Připomínka nebyla nalezena.', 404);
            }
            json_response(['success' => true]);
            break;

        default:
            require_method('GET', 'POST', 'PUT', 'DELETE');
    }
}

if ($action !== '') {
    json_error('Neznámá akce', 404);
}

// --- OBSLUHA TANKOVÁNÍ ---
switch ($method) {
    case 'GET':
        // Podmínka v.user_id zajistí, že se nikdy nenapojí cizí vozidlo
        $stmt = $pdo->prepare("
            SELECT r.id, r.amount, r.refuel_date AS date, r.litres, r.odometer, r.full_tank AS fullTank, r.fuel_type AS fuelType,
                   r.station, r.note, r.vehicle_id AS vehicleId, v.name AS vehicleName, v.color AS vehicleColor
            FROM fuel_records r
            LEFT JOIN vehicles v ON v.id = r.vehicle_id AND v.user_id = r.user_id
            WHERE r.user_id = ?
            ORDER BY r.refuel_date DESC, r.id DESC
        ");
        $stmt->execute([$userId]);
        json_response($stmt->fetchAll());
        break;

    case 'POST':
        $record = parse_fuel_record($pdo, read_json_body(), $userId);

        $stmt = $pdo->prepare("
            INSERT INTO fuel_records (user_id, vehicle_id, amount, refuel_date, litres, odometer, full_tank, fuel_type, station, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");
        $stmt->execute([
            $userId, $record['vehicle_id'], $record['amount'], $record['refuel_date'], $record['litres'],
            $record['odometer'], $record['full_tank'], $record['fuel_type'], $record['station'], $record['note'],
        ]);
        json_response(['success' => true, 'id' => (int)$pdo->lastInsertId()], 201);
        break;

    case 'PUT':
        $id = require_id();
        $record = parse_fuel_record($pdo, read_json_body(), $userId);

        $stmt = $pdo->prepare("
            UPDATE fuel_records
            SET vehicle_id = ?, amount = ?, refuel_date = ?, litres = ?, odometer = ?, full_tank = ?,
                fuel_type = ?, station = ?, note = ?
            WHERE id = ? AND user_id = ?
        ");
        $stmt->execute([
            $record['vehicle_id'], $record['amount'], $record['refuel_date'], $record['litres'],
            $record['odometer'], $record['full_tank'], $record['fuel_type'], $record['station'], $record['note'], $id, $userId,
        ]);
        if ($stmt->rowCount() === 0) {
            json_error('Záznam nebyl nalezen.', 404);
        }
        json_response(['success' => true]);
        break;

    case 'DELETE':
        $id = require_id();
        $stmt = $pdo->prepare("DELETE FROM fuel_records WHERE id = ? AND user_id = ?");
        $stmt->execute([$id, $userId]);
        if ($stmt->rowCount() === 0) {
            json_error('Záznam nebyl nalezen.', 404);
        }
        json_response(['success' => true]);
        break;

    default:
        require_method('GET', 'POST', 'PUT', 'DELETE');
}
