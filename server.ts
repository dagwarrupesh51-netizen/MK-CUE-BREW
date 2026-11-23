import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
    const app = express();
    const PORT = 3000;

    // Initialize Database
    const db = new Database("gaming_cafe.db");
    db.pragma('journal_mode = WAL');

    // Create Tables Schema
    db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT CHECK(role IN ('admin', 'staff', 'user')) DEFAULT 'user',
      phone TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      number TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL,
      price REAL NOT NULL,
      pricing_method TEXT CHECK(pricing_method IN ('per_minute', 'per_hour', 'fixed_session')) DEFAULT 'per_hour',
      fixed_duration_minutes INTEGER DEFAULT 60,
      status TEXT CHECK(status IN ('available', 'occupied', 'reserved', 'maintenance')) DEFAULT 'available',
      active_session_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_id INTEGER NOT NULL,
      table_name TEXT NOT NULL,
      table_price REAL NOT NULL,
      pricing_method TEXT NOT NULL,
      fixed_duration_minutes INTEGER DEFAULT 60,
      start_time INTEGER NOT NULL, -- Unix timestamp in ms
      paused_at INTEGER,           -- Unix timestamp in ms
      total_paused_ms INTEGER DEFAULT 0,
      end_time INTEGER,            -- Unix timestamp in ms
      status TEXT CHECK(status IN ('active', 'paused', 'completed', 'cancelled')) DEFAULT 'active',
      total_duration_seconds INTEGER DEFAULT 0,
      base_amount REAL DEFAULT 0,
      additional_charges REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      manual_adjustment_amount REAL DEFAULT 0,
      manual_adjustment_reason TEXT,
      final_amount REAL DEFAULT 0,
      staff_id INTEGER,
      staff_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (table_id) REFERENCES tables(id)
    );

    CREATE TABLE IF NOT EXISTS session_players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      player_slot INTEGER NOT NULL,
      name TEXT NOT NULL,
      username TEXT,
      status TEXT CHECK(status IN ('PLAYING', 'OUT', 'WINNER')) DEFAULT 'PLAYING',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT UNIQUE NOT NULL,
      session_id INTEGER,
      table_id INTEGER,
      table_name TEXT NOT NULL,
      customer_names TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      duration_formatted TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL,
      table_rate REAL NOT NULL,
      pricing_method TEXT NOT NULL,
      base_amount REAL NOT NULL,
      additional_charges REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      manual_adjustment_amount REAL DEFAULT 0,
      manual_adjustment_reason TEXT,
      final_amount REAL NOT NULL,
      payment_status TEXT CHECK(payment_status IN ('Paid', 'Unpaid', 'Partially Paid')) DEFAULT 'Paid',
      payment_method TEXT CHECK(payment_method IN ('UPI', 'Cash', 'Card', 'Other')) DEFAULT 'UPI',
      amount_paid REAL NOT NULL,
      pending_amount REAL DEFAULT 0,
      upi_ref TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      username TEXT,
      reward_points INTEGER DEFAULT 0,
      tier TEXT DEFAULT 'Bronze',
      total_visits INTEGER DEFAULT 0,
      total_gaming_hours REAL DEFAULT 0,
      total_spent REAL DEFAULT 0,
      birthday TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_id INTEGER NOT NULL,
      table_name TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      booking_time DATETIME NOT NULL,
      duration_hours REAL DEFAULT 1,
      guests_count INTEGER DEFAULT 1,
      notes TEXT,
      status TEXT CHECK(status IN ('confirmed', 'active', 'completed', 'cancelled')) DEFAULT 'confirmed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (table_id) REFERENCES tables(id)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      payment_mode TEXT DEFAULT 'UPI',
      expense_date DATE DEFAULT (DATE('now')),
      created_by TEXT DEFAULT 'Admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_name TEXT,
      action TEXT NOT NULL,
      details TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

    // Helper to log audit
    function logAudit(userId: number | null, userName: string, action: string, details: string) {
        try {
            db.prepare("INSERT INTO audit_logs (user_id, user_name, action, details) VALUES (?, ?, ?, ?)").run(
                userId,
                userName,
                action,
                details
            );
        } catch (e) {
            console.error("Audit log error:", e);
        }
    }

    // Seed default settings
    const defaultSettings: Record<string, string> = {
        cafe_name: "MK² CUE & BREW",
        tagline: "Premier Gaming, Snooker Lounge & Café",
        logo_url: "/logo.png",
        phone: "+91 98765 43210",
        email: "support@mk2cuebrew.cafe",
        address: "Unit 402, Cyber Hub, MG Road, Tech City",
        upi_id: "mk2cuebrew@okaxis",
        upi_payee_name: "MK2 Cue & Brew",
        currency: "₹",
        wifi_ssid: "MK2_CUE_BREW_5G",
        wifi_pass: "MK2BREW@2026",
        hourly_rate_default: "150",
        loyalty_points_per_100: "10"
    };

    for (const [key, value] of Object.entries(defaultSettings)) {
        const exists = db.prepare("SELECT key FROM settings WHERE key = ?").get(key);
        if (!exists) {
            db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(key, value);
        } else if (key === 'cafe_name' || key === 'tagline' || key === 'logo_url' || key === 'upi_payee_name') {
            db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(value, key);
        }
    }

    // Seed Users
    const adminExists = db.prepare("SELECT id FROM users WHERE email = ?").get("admin@shocker.cafe");
    if (!adminExists) {
        db.prepare(
            "INSERT INTO users (name, email, username, password, role, phone) VALUES (?, ?, ?, ?, ?, ?)"
        ).run("Commander Admin", "admin@shocker.cafe", "admin", "admin123", "admin", "+91 99999 11111");
        console.log("Seeded default admin (admin@shocker.cafe / admin123)");
    }

    const staffExists = db.prepare("SELECT id FROM users WHERE email = ?").get("staff@shocker.cafe");
    if (!staffExists) {
        db.prepare(
            "INSERT INTO users (name, email, username, password, role, phone) VALUES (?, ?, ?, ?, ?, ?)"
        ).run("Alex Vance", "staff@shocker.cafe", "staff1", "staff123", "staff", "+91 98888 22222");
        db.prepare(
            "INSERT INTO users (name, email, username, password, role, phone) VALUES (?, ?, ?, ?, ?, ?)"
        ).run("Rhea Ripley", "rhea@shocker.cafe", "staff2", "staff123", "staff", "+91 97777 33333");
        console.log("Seeded default staff accounts");
    }

    app.use(express.json({ limit: "50mb" }));

    // --- API ROUTES ---

    // Health
    app.get("/api/health", (req, res) => {
        res.json({ status: "ok", name: "SHOCKER GAMING CAFÉ API", timestamp: new Date().toISOString() });
    });

    // 1. AUTH ROUTES
    app.post("/api/auth/login", (req, res) => {
        const { identifier, password } = req.body;
        try {
            const user = db.prepare(
                "SELECT id, name, email, username, role, phone, status FROM users WHERE (email = ? OR username = ?) AND password = ?"
            ).get(identifier, identifier, password) as any;

            if (user) {
                if (user.status !== 'active') {
                    return res.status(403).json({ error: "Account is disabled. Contact Admin." });
                }
                logAudit(user.id, user.name, "USER_LOGIN", `Logged in with role: ${user.role}`);
                res.json({ success: true, user });
            } else {
                res.status(401).json({ error: "Invalid credentials. Please check your username/email and password." });
            }
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // USER SELF-REGISTRATION (creates 'user' role only)
    app.post("/api/auth/register", (req, res) => {
        const { name, email, phone, password, username } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: "Name, email and password are required." });
        }
        try {
            const existing = db.prepare("SELECT id FROM users WHERE email = ? OR username = ?").get(email, username || email);
            if (existing) {
                return res.status(409).json({ error: "An account with this email or username already exists." });
            }
            const uname = username || email.split('@')[0];
            const info = db.prepare(
                "INSERT INTO users (name, email, username, password, role, phone) VALUES (?, ?, ?, ?, 'user', ?)"
            ).run(name, email, uname, password, phone || '');
            const newUser = db.prepare("SELECT id, name, email, username, role, phone, status FROM users WHERE id = ?").get(info.lastInsertRowid) as any;
            logAudit(newUser.id, newUser.name, "USER_REGISTER", `New customer registered: ${email}`);
            res.json({ success: true, user: newUser });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // USER PORTAL: Public tables view (available tables + types for booking)
    app.get("/api/user/tables", (req, res) => {
        try {
            const tables = db.prepare(`
                SELECT id, name, number, type, price, pricing_method, fixed_duration_minutes, status
                FROM tables WHERE status IN ('available','reserved') ORDER BY number ASC
            `).all();
            res.json(tables);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // USER PORTAL: All tables (for booking form)
    app.get("/api/user/all-tables", (req, res) => {
        try {
            const tables = db.prepare(`
                SELECT id, name, number, type, price, pricing_method, status
                FROM tables ORDER BY number ASC
            `).all();
            res.json(tables);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // USER PORTAL: Personal bookings by phone
    app.get("/api/user/my-bookings", (req, res) => {
        const { phone } = req.query as any;
        if (!phone) return res.status(400).json({ error: "Phone required" });
        try {
            const bookings = db.prepare(`
                SELECT * FROM bookings WHERE phone = ? ORDER BY booking_time DESC
            `).all(phone);
            res.json(bookings);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // USER PORTAL: Personal bills by customer name or phone
    app.get("/api/user/my-bills", (req, res) => {
        const { name, phone } = req.query as any;
        if (!name && !phone) return res.status(400).json({ error: "Name or phone required" });
        try {
            const bills = db.prepare(`
                SELECT invoice_no, table_name, customer_names, duration_formatted,
                       final_amount, payment_status, payment_method, amount_paid, pending_amount, created_at
                FROM bills
                WHERE customer_names LIKE ? OR customer_names LIKE ?
                ORDER BY created_at DESC LIMIT 50
            `).all(`%${name || ''}%`, `%${phone || ''}%`);
            res.json(bills);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // USER PORTAL: Leaderboard (top customers by spend / hours)
    app.get("/api/user/leaderboard", (req, res) => {
        try {
            const leaders = db.prepare(`
                SELECT name, username, tier, total_visits, total_gaming_hours, total_spent, reward_points
                FROM customers ORDER BY total_spent DESC LIMIT 20
            `).all();
            res.json(leaders);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // USER PORTAL: Create booking (users can self-book)
    app.post("/api/user/bookings", (req, res) => {
        const { table_id, customer_name, phone, booking_time, duration_hours, guests_count, notes } = req.body;
        if (!table_id || !customer_name || !phone || !booking_time) {
            return res.status(400).json({ error: "Table, name, phone and booking time are required." });
        }
        try {
            const table = db.prepare("SELECT * FROM tables WHERE id = ?").get(table_id) as any;
            if (!table) return res.status(404).json({ error: "Table not found." });
            const info = db.prepare(`
                INSERT INTO bookings (table_id, table_name, customer_name, phone, booking_time, duration_hours, guests_count, notes, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')
            `).run(table.id, table.name, customer_name, phone, booking_time, duration_hours || 1, guests_count || 1, notes || '');
            const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(info.lastInsertRowid);
            res.json(booking);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // USER PORTAL: Get customer profile by phone
    app.get("/api/user/profile", (req, res) => {
        const { phone } = req.query as any;
        if (!phone) return res.status(400).json({ error: "Phone required" });
        try {
            const customer = db.prepare("SELECT * FROM customers WHERE phone = ?").get(phone);
            res.json(customer || null);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });


    app.get("/api/dashboard/stats", (req, res) => {
        try {
            const todayStr = new Date().toISOString().slice(0, 10);
            const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

            // Total revenue today
            const revToday = db.prepare(`
              SELECT COALESCE(SUM(amount_paid), 0) as total FROM bills 
              WHERE DATE(created_at) = DATE('now')
            `).get() as any;

            // Total revenue this month
            const revMonth = db.prepare(`
              SELECT COALESCE(SUM(amount_paid), 0) as total FROM bills 
              WHERE created_at >= ?
            `).get(firstDayOfMonth) as any;

            // Active & Available tables
            const totalTables = db.prepare("SELECT COUNT(*) as count FROM tables").get() as any;
            const activeTables = db.prepare("SELECT COUNT(*) as count FROM tables WHERE status = 'occupied'").get() as any;
            const availableTables = db.prepare("SELECT COUNT(*) as count FROM tables WHERE status = 'available'").get() as any;
            const maintenanceTables = db.prepare("SELECT COUNT(*) as count FROM tables WHERE status = 'maintenance'").get() as any;

            // Sessions today
            const sessionsToday = db.prepare(`
              SELECT COUNT(*) as count, COALESCE(SUM(total_duration_seconds), 0) as total_secs 
              FROM sessions WHERE DATE(created_at) = DATE('now')
            `).get() as any;

            // Players today
            const playersToday = db.prepare(`
              SELECT COUNT(DISTINCT sp.id) as count 
              FROM session_players sp
              JOIN sessions s ON sp.session_id = s.id
              WHERE DATE(s.created_at) = DATE('now')
            `).get() as any;

            // Pending Bills
            const pendingBills = db.prepare(`
              SELECT COUNT(*) as count, COALESCE(SUM(pending_amount), 0) as total_pending 
              FROM bills WHERE payment_status != 'Paid'
            `).get() as any;

            // Total expenses this month
            const expensesMonth = db.prepare(`
              SELECT COALESCE(SUM(amount), 0) as total FROM expenses 
              WHERE created_at >= ?
            `).get(firstDayOfMonth) as any;

            // Recent 6 Sessions
            const recentSessions = db.prepare(`
              SELECT s.*, t.name as table_name, t.type as table_type,
                     (SELECT COUNT(*) FROM session_players WHERE session_id = s.id) as player_count
              FROM sessions s
              JOIN tables t ON s.table_id = t.id
              ORDER BY s.id DESC LIMIT 6
            `).all();

            // Daily Revenue Last 7 Days for Area Chart
            const dailyRevenue = db.prepare(`
              SELECT DATE(created_at) as date, COALESCE(SUM(amount_paid), 0) as revenue, COUNT(*) as sessions
              FROM bills
              WHERE created_at >= DATE('now', '-7 days')
              GROUP BY DATE(created_at)
              ORDER BY date ASC
            `).all();

            // Weekly Revenue (last 4 weeks)
            const weeklyRevenue = db.prepare(`
              SELECT strftime('%Y-W%W', created_at) as week, COALESCE(SUM(amount_paid), 0) as revenue
              FROM bills
              WHERE created_at >= DATE('now', '-28 days')
              GROUP BY week
              ORDER BY week ASC
            `).all();

            // Monthly Revenue (last 6 months)
            const monthlyRevenue = db.prepare(`
              SELECT strftime('%Y-%m', created_at) as month, COALESCE(SUM(amount_paid), 0) as revenue
              FROM bills
              WHERE created_at >= DATE('now', '-6 months')
              GROUP BY month
              ORDER BY month ASC
            `).all();

            // Popular Tables (by sessions and revenue)
            const popularTables = db.prepare(`
              SELECT table_name, COUNT(*) as sessions_count, SUM(amount_paid) as total_revenue
              FROM bills
              GROUP BY table_name
              ORDER BY sessions_count DESC LIMIT 6
            `).all();

            // Peak Gaming Hours (Distribution across 24h)
            const peakHours = db.prepare(`
              SELECT strftime('%H', datetime(start_time/1000, 'unixepoch', 'localtime')) as hour, COUNT(*) as sessions
              FROM sessions
              GROUP BY hour
              ORDER BY hour ASC
            `).all();

            res.json({
                revenueToday: revToday.total,
                revenueMonth: revMonth.total,
                expensesMonth: expensesMonth.total,
                netProfitMonth: revMonth.total - expensesMonth.total,
                totalTables: totalTables.count,
                activeTables: activeTables.count,
                availableTables: availableTables.count,
                maintenanceTables: maintenanceTables.count,
                sessionsToday: sessionsToday.count,
                gamingHoursToday: Math.round((sessionsToday.total_secs / 3600) * 10) / 10,
                playersToday: playersToday.count,
                pendingBillsCount: pendingBills.count,
                pendingBillsAmount: pendingBills.total_pending,
                recentSessions,
                dailyRevenue,
                weeklyRevenue,
                monthlyRevenue,
                popularTables,
                peakHours
            });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // 3. SHOCKER TABLES & LIVE SESSIONS
    app.get("/api/tables", (req, res) => {
        try {
            const tables = db.prepare("SELECT * FROM tables ORDER BY id ASC").all() as any[];

            // Attach active session data and players if table is occupied
            const enriched = tables.map(table => {
                if (table.active_session_id) {
                    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(table.active_session_id) as any;
                    if (session) {
                        const players = db.prepare("SELECT * FROM session_players WHERE session_id = ? ORDER BY player_slot ASC").all(session.id);
                        return {
                            ...table,
                            active_session: {
                                ...session,
                                players
                            }
                        };
                    }
                }
                return { ...table, active_session: null };
            });

            res.json(enriched);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // Create Table (Admin only)
    app.post("/api/tables", (req, res) => {
        const { name, number, type, price, pricing_method, fixed_duration_minutes, user_role, user_name } = req.body;
        if (user_role !== 'admin') {
            return res.status(403).json({ error: "Only Admin can add gaming tables." });
        }
        try {
            const info = db.prepare(`
              INSERT INTO tables (name, number, type, price, pricing_method, fixed_duration_minutes, status)
              VALUES (?, ?, ?, ?, ?, ?, 'available')
            `).run(name, number, type, Number(price), pricing_method || 'per_hour', Number(fixed_duration_minutes || 60));

            logAudit(null, user_name || "Admin", "CREATE_TABLE", `Added table ${name} (${number}) at ₹${price}/${pricing_method}`);
            const table = db.prepare("SELECT * FROM tables WHERE id = ?").get(info.lastInsertRowid);
            res.json(table);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // Update Table (Admin only for price/config, Staff can change status)
    app.put("/api/tables/:id", (req, res) => {
        const { id } = req.params;
        const { name, number, type, price, pricing_method, fixed_duration_minutes, status, user_role, user_name } = req.body;

        try {
            const current = db.prepare("SELECT * FROM tables WHERE id = ?").get(id) as any;
            if (!current) return res.status(404).json({ error: "Table not found" });

            if (price !== undefined && Number(price) !== current.price && user_role !== 'admin') {
                return res.status(403).json({ error: "Only Admin can change table prices." });
            }

            db.prepare(`
              UPDATE tables SET
                name = COALESCE(?, name),
                number = COALESCE(?, number),
                type = COALESCE(?, type),
                price = COALESCE(?, price),
                pricing_method = COALESCE(?, pricing_method),
                fixed_duration_minutes = COALESCE(?, fixed_duration_minutes),
                status = COALESCE(?, status),
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(name, number, type, price ? Number(price) : null, pricing_method, fixed_duration_minutes ? Number(fixed_duration_minutes) : null, status, id);

            logAudit(null, user_name || "Staff", "UPDATE_TABLE", `Updated table ID ${id} (${current.name})`);
            const updated = db.prepare("SELECT * FROM tables WHERE id = ?").get(id);
            res.json(updated);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // Delete Table (Admin only)
    app.delete("/api/tables/:id", (req, res) => {
        const { id } = req.params;
        const { user_role, user_name } = req.body;
        if (user_role !== 'admin') {
            return res.status(403).json({ error: "Only Admin can delete tables." });
        }
        try {
            const current = db.prepare("SELECT * FROM tables WHERE id = ?").get(id) as any;
            if (current?.status === 'occupied') {
                return res.status(400).json({ error: "Cannot delete an occupied table with an active session." });
            }
            db.prepare("DELETE FROM tables WHERE id = ?").run(id);
            logAudit(null, user_name || "Admin", "DELETE_TABLE", `Deleted table ID ${id}`);
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // Table History & Revenue
    app.get("/api/tables/:id/history", (req, res) => {
        const { id } = req.params;
        try {
            const table = db.prepare("SELECT * FROM tables WHERE id = ?").get(id);
            const sessions = db.prepare(`
              SELECT s.*, b.invoice_no, b.amount_paid, b.payment_status
              FROM sessions s
              LEFT JOIN bills b ON s.id = b.session_id
              WHERE s.table_id = ?
              ORDER BY s.id DESC LIMIT 30
            `).all(id);

            const totalRevenue = db.prepare(`
              SELECT COALESCE(SUM(amount_paid), 0) as total FROM bills WHERE table_id = ?
            `).get(id) as any;

            res.json({ table, totalRevenue: totalRevenue.total, sessions });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // START A SESSION ON TABLE
    app.post("/api/sessions/start", (req, res) => {
        const { table_id, players, staff_id, staff_name } = req.body;
        try {
            const table = db.prepare("SELECT * FROM tables WHERE id = ?").get(table_id) as any;
            if (!table) return res.status(404).json({ error: "Table not found" });
            if (table.status === 'occupied') {
                return res.status(400).json({ error: "Table is already occupied!" });
            }

            const startTime = Date.now();
            const sessionResult = db.prepare(`
              INSERT INTO sessions (
                table_id, table_name, table_price, pricing_method, fixed_duration_minutes,
                start_time, status, staff_id, staff_name
              ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
            `).run(
                table.id, table.name, table.price, table.pricing_method, table.fixed_duration_minutes,
                startTime, staff_id || 1, staff_name || 'Staff'
            );

            const sessionId = sessionResult.lastInsertRowid;

            // Insert initial players
            if (Array.isArray(players) && players.length > 0) {
                const insertPlayer = db.prepare(`
                  INSERT INTO session_players (session_id, player_slot, name, username, status)
                  VALUES (?, ?, ?, ?, 'PLAYING')
                `);
                players.forEach((p, index) => {
                    insertPlayer.run(sessionId, index + 1, p.name || `Player ${index + 1}`, p.username || '');

                    // Upsert customer record or increment visit
                    if (p.phone) {
                        const existingCust = db.prepare("SELECT * FROM customers WHERE phone = ?").get(p.phone) as any;
                        if (existingCust) {
                            db.prepare("UPDATE customers SET total_visits = total_visits + 1 WHERE id = ?").run(existingCust.id);
                        } else {
                            db.prepare("INSERT INTO customers (name, phone, username, total_visits) VALUES (?, ?, ?, 1)").run(
                                p.name, p.phone, p.username || ''
                            );
                        }
                    }
                });
            } else {
                // Default 1 player
                db.prepare(`
                  INSERT INTO session_players (session_id, player_slot, name, username, status)
                  VALUES (?, 1, 'Player 1', 'Gamer1', 'PLAYING')
                `).run(sessionId);
            }

            // Update table status
            db.prepare("UPDATE tables SET status = 'occupied', active_session_id = ? WHERE id = ?").run(sessionId, table_id);

            logAudit(staff_id || null, staff_name || "Staff", "START_SESSION", `Started session #${sessionId} on ${table.name}`);

            const fullSession = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as any;
            const fullPlayers = db.prepare("SELECT * FROM session_players WHERE session_id = ?").all(sessionId);

            res.json({ success: true, session: { ...fullSession, players: fullPlayers } });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // PAUSE SESSION
    app.post("/api/sessions/:id/pause", (req, res) => {
        const { id } = req.params;
        const { user_name } = req.body;
        try {
            const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as any;
            if (!session) return res.status(404).json({ error: "Session not found" });
            if (session.status !== 'active') return res.status(400).json({ error: "Session is not active" });

            const now = Date.now();
            db.prepare("UPDATE sessions SET status = 'paused', paused_at = ? WHERE id = ?").run(now, id);
            logAudit(null, user_name || "Staff", "PAUSE_SESSION", `Paused session #${id}`);

            const updated = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
            res.json(updated);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // RESUME SESSION
    app.post("/api/sessions/:id/resume", (req, res) => {
        const { id } = req.params;
        const { user_name } = req.body;
        try {
            const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as any;
            if (!session) return res.status(404).json({ error: "Session not found" });
            if (session.status !== 'paused') return res.status(400).json({ error: "Session is not paused" });

            const now = Date.now();
            const pausedDuration = session.paused_at ? (now - session.paused_at) : 0;
            const newTotalPaused = (session.total_paused_ms || 0) + pausedDuration;

            db.prepare("UPDATE sessions SET status = 'active', paused_at = NULL, total_paused_ms = ? WHERE id = ?").run(newTotalPaused, id);
            logAudit(null, user_name || "Staff", "RESUME_SESSION", `Resumed session #${id}`);

            const updated = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
            res.json(updated);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // PLAYER MANAGEMENT IN SESSION: ADD PLAYER
    app.post("/api/sessions/:id/players", (req, res) => {
        const { id } = req.params;
        const { name, username } = req.body;
        try {
            const existing = db.prepare("SELECT COUNT(*) as count FROM session_players WHERE session_id = ?").get(id) as any;
            const nextSlot = existing.count + 1;
            const info = db.prepare(`
              INSERT INTO session_players (session_id, player_slot, name, username, status)
              VALUES (?, ?, ?, ?, 'PLAYING')
            `).run(id, nextSlot, name || `Player ${nextSlot}`, username || '');

            const player = db.prepare("SELECT * FROM session_players WHERE id = ?").get(info.lastInsertRowid);
            res.json(player);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // PLAYER MANAGEMENT: UPDATE STATUS (PLAYING / OUT / WINNER) OR NAME
    app.put("/api/sessions/:id/players/:playerId", (req, res) => {
        const { id, playerId } = req.params;
        const { name, username, status } = req.body;
        try {
            db.prepare(`
              UPDATE session_players SET
                name = COALESCE(?, name),
                username = COALESCE(?, username),
                status = COALESCE(?, status)
              WHERE id = ? AND session_id = ?
            `).run(name, username, status, playerId, id);

            const updated = db.prepare("SELECT * FROM session_players WHERE id = ?").get(playerId);
            res.json(updated);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // PLAYER MANAGEMENT: REMOVE PLAYER
    app.delete("/api/sessions/:id/players/:playerId", (req, res) => {
        const { id, playerId } = req.params;
        try {
            db.prepare("DELETE FROM session_players WHERE id = ? AND session_id = ?").run(playerId, id);
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // ADJUST SESSION BILL MANUALLY
    app.post("/api/sessions/:id/adjust", (req, res) => {
        const { id } = req.params;
        const { adjustment_amount, reason, additional_charges, discount_amount, user_name } = req.body;
        try {
            db.prepare(`
              UPDATE sessions SET
                manual_adjustment_amount = COALESCE(?, manual_adjustment_amount),
                manual_adjustment_reason = COALESCE(?, manual_adjustment_reason),
                additional_charges = COALESCE(?, additional_charges),
                discount_amount = COALESCE(?, discount_amount)
              WHERE id = ?
            `).run(
                adjustment_amount !== undefined ? Number(adjustment_amount) : null,
                reason,
                additional_charges !== undefined ? Number(additional_charges) : null,
                discount_amount !== undefined ? Number(discount_amount) : null,
                id
            );

            logAudit(null, user_name || "Staff", "ADJUST_BILL", `Adjusted session #${id}: ${reason} (₹${adjustment_amount})`);
            const updated = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
            res.json(updated);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // END SESSION AND GENERATE INVOICE
    app.post("/api/sessions/:id/end", (req, res) => {
        const { id } = req.params;
        const {
            additional_charges = 0,
            discount_amount = 0,
            manual_adjustment_amount = 0,
            manual_adjustment_reason = '',
            payment_method = 'UPI',
            payment_status = 'Paid',
            amount_paid,
            upi_ref = '',
            user_name = 'Staff'
        } = req.body;

        try {
            const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as any;
            if (!session) return res.status(404).json({ error: "Session not found" });
            if (session.status === 'completed') return res.status(400).json({ error: "Session already ended" });

            const now = Date.now();
            let totalPaused = session.total_paused_ms || 0;
            if (session.status === 'paused' && session.paused_at) {
                totalPaused += (now - session.paused_at);
            }

            const elapsedMs = Math.max(0, now - session.start_time - totalPaused);
            const durationSeconds = Math.max(60, Math.floor(elapsedMs / 1000));
            const durationMinutes = Math.ceil(durationSeconds / 60);

            // Calculate Base Amount based on pricing method
            let baseAmount = 0;
            if (session.pricing_method === 'per_minute') {
                baseAmount = Math.round(session.table_price * durationMinutes);
            } else if (session.pricing_method === 'fixed_session') {
                baseAmount = session.table_price;
                // Add overtime if elapsed beyond fixed duration
                if (durationMinutes > (session.fixed_duration_minutes || 60)) {
                    const extraMinutes = durationMinutes - session.fixed_duration_minutes;
                    const overtimeRate = (session.table_price / (session.fixed_duration_minutes || 60));
                    baseAmount += Math.round(extraMinutes * overtimeRate);
                }
            } else {
                // per_hour
                baseAmount = Math.round((session.table_price * (durationMinutes / 60)) * 10) / 10;
            }

            const finalAmount = Math.max(
                0,
                Math.round(
                    baseAmount +
                    Number(additional_charges) -
                    Number(discount_amount) +
                    Number(manual_adjustment_amount)
                )
            );

            const effectivePaid = payment_status === 'Paid' ? finalAmount : (amount_paid !== undefined ? Number(amount_paid) : 0);
            const pendingAmount = Math.max(0, finalAmount - effectivePaid);

            // Update session
            db.prepare(`
              UPDATE sessions SET
                end_time = ?,
                status = 'completed',
                total_duration_seconds = ?,
                base_amount = ?,
                additional_charges = ?,
                discount_amount = ?,
                manual_adjustment_amount = ?,
                manual_adjustment_reason = ?,
                final_amount = ?
              WHERE id = ?
            `).run(
                now, durationSeconds, baseAmount,
                Number(additional_charges), Number(discount_amount),
                Number(manual_adjustment_amount), manual_adjustment_reason,
                finalAmount, id
            );

            // Free table
            db.prepare("UPDATE tables SET status = 'available', active_session_id = NULL WHERE id = ?").run(session.table_id);

            // Get players
            const players = db.prepare("SELECT * FROM session_players WHERE session_id = ?").all(id) as any[];
            const customerNames = players.map(p => `${p.name}${p.status === 'WINNER' ? ' (🏆 Winner)' : ''}`).join(', ');

            // Format duration
            const hrs = Math.floor(durationMinutes / 60);
            const mins = durationMinutes % 60;
            const durationFormatted = hrs > 0 ? `${hrs}h ${mins}m` : `${mins} mins`;

            // Unique invoice number
            const countBills = (db.prepare("SELECT COUNT(*) as count FROM bills").get() as any).count + 1001;
            const invoiceNo = `SGC-2026-${countBills}`;

            // Insert into bills
            const billInfo = db.prepare(`
              INSERT INTO bills (
                invoice_no, session_id, table_id, table_name, customer_names,
                start_time, end_time, duration_formatted, duration_seconds,
                table_rate, pricing_method, base_amount, additional_charges,
                discount_amount, manual_adjustment_amount, manual_adjustment_reason,
                final_amount, payment_status, payment_method, amount_paid, pending_amount,
                upi_ref, notes
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                invoiceNo, id, session.table_id, session.table_name, customerNames || 'Guest Players',
                session.start_time, now, durationFormatted, durationSeconds,
                session.table_price, session.pricing_method, baseAmount,
                Number(additional_charges), Number(discount_amount),
                Number(manual_adjustment_amount), manual_adjustment_reason,
                finalAmount, payment_status, payment_method, effectivePaid, pendingAmount,
                upi_ref, manual_adjustment_reason || 'Gaming session completed'
            );

            logAudit(null, user_name, "END_SESSION_BILL", `Ended session #${id} on ${session.table_name}. Generated ${invoiceNo} for ₹${finalAmount}`);

            const fullBill = db.prepare("SELECT * FROM bills WHERE id = ?").get(billInfo.lastInsertRowid);
            res.json({ success: true, bill: fullBill, players });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // 4. BILLING & INVOICES
    app.get("/api/bills", (req, res) => {
        try {
            const { status, search, limit = 100 } = req.query;
            let query = "SELECT * FROM bills";
            const params: any[] = [];
            const conditions: string[] = [];

            if (status && status !== 'all') {
                conditions.push("payment_status = ?");
                params.push(status);
            }

            if (search) {
                conditions.push("(invoice_no LIKE ? OR customer_names LIKE ? OR table_name LIKE ?)");
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            if (conditions.length > 0) {
                query += " WHERE " + conditions.join(" AND ");
            }

            query += " ORDER BY id DESC LIMIT ?";
            params.push(Number(limit));

            const bills = db.prepare(query).all(...params);
            res.json(bills);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // Record Payment on Bill
    app.post("/api/bills/:id/pay", (req, res) => {
        const { id } = req.params;
        const { payment_status, payment_method, amount_paid, upi_ref, user_name } = req.body;
        try {
            const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(id) as any;
            if (!bill) return res.status(404).json({ error: "Bill not found" });

            const newPaid = Number(amount_paid !== undefined ? amount_paid : bill.final_amount);
            const newPending = Math.max(0, bill.final_amount - newPaid);
            const newStatus = payment_status || (newPending === 0 ? 'Paid' : (newPaid > 0 ? 'Partially Paid' : 'Unpaid'));

            db.prepare(`
              UPDATE bills SET
                payment_status = ?,
                payment_method = COALESCE(?, payment_method),
                amount_paid = ?,
                pending_amount = ?,
                upi_ref = COALESCE(?, upi_ref)
              WHERE id = ?
            `).run(newStatus, payment_method, newPaid, newPending, upi_ref, id);

            logAudit(null, user_name || "Staff", "RECORD_PAYMENT", `Updated payment for ${bill.invoice_no}: Paid ₹${newPaid}, Pending ₹${newPending} (${newStatus})`);

            const updated = db.prepare("SELECT * FROM bills WHERE id = ?").get(id);
            res.json(updated);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // Delete/Void Bill (Admin only)
    app.post("/api/bills/:id/void", (req, res) => {
        const { id } = req.params;
        const { user_role, user_name, reason } = req.body;
        if (user_role !== 'admin') {
            return res.status(403).json({ error: "Only Admin can void bills." });
        }
        try {
            const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(id) as any;
            if (!bill) return res.status(404).json({ error: "Bill not found" });

            db.prepare("DELETE FROM bills WHERE id = ?").run(id);
            logAudit(null, user_name || "Admin", "VOID_BILL", `Voided bill ${bill.invoice_no}. Reason: ${reason || 'N/A'}`);
            res.json({ success: true, message: `Bill ${bill.invoice_no} has been voided.` });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // 5. 30-DAY REPORTS & COLLECTION ANALYTICS
    app.get("/api/reports/analytics", (req, res) => {
        try {
            const { range = '30days', startDate, endDate } = req.query;

            let dateCondition = "created_at >= DATE('now', '-30 days')";
            let expenseDateCondition = "expense_date >= DATE('now', '-30 days')";
            let params: any[] = [];
            let expenseParams: any[] = [];

            if (range === 'today') {
                dateCondition = "DATE(created_at) = DATE('now')";
                expenseDateCondition = "expense_date = DATE('now')";
            } else if (range === '7days') {
                dateCondition = "created_at >= DATE('now', '-7 days')";
                expenseDateCondition = "expense_date >= DATE('now', '-7 days')";
            } else if (range === 'month') {
                dateCondition = "strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')";
                expenseDateCondition = "strftime('%Y-%m', expense_date) = strftime('%Y-%m', 'now')";
            } else if (range === 'custom' && startDate && endDate) {
                dateCondition = "DATE(created_at) BETWEEN ? AND ?";
                expenseDateCondition = "expense_date BETWEEN ? AND ?";
                params = [startDate, endDate];
                expenseParams = [startDate, endDate];
            }

            // Summary Metrics
            const summary = db.prepare(`
              SELECT 
                COALESCE(SUM(amount_paid), 0) as total_collection,
                COALESCE(SUM(final_amount), 0) as total_billed,
                COALESCE(SUM(pending_amount), 0) as total_pending,
                COALESCE(SUM(discount_amount), 0) as total_discounts,
                COALESCE(SUM(duration_seconds), 0) as total_seconds,
                COUNT(*) as total_sessions
              FROM bills
              WHERE ${dateCondition}
            `).get(...params) as any;

            // Total Expenses
            const expensesSummary = db.prepare(`
              SELECT COALESCE(SUM(amount), 0) as total FROM expenses
              WHERE ${expenseDateCondition}
            `).get(...expenseParams) as any;

            // Day-wise Collection
            const dayWise = db.prepare(`
              SELECT 
                DATE(created_at) as date,
                COALESCE(SUM(amount_paid), 0) as collection,
                COALESCE(SUM(final_amount), 0) as billed,
                COALESCE(SUM(pending_amount), 0) as pending,
                COALESCE(SUM(discount_amount), 0) as discounts,
                COUNT(*) as sessions_count,
                ROUND(COALESCE(SUM(duration_seconds), 0) / 3600.0, 1) as gaming_hours
              FROM bills
              WHERE ${dateCondition}
              GROUP BY DATE(created_at)
              ORDER BY date ASC
            `).all(...params);

            // Table-wise Breakdown
            const tableBreakdown = db.prepare(`
              SELECT 
                table_name,
                COUNT(*) as sessions_count,
                COALESCE(SUM(amount_paid), 0) as total_revenue,
                ROUND(COALESCE(SUM(duration_seconds), 0) / 3600.0, 1) as total_hours
              FROM bills
              WHERE ${dateCondition}
              GROUP BY table_name
              ORDER BY total_revenue DESC
            `).all(...params);

            // Payment Methods Breakdown (Cash vs UPI vs Card)
            const paymentBreakdown = db.prepare(`
              SELECT 
                payment_method,
                COALESCE(SUM(amount_paid), 0) as amount,
                COUNT(*) as count
              FROM bills
              WHERE ${dateCondition}
              GROUP BY payment_method
            `).all(...params);

            // Expenses by Category
            const expensesByCategory = db.prepare(`
              SELECT category, COALESCE(SUM(amount), 0) as total, COUNT(*) as count
              FROM expenses
              WHERE ${expenseDateCondition}
              GROUP BY category
              ORDER BY total DESC
            `).all(...expenseParams);

            // Net Profit
            const netProfit = (summary.total_collection || 0) - (expensesSummary.total || 0);

            res.json({
                summary: {
                    ...summary,
                    total_expenses: expensesSummary.total || 0,
                    net_profit: netProfit,
                    gaming_hours: Math.round(((summary.total_seconds || 0) / 3600) * 10) / 10
                },
                dayWise,
                tableBreakdown,
                paymentBreakdown,
                expensesByCategory
            });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // DAILY CLOSING REPORT (EOD summary)
    app.get("/api/reports/daily-closing", (req, res) => {
        try {
            const todayStr = new Date().toISOString().slice(0, 10);
            const cashCollection = db.prepare(`
              SELECT COALESCE(SUM(amount_paid), 0) as total FROM bills 
              WHERE DATE(created_at) = DATE('now') AND payment_method = 'Cash'
            `).get() as any;

            const upiCollection = db.prepare(`
              SELECT COALESCE(SUM(amount_paid), 0) as total FROM bills 
              WHERE DATE(created_at) = DATE('now') AND payment_method = 'UPI'
            `).get() as any;

            const otherCollection = db.prepare(`
              SELECT COALESCE(SUM(amount_paid), 0) as total FROM bills 
              WHERE DATE(created_at) = DATE('now') AND payment_method NOT IN ('Cash', 'UPI')
            `).get() as any;

            const pendingTotal = db.prepare(`
              SELECT COALESCE(SUM(pending_amount), 0) as total FROM bills 
              WHERE DATE(created_at) = DATE('now') AND payment_status != 'Paid'
            `).get() as any;

            const expensesToday = db.prepare(`
              SELECT COALESCE(SUM(amount), 0) as total FROM expenses 
              WHERE expense_date = DATE('now')
            `).get() as any;

            const sessionsCount = db.prepare(`
              SELECT COUNT(*) as count FROM sessions WHERE DATE(created_at) = DATE('now')
            `).get() as any;

            res.json({
                date: todayStr,
                cashInCounter: cashCollection.total,
                upiInBank: upiCollection.total,
                otherCollection: otherCollection.total,
                totalCollected: cashCollection.total + upiCollection.total + otherCollection.total,
                pendingAmount: pendingTotal.total,
                expensesToday: expensesToday.total,
                netCashInHand: cashCollection.total - expensesToday.total,
                sessionsCount: sessionsCount.count
            });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // 6. CUSTOMER MANAGEMENT
    app.get("/api/customers", (req, res) => {
        try {
            const customers = db.prepare("SELECT * FROM customers ORDER BY total_spent DESC").all();
            res.json(customers);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/api/customers", (req, res) => {
        const { name, phone, username, birthday, notes } = req.body;
        try {
            const info = db.prepare(`
              INSERT INTO customers (name, phone, username, birthday, notes)
              VALUES (?, ?, ?, ?, ?)
            `).run(name, phone, username || '', birthday || null, notes || '');

            const cust = db.prepare("SELECT * FROM customers WHERE id = ?").get(info.lastInsertRowid);
            res.json(cust);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    app.put("/api/customers/:id", (req, res) => {
        const { id } = req.params;
        const { name, phone, username, reward_points, tier, birthday, notes } = req.body;
        try {
            db.prepare(`
              UPDATE customers SET
                name = COALESCE(?, name),
                phone = COALESCE(?, phone),
                username = COALESCE(?, username),
                reward_points = COALESCE(?, reward_points),
                tier = COALESCE(?, tier),
                birthday = COALESCE(?, birthday),
                notes = COALESCE(?, notes)
              WHERE id = ?
            `).run(name, phone, username, reward_points ? Number(reward_points) : null, tier, birthday, notes, id);

            const updated = db.prepare("SELECT * FROM customers WHERE id = ?").get(id);
            res.json(updated);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    app.delete("/api/customers/:id", (req, res) => {
        const { id } = req.params;
        try {
            db.prepare("DELETE FROM customers WHERE id = ?").run(id);
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // 7. BOOKINGS / TABLE RESERVATION
    app.get("/api/bookings", (req, res) => {
        try {
            const bookings = db.prepare("SELECT * FROM bookings ORDER BY booking_time ASC").all();
            res.json(bookings);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/api/bookings", (req, res) => {
        const { table_id, customer_name, phone, booking_time, duration_hours, guests_count, notes } = req.body;
        try {
            const table = db.prepare("SELECT * FROM tables WHERE id = ?").get(table_id) as any;
            if (!table) return res.status(404).json({ error: "Table not found" });

            const info = db.prepare(`
              INSERT INTO bookings (table_id, table_name, customer_name, phone, booking_time, duration_hours, guests_count, notes, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')
            `).run(table.id, table.name, customer_name, phone, booking_time, duration_hours || 1, guests_count || 1, notes || '');

            const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(info.lastInsertRowid);
            res.json(booking);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    app.put("/api/bookings/:id", (req, res) => {
        const { id } = req.params;
        const { status, booking_time, duration_hours, notes } = req.body;
        try {
            db.prepare(`
              UPDATE bookings SET
                status = COALESCE(?, status),
                booking_time = COALESCE(?, booking_time),
                duration_hours = COALESCE(?, duration_hours),
                notes = COALESCE(?, notes)
              WHERE id = ?
            `).run(status, booking_time, duration_hours, notes, id);

            const updated = db.prepare("SELECT * FROM bookings WHERE id = ?").get(id);
            res.json(updated);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    app.delete("/api/bookings/:id", (req, res) => {
        const { id } = req.params;
        try {
            db.prepare("DELETE FROM bookings WHERE id = ?").run(id);
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // 8. EXPENSES
    app.get("/api/expenses", (req, res) => {
        try {
            const expenses = db.prepare("SELECT * FROM expenses ORDER BY expense_date DESC, id DESC").all();
            res.json(expenses);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/api/expenses", (req, res) => {
        const { category, amount, description, payment_mode, expense_date, user_name } = req.body;
        try {
            const info = db.prepare(`
              INSERT INTO expenses (category, amount, description, payment_mode, expense_date, created_by)
              VALUES (?, ?, ?, ?, COALESCE(?, DATE('now')), ?)
            `).run(category, Number(amount), description || '', payment_mode || 'UPI', expense_date || null, user_name || 'Staff');

            logAudit(null, user_name || "Staff", "ADD_EXPENSE", `Added expense: ${category} - ₹${amount}`);
            const exp = db.prepare("SELECT * FROM expenses WHERE id = ?").get(info.lastInsertRowid);
            res.json(exp);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    app.delete("/api/expenses/:id", (req, res) => {
        const { id } = req.params;
        const { user_role, user_name } = req.body;
        if (user_role !== 'admin') {
            return res.status(403).json({ error: "Only Admin can delete expense records." });
        }
        try {
            db.prepare("DELETE FROM expenses WHERE id = ?").run(id);
            logAudit(null, user_name || "Admin", "DELETE_EXPENSE", `Deleted expense ID ${id}`);
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // 9. STAFF MANAGEMENT (Admin only)
    app.get("/api/staff", (req, res) => {
        try {
            const staff = db.prepare("SELECT id, name, email, username, role, phone, status, created_at FROM users ORDER BY id ASC").all();
            res.json(staff);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/api/staff", (req, res) => {
        const { name, email, username, password, role, phone, user_role, user_name } = req.body;
        if (user_role !== 'admin') {
            return res.status(403).json({ error: "Only Admin can manage staff." });
        }
        try {
            const info = db.prepare(`
              INSERT INTO users (name, email, username, password, role, phone, status)
              VALUES (?, ?, ?, ?, ?, ?, 'active')
            `).run(name, email, username, password || 'password123', role || 'staff', phone || '');

            logAudit(null, user_name || "Admin", "CREATE_STAFF", `Created ${role} account for ${name} (${username})`);
            const created = db.prepare("SELECT id, name, email, username, role, phone, status, created_at FROM users WHERE id = ?").get(info.lastInsertRowid);
            res.json(created);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    app.put("/api/staff/:id", (req, res) => {
        const { id } = req.params;
        const { name, email, username, password, role, phone, status, user_role, user_name } = req.body;
        if (user_role !== 'admin') {
            return res.status(403).json({ error: "Only Admin can edit staff." });
        }
        try {
            db.prepare(`
              UPDATE users SET
                name = COALESCE(?, name),
                email = COALESCE(?, email),
                username = COALESCE(?, username),
                password = COALESCE(?, password),
                role = COALESCE(?, role),
                phone = COALESCE(?, phone),
                status = COALESCE(?, status)
              WHERE id = ?
            `).run(name, email, username, password || null, role, phone, status, id);

            logAudit(null, user_name || "Admin", "UPDATE_STAFF", `Updated staff ID ${id}`);
            const updated = db.prepare("SELECT id, name, email, username, role, phone, status, created_at FROM users WHERE id = ?").get(id);
            res.json(updated);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    app.delete("/api/staff/:id", (req, res) => {
        const { id } = req.params;
        const { user_role, user_name } = req.body;
        if (user_role !== 'admin') {
            return res.status(403).json({ error: "Only Admin can delete staff." });
        }
        try {
            if (Number(id) === 1) {
                return res.status(400).json({ error: "Cannot delete master Administrator account." });
            }
            db.prepare("DELETE FROM users WHERE id = ?").run(id);
            logAudit(null, user_name || "Admin", "DELETE_STAFF", `Deleted staff ID ${id}`);
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // 10. AUDIT LOGS
    app.get("/api/audit-logs", (req, res) => {
        try {
            const logs = db.prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100").all();
            res.json(logs);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // 11. SETTINGS
    app.get("/api/settings", (req, res) => {
        try {
            const rows = db.prepare("SELECT key, value FROM settings").all() as any[];
            const settingsObj: Record<string, string> = {};
            rows.forEach(r => { settingsObj[r.key] = r.value; });
            res.json(settingsObj);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/api/settings", (req, res) => {
        const { settings, user_role, user_name } = req.body;
        if (user_role !== 'admin') {
            return res.status(403).json({ error: "Only Admin can update café settings." });
        }
        try {
            const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
            for (const [k, v] of Object.entries(settings)) {
                upsert.run(k, String(v));
            }
            logAudit(null, user_name || "Admin", "UPDATE_SETTINGS", "Updated system and café settings");
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // 12. BACKUP & RESTORE
    app.get("/api/backup/export", (req, res) => {
        try {
            const data = {
                tables: db.prepare("SELECT * FROM tables").all(),
                sessions: db.prepare("SELECT * FROM sessions").all(),
                session_players: db.prepare("SELECT * FROM session_players").all(),
                bills: db.prepare("SELECT * FROM bills").all(),
                customers: db.prepare("SELECT * FROM customers").all(),
                bookings: db.prepare("SELECT * FROM bookings").all(),
                expenses: db.prepare("SELECT * FROM expenses").all(),
                users: db.prepare("SELECT id, name, email, username, role, phone, status FROM users").all(),
                settings: db.prepare("SELECT * FROM settings").all(),
                timestamp: new Date().toISOString()
            };
            res.json(data);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // Static files
    app.use(express.static(path.join(__dirname, "public")));

    // Vite Middleware for dev
    if (process.env.NODE_ENV !== "production") {
        const vite = await createViteServer({
            server: {
                middlewareMode: true,
                hmr: false,
            },
            appType: "spa",
        });
        app.use(vite.middlewares);
    } else {
        app.use(express.static(path.join(__dirname, "dist")));
        app.get("*", (req, res) => {
            res.sendFile(path.join(__dirname, "dist", "index.html"));
        });
    }

    app.listen(PORT, "0.0.0.0", () => {
        console.log(`🎮 SHOCKER GAMING CAFÉ server running on http://localhost:${PORT}`);
    });
}

startServer().catch((err) => {
    console.error("Failed to start server:", err);
});
