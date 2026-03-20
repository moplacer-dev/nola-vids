const { supabase } = require('./supabase');
const { v4: uuidv4 } = require('uuid');

/**
 * Initialize database connection
 * With Supabase, there's no local DB to initialize - just verify connection
 */
async function initDatabase() {
  console.log('Initializing Supabase database connection...');

  // Verify connection by doing a simple query
  const { error } = await supabase.from('jobs').select('id').limit(1);

  if (error) {
    console.error('Failed to connect to Supabase:', error.message);
    console.error('Make sure SUPABASE_URL and SUPABASE_SERVICE_KEY are set correctly');
    throw error;
  }

  console.log('Supabase database connection established');
  return true;
}

// Helper: Convert snake_case DB row to camelCase object
function toCamelCase(row) {
  if (!row) return null;
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

// Helper: Convert camelCase object to snake_case for DB
function toSnakeCase(obj) {
  if (!obj) return null;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    result[snakeKey] = value;
  }
  return result;
}

// ==========================================
// Job Operations
// ==========================================
const jobQueries = {
  async create(job) {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('jobs')
      .insert({
        id: job.id,
        type: job.type,
        params: job.params,
        status: job.status,
        operation_data: job.operationData || null,
        operation_name: job.operationName || null,
        error: job.error || null,
        created_at: job.createdAt || now,
        updated_at: job.updatedAt || now
      })
      .select()
      .single();

    if (error) throw error;
    return parseJobRow(data);
  },

  async update(job) {
    const { data, error } = await supabase
      .from('jobs')
      .update({
        status: job.status,
        operation_data: job.operationData || null,
        operation_name: job.operationName || null,
        error: job.error || null,
        updated_at: job.updatedAt || new Date().toISOString()
      })
      .eq('id', job.id)
      .select()
      .single();

    if (error) throw error;
    return parseJobRow(data);
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseJobRow(data) : null;
  },

  async getAll() {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data.map(parseJobRow);
  },

  async getByStatus(status) {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data.map(parseJobRow);
  },

  async delete(id) {
    const { data, error } = await supabase
      .from('jobs')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  }
};

// ==========================================
// Video Operations
// ==========================================
const videoQueries = {
  async create(video) {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('videos')
      .insert({
        id: video.id,
        job_id: video.jobId,
        filename: video.filename,
        path: video.path,
        mime_type: video.mimeType || null,
        title: video.title || null,
        folder: video.folder || null,
        source_uri: video.sourceUri || null,
        module_name: video.moduleName || null,
        created_at: video.createdAt || now
      })
      .select()
      .single();

    if (error) throw error;
    return parseVideoRow(data);
  },

  async getByJobId(jobId) {
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at');

    if (error) throw error;
    return data.map(parseVideoRow);
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseVideoRow(data) : null;
  },

  async getByPath(path) {
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .eq('path', path)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseVideoRow(data) : null;
  },

  async getAll(options = {}) {
    let query = supabase
      .from('videos')
      .select(`
        *,
        jobs!inner(params, type, status)
      `)
      .eq('jobs.status', 'completed');

    if (options.folder) {
      query = query.eq('folder', options.folder);
    }

    if (options.search) {
      query = query.or(`title.ilike.%${options.search}%,jobs.params.ilike.%${options.search}%`);
    }

    query = query.order('created_at', { ascending: false });

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 100) - 1);
    }

    const { data, error } = await query;

    if (error) throw error;

    return data.map(row => ({
      ...parseVideoRow(row),
      params: row.jobs?.params || null,
      jobType: row.jobs?.type || null
    }));
  },

  async update(id, updates) {
    const updateData = {};
    if (updates.title !== undefined) updateData.title = updates.title;
    if (updates.folder !== undefined) updateData.folder = updates.folder;
    if (updates.moduleName !== undefined) updateData.module_name = updates.moduleName;

    if (Object.keys(updateData).length === 0) return false;

    const { data, error } = await supabase
      .from('videos')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  },

  async delete(id) {
    const { data, error } = await supabase
      .from('videos')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseVideoRow(data) : null;
  },

  async deleteByJobId(jobId) {
    const { data, error } = await supabase
      .from('videos')
      .delete()
      .eq('job_id', jobId)
      .select();

    if (error) throw error;
    return data.map(parseVideoRow);
  },

  async getAllWithJobIds(jobIds) {
    if (!jobIds || jobIds.length === 0) return [];

    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .in('job_id', jobIds)
      .order('created_at');

    if (error) throw error;
    return data.map(parseVideoRow);
  }
};

