import { useState, useCallback } from 'react';

const API_BASE = '/api';

export function useApi(accessKey) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const request = useCallback(async (endpoint, options = {}) => {
    setLoading(true);
    setError(null);

    try {
      // Add auth header to all requests
      const headers = {
        'X-Access-Key': accessKey,
        ...options.headers
      };

      const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [accessKey]);

  const generateTextToVideo = useCallback(async (params) => {
    return request('/generate/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
  }, [request]);

  const generateImageToVideo = useCallback(async (formData) => {
    return request('/generate/image', {
      method: 'POST',
      body: formData
    });
  }, [request]);

  const generateFrameInterpolation = useCallback(async (formData) => {
    return request('/generate/frames', {
      method: 'POST',
      body: formData
    });
  }, [request]);

  const generateReferenceGuided = useCallback(async (formData) => {
    return request('/generate/reference', {
      method: 'POST',
      body: formData
    });
  }, [request]);

  const extendVideo = useCallback(async (params) => {
    return request('/generate/extend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
  }, [request]);

  const getJobs = useCallback(async () => {
    return request('/jobs');
  }, [request]);

  const getJob = useCallback(async (jobId) => {
    return request(`/jobs/${jobId}`);
  }, [request]);

  const deleteJob = useCallback(async (jobId) => {
    return request(`/jobs/${jobId}`, { method: 'DELETE' });
  }, [request]);

  const getTemplates = useCallback(async () => {
    return request('/templates');
  }, [request]);

  // Library endpoints
  const getLibrary = useCallback(async (options = {}) => {
    const params = new URLSearchParams();
    if (options.folder) params.set('folder', options.folder);
    if (options.search) params.set('search', options.search);
    if (options.limit) params.set('limit', options.limit);
    if (options.offset) params.set('offset', options.offset);

    const query = params.toString();
    return request(`/library${query ? `?${query}` : ''}`);
  }, [request]);

  const getFolders = useCallback(async () => {
    return request('/library/folders');
  }, [request]);

  const createFolder = useCallback(async (name) => {
    return request('/library/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
  }, [request]);

  const deleteFolder = useCallback(async (folderId) => {
    return request(`/library/folders/${folderId}`, { method: 'DELETE' });
  }, [request]);

  const updateVideo = useCallback(async (videoId, updates) => {
    return request(`/videos/${videoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
  }, [request]);

  const deleteVideo = useCallback(async (videoId) => {
    return request(`/videos/${videoId}`, { method: 'DELETE' });
  }, [request]);

  // Image Generation endpoints
  const getAssetLists = useCallback(async (moduleName) => {
    const params = moduleName ? `?moduleName=${encodeURIComponent(moduleName)}` : '';
    return request(`/asset-lists${params}`);
  }, [request]);

  const getAssetList = useCallback(async (id) => {
    return request(`/asset-lists/${id}`);
  }, [request]);

  const importAssetList = useCallback(async (data) => {
    return request('/asset-lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  }, [request]);

  const deleteAssetList = useCallback(async (id) => {
    return request(`/asset-lists/${id}`, { method: 'DELETE' });
  }, [request]);

  const getCharacters = useCallback(async (moduleName) => {
    return request(`/characters/${encodeURIComponent(moduleName)}`);
  }, [request]);

  const createCharacter = useCallback(async (data) => {
    return request('/characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  }, [request]);

  const setCharacterAnchor = useCallback(async (characterId, filesOrFormData) => {
    let formData;
    if (filesOrFormData instanceof FormData) {
      formData = filesOrFormData;
    } else if (Array.isArray(filesOrFormData)) {
      formData = new FormData();
      for (const file of filesOrFormData) {
        formData.append('anchor', file);
      }
    } else {
      // Single file
      formData = new FormData();
      formData.append('anchor', filesOrFormData);
    }
    return request(`/characters/${characterId}/anchor`, {
      method: 'PUT',
      body: formData
    });
  }, [request]);

  const removeCharacterReferenceImage = useCallback(async (characterId, imagePath) => {
    return request(`/characters/${characterId}/reference-image`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePath })
    });
  }, [request]);

  const getGeneratedImages = useCallback(async (options = {}) => {
    const params = new URLSearchParams();
    if (options.moduleName) params.set('moduleName', options.moduleName);
    if (options.sessionNumber) params.set('sessionNumber', options.sessionNumber);
    if (options.status) params.set('status', options.status);
    if (options.limit) params.set('limit', options.limit);
    if (options.offset) params.set('offset', options.offset);

    const query = params.toString();
    return request(`/images${query ? `?${query}` : ''}`);
  }, [request]);

  const getGeneratedImage = useCallback(async (id) => {
    return request(`/images/${id}`);
  }, [request]);

  const generateImage = useCallback(async (generatedImageId, options = {}) => {
    return request('/images/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generatedImageId,
        prompt: options.prompt,
        useCharacterAnchor: options.useCharacterAnchor
      })
    });
  }, [request]);

  const generateStandaloneImage = useCallback(async ({ prompt, referenceImage, referenceImages, moduleName, sessionNumber, pageNumber }) => {
    const formData = new FormData();
    formData.append('prompt', prompt);

    // Support both single referenceImage (legacy) and multiple referenceImages
    const images = referenceImages || (referenceImage ? [referenceImage] : []);
    for (const img of images) {
      formData.append('referenceImage', img);
    }

    if (moduleName) {
      formData.append('moduleName', moduleName);
    }
    if (sessionNumber) {
      formData.append('sessionNumber', sessionNumber.toString());
    }
    if (pageNumber) {
      formData.append('pageNumber', pageNumber.toString());
    }

    return request('/images/generate-standalone', {
      method: 'POST',
      body: formData
    });
  }, [request]);

  const regenerateImage = useCallback(async (id, options = {}) => {
    return request(`/images/${id}/regenerate`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: options.prompt,
        useCharacterAnchor: options.useCharacterAnchor
      })
    });
  }, [request]);

  const updateGeneratedImage = useCallback(async (id, updates) => {
    return request(`/images/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
  }, [request]);

  const uploadGeneratedImage = useCallback(async (id, file) => {
    if (!id) {
      throw new Error('Image ID is required for upload');
    }
    const formData = new FormData();
    formData.append('image', file);
    return request(`/images/${encodeURIComponent(String(id))}/upload`, {
      method: 'POST',
      body: formData
    });
  }, [request]);

  const importFromLibrary = useCallback(async (generatedImageId, sourceId, sourceType) => {
    if (!generatedImageId || !sourceId || !sourceType) {
      throw new Error('generatedImageId, sourceId, and sourceType are required');
    }
    return request(`/images/${encodeURIComponent(String(generatedImageId))}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId, sourceType })
    });
  }, [request]);

  // Motion Graphics Video endpoints
  const getMotionGraphicsSlide = useCallback(async (assetListId, slideNumber) => {
    return request(`/motion-graphics/${encodeURIComponent(assetListId)}/${slideNumber}`);
  }, [request]);

  const uploadMotionGraphicsVideo = useCallback(async (assetListId, slideNumber, file) => {
    const formData = new FormData();
    formData.append('video', file);
    return request(`/motion-graphics/${encodeURIComponent(assetListId)}/${slideNumber}/video`, {
      method: 'POST',
      body: formData
    });
  }, [request]);

  const deleteMotionGraphicsVideo = useCallback(async (assetListId, slideNumber) => {
    return request(`/motion-graphics/${encodeURIComponent(assetListId)}/${slideNumber}/video`, {
      method: 'DELETE'
    });
  }, [request]);

  const addMGScene = useCallback(async (assetListId, slideNumber, { prompt, assetType = 'motion_graphics' }) => {
    return request(`/motion-graphics/${encodeURIComponent(String(assetListId))}/${encodeURIComponent(String(slideNumber))}/scenes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, assetType })
    });
  }, [request]);

  const deleteMGScene = useCallback(async (sceneId) => {
    return request(`/motion-graphics/scenes/${encodeURIComponent(sceneId)}`, {
      method: 'DELETE'
    });
  }, [request]);

  // Audio/TTS endpoints
  const getVoices = useCallback(async () => {
    return request('/voices');
  }, [request]);

  const generateAudio = useCallback(async (audioId, options = {}) => {
    return request('/audio/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioId,
        text: options.text,
        voiceId: options.voiceId,
        voiceName: options.voiceName
      })
    });
  }, [request]);

  const uploadAudio = useCallback(async (id, file) => {
    if (!id) {
      throw new Error('Audio ID is required for upload');
    }
    const formData = new FormData();
    formData.append('audio', file);
    return request(`/audio/${encodeURIComponent(String(id))}/upload`, {
      method: 'POST',
      body: formData
    });
  }, [request]);

  const updateAudio = useCallback(async (id, updates) => {
    return request(`/audio/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
  }, [request]);

  const regenerateAudio = useCallback(async (id, options = {}) => {
    return request(`/audio/${encodeURIComponent(id)}/regenerate`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: options.text,
        voiceId: options.voiceId,
        voiceName: options.voiceName
      })
    });
  }, [request]);

  const setSessionDefaultVoice = useCallback(async (assetListId, voiceId, voiceName) => {
    return request(`/asset-lists/${encodeURIComponent(assetListId)}/voice`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceId, voiceName })
    });
  }, [request]);

  const setAssessmentDefaultVoice = useCallback(async (assessmentId, voiceId, voiceName) => {
    return request(`/assessment-assets/${encodeURIComponent(assessmentId)}/voice`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceId, voiceName })
    });
  }, [request]);

  // Assessment Assets endpoints
  const getAssessmentAssets = useCallback(async (moduleName) => {
    const params = moduleName ? `?moduleName=${encodeURIComponent(moduleName)}` : '';
    return request(`/assessment-assets${params}`);
  }, [request]);

  const getAssessmentAsset = useCallback(async (id) => {
    return request(`/assessment-assets/${id}`);
  }, [request]);

  // Assessment Audio endpoints
  const getAssessmentAudio = useCallback(async (assessmentAssetId) => {
    return request(`/assessment-assets/${assessmentAssetId}/audio`);
  }, [request]);

  const generateAssessmentAudio = useCallback(async (audioId, options = {}) => {
    return request('/audio/generate-assessment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioId,
        text: options.text,
        voiceId: options.voiceId,
        voiceName: options.voiceName
      })
    });
  }, [request]);

  const generateBulkAudio = useCallback(async (options) => {
    return request('/audio/generate-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });
  }, [request]);

  return {
    loading,
    error,
    // Video generation
    generateTextToVideo,
    generateImageToVideo,
    generateFrameInterpolation,
    generateReferenceGuided,
    extendVideo,
    getJobs,
    getJob,
    deleteJob,
    getTemplates,
    // Video library
    getLibrary,
    getFolders,
    createFolder,
    deleteFolder,
    updateVideo,
    deleteVideo,
    // Image generation
    getAssetLists,
    getAssetList,
    importAssetList,
    deleteAssetList,
    getCharacters,
    createCharacter,
    setCharacterAnchor,
    removeCharacterReferenceImage,
    getGeneratedImages,
    getGeneratedImage,
    generateImage,
    generateStandaloneImage,
    regenerateImage,
    updateGeneratedImage,
    uploadGeneratedImage,
    importFromLibrary,
    // Motion graphics videos
    getMotionGraphicsSlide,
    uploadMotionGraphicsVideo,
    deleteMotionGraphicsVideo,
    // Motion graphics scenes
    addMGScene,
    deleteMGScene,
    // Audio/TTS
    getVoices,
    generateAudio,
    uploadAudio,
    updateAudio,
    regenerateAudio,
    setSessionDefaultVoice,
    setAssessmentDefaultVoice,
    // Assessment Assets
    getAssessmentAssets,
    getAssessmentAsset,
    // Assessment Audio
    getAssessmentAudio,
    generateAssessmentAudio,
    generateBulkAudio
  };
}
