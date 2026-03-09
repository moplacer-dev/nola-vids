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
      source_uri TEXT,
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

    -- Image Generation Tables --

    -- Characters with anchor images for consistency
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      module_name TEXT NOT NULL,
      character_name TEXT NOT NULL,
      career TEXT,
      appearance_description TEXT,
      anchor_image_path TEXT,
      reference_images TEXT,
      appears_on_slides TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(module_name, character_name)
    );

    -- Asset lists from Carl v7
    CREATE TABLE IF NOT EXISTS asset_lists (
      id TEXT PRIMARY KEY,
      module_name TEXT NOT NULL,
      session_number INTEGER,
      session_title TEXT,
      assets_json TEXT NOT NULL,
      slides_json TEXT,
      career_character_json TEXT,
      imported_at TEXT DEFAULT (datetime('now'))
    );

    -- Generated images
    CREATE TABLE IF NOT EXISTS generated_images (
      id TEXT PRIMARY KEY,
      asset_list_id TEXT REFERENCES asset_lists(id),
      slide_number INTEGER,
      asset_type TEXT,
      asset_number INTEGER DEFAULT 1,
      cms_filename TEXT,
      original_prompt TEXT,
      modified_prompt TEXT,
      character_id TEXT REFERENCES characters(id),
      image_path TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Generation history for regeneration tracking
    CREATE TABLE IF NOT EXISTS generation_history (
      id TEXT PRIMARY KEY,
      generated_image_id TEXT REFERENCES generated_images(id) ON DELETE CASCADE,
      prompt TEXT,
      image_path TEXT,
      created_at TEXT NOT NULL
    );

    -- Motion graphics final videos (one video per slide)
    CREATE TABLE IF NOT EXISTS motion_graphics_videos (
      id TEXT PRIMARY KEY,
      asset_list_id TEXT REFERENCES asset_lists(id) ON DELETE CASCADE,
      slide_number INTEGER NOT NULL,
      cms_filename TEXT,
      video_path TEXT,
      status TEXT DEFAULT 'pending',
      scene_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(asset_list_id, slide_number)
    );

    -- Generated audio for TTS narration
    CREATE TABLE IF NOT EXISTS generated_audio (
      id TEXT PRIMARY KEY,
      asset_list_id TEXT REFERENCES asset_lists(id) ON DELETE CASCADE,
      slide_number INTEGER NOT NULL,
      cms_filename TEXT,
      narration_text TEXT,
      voice_id TEXT,
      voice_name TEXT,
      audio_path TEXT,
      duration_ms INTEGER,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(asset_list_id, slide_number)
    );

    CREATE INDEX IF NOT EXISTS idx_characters_module ON characters(module_name);
    CREATE INDEX IF NOT EXISTS idx_asset_lists_module ON asset_lists(module_name);
    CREATE INDEX IF NOT EXISTS idx_asset_lists_session ON asset_lists(module_name, session_number);
    CREATE INDEX IF NOT EXISTS idx_generated_images_asset_list ON generated_images(asset_list_id);
    CREATE INDEX IF NOT EXISTS idx_generated_images_status ON generated_images(status);
    CREATE INDEX IF NOT EXISTS idx_generation_history_image ON generation_history(generated_image_id);
    CREATE INDEX IF NOT EXISTS idx_mg_videos_asset_list ON motion_graphics_videos(asset_list_id);
    CREATE INDEX IF NOT EXISTS idx_generated_audio_asset_list ON generated_audio(asset_list_id);
    CREATE INDEX IF NOT EXISTS idx_generated_audio_status ON generated_audio(status);
  `);

  // Migration: Add source_uri column if it doesn't exist (for existing databases)
  const columns = db.prepare("PRAGMA table_info(videos)").all();
  const hasSourceUri = columns.some(col => col.name === 'source_uri');
  if (!hasSourceUri) {
    db.exec('ALTER TABLE videos ADD COLUMN source_uri TEXT');
    console.log('Migration: Added source_uri column to videos table');
  }

  // Migration: Add module_name column to videos if it doesn't exist
  const hasModuleName = columns.some(col => col.name === 'module_name');
  if (!hasModuleName) {
    db.exec('ALTER TABLE videos ADD COLUMN module_name TEXT');
    console.log('Migration: Added module_name column to videos table');
  }

  // Migration: Add slides_json column to asset_lists if it doesn't exist
  const assetListColumns = db.prepare("PRAGMA table_info(asset_lists)").all();
  const hasSlidesJson = assetListColumns.some(col => col.name === 'slides_json');
  if (!hasSlidesJson) {
    db.exec('ALTER TABLE asset_lists ADD COLUMN slides_json TEXT');
    console.log('Migration: Added slides_json column to asset_lists table');
  }

  // Migration: Add asset_number column to generated_images if it doesn't exist
  const genImageColumns = db.prepare("PRAGMA table_info(generated_images)").all();
  const hasAssetNumber = genImageColumns.some(col => col.name === 'asset_number');
  if (!hasAssetNumber) {
    db.exec('ALTER TABLE generated_images ADD COLUMN asset_number INTEGER DEFAULT 1');
    console.log('Migration: Added asset_number column to generated_images table');
  }

  // Migration: Add default_voice_id and default_voice_name columns to asset_lists
  const hasDefaultVoiceId = assetListColumns.some(col => col.name === 'default_voice_id');
  if (!hasDefaultVoiceId) {
    db.exec('ALTER TABLE asset_lists ADD COLUMN default_voice_id TEXT');
    db.exec('ALTER TABLE asset_lists ADD COLUMN default_voice_name TEXT');
    console.log('Migration: Added default_voice_id and default_voice_name columns to asset_lists table');
  }

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
      INSERT INTO videos (id, job_id, filename, path, mime_type, title, folder, source_uri, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      video.id,
      video.jobId,
      video.filename,
      video.path,
      video.mimeType,
      video.title,
      video.folder,
      video.sourceUri,
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

  getByPath: (path) => {
    return db.prepare('SELECT * FROM videos WHERE path = ?').get(path);
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
      params: row.params ? JSON.parse(row.params) : null,
      moduleName: row.module_name || null
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
    if (updates.moduleName !== undefined) {
      fields.push('module_name = ?');
      values.push(updates.moduleName);
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

// Character operations (for image generation consistency)
const characterQueries = {
  create: (character) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    try {
      db.prepare(`
        INSERT INTO characters (id, module_name, character_name, career, appearance_description, anchor_image_path, reference_images, appears_on_slides, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        character.moduleName,
        character.characterName,
        character.career || null,
        character.appearanceDescription || null,
        character.anchorImagePath || null,
        character.referenceImages ? JSON.stringify(character.referenceImages) : null,
        character.appearsOnSlides ? JSON.stringify(character.appearsOnSlides) : null,
        now,
        now
      );
      return { id, ...character, createdAt: now, updatedAt: now };
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return null; // Character already exists for this module
      }
      throw err;
    }
  },

  getById: (id) => {
    const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
    return row ? parseCharacterRow(row) : null;
  },

  getByModule: (moduleName) => {
    const rows = db.prepare('SELECT * FROM characters WHERE module_name = ? ORDER BY character_name').all(moduleName);
    return rows.map(parseCharacterRow);
  },

  getByModuleAndName: (moduleName, characterName) => {
    const row = db.prepare('SELECT * FROM characters WHERE module_name = ? AND character_name = ?').get(moduleName, characterName);
    return row ? parseCharacterRow(row) : null;
  },

  update: (id, updates) => {
    const fields = [];
    const values = [];

    if (updates.career !== undefined) {
      fields.push('career = ?');
      values.push(updates.career);
    }
    if (updates.appearanceDescription !== undefined) {
      fields.push('appearance_description = ?');
      values.push(updates.appearanceDescription);
    }
    if (updates.anchorImagePath !== undefined) {
      fields.push('anchor_image_path = ?');
      values.push(updates.anchorImagePath);
    }
    if (updates.referenceImages !== undefined) {
      fields.push('reference_images = ?');
      values.push(JSON.stringify(updates.referenceImages));
    }
    if (updates.appearsOnSlides !== undefined) {
      fields.push('appears_on_slides = ?');
      values.push(JSON.stringify(updates.appearsOnSlides));
    }

    if (fields.length === 0) return false;

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const result = db.prepare(`UPDATE characters SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return result.changes > 0;
  },

  setAnchorImage: (id, imagePath) => {
    const now = new Date().toISOString();
    const result = db.prepare('UPDATE characters SET anchor_image_path = ?, updated_at = ? WHERE id = ?').run(imagePath, now, id);
    return result.changes > 0;
  },

  delete: (id) => {
    const result = db.prepare('DELETE FROM characters WHERE id = ?').run(id);
    return result.changes > 0;
  }
};

// Asset list operations (from Carl v7)
const assetListQueries = {
  create: (assetList) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO asset_lists (id, module_name, session_number, session_title, assets_json, slides_json, career_character_json, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      assetList.moduleName,
      assetList.sessionNumber || null,
      assetList.sessionTitle || null,
      JSON.stringify(assetList.assets),
      assetList.slides ? JSON.stringify(assetList.slides) : null,
      assetList.careerCharacter ? JSON.stringify(assetList.careerCharacter) : null,
      now
    );
    return { id, ...assetList, importedAt: now };
  },

  getById: (id) => {
    const row = db.prepare('SELECT * FROM asset_lists WHERE id = ?').get(id);
    return row ? parseAssetListRow(row) : null;
  },

  getAll: () => {
    const rows = db.prepare('SELECT * FROM asset_lists ORDER BY imported_at DESC').all();
    return rows.map(parseAssetListRow);
  },

  getByModule: (moduleName) => {
    const rows = db.prepare('SELECT * FROM asset_lists WHERE module_name = ? ORDER BY session_number, imported_at DESC').all(moduleName);
    return rows.map(parseAssetListRow);
  },

  getByModuleAndSession: (moduleName, sessionNumber) => {
    const row = db.prepare('SELECT * FROM asset_lists WHERE module_name = ? AND session_number = ? ORDER BY imported_at DESC LIMIT 1').get(moduleName, sessionNumber);
    return row ? parseAssetListRow(row) : null;
  },

  update: (id, updates) => {
    const fields = [];
    const values = [];

    if (updates.sessionTitle !== undefined) {
      fields.push('session_title = ?');
      values.push(updates.sessionTitle);
    }
    if (updates.assets !== undefined) {
      fields.push('assets_json = ?');
      values.push(JSON.stringify(updates.assets));
    }
    if (updates.slides !== undefined) {
      fields.push('slides_json = ?');
      values.push(updates.slides ? JSON.stringify(updates.slides) : null);
    }
    if (updates.careerCharacter !== undefined) {
      fields.push('career_character_json = ?');
      values.push(updates.careerCharacter ? JSON.stringify(updates.careerCharacter) : null);
    }
    if (updates.defaultVoiceId !== undefined) {
      fields.push('default_voice_id = ?');
      values.push(updates.defaultVoiceId);
    }
    if (updates.defaultVoiceName !== undefined) {
      fields.push('default_voice_name = ?');
      values.push(updates.defaultVoiceName);
    }

    if (fields.length === 0) return false;

    fields.push('imported_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const result = db.prepare(`UPDATE asset_lists SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return result.changes > 0;
  },

  delete: (id) => {
    const result = db.prepare('DELETE FROM asset_lists WHERE id = ?').run(id);
    return result.changes > 0;
  }
};