// ==========================================
// Folder Operations
// ==========================================
const folderQueries = {
  async create(name) {
    const id = uuidv4();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('folders')
      .insert({
        id,
        name,
        created_at: now
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return null; // Unique constraint violation - folder exists
      }
      throw error;
    }

    return { id: data.id, name: data.name, createdAt: data.created_at };
  },

  async getAll() {
    // Use Supabase join with embedded count to get folders with video counts in a single query
    const { data: folders, error } = await supabase
      .from('folders')
      .select(`
        *,
        videos!videos_folder_fkey(count)
      `)
      .order('name');

    if (error) {
      // Fallback if foreign key doesn't exist - use separate count query
      const { data: foldersOnly, error: folderError } = await supabase
        .from('folders')
        .select('*')
        .order('name');

      if (folderError) throw folderError;

      // Use RPC or aggregate query for counts
      const { data: counts, error: countError } = await supabase
        .from('videos')
        .select('folder')
        .not('folder', 'is', null);

      if (countError) throw countError;

      const countMap = {};
      counts.forEach(v => {
        countMap[v.folder] = (countMap[v.folder] || 0) + 1;
      });

      return foldersOnly.map(f => ({
        id: f.id,
        name: f.name,
        createdAt: f.created_at,
        videoCount: countMap[f.name] || 0
      }));
    }

    return folders.map(f => ({
      id: f.id,
      name: f.name,
      createdAt: f.created_at,
      videoCount: f.videos?.[0]?.count || 0
    }));
  },

  async delete(id) {
    // First get the folder name
    const { data: folder, error: getError } = await supabase
      .from('folders')
      .select('name')
      .eq('id', id)
      .single();

    if (getError && getError.code !== 'PGRST116') throw getError;
    if (!folder) return false;

    // Unset folder for all videos in this folder
    await supabase
      .from('videos')
      .update({ folder: null })
      .eq('folder', folder.name);

    // Delete the folder
    const { data, error } = await supabase
      .from('folders')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  }
};

