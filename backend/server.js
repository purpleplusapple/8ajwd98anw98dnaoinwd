const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); // Increased limit for base64 images/videos
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Storage for uploaded files (referenced in jobs)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname)
    }
});
const upload = multer({ storage: storage });

// Database Setup
const db = new sqlite3.Database('./jobs.db', (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initializeDatabase();
    }
});

function initializeDatabase() {
    db.run(`CREATE TABLE IF NOT EXISTS templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL, -- 'UPLOAD_IMAGE' or 'GENERATE_VIDEO'
        url TEXT NOT NULL,
        method TEXT NOT NULL,
        headers TEXT, -- JSON string
        body_structure TEXT -- JSON string with placeholders
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prompt TEXT,
        reference_image_path TEXT,
        status TEXT DEFAULT 'PENDING', -- 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'
        settings TEXT, -- JSON string (ratio, duration, etc.)
        result_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
}

// --- Endpoints ---

// 1. Save captured API patterns
app.post('/api/templates', (req, res) => {
    const { type, url, method, headers, body_structure } = req.body;

    // Upsert or simple insert. For simplicity, we just insert.
    // In a real app, might want to replace existing template of same type.
    // Let's delete existing template of same type first to keep it simple (latest wins).
    db.run(`DELETE FROM templates WHERE type = ?`, [type], (err) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        const sql = `INSERT INTO templates (type, url, method, headers, body_structure) VALUES (?, ?, ?, ?, ?)`;
        const params = [type, url, method, JSON.stringify(headers), JSON.stringify(body_structure)];

        db.run(sql, params, function(err) {
            if (err) {
                return res.status(400).json({ error: err.message });
            }
            res.json({ message: 'Template saved', id: this.lastID });
        });
    });
});

// Get learning status
app.get('/api/templates/status', (req, res) => {
    db.all("SELECT type FROM templates", [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        const types = rows.map(r => r.type);
        res.json({
            hasUpload: types.includes('UPLOAD_IMAGE'),
            hasGenerate: types.includes('GENERATE_VIDEO')
        });
    });
});

// 2. Create a new job
app.post('/api/jobs', upload.single('reference_image'), (req, res) => {
    const { prompt, ratio, duration } = req.body;
    const reference_image_path = req.file ? req.file.path : null;

    const settings = {
        ratio: ratio || '16:9',
        duration: duration || '4s'
    };

    const sql = `INSERT INTO jobs (prompt, reference_image_path, settings) VALUES (?, ?, ?)`;
    const params = [prompt, reference_image_path, JSON.stringify(settings)];

    db.run(sql, params, function(err) {
        if (err) {
            return res.status(400).json({ error: err.message });
        }
        res.json({ message: 'Job created', id: this.lastID });
    });
});

// List jobs
app.get('/api/jobs', (req, res) => {
    db.all("SELECT * FROM jobs ORDER BY created_at DESC", [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// 3. Poll for pending jobs (called by Extension)
app.get('/api/poll', (req, res) => {
    // Find the oldest PENDING job
    db.get("SELECT * FROM jobs WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 1", [], (err, job) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (!job) {
            return res.json({ job: null });
        }

        // Also fetch templates needed
        db.all("SELECT * FROM templates", [], (err, templates) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            // Mark job as PROCESSING
            db.run("UPDATE jobs SET status = 'PROCESSING' WHERE id = ?", [job.id], (err) => {
                if (err) console.error("Error updating job status", err);
            });

            // If job has reference image, read it and convert to base64 if needed
            // Ideally we pass the path or serving URL, but extension context might need base64.
            // Let's provide base64 for the extension.
            let imageBase64 = null;
            if (job.reference_image_path) {
                try {
                    const imgData = fs.readFileSync(job.reference_image_path);
                    imageBase64 = imgData.toString('base64');
                } catch (e) {
                    console.error("Error reading image file", e);
                }
            }

            res.json({
                job: {
                    ...job,
                    settings: JSON.parse(job.settings),
                    imageBase64: imageBase64
                },
                templates: templates.map(t => ({
                    ...t,
                    headers: JSON.parse(t.headers),
                    body_structure: JSON.parse(t.body_structure)
                }))
            });
        });
    });
});

// 4. Save final result (called by Extension)
app.post('/api/save', (req, res) => {
    const { jobId, resultUrl, error } = req.body;

    if (error) {
        db.run("UPDATE jobs SET status = 'FAILED' WHERE id = ?", [jobId], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            return res.json({ message: 'Job marked as failed' });
        });
    } else {
        // In a real scenario, the extension might upload the video file here.
        // For now, we assume it sends a URL or we just store the text URL if hosted elsewhere,
        // OR the extension could send the blob as base64 and we save it.
        // Let's assume the extension might send a resultPath or we just store the URL.

        db.run("UPDATE jobs SET status = 'COMPLETED', result_path = ? WHERE id = ?", [resultUrl, jobId], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            return res.json({ message: 'Job completed' });
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
