const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const STORAGE_DIR = path.join(__dirname, '..', 'storage');
const DB_PATH = path.join(STORAGE_DIR, 'nola.db');

let db = null;

function initDatabase() {
  // Ensure storage directory exists
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      params TEXT NOT NULL,
      status TEXT NOT NULL,
      operation_data TEXT,
      operation_name TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      path TEXT NOT NULL,
      mime_type TEXT,
      title TEXT,
      folder TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);
    CREATE INDEX IF NOT EXISTS idx_videos_job_id ON videos(job_id);
    CREATE INDEX IF NOT EXISTS idx_videos_folder ON videos(folder);
  `);

  // Import any orphaned video files
  importOrphanedVideos();

  return db;
}

function importOrphanedVideos() {
  const files = fs.readdirSync(STORAGE_DIR).filter(f => f.endsWith('.mp4'));

  for (const filename of files) {
    // Check if video already exists in database
    const existing = db.prepare('SELECT id FROM videos WHERE filename = ?').get(filename);
    if (existing) continue;

    // Parse jobId from filename (format: {jobId}_{index}.mp4)
    const match = filename.match(/^([a-f0-9-]+)_(\d+)\.mp4$/);
    if (!match) continue;

    const jobId = match[0].replace(/_\d+\.mp4$/, '');

    // Check if job exists
    let job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(jobId);

    if (!job) {
      // Create an imported job record
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO jobs (id, type, params, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(jobId, 'imported', JSON.stringify({ prompt: 'Imported video' }), 'completed', now, now);
    }

    // Create video record
    const videoId = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO videos (id, job_id, filename, path, mime_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(videoId, jobId, filename, `/videos/${filename}`, 'video/mp4', now);

    console.log(`Imported orphaned video: ${filename}`);
  }
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

// Job operations
const jobQueries = {
  create: (job) => {
    const stmt = db.prepare(`
      INSERT INTO jobs (id, type, params, status, operation_data, operation_name, error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      job.id,
      job.type,
      JSON.stringify(job.params),
      job.status,
      job.operationData ? JSON.stringify(job.operationData) : null,
      job.operationName,
      job.error,
      job.createdAt,
      job.updatedAt
    );
    return job;
  },

  update: (job) => {
    const stmt = db.prepare(`
      UPDATE jobs
      SET status = ?, operation_data = ?, operation_name = ?, error = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(
      job.status,
      job.operationData ? JSON.stringify(job.operationData) : null,
      job.operationName,
      job.error,
      job.updatedAt,
      job.id
    );
    return job;
  },

  getById: (id) => {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    return row ? parseJobRow(row) : null;
  },

  getAll: () => {
    const rows = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all();
    return rows.map(parseJobRow);
  },

  getByStatus: (status) => {
    const rows = db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC').all(status);
    return rows.map(parseJobRow);
  },

  delete: (id) => {
    const result = db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
    return result.changes > 0;
  }
};

// Video operations
const videoQueries = {
  create: (video) => {
    const stmt = db.prepare(`
      INSERT INTO videos (id, job_id, filename, path, mime_type, title, folder, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      video.id,
      video.jobId,
      video.filename,
      video.path,
      video.mimeType,
      video.title,
      video.folder,
      video.createdAt
    );
    return video;
  },

  getByJobId: (jobId) => {
    return db.prepare('SELECT * FROM videos WHERE job_id = ? ORDER BY created_at').all(jobId);
  },

  getById: (id) => {
    return db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
  },

  getAll: (options = {}) => {
    let query = `
      SELECT v.*, j.params, j.type as job_type
      FROM videos v
      JOIN jobs j ON v.job_id = j.id
      WHERE j.status = 'completed'
    `;
    const params = [];

    if (options.folder) {
      query += ' AND v.folder = ?';
      params.push(options.folder);
    }

    if (options.search) {
      query += ' AND (v.title LIKE ? OR j.params LIKE ?)';
      const searchTerm = `%${options.search}%`;
      params.push(searchTerm, searchTerm);
    }

    query += ' ORDER BY v.created_at DESC';

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    if (options.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    return db.prepare(query).all(...params).map(row => ({
      ...row,
      params: row.params ? JSON.parse(row.params) : null
    }));
  },

  update: (id, updates) => {
    const fields = [];
    const values = [];

    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.folder !== undefined) {
      fields.push('folder = ?');
      values.push(updates.folder);
    }

    if (fields.length === 0) return false;

    values.push(id);
    const result = db.prepare(`UPDATE videos SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return result.changes > 0;
  },

  delete: (id) => {
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
    if (!video) return null;

    db.prepare('DELETE FROM videos WHERE id = ?').run(id);
    return video;
  },

  deleteByJobId: (jobId) => {
    const videos = db.prepare('SELECT * FROM videos WHERE job_id = ?').all(jobId);
    db.prepare('DELETE FROM videos WHERE job_id = ?').run(jobId);
    return videos;
  }
};

// Folder operations
const folderQueries = {
  create: (name) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    try {
      db.prepare('INSERT INTO folders (id, name, created_at) VALUES (?, ?, ?)').run(id, name, now);
      return { id, name, createdAt: now };
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return null; // Folder already exists
      }
      throw err;
    }
  },

  getAll: () => {
    const folders = db.prepare('SELECT * FROM folders ORDER BY name').all();

    // Get video counts for each folder
    const counts = db.prepare(`
      SELECT folder, COUNT(*) as count
      FROM videos
      WHERE folder IS NOT NULL
      GROUP BY folder
    `).all();

    const countMap = {};
    counts.forEach(c => { countMap[c.folder] = c.count; });

    return folders.map(f => ({
      ...f,
      videoCount: countMap[f.name] || 0
    }));
  },

  delete: (id) => {
    // First, unset folder for all videos in this folder
    const folder = db.prepare('SELECT name FROM folders WHERE id = ?').get(id);
    if (folder) {
      db.prepare('UPDATE videos SET folder = NULL WHERE folder = ?').run(folder.name);
    }
    const result = db.prepare('DELETE FROM folders WHERE id = ?').run(id);
    return result.changes > 0;
  }
};

function parseJobRow(row) {
  return {
    id: row.id,
    type: row.type,
    params: JSON.parse(row.params),
    status: row.status,
    operationData: row.operation_data ? JSON.parse(row.operation_data) : null,
    operationName: row.operation_name,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = {
  initDatabase,
  getDb,
  jobs: jobQueries,
  videos: videoQueries,
  folders: folderQueries
};