// ==========================================
// Character Operations
// ==========================================
const characterQueries = {
  async create(character) {
    const id = uuidv4();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('characters')
      .insert({
        id,
        module_name: character.moduleName,
        character_name: character.characterName,
        career: character.career || null,
        appearance_description: character.appearanceDescription || null,
        anchor_image_path: character.anchorImagePath || null,
        reference_images: character.referenceImages || [],
        appears_on_slides: character.appearsOnSlides || [],
        created_at: now,
        updated_at: now
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return null; // Unique constraint violation
      }
      throw error;
    }

    return parseCharacterRow(data);
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('characters')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseCharacterRow(data) : null;
  },

  async getByModule(moduleName) {
    const { data, error } = await supabase
      .from('characters')
      .select('*')
      .eq('module_name', moduleName)
      .order('character_name');

    if (error) throw error;
    return data.map(parseCharacterRow);
  },

  async getByModuleAndName(moduleName, characterName) {
    const { data, error } = await supabase
      .from('characters')
      .select('*')
      .eq('module_name', moduleName)
      .eq('character_name', characterName)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseCharacterRow(data) : null;
  },

  async update(id, updates) {
    const updateData = { updated_at: new Date().toISOString() };

    if (updates.career !== undefined) updateData.career = updates.career;
    if (updates.appearanceDescription !== undefined) updateData.appearance_description = updates.appearanceDescription;
    if (updates.anchorImagePath !== undefined) updateData.anchor_image_path = updates.anchorImagePath;
    if (updates.referenceImages !== undefined) updateData.reference_images = updates.referenceImages;
    if (updates.appearsOnSlides !== undefined) updateData.appears_on_slides = updates.appearsOnSlides;

    const { data, error } = await supabase
      .from('characters')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  },

  async setAnchorImage(id, imagePath) {
    const { data, error } = await supabase
      .from('characters')
      .update({
        anchor_image_path: imagePath,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  },

  async delete(id) {
    const { data, error } = await supabase
      .from('characters')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  }
};

// ==========================================
// Asset List Operations
// ==========================================
const assetListQueries = {
  async create(assetList) {
    const id = uuidv4();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('asset_lists')
      .insert({
        id,
        module_name: assetList.moduleName,
        session_number: assetList.sessionNumber || null,
        session_type: assetList.sessionType || 'regular',
        session_title: assetList.sessionTitle || null,
        assets_json: assetList.assets,
        slides_json: assetList.slides || null,
        career_character_json: assetList.careerCharacter || null,
        imported_at: now
      })
      .select()
      .single();

    if (error) throw error;
    return parseAssetListRow(data);
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('asset_lists')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseAssetListRow(data) : null;
  },

  async getAll() {
    const { data, error } = await supabase
      .from('asset_lists')
      .select('*')
      .order('imported_at', { ascending: false });

    if (error) throw error;
    return data.map(parseAssetListRow);
  },

  async getByModule(moduleName) {
    const { data, error } = await supabase
      .from('asset_lists')
      .select('*')
      .eq('module_name', moduleName)
      .order('session_number')
      .order('imported_at', { ascending: false });

    if (error) throw error;
    return data.map(parseAssetListRow);
  },

  async getByModuleAndSession(moduleName, sessionNumber) {
    const { data, error } = await supabase
      .from('asset_lists')
      .select('*')
      .eq('module_name', moduleName)
      .eq('session_number', sessionNumber)
      .order('imported_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseAssetListRow(data) : null;
  },

  async getByModuleSessionAndType(moduleName, sessionNumber, sessionType) {
    const { data, error } = await supabase
      .from('asset_lists')
      .select('*')
      .eq('module_name', moduleName)
      .eq('session_number', sessionNumber)
      .eq('session_type', sessionType || 'regular')
      .order('imported_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseAssetListRow(data) : null;
  },

  async update(id, updates) {
    const updateData = { imported_at: new Date().toISOString() };

    if (updates.sessionTitle !== undefined) updateData.session_title = updates.sessionTitle;
    if (updates.assets !== undefined) updateData.assets_json = updates.assets;
    if (updates.slides !== undefined) updateData.slides_json = updates.slides;
    if (updates.careerCharacter !== undefined) updateData.career_character_json = updates.careerCharacter;
    if (updates.defaultVoiceId !== undefined) updateData.default_voice_id = updates.defaultVoiceId;
    if (updates.defaultVoiceName !== undefined) updateData.default_voice_name = updates.defaultVoiceName;
    if (updates.cmsPageMapping !== undefined) updateData.cms_page_mapping = updates.cmsPageMapping;

    const { data, error } = await supabase
      .from('asset_lists')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  },

  async updateCmsPageMapping(id, pageMapping) {
    const { data, error } = await supabase
      .from('asset_lists')
      .update({
        cms_page_mapping: pageMapping,
        imported_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  },

  async addSlide(id, slideData) {
    // Get current asset list
    const { data: assetList, error: getError } = await supabase
      .from('asset_lists')
      .select('slides_json, cms_page_mapping')
      .eq('id', id)
      .single();

    if (getError) throw getError;
    if (!assetList) throw new Error('Asset list not found');

    // Add new slide to slides_json
    const slides = assetList.slides_json || [];
    const newSlide = {
      slideNumber: slideData.slideNumber,
      slideTitle: slideData.title,
      slideType: slideData.slideType || 'Text & Image',
      narrationText: slideData.narrationText || ''
    };

    // Insert in correct position based on slideNumber
    const insertIndex = slides.findIndex(s => (s.slideNumber ?? s.slide_number) > slideData.slideNumber);
    if (insertIndex === -1) {
      slides.push(newSlide);
    } else {
      slides.splice(insertIndex, 0, newSlide);
    }

    // Update CMS page mapping if pageId provided
    const cmsPageMapping = assetList.cms_page_mapping || {};
    if (slideData.cmsPageId) {
      cmsPageMapping[String(slideData.slideNumber)] = slideData.cmsPageId;
    }

    const { data, error } = await supabase
      .from('asset_lists')
      .update({
        slides_json: slides,
        cms_page_mapping: cmsPageMapping,
        imported_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return parseAssetListRow(data);
  },

  async removeSlide(id, slideNumber) {
    // Get current asset list
    const { data: assetList, error: getError } = await supabase
      .from('asset_lists')
      .select('slides_json, cms_page_mapping')
      .eq('id', id)
      .single();

    if (getError) throw getError;
    if (!assetList) throw new Error('Asset list not found');

    // Remove slide from slides_json
    const slides = (assetList.slides_json || []).filter(
      s => (s.slideNumber ?? s.slide_number) !== slideNumber
    );

    // Remove from CMS page mapping
    const cmsPageMapping = assetList.cms_page_mapping || {};
    delete cmsPageMapping[String(slideNumber)];

    const { data, error } = await supabase
      .from('asset_lists')
      .update({
        slides_json: slides,
        cms_page_mapping: cmsPageMapping,
        imported_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return parseAssetListRow(data);
  },

  async delete(id) {
    const { data, error } = await supabase
      .from('asset_lists')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  }
};

// ==========================================
// Generated Image Operations
// ==========================================
const generatedImageQueries = {
  async create(image) {
    const id = uuidv4();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('generated_images')
      .insert({
        id,
        asset_list_id: image.assetListId || null,
        assessment_asset_id: image.assessmentAssetId || null,
        slide_number: image.slideNumber || null,
        asset_type: image.assetType || null,
        asset_number: image.assetNumber || 1,
        cms_filename: image.cmsFilename || null,
        original_prompt: image.originalPrompt || null,
        modified_prompt: image.modifiedPrompt || null,
        character_id: image.characterId || null,
        image_path: image.imagePath || null,
        status: image.status || 'pending',
        created_at: now,
        updated_at: now
      })
      .select()
      .single();

    if (error) throw error;
    return parseGeneratedImageRow(data);
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('generated_images')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseGeneratedImageRow(data) : null;
  },

  async getByAssetList(assetListId) {
    const { data, error } = await supabase
      .from('generated_images')
      .select('*')
      .eq('asset_list_id', assetListId)
      .order('slide_number');

    if (error) throw error;
    return data.map(parseGeneratedImageRow);
  },

  async getAll(options = {}) {
    let query = supabase
      .from('generated_images')
      .select(`
        *,
        asset_lists(module_name, session_number)
      `);

    // Filter for standalone images (no asset list) or Carl Gen images (has asset list)
    if (options.source === 'standalone') {
      query = query.is('asset_list_id', null);
    } else if (options.source === 'carl-gen') {
      query = query.not('asset_list_id', 'is', null);
    }

    if (options.moduleName) {
      query = query.eq('asset_lists.module_name', options.moduleName);
    }

    if (options.sessionNumber) {
      query = query.eq('asset_lists.session_number', options.sessionNumber);
    }

    if (options.statuses && Array.isArray(options.statuses) && options.statuses.length > 0) {
      query = query.in('status', options.statuses);
    } else if (options.status) {
      query = query.eq('status', options.status);
    }

    query = query.order('created_at', { ascending: false });

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 100) - 1);
    }

    const { data, error } = await query;

    if (error) throw error;

    return data.map(row => ({
      ...parseGeneratedImageRow(row),
      moduleName: row.asset_lists?.module_name,
      sessionNumber: row.asset_lists?.session_number
    }));
  },

  async update(id, updates) {
    const updateData = { updated_at: new Date().toISOString() };

    if (updates.modifiedPrompt !== undefined) updateData.modified_prompt = updates.modifiedPrompt;
    if (updates.imagePath !== undefined) updateData.image_path = updates.imagePath;
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.characterId !== undefined) updateData.character_id = updates.characterId;
    if (updates.assetType !== undefined) updateData.asset_type = updates.assetType;
    if (updates.cmsFilename !== undefined) updateData.cms_filename = updates.cmsFilename;
    if (updates.originalPrompt !== undefined) updateData.original_prompt = updates.originalPrompt;
    if (updates.assessmentAssetId !== undefined) updateData.assessment_asset_id = updates.assessmentAssetId;
    // CMS push tracking fields
    if (updates.cmsFileId !== undefined) updateData.cms_file_id = updates.cmsFileId;
    if (updates.cmsPushStatus !== undefined) updateData.cms_push_status = updates.cmsPushStatus;
    if (updates.cmsPushedAt !== undefined) updateData.cms_pushed_at = updates.cmsPushedAt;

    const { data, error } = await supabase
      .from('generated_images')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  },

  async delete(id) {
    const { data, error } = await supabase
      .from('generated_images')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseGeneratedImageRow(data) : null;
  },

  async deleteByIds(ids) {
    if (!ids || ids.length === 0) return 0;

    const { data, error } = await supabase
      .from('generated_images')
      .delete()
      .in('id', ids)
      .select();

    if (error) throw error;
    return data?.length || 0;
  },

  async getByAssessmentAsset(assessmentAssetId) {
    const { data, error } = await supabase
      .from('generated_images')
      .select('*')
      .eq('assessment_asset_id', assessmentAssetId)
      .order('slide_number');

    if (error) throw error;
    return data.map(parseGeneratedImageRow);
  },

  async deleteByAssessmentAsset(assessmentAssetId) {
    const { data, error } = await supabase
      .from('generated_images')
      .delete()
      .eq('assessment_asset_id', assessmentAssetId)
      .select();

    if (error) throw error;
    return data.map(parseGeneratedImageRow);
  },

  // Batch create multiple images at once
  async createBulk(images) {
    if (!images || images.length === 0) return [];
    const now = new Date().toISOString();

    const records = images.map(image => ({
      id: uuidv4(),
      asset_list_id: image.assetListId || null,
      assessment_asset_id: image.assessmentAssetId || null,
      slide_number: image.slideNumber || null,
      asset_type: image.assetType || null,
      asset_number: image.assetNumber || 1,
      cms_filename: image.cmsFilename || null,
      original_prompt: image.originalPrompt || null,
      modified_prompt: image.modifiedPrompt || null,
      character_id: image.characterId || null,
      image_path: image.imagePath || null,
      status: image.status || 'pending',
      created_at: now,
      updated_at: now
    }));

    const { data, error } = await supabase
      .from('generated_images')
      .insert(records)
      .select();

    if (error) throw error;
    return data.map(parseGeneratedImageRow);
  },

  async deleteByAssetListAndSlide(assetListId, slideNumber) {
    const { data, error } = await supabase
      .from('generated_images')
      .delete()
      .eq('asset_list_id', assetListId)
      .eq('slide_number', slideNumber)
      .select();

    if (error) throw error;
    return data.map(parseGeneratedImageRow);
  },

  // Batch update multiple images by ID
  // Takes an array of { id, updates } objects
  async updateBulk(updates) {
    if (!updates || updates.length === 0) return [];
    const now = new Date().toISOString();

    // Supabase doesn't support batch updates natively, so we use Promise.all
    // but we can at least run them in parallel
    const results = await Promise.all(
      updates.map(async ({ id, ...updateFields }) => {
        const updateData = { updated_at: now };

        if (updateFields.modifiedPrompt !== undefined) updateData.modified_prompt = updateFields.modifiedPrompt;
        if (updateFields.imagePath !== undefined) updateData.image_path = updateFields.imagePath;
        if (updateFields.status !== undefined) updateData.status = updateFields.status;
        if (updateFields.characterId !== undefined) updateData.character_id = updateFields.characterId;
        if (updateFields.assetType !== undefined) updateData.asset_type = updateFields.assetType;
        if (updateFields.cmsFilename !== undefined) updateData.cms_filename = updateFields.cmsFilename;
        if (updateFields.originalPrompt !== undefined) updateData.original_prompt = updateFields.originalPrompt;

        const { data, error } = await supabase
          .from('generated_images')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();

        if (error && error.code !== 'PGRST116') throw error;
        return data ? parseGeneratedImageRow(data) : null;
      })
    );

    return results.filter(Boolean);
  }
};

// ==========================================
// Generation History Operations
// ==========================================
const generationHistoryQueries = {
  async create(entry) {
    const id = uuidv4();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('generation_history')
      .insert({
        id,
        generated_image_id: entry.generatedImageId,
        prompt: entry.prompt,
        image_path: entry.imagePath,
        created_at: now
      })
      .select()
      .single();

    if (error) throw error;
    return {
      id: data.id,
      generatedImageId: data.generated_image_id,
      prompt: data.prompt,
      imagePath: data.image_path,
      createdAt: data.created_at
    };
  },

  async getByImageId(generatedImageId) {
    const { data, error } = await supabase
      .from('generation_history')
      .select('*')
      .eq('generated_image_id', generatedImageId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data.map(row => ({
      id: row.id,
      generatedImageId: row.generated_image_id,
      prompt: row.prompt,
      imagePath: row.image_path,
      createdAt: row.created_at
    }));
  }
};

// ==========================================
// Motion Graphics Video Operations
// ==========================================
const motionGraphicsVideoQueries = {
  async create(video) {
    const id = uuidv4();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('motion_graphics_videos')
      .insert({
        id,
        asset_list_id: video.assetListId,
        slide_number: video.slideNumber,
        cms_filename: video.cmsFilename || null,
        video_path: video.videoPath || null,
        status: video.status || 'pending',
        scene_count: video.sceneCount || 0,
        created_at: now,
        updated_at: now
      })
      .select()
      .single();

    if (error) throw error;
    return parseMGVideoRow(data);
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('motion_graphics_videos')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseMGVideoRow(data) : null;
  },

  async getByAssetList(assetListId) {
    const { data, error } = await supabase
      .from('motion_graphics_videos')
      .select('*')
      .eq('asset_list_id', assetListId)
      .order('slide_number');

    if (error) throw error;
    return data.map(parseMGVideoRow);
  },

  async getByAssetListAndSlide(assetListId, slideNumber) {
    const { data, error } = await supabase
      .from('motion_graphics_videos')
      .select('*')
      .eq('asset_list_id', assetListId)
      .eq('slide_number', slideNumber)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseMGVideoRow(data) : null;
  },

  async update(id, updates) {
    const updateData = { updated_at: new Date().toISOString() };

    if (updates.cmsFilename !== undefined) updateData.cms_filename = updates.cmsFilename;
    if (updates.videoPath !== undefined) updateData.video_path = updates.videoPath;
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.sceneCount !== undefined) updateData.scene_count = updates.sceneCount;
    // CMS push tracking fields
    if (updates.cmsFileId !== undefined) updateData.cms_file_id = updates.cmsFileId;
    if (updates.cmsPushStatus !== undefined) updateData.cms_push_status = updates.cmsPushStatus;
    if (updates.cmsPushedAt !== undefined) updateData.cms_pushed_at = updates.cmsPushedAt;

    const { data, error } = await supabase
      .from('motion_graphics_videos')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data ? parseMGVideoRow(data) : null;
  },

  async delete(id) {
    const { data, error } = await supabase
      .from('motion_graphics_videos')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseMGVideoRow(data) : null;
  },

  async deleteByAssetListAndSlide(assetListId, slideNumber) {
    const { data, error } = await supabase
      .from('motion_graphics_videos')
      .delete()
      .eq('asset_list_id', assetListId)
      .eq('slide_number', slideNumber)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseMGVideoRow(data) : null;
  }
};

// ==========================================
// Generated Audio Operations
// ==========================================
const generatedAudioQueries = {
  async create(audio) {
    const id = uuidv4();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('generated_audio')
      .insert({
        id,
        asset_list_id: audio.assetListId || null,
        assessment_asset_id: audio.assessmentAssetId || null,
        slide_number: audio.slideNumber || null,
        question_number: audio.questionNumber || null,
        narration_type: audio.narrationType || 'slide_narration',
        cms_filename: audio.cmsFilename || null,
        narration_text: audio.narrationText || null,
        voice_id: audio.voiceId || null,
        voice_name: audio.voiceName || null,
        audio_path: audio.audioPath || null,
        duration_ms: audio.durationMs || null,
        status: audio.status || 'pending',
        created_at: now,
        updated_at: now
      })
      .select()
      .single();

    if (error) throw error;
    return parseGeneratedAudioRow(data);
  },

  async createBulk(audioRecords) {
    const now = new Date().toISOString();
    const records = audioRecords.map(audio => ({
      id: uuidv4(),
      asset_list_id: audio.assetListId || null,
      assessment_asset_id: audio.assessmentAssetId || null,
      slide_number: audio.slideNumber || null,
      question_number: audio.questionNumber || null,
      narration_type: audio.narrationType || 'slide_narration',
      cms_filename: audio.cmsFilename || null,
      narration_text: audio.narrationText || null,
      voice_id: audio.voiceId || null,
      voice_name: audio.voiceName || null,
      audio_path: audio.audioPath || null,
      duration_ms: audio.durationMs || null,
      status: audio.status || 'pending',
      created_at: now,
      updated_at: now
    }));

    const { data, error } = await supabase
      .from('generated_audio')
      .insert(records)
      .select();

    if (error) throw error;
    return data.map(parseGeneratedAudioRow);
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('generated_audio')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseGeneratedAudioRow(data) : null;
  },

  async getByAssetList(assetListId) {
    const { data, error } = await supabase
      .from('generated_audio')
      .select('*')
      .eq('asset_list_id', assetListId)
      .order('slide_number');

    if (error) throw error;
    return data.map(parseGeneratedAudioRow);
  },

  async getByAssetListAndSlide(assetListId, slideNumber) {
    // For backward compatibility, return single record for slides with one audio
    // For multi-part slides, use getByAssetListSlideAndType
    const { data, error } = await supabase
      .from('generated_audio')
      .select('*')
      .eq('asset_list_id', assetListId)
      .eq('slide_number', slideNumber)
      .order('narration_type');

    if (error && error.code !== 'PGRST116') throw error;

    // Return first record for backward compatibility (slide_narration type)
    const slideNarration = data?.find(d => d.narration_type === 'slide_narration' || !d.narration_type);
    return slideNarration ? parseGeneratedAudioRow(slideNarration) : (data?.[0] ? parseGeneratedAudioRow(data[0]) : null);
  },

  async getAllByAssetListAndSlide(assetListId, slideNumber) {
    const { data, error } = await supabase
      .from('generated_audio')
      .select('*')
      .eq('asset_list_id', assetListId)
      .eq('slide_number', slideNumber)
      .order('narration_type');

    if (error) throw error;
    return data.map(parseGeneratedAudioRow);
  },

  async getByAssetListSlideAndType(assetListId, slideNumber, narrationType) {
    const { data, error } = await supabase
      .from('generated_audio')
      .select('*')
      .eq('asset_list_id', assetListId)
      .eq('slide_number', slideNumber)
      .eq('narration_type', narrationType)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseGeneratedAudioRow(data) : null;
  },

  async getByAssessmentAsset(assessmentAssetId) {
    const { data, error } = await supabase
      .from('generated_audio')
      .select('*')
      .eq('assessment_asset_id', assessmentAssetId)
      .order('question_number')
      .order('narration_type');

    if (error) throw error;
    return data.map(parseGeneratedAudioRow);
  },

  async getByAssessmentQuestion(assessmentAssetId, questionNumber) {
    const { data, error } = await supabase
      .from('generated_audio')
      .select('*')
      .eq('assessment_asset_id', assessmentAssetId)
      .eq('question_number', questionNumber)
      .order('narration_type');

    if (error) throw error;
    return data.map(parseGeneratedAudioRow);
  },

  async deleteByAssessmentAsset(assessmentAssetId) {
    const { data, error } = await supabase
      .from('generated_audio')
      .delete()
      .eq('assessment_asset_id', assessmentAssetId)
      .select();

    if (error) throw error;
    return data.map(parseGeneratedAudioRow);
  },

  async update(id, updates) {
    const updateData = { updated_at: new Date().toISOString() };

    if (updates.cmsFilename !== undefined) updateData.cms_filename = updates.cmsFilename;
    if (updates.narrationText !== undefined) updateData.narration_text = updates.narrationText;
    if (updates.voiceId !== undefined) updateData.voice_id = updates.voiceId;
    if (updates.voiceName !== undefined) updateData.voice_name = updates.voiceName;
    if (updates.audioPath !== undefined) updateData.audio_path = updates.audioPath;
    if (updates.durationMs !== undefined) updateData.duration_ms = updates.durationMs;
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.narrationType !== undefined) updateData.narration_type = updates.narrationType;
    if (updates.questionNumber !== undefined) updateData.question_number = updates.questionNumber;
    if (updates.assessmentAssetId !== undefined) updateData.assessment_asset_id = updates.assessmentAssetId;
    // CMS push tracking fields
    if (updates.cmsFileId !== undefined) updateData.cms_file_id = updates.cmsFileId;
    if (updates.cmsPushStatus !== undefined) updateData.cms_push_status = updates.cmsPushStatus;
    if (updates.cmsPushedAt !== undefined) updateData.cms_pushed_at = updates.cmsPushedAt;

    const { data, error } = await supabase
      .from('generated_audio')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data ? parseGeneratedAudioRow(data) : null;
  },

  async delete(id) {
    const { data, error } = await supabase
      .from('generated_audio')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseGeneratedAudioRow(data) : null;
  },

  async deleteByAssetList(assetListId) {
    const { data, error } = await supabase
      .from('generated_audio')
      .delete()
      .eq('asset_list_id', assetListId)
      .select();

    if (error) throw error;
    return data.map(parseGeneratedAudioRow);
  },

  async deleteByAssetListAndSlide(assetListId, slideNumber) {
    const { data, error } = await supabase
      .from('generated_audio')
      .delete()
      .eq('asset_list_id', assetListId)
      .eq('slide_number', slideNumber)
      .select();

    if (error) throw error;
    return data.map(parseGeneratedAudioRow);
  },

  async upsert(audio) {
    const existing = await this.getByAssetListAndSlide(audio.assetListId, audio.slideNumber);
    if (existing) {
      return this.update(existing.id, audio);
    } else {
      return this.create(audio);
    }
  },

  // Batch upsert: takes existing records map and new records to process
  // existingBySlide: Map of slideNumber -> existing audio record
  // newRecords: array of { slideNumber, narrationText, assetListId, ... }
  // Returns { created: number, updated: number }
  async upsertBulk(assetListId, existingBySlide, newRecords) {
    const toCreate = [];
    const toUpdate = [];

    for (const record of newRecords) {
      const existing = existingBySlide.get(record.slideNumber);
      if (existing) {
        // Only update if narration text changed
        if (existing.narrationText !== record.narrationText) {
          toUpdate.push({ id: existing.id, narrationText: record.narrationText });
        }
      } else {
        toCreate.push({
          assetListId,
          slideNumber: record.slideNumber,
          narrationText: record.narrationText,
          cmsFilename: record.cmsFilename,
          status: 'pending'
        });
      }
    }

    // Batch create new records
    if (toCreate.length > 0) {
      await this.createBulk(toCreate);
    }

    // Batch update existing records (run in parallel)
    if (toUpdate.length > 0) {
      const now = new Date().toISOString();
      await Promise.all(
        toUpdate.map(({ id, narrationText }) =>
          supabase
            .from('generated_audio')
            .update({ narration_text: narrationText, updated_at: now })
            .eq('id', id)
        )
      );
    }

    return { created: toCreate.length, updated: toUpdate.length };
  },

  // Upsert with compound key support (keys by slideNumber-narrationType)
  // existingByKey: Map keyed by "slideNumber-narrationType"
  // newRecords: array of { slideNumber, narrationType, narrationText, cmsFilename }
  async upsertBulkRcp(assetListId, existingByKey, newRecords, isRcp = false) {
    const toCreate = [];
    const toUpdate = [];

    for (const record of newRecords) {
      // Always use compound key to support both RCP and regular sessions with structuredNarration
      const key = `${record.slideNumber}-${record.narrationType}`;
      const existing = existingByKey.get(key);

      if (existing) {
        // Only update if narration text changed
        if (existing.narrationText !== record.narrationText) {
          toUpdate.push({ id: existing.id, narrationText: record.narrationText });
        }
      } else {
        toCreate.push({
          assetListId,
          slideNumber: record.slideNumber,
          narrationType: record.narrationType || 'slide_narration',
          narrationText: record.narrationText,
          cmsFilename: record.cmsFilename,
          status: 'pending'
        });
      }
    }

    // Batch create new records
    if (toCreate.length > 0) {
      await this.createBulk(toCreate);
    }

    // Batch update existing records (run in parallel)
    if (toUpdate.length > 0) {
      const now = new Date().toISOString();
      await Promise.all(
        toUpdate.map(({ id, narrationText }) =>
          supabase
            .from('generated_audio')
            .update({ narration_text: narrationText, updated_at: now })
            .eq('id', id)
        )
      );
    }

    return { created: toCreate.length, updated: toUpdate.length };
  }
};

// ==========================================
// Assessment Asset Operations
// ==========================================
const assessmentAssetQueries = {
  async create(assessment) {
    const id = uuidv4();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('assessment_assets')
      .insert({
        id,
        module_name: assessment.moduleName,
        assessment_type: assessment.assessmentType,
        subject: assessment.subject,
        grade_level: assessment.gradeLevel,
        questions_json: assessment.questions || [],
        asset_summary_json: assessment.assetSummary || {},
        created_at: now,
        updated_at: now
      })
      .select()
      .single();

    if (error) throw error;
    return parseAssessmentAssetRow(data);
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('assessment_assets')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseAssessmentAssetRow(data) : null;
  },

  async getAll() {
    const { data, error } = await supabase
      .from('assessment_assets')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data.map(parseAssessmentAssetRow);
  },

  async getByModule(moduleName) {
    const { data, error } = await supabase
      .from('assessment_assets')
      .select('*')
      .eq('module_name', moduleName)
      .order('assessment_type');

    if (error) throw error;
    return data.map(parseAssessmentAssetRow);
  },

  async getByModuleAndType(moduleName, assessmentType) {
    const { data, error } = await supabase
      .from('assessment_assets')
      .select('*')
      .eq('module_name', moduleName)
      .eq('assessment_type', assessmentType)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? parseAssessmentAssetRow(data) : null;
  },

  async update(id, updates) {
    const updateData = { updated_at: new Date().toISOString() };

    if (updates.subject !== undefined) updateData.subject = updates.subject;
    if (updates.gradeLevel !== undefined) updateData.grade_level = updates.gradeLevel;
    if (updates.questions !== undefined) updateData.questions_json = updates.questions;
    if (updates.assetSummary !== undefined) updateData.asset_summary_json = updates.assetSummary;
    if (updates.defaultVoiceId !== undefined) updateData.default_voice_id = updates.defaultVoiceId;
    if (updates.defaultVoiceName !== undefined) updateData.default_voice_name = updates.defaultVoiceName;
    if (updates.cmsPageMapping !== undefined) updateData.cms_page_mapping = updates.cmsPageMapping;

    const { data, error } = await supabase
      .from('assessment_assets')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data ? parseAssessmentAssetRow(data) : null;
  },

  async updateCmsPageMapping(id, pageMapping) {
    const { data, error } = await supabase
      .from('assessment_assets')
      .update({
        cms_page_mapping: pageMapping,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  },

  async delete(id) {
    const { data, error } = await supabase
      .from('assessment_assets')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  }
};

// ==========================================
// Parse Helper Functions
// ==========================================
function parseJobRow(row) {
  return {
    id: row.id,
    type: row.type,
    params: row.params,
    status: row.status,
    operationData: row.operation_data,
    operationName: row.operation_name,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseVideoRow(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    filename: row.filename,
    path: row.path,
    mimeType: row.mime_type,
    title: row.title,
    folder: row.folder,
    sourceUri: row.source_uri,
    moduleName: row.module_name,
    createdAt: row.created_at
  };
}

function parseCharacterRow(row) {
  return {
    id: row.id,
    moduleName: row.module_name,
    characterName: row.character_name,
    career: row.career,
    appearanceDescription: row.appearance_description,
    anchorImagePath: row.anchor_image_path,
    referenceImages: row.reference_images || [],
    appearsOnSlides: row.appears_on_slides || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseAssetListRow(row) {
  return {
    id: row.id,
    moduleName: row.module_name,
    sessionNumber: row.session_number,
    sessionType: row.session_type || 'regular',
    sessionTitle: row.session_title,
    assets: row.assets_json,
    slides: row.slides_json,
    careerCharacter: row.career_character_json,
    defaultVoiceId: row.default_voice_id,
    defaultVoiceName: row.default_voice_name,
    cmsPageMapping: row.cms_page_mapping || {},
    importedAt: row.imported_at
  };
}

function parseGeneratedImageRow(row) {
  return {
    id: row.id,
    assetListId: row.asset_list_id,
    assessmentAssetId: row.assessment_asset_id,
    slideNumber: row.slide_number,
    assetType: row.asset_type,
    assetNumber: row.asset_number || 1,
    cmsFilename: row.cms_filename,
    originalPrompt: row.original_prompt,
    modifiedPrompt: row.modified_prompt,
    characterId: row.character_id,
    imagePath: row.image_path,
    status: row.status,
    cmsFileId: row.cms_file_id,
    cmsPushStatus: row.cms_push_status || 'pending',
    cmsPushedAt: row.cms_pushed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseAssessmentAssetRow(row) {
  return {
    id: row.id,
    moduleName: row.module_name,
    assessmentType: row.assessment_type,
    subject: row.subject,
    gradeLevel: row.grade_level,
    questions: row.questions_json,
    assetSummary: row.asset_summary_json,
    defaultVoiceId: row.default_voice_id,
    defaultVoiceName: row.default_voice_name,
    cmsPageMapping: row.cms_page_mapping || {},
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
    cmsFileId: row.cms_file_id,
    cmsPushStatus: row.cms_push_status || 'pending',
    cmsPushedAt: row.cms_pushed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseGeneratedAudioRow(row) {
  return {
    id: row.id,
    assetListId: row.asset_list_id,
    assessmentAssetId: row.assessment_asset_id,
    slideNumber: row.slide_number,
    questionNumber: row.question_number,
    narrationType: row.narration_type || 'slide_narration',
    cmsFilename: row.cms_filename,
    narrationText: row.narration_text,
    voiceId: row.voice_id,
    voiceName: row.voice_name,
    audioPath: row.audio_path,
    durationMs: row.duration_ms,
    status: row.status,
    cmsFileId: row.cms_file_id,
    cmsPushStatus: row.cms_push_status || 'pending',
    cmsPushedAt: row.cms_pushed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = {
  initDatabase,
  jobs: jobQueries,
  videos: videoQueries,
  folders: folderQueries,
  characters: characterQueries,
  assetLists: assetListQueries,
  generatedImages: generatedImageQueries,
  generationHistory: generationHistoryQueries,
  motionGraphicsVideos: motionGraphicsVideoQueries,
  generatedAudio: generatedAudioQueries,
  assessmentAssets: assessmentAssetQueries
};
