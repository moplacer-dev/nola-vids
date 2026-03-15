import { useState, useEffect, useCallback, useRef } from 'react';
import GenerationForm from './components/GenerationForm';
import JobList from './components/JobList';
import VideoPlayer from './components/VideoPlayer';
import Login from './components/Login';
import Tips from './components/Tips';
import Library from './components/Library';
import ImageGenerator from './components/ImageGenerator';
import ImageGenForm from './components/ImageGenForm';
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
  const [currentView, setCurrentView] = useState('generator'); // 'generator' | 'image-gen' | 'carl-gen' | 'library'
  const [generatedImage, setGeneratedImage] = useState(null);
  const [imageGenerating, setImageGenerating] = useState(false);
  const imageGenFormRef = useRef(null);

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
    deleteVideo,
    // Image generation
    getAssetLists,
    getAssetList,
    getCharacters,
    setCharacterAnchor,
    removeCharacterReferenceImage,
    generateImage,
    generateStandaloneImage,
    regenerateImage,
    updateGeneratedImage,
    uploadGeneratedImage,
    importFromLibrary,
    getGeneratedImages,
    // Motion graphics videos
    uploadMotionGraphicsVideo,
    deleteMotionGraphicsVideo,
    // Motion graphics scenes
    addMGScene,
    deleteMGScene,
    // Audio/TTS
    getVoices,
    checkAudioStatus,
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
    const hasActiveJobs = jobs.some(j => j.status === 'processing' || j.status === 'pending' || j.status === 'queued');
    if (!hasActiveJobs) return;

    const interval = setInterval(loadJobs, 15000);
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
        <span className="tagline">Powered by Veo 3.1 + Nano Banana 2</span>

        <nav className="nav">
          <button
            className={`nav-btn ${currentView === 'generator' ? 'active' : ''}`}
            onClick={() => setCurrentView('generator')}
          >
            Video Gen
          </button>
          <button
            className={`nav-btn ${currentView === 'image-gen' ? 'active' : ''}`}
            onClick={() => setCurrentView('image-gen')}
          >
            Image Gen
          </button>
          <button
            className={`nav-btn ${currentView === 'carl-gen' ? 'active' : ''}`}
            onClick={() => setCurrentView('carl-gen')}
          >
            Carl Gen
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
      ) : currentView === 'image-gen' ? (
        <main className="main">
          <div className="left-panel">
            <ImageGenForm
              ref={imageGenFormRef}
              onGenerate={async (params) => {
                setImageGenerating(true);
                setGeneratedImage(null);
                try {
                  const result = await generateStandaloneImage(params);
                  setGeneratedImage(result);
                } catch (err) {
                  console.error('Image generation failed:', err);
                } finally {
                  setImageGenerating(false);
                }
              }}
              disabled={imageGenerating || loading}
            />
          </div>

          <div className="right-panel">
            <div className="image-result-panel">
              <h3>Generated Image</h3>
              {imageGenerating ? (
                <div className="image-result-placeholder">Generating image...</div>
              ) : generatedImage ? (
                <div className="image-result">
                  <img
                    src={(() => {
                      // Use Supabase image transforms for optimized display
                      // Original full-quality image is preserved for downloads
                      const url = generatedImage.path;
                      if (url.includes('supabase.co/storage/v1/object/public/')) {
                        return url.replace(
                          '/storage/v1/object/public/',
                          '/storage/v1/render/image/public/'
                        ) + '?width=1200&quality=80';
                      }
                      return url;
                    })()}
                    alt="Generated"
                    className="generated-image"
                    width={generatedImage.width}
                    height={generatedImage.height}
                    loading="eager"
                    decoding="async"
                    fetchpriority="high"
                  />
                  <div className="image-result-filename">{generatedImage.filename}</div>
                  <div className="image-result-actions">
                    <button
                      className="btn-download-image"
                      onClick={() => {
                        const url = generatedImage.path;
                        const filename = generatedImage.filename;
                        // Use server proxy for Supabase URLs to handle CORS
                        if (url.startsWith('http') && url.includes('supabase')) {
                          const proxyUrl = `/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
                          window.location.href = proxyUrl;
                        } else {
                          const link = document.createElement('a');
                          link.href = url;
                          link.download = filename;
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        }
                      }}
                    >
                      Download
                    </button>
                    <button
                      className="btn-refine-image"
                      onClick={() => {
                        if (generatedImage?.path) {
                          imageGenFormRef.current?.addReferenceUrl(generatedImage.path);
                        }
                      }}
                    >
                      Refine
                    </button>
                  </div>
                </div>
              ) : (
                <div className="image-result-placeholder">
                  Enter a prompt and click Generate to create an image
                </div>
              )}
            </div>
          </div>
        </main>
      ) : currentView === 'carl-gen' ? (
        <main className="main-library">
          <ImageGenerator
            getAssetLists={getAssetLists}
            getAssetList={getAssetList}
            getCharacters={getCharacters}
            setCharacterAnchor={setCharacterAnchor}
            removeCharacterReferenceImage={removeCharacterReferenceImage}
            generateImage={generateImage}
            regenerateImage={regenerateImage}
            updateGeneratedImage={updateGeneratedImage}
            uploadGeneratedImage={uploadGeneratedImage}
            importFromLibrary={importFromLibrary}
            getGeneratedImages={getGeneratedImages}
            getLibrary={getLibrary}
            uploadMotionGraphicsVideo={uploadMotionGraphicsVideo}
            deleteMotionGraphicsVideo={deleteMotionGraphicsVideo}
            addMGScene={addMGScene}
            deleteMGScene={deleteMGScene}
            getVoices={getVoices}
            checkAudioStatus={checkAudioStatus}
            generateAudio={generateAudio}
            uploadAudio={uploadAudio}
            updateAudio={updateAudio}
            regenerateAudio={regenerateAudio}
            setSessionDefaultVoice={setSessionDefaultVoice}
            setAssessmentDefaultVoice={setAssessmentDefaultVoice}
            getAssessmentAssets={getAssessmentAssets}
            getAssessmentAsset={getAssessmentAsset}
            getAssessmentAudio={getAssessmentAudio}
            generateAssessmentAudio={generateAssessmentAudio}
            generateBulkAudio={generateBulkAudio}
          />
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
            getGeneratedImages={getGeneratedImages}
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
