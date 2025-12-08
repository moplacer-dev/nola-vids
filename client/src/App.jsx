import { useState, useEffect, useCallback } from 'react';
import GenerationForm from './components/GenerationForm';
import JobList from './components/JobList';
import VideoPlayer from './components/VideoPlayer';
import Login from './components/Login';
import Tips from './components/Tips';
import { useApi } from './hooks/useApi';
import './App.css';

const STORAGE_KEY = 'nola_access_key';

export default function App() {
  const [accessKey, setAccessKey] = useState(() => {
    return sessionStorage.getItem(STORAGE_KEY) || null;
  });
  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [templates, setTemplates] = useState(null);
  const [generating, setGenerating] = useState(false);

  const {
    loading,
    error,
    generateTextToVideo,
    generateImageToVideo,
    generateFrameInterpolation,
    generateReferenceGuided,
    extendVideo,
    getJobs,
    deleteJob,
    getTemplates
  } = useApi(accessKey);

  const handleLogin = (key) => {
    sessionStorage.setItem(STORAGE_KEY, key);
    setAccessKey(key);
  };

  const handleLogout = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    setAccessKey(null);
  };

  // Show login if not authenticated
  if (!accessKey) {
    return <Login onLogin={handleLogin} />;
  }

  // Load jobs and templates on mount and after login
  useEffect(() => {
    if (accessKey) {
      loadJobs();
      loadTemplates();
    }
  }, [accessKey]);

  // Poll for job updates
  useEffect(() => {
    const hasProcessingJobs = jobs.some(j => j.status === 'processing' || j.status === 'pending');
    if (!hasProcessingJobs) return;

    const interval = setInterval(loadJobs, 5000);
    return () => clearInterval(interval);
  }, [jobs]);

  const loadJobs = async () => {
    try {
      const data = await getJobs();
      setJobs(data);

      // Update selected job if it exists
      if (selectedJob) {
        const updated = data.find(j => j.id === selectedJob.id);
        if (updated) setSelectedJob(updated);
      }
    } catch (err) {
      console.error('Failed to load jobs:', err);
    }
  };

  const loadTemplates = async () => {
    try {
      const data = await getTemplates();
      setTemplates(data);
    } catch (err) {
      console.error('Failed to load templates:', err);
    }
  };

  const handleGenerate = async (mode, params) => {
    setGenerating(true);
    try {
      let result;
      switch (mode) {
        case 'text':
          result = await generateTextToVideo(params);
          break;
        case 'image':
          result = await generateImageToVideo(params);
          break;
        case 'frames':
          result = await generateFrameInterpolation(params);
          break;
        case 'reference':
          result = await generateReferenceGuided(params);
          break;
        case 'extend':
          result = await extendVideo(params);
          break;
      }

      // Reload jobs and select the new one
      await loadJobs();
      const newJobs = await getJobs();
      const newJob = newJobs.find(j => j.id === result.jobId);
      if (newJob) setSelectedJob(newJob);
    } catch (err) {
      console.error('Generation failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (jobId) => {
    try {
      await deleteJob(jobId);
      if (selectedJob?.id === jobId) {
        setSelectedJob(null);
      }
      await loadJobs();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1 className="logo">NOLA.vids</h1>
        <span className="tagline">Powered by Veo 3.1</span>
        <button className="logout-btn" onClick={handleLogout}>Logout</button>
      </header>

      <main className="main">
        <div className="left-panel">
          <GenerationForm
            onGenerate={handleGenerate}
            templates={templates}
            disabled={generating || loading}
          />
        </div>

        <div className="right-panel">
          <VideoPlayer job={selectedJob} />
          <JobList
            jobs={jobs}
            onDelete={handleDelete}
            onSelect={setSelectedJob}
            selectedJobId={selectedJob?.id}
          />
          <Tips />
        </div>
      </main>

      {error && (
        <div className="error-toast">
          {error}
        </div>
      )}
    </div>
  );
}
