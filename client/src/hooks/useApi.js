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

  const extendVideo = useCallback(async (formData) => {
    return request('/generate/extend', {
      method: 'POST',
      body: formData
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

  return {
    loading,
    error,
    generateTextToVideo,
    generateImageToVideo,
    generateFrameInterpolation,
    generateReferenceGuided,
    extendVideo,
    getJobs,
    getJob,
    deleteJob,
    getTemplates
  };
}