// Generated image operations
const generatedImageQueries = {
  create: (image) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO generated_images (id, asset_list_id, slide_number, asset_type, asset_number, cms_filename, original_prompt, modified_prompt, character_id, image_path, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      image.assetListId || null,
      image.slideNumber || null,
      image.assetType || null,
      image.assetNumber || 1,
      image.cmsFilename || null,
      image.originalPrompt || null,
      image.modifiedPrompt || null,
      image.characterId || null,
      image.imagePath || null,
      image.status || 'pending',
      now,
      now
    );
    return { id, ...image, assetNumber: image.assetNumber || 1, createdAt: now, updatedAt: now };
  },

  getById: (id) => {
    const row = db.prepare('SELECT * FROM generated_images WHERE id = ?').get(id);
    return row ? parseGeneratedImageRow(row) : null;
  },

  getByAssetList: (assetListId) => {
    const rows = db.prepare('SELECT * FROM generated_images WHERE asset_list_id = ? ORDER BY slide_number').all(assetListId);
    return rows.map(parseGeneratedImageRow);
  },

  getAll: (options = {}) => {
    let query = `
      SELECT gi.*, al.module_name, al.session_number
      FROM generated_images gi
      LEFT JOIN asset_lists al ON gi.asset_list_id = al.id
      WHERE 1=1
    `;
    const params = [];

    if (options.moduleName) {
      query += ' AND al.module_name = ?';
      params.push(options.moduleName);
    }

    if (options.sessionNumber) {
      query += ' AND al.session_number = ?';
      params.push(options.sessionNumber);
    }

    // Support single status (string) or multiple statuses (array)
    if (options.statuses && Array.isArray(options.statuses) && options.statuses.length > 0) {
      const placeholders = options.statuses.map(() => '?').join(', ');
      query += ` AND gi.status IN (${placeholders})`;
      params.push(...options.statuses);
    } else if (options.status) {
      query += ' AND gi.status = ?';
      params.push(options.status);
    }

    query += ' ORDER BY gi.created_at DESC';

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    if (options.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    return db.prepare(query).all(...params).map(row => ({
      ...parseGeneratedImageRow(row),
      moduleName: row.module_name,
      sessionNumber: row.session_number
    }));
  },

  update: (id, updates) => {
    const fields = [];
    const values = [];

    if (updates.modifiedPrompt !== undefined) {
      fields.push('modified_prompt = ?');
      values.push(updates.modifiedPrompt);
    }
    if (updates.imagePath !== undefined) {
      fields.push('image_path = ?');
      values.push(updates.imagePath);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.characterId !== undefined) {
      fields.push('character_id = ?');
      values.push(updates.characterId);
    }
    if (updates.assetType !== undefined) {
      fields.push('asset_type = ?');
      values.push(updates.assetType);
    }
    if (updates.cmsFilename !== undefined) {
      fields.push('cms_filename = ?');
      values.push(updates.cmsFilename);
    }

    if (fields.length === 0) return false;

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const result = db.prepare(`UPDATE generated_images SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return result.changes > 0;
  },

  delete: (id) => {
    const image = db.prepare('SELECT * FROM generated_images WHERE id = ?').get(id);
    if (!image) return null;
    db.prepare('DELETE FROM generated_images WHERE id = ?').run(id);
    return parseGeneratedImageRow(image);
  },

  deleteByIds: (ids) => {
    if (!ids || ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(', ');
    const result = db.prepare(`DELETE FROM generated_images WHERE id IN (${placeholders})`).run(...ids);
    return result.changes;
  }
};

// Generation history operations
const generationHistoryQueries = {
  create: (entry) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO generation_history (id, generated_image_id, prompt, image_path, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, entry.generatedImageId, entry.prompt, entry.imagePath, now);
    return { id, ...entry, createdAt: now };
  },

  getByImageId: (generatedImageId) => {
    return db.prepare('SELECT * FROM generation_history WHERE generated_image_id = ? ORDER BY created_at DESC').all(generatedImageId);
  }
};

// Motion graphics video operations (final videos for MG slides)
const motionGraphicsVideoQueries = {
  create: (video) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO motion_graphics_videos (id, asset_list_id, slide_number, cms_filename, video_path, status, scene_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      video.assetListId,
      video.slideNumber,
      video.cmsFilename || null,
      video.videoPath || null,
      video.status || 'pending',
      video.sceneCount || 0,
      now,
      now
    );
    return { id, ...video, createdAt: now, updatedAt: now };
  },

  getById: (id) => {
    const row = db.prepare('SELECT * FROM motion_graphics_videos WHERE id = ?').get(id);
    return row ? parseMGVideoRow(row) : null;
  },

  getByAssetList: (assetListId) => {
    const rows = db.prepare('SELECT * FROM motion_graphics_videos WHERE asset_list_id = ? ORDER BY slide_number').all(assetListId);
    return rows.map(parseMGVideoRow);
  },

  getByAssetListAndSlide: (assetListId, slideNumber) => {
    const row = db.prepare('SELECT * FROM motion_graphics_videos WHERE asset_list_id = ? AND slide_number = ?').get(assetListId, slideNumber);
    return row ? parseMGVideoRow(row) : null;
  },

  update: (id, updates) => {
    const fields = [];
    const values = [];

    if (updates.cmsFilename !== undefined) {
      fields.push('cms_filename = ?');
      values.push(updates.cmsFilename);
    }
    if (updates.videoPath !== undefined) {
      fields.push('video_path = ?');
      values.push(updates.videoPath);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.sceneCount !== undefined) {
      fields.push('scene_count = ?');
      values.push(updates.sceneCount);
    }

    if (fields.length === 0) return null;

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    db.prepare(`UPDATE motion_graphics_videos SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return motionGraphicsVideoQueries.getById(id);
  },

  delete: (id) => {
    const video = db.prepare('SELECT * FROM motion_graphics_videos WHERE id = ?').get(id);
    if (!video) return null;
    db.prepare('DELETE FROM motion_graphics_videos WHERE id = ?').run(id);
    return parseMGVideoRow(video);
  },

  deleteByAssetListAndSlide: (assetListId, slideNumber) => {
    const video = db.prepare('SELECT * FROM motion_graphics_videos WHERE asset_list_id = ? AND slide_number = ?')
      .get(assetListId, slideNumber);
    if (!video) return null;
    db.prepare('DELETE FROM motion_graphics_videos WHERE asset_list_id = ? AND slide_number = ?')
      .run(assetListId, slideNumber);
    return parseMGVideoRow(video);
  }
};

// Generated audio operations (TTS narration)
const generatedAudioQueries = {
  create: (audio) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO generated_audio (id, asset_list_id, slide_number, cms_filename, narration_text, voice_id, voice_name, audio_path, duration_ms, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      audio.assetListId,
      audio.slideNumber,
      audio.cmsFilename || null,
      audio.narrationText || null,
      audio.voiceId || null,
      audio.voiceName || null,
      audio.audioPath || null,
      audio.durationMs || null,
      audio.status || 'pending',
      now,
      now
    );
    return { id, ...audio, createdAt: now, updatedAt: now };
  },

  getById: (id) => {
    const row = db.prepare('SELECT * FROM generated_audio WHERE id = ?').get(id);
    return row ? parseGeneratedAudioRow(row) : null;
  },

  getByAssetList: (assetListId) => {
    const rows = db.prepare('SELECT * FROM generated_audio WHERE asset_list_id = ? ORDER BY slide_number').all(assetListId);
    return rows.map(parseGeneratedAudioRow);
  },

  getByAssetListAndSlide: (assetListId, slideNumber) => {
    const row = db.prepare('SELECT * FROM generated_audio WHERE asset_list_id = ? AND slide_number = ?').get(assetListId, slideNumber);
    return row ? parseGeneratedAudioRow(row) : null;
  },

  update: (id, updates) => {
    const fields = [];
    const values = [];

    if (updates.cmsFilename !== undefined) {
      fields.push('cms_filename = ?');
      values.push(updates.cmsFilename);
    }
    if (updates.narrationText !== undefined) {
      fields.push('narration_text = ?');
      values.push(updates.narrationText);
    }
    if (updates.voiceId !== undefined) {
      fields.push('voice_id = ?');
      values.push(updates.voiceId);
    }
    if (updates.voiceName !== undefined) {
      fields.push('voice_name = ?');
      values.push(updates.voiceName);
    }
    if (updates.audioPath !== undefined) {
      fields.push('audio_path = ?');
      values.push(updates.audioPath);
    }
    if (updates.durationMs !== undefined) {
      fields.push('duration_ms = ?');
      values.push(updates.durationMs);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }

    if (fields.length === 0) return null;

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    db.prepare(`UPDATE generated_audio SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return generatedAudioQueries.getById(id);
  },

  delete: (id) => {
    const audio = db.prepare('SELECT * FROM generated_audio WHERE id = ?').get(id);
    if (!audio) return null;
    db.prepare('DELETE FROM generated_audio WHERE id = ?').run(id);
    return parseGeneratedAudioRow(audio);
  },

  deleteByAssetList: (assetListId) => {
    const rows = db.prepare('SELECT * FROM generated_audio WHERE asset_list_id = ?').all(assetListId);
    db.prepare('DELETE FROM generated_audio WHERE asset_list_id = ?').run(assetListId);
    return rows.map(parseGeneratedAudioRow);
  },

  upsert: (audio) => {
    // Try to find existing record
    const existing = generatedAudioQueries.getByAssetListAndSlide(audio.assetListId, audio.slideNumber);
    if (existing) {
      // Update existing record
      return generatedAudioQueries.update(existing.id, audio);
    } else {
      // Create new record
      return generatedAudioQueries.create(audio);
    }
  }
};

// Parse helper functions
function parseCharacterRow(row) {
  return {
    id: row.id,
    moduleName: row.module_name,
    characterName: row.character_name,
    career: row.career,
    appearanceDescription: row.appearance_description,
    anchorImagePath: row.anchor_image_path,
    referenceImages: row.reference_images ? JSON.parse(row.reference_images) : [],
    appearsOnSlides: row.appears_on_slides ? JSON.parse(row.appears_on_slides) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseAssetListRow(row) {
  return {
    id: row.id,
    moduleName: row.module_name,
    sessionNumber: row.session_number,
    sessionTitle: row.session_title,
    assets: JSON.parse(row.assets_json),
    slides: row.slides_json ? JSON.parse(row.slides_json) : null,
    careerCharacter: row.career_character_json ? JSON.parse(row.career_character_json) : null,
    defaultVoiceId: row.default_voice_id || null,
    defaultVoiceName: row.default_voice_name || null,
    importedAt: row.imported_at
  };
}

function parseGeneratedImageRow(row) {
  return {
    id: row.id,
    assetListId: row.asset_list_id,
    slideNumber: row.slide_number,
    assetType: row.asset_type,
    assetNumber: row.asset_number || 1,
    cmsFilename: row.cms_filename,
    originalPrompt: row.original_prompt,
    modifiedPrompt: row.modified_prompt,
    characterId: row.character_id,
    imagePath: row.image_path,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

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

function parseMGVideoRow(row) {
  return {
    id: row.id,
    assetListId: row.asset_list_id,
    slideNumber: row.slide_number,
    cmsFilename: row.cms_filename,
    videoPath: row.video_path,
    status: row.status,
    sceneCount: row.scene_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseGeneratedAudioRow(row) {
  return {
    id: row.id,
    assetListId: row.asset_list_id,
    slideNumber: row.slide_number,
    cmsFilename: row.cms_filename,
    narrationText: row.narration_text,
    voiceId: row.voice_id,
    voiceName: row.voice_name,
    audioPath: row.audio_path,
    durationMs: row.duration_ms,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = {
  initDatabase,
  getDb,
  jobs: jobQueries,
  videos: videoQueries,
  folders: folderQueries,
  characters: characterQueries,
  assetLists: assetListQueries,
  generatedImages: generatedImageQueries,
  generationHistory: generationHistoryQueries,
  motionGraphicsVideos: motionGraphicsVideoQueries,
  generatedAudio: generatedAudioQueries
};
