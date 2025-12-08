import { useState, useEffect, useCallback } from 'react';
import GenerationForm from './components/GenerationForm';
import JobList from './components/JobList';
import VideoPlayer from './components/VideoPlayer';
import Login from './components/Login';
import Tips from './components/Tips';
import Library from './components/Library';
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
  const [currentView, setCurrentView] = useState('generator'); // 'generator' | 'library'

  // State for pre-filling the form from library actions
  const [prefillPrompt, setPrefillPrompt] = useState(null);
  const [prefillVideo, setPrefillVideo] = useState(null);

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
    getTemplates,
    getLibrary,
    getFolders,
    createFolder,
    deleteFolder,
    updateVideo,
    deleteVideo
  } = useApi(accessKey);

  const loadJobs = useCallback(async () => {
    if (!accessKey) return;
    try {
      const data = await getJobs();
      setJobs(data);

      // Update selected job if it exists
      setSelectedJob(prev => {
        if (prev) {
          const updated = data.find(j => j.id === prev.id);
          return updated || prev;
        }
        return null;
      });
    } catch (err) {
      console.error('Failed to load jobs:', err);
    }
  }, [accessKey, getJobs]);

  const loadTemplates = useCallback(async () => {
    if (!accessKey) return;
    try {
      const data = await getTemplates();
      setTemplates(data);
    } catch (err) {
      console.error('Failed to load templates:', err);
    }
  }, [accessKey, getTemplates]);

  // Load jobs and templates on mount and after login
  useEffect(() => {
    if (accessKey) {
      loadJobs();
      loadTemplates();
    }
  }, [accessKey, loadJobs, loadTemplates]);

  // Poll for job updates
  useEffect(() => {
    const hasProcessingJobs = jobs.some(j => j.status === 'processing' || j.status === 'pending');
    if (!hasProcessingJobs) return;

    const interval = setInterval(loadJobs, 5000);
    return () => clearInterval(interval);
  }, [jobs, loadJobs]);

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

      // Clear any prefill state
      setPrefillPrompt(null);
      setPrefillVideo(null);
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

  // Handlers for library actions
  const handleReusePrompt = (prompt, negativePrompt) => {
    setPrefillPrompt({ prompt, negativePrompt });
    setPrefillVideo(null);
    setCurrentView('generator');
  };

  const handleExtendVideo = (video) => {
    setPrefillVideo(video);
    setPrefillPrompt(null);
    setCurrentView('generator');
  };

  const handleViewLibrary = () => {
    setCurrentView('library');
  };

  return (
    <div className="app">
      <header className="header">
        <h1 className="logo">NOLA.vids</h1>
        <span className="tagline">Powered by Veo 3.1</span>

        <nav className="nav">
          <button
            className={`nav-btn ${currentView === 'generator' ? 'active' : ''}`}
            onClick={() => setCurrentView('generator')}
          >
            Generator
          </button>
          <button
            className={`nav-btn ${currentView === 'library' ? 'active' : ''}`}
            onClick={() => setCurrentView('library')}
          >
            Library
          </button>
        </nav>

        <button className="logout-btn" onClick={handleLogout}>Logout</button>
      </header>

      {currentView === 'generator' ? (
        <main className="main">
          <div className="left-panel">
            <GenerationForm
              onGenerate={handleGenerate}
              templates={templates}
              disabled={generating || loading}
              prefillPrompt={prefillPrompt}
              prefillVideo={prefillVideo}
              onPrefillConsumed={() => {
                setPrefillPrompt(null);
                setPrefillVideo(null);
              }}
            />
          </div>

          <div className="right-panel">
            <VideoPlayer job={selectedJob} />
            <JobList
              jobs={jobs}
              onDelete={handleDelete}
              onSelect={setSelectedJob}
              selectedJobId={selectedJob?.id}
              onViewLibrary={handleViewLibrary}
            />
            <Tips />
          </div>
        </main>
      ) : (
        <main className="main-library">
          <Library
            accessKey={accessKey}
            getLibrary={getLibrary}
            getFolders={getFolders}
            createFolder={createFolder}
            deleteFolder={deleteFolder}
            updateVideo={updateVideo}
            deleteVideo={deleteVideo}
            onReusePrompt={handleReusePrompt}
            onExtendVideo={handleExtendVideo}
          />
        </main>
      )}

      {error && (
        <div className="error-toast">
          {error}
        </div>
      )}
    </div>
  );
}
