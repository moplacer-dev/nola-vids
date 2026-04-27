import { useState, useEffect, useCallback, useRef } from 'react';
import GenerationForm from './components/GenerationForm';
import JobList from './components/JobList';
import VideoPlayer from './components/VideoPlayer';
import Login from './components/Login';
import Tips from './components/Tips';
// Library component kept for reference but no longer used in UI
// import Library from './components/Library';
import ImageGenerator from './components/ImageGenerator';
import ImageGenForm from './components/ImageGenForm';
import ImageGenQueue from './components/ImageGenQueue';
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
  const [currentView, setCurrentView] = useState('generator'); // 'generator' | 'image-gen' | 'carl-gen'
  const [generatedImage, setGeneratedImage] = useState(null);
  const [imageGenerating, setImageGenerating] = useState(false);
  const imageGenFormRef = useRef(null);

  // State for completed videos from library (Video Gen queue)
  const [completedVideos, setCompletedVideos] = useState([]);

  // State for standalone images (Image Gen queue)
  const [standaloneImages, setStandaloneImages] = useState([]);
  const [selectedStandaloneImage, setSelectedStandaloneImage] = useState(null);

  // State for pre-filling the form from library actions
  const [prefillPrompt, setPrefillPrompt] = useState(null);
  const [prefillVideo, setPrefillVideo] = useState(null);

  const {
    loading,
    error,
    // CMS Sync
    checkCmsStatus,
    fetchCmsSync,
    addSlideFromCms,
    deleteSlideFromNola,
    updateNarrationFromCms,
    renumberSlides,
    // CMS Push
    pushImageToCms,
    pushAudioToCms,
    pushMgVideoToCms,
    pushVideoToCms,
    // Video generation
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
    getCharacterViews,
    assignCharacterView,
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
    createAudio,
    deleteAudio,
    setSessionDefaultVoice,
    setAssessmentDefaultVoice,
    // Assessment Assets
    getAssessmentAssets,
    getAssessmentAsset,
    // Assessment Audio
    getAssessmentAudio,
    generateAssessmentAudio,
    generateBulkAudio,
    // Image deletion
    deleteGeneratedImage,
    // Assessment CMS Sync
    fetchAssessmentCmsSync,
    pushAssessmentAudioToCms,
    pushAssessmentImageToCms,
    updateAssessmentNarrationFromCms
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

  const loadCompletedVideos = useCallback(async () => {
    if (!accessKey) return;
    try {
      const data = await getLibrary();
      setCompletedVideos(data);
    } catch (err) {
      console.error('Failed to load completed videos:', err);
    }
  }, [accessKey, getLibrary]);

  const loadStandaloneImages = useCallback(async () => {
    if (!accessKey) return;
    try {
      const data = await getGeneratedImages({ source: 'standalone' });
      setStandaloneImages(data);
    } catch (err) {
      console.error('Failed to load standalone images:', err);
    }
  }, [accessKey, getGeneratedImages]);

  // Load jobs, templates, videos, and images on mount and after login
  useEffect(() => {
    if (accessKey) {
      // Parallelize all initial data loading
      Promise.all([
        loadJobs(),
        loadTemplates(),
        loadCompletedVideos(),
        loadStandaloneImages()
      ]);
    }
  }, [accessKey, loadJobs, loadTemplates, loadCompletedVideos, loadStandaloneImages]);

  // Track active jobs in a ref to avoid polling restart on every jobs update
  const hasActiveJobsRef = useRef(false);

  // Update the ref when jobs change
  useEffect(() => {
    hasActiveJobsRef.current = jobs.some(j => j.status === 'processing' || j.status === 'pending' || j.status === 'queued');
  }, [jobs]);

  // Poll for job updates - only depends on loadJobs, not jobs
  useEffect(() => {
    const pollJobs = () => {
      if (hasActiveJobsRef.current) {
        loadJobs();
      }
    };

    const interval = setInterval(pollJobs, 15000);
    return () => clearInterval(interval);
  }, [loadJobs]);

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

  const handleDeleteJob = async (jobId) => {
    try {
      await deleteJob(jobId);
      if (selectedJob?.id === jobId) {
        setSelectedJob(null);
      }
      await loadJobs();
      await loadCompletedVideos();
    } catch (err) {
      console.error('Delete job failed:', err);
    }
  };

  const handleDeleteVideo = async (videoId) => {
    try {
      await deleteVideo(videoId);
      if (selectedJob?.videos?.[0]?.id === videoId) {
        setSelectedJob(null);
      }
      await loadCompletedVideos();
    } catch (err) {
      console.error('Delete video failed:', err);
    }
  };

  const handleDeleteStandaloneImage = async (imageId) => {
    try {
      await deleteGeneratedImage(imageId);
      if (selectedStandaloneImage?.id === imageId) {
        setSelectedStandaloneImage(null);
        setGeneratedImage(null);
      }
      await loadStandaloneImages();
    } catch (err) {
      console.error('Delete image failed:', err);
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
            <VideoPlayer
              job={selectedJob}
              onReusePrompt={handleReusePrompt}
              onExtendVideo={handleExtendVideo}
            />
            <JobList
              jobs={jobs}
              completedVideos={completedVideos}
              onDeleteJob={handleDeleteJob}
              onDeleteVideo={handleDeleteVideo}
              onSelect={setSelectedJob}
              selectedId={selectedJob?.id}
              onReusePrompt={handleReusePrompt}
              onExtendVideo={handleExtendVideo}
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
                setSelectedStandaloneImage(null);
                try {
                  const result = await generateStandaloneImage(params);
                  setGeneratedImage(result);
                  // Refresh the queue to show the new image
                  await loadStandaloneImages();
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
            {(() => {
              // Show either the selected standalone image or the most recently generated image
              const displayImage = selectedStandaloneImage || generatedImage;
              const imagePath = displayImage?.imagePath || displayImage?.path;
              const imageFilename = displayImage?.cmsFilename || displayImage?.filename || 'Generated Image';

              return (
                <div className="image-result-panel">
                  <h3>Generated Image</h3>
                  {imageGenerating ? (
                    <div className="image-result-placeholder">Generating image...</div>
                  ) : imagePath ? (
                    <div className="image-result">
                      <img
                        src={imagePath}
                        alt="Generated"
                        className="generated-image"
                        loading="eager"
                        decoding="async"
                        fetchPriority="high"
                      />
                      <div className="image-result-actions">
                        <button
                          className="btn-download-image"
                          onClick={() => {
                            const url = imagePath;
                            const filename = imageFilename;
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
                            if (imagePath) {
                              imageGenFormRef.current?.addReferenceUrl(imagePath);
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
              );
            })()}
            <ImageGenQueue
              images={standaloneImages}
              selectedId={selectedStandaloneImage?.id}
              onSelect={(image) => {
                setSelectedStandaloneImage(image);
                setGeneratedImage(null);
              }}
              onDelete={handleDeleteStandaloneImage}
              onReusePrompt={(prompt) => {
                imageGenFormRef.current?.setPrompt(prompt);
              }}
            />
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
            getCharacterViews={getCharacterViews}
            assignCharacterView={assignCharacterView}
            generateStandaloneImage={generateStandaloneImage}
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
            createAudio={createAudio}
            deleteAudio={deleteAudio}
            setSessionDefaultVoice={setSessionDefaultVoice}
            setAssessmentDefaultVoice={setAssessmentDefaultVoice}
            getAssessmentAssets={getAssessmentAssets}
            getAssessmentAsset={getAssessmentAsset}
            getAssessmentAudio={getAssessmentAudio}
            generateAssessmentAudio={generateAssessmentAudio}
            generateBulkAudio={generateBulkAudio}
            checkCmsStatus={checkCmsStatus}
            fetchCmsSync={fetchCmsSync}
            addSlideFromCms={addSlideFromCms}
            deleteSlideFromNola={deleteSlideFromNola}
            updateNarrationFromCms={updateNarrationFromCms}
            renumberSlides={renumberSlides}
            pushImageToCms={pushImageToCms}
            pushAudioToCms={pushAudioToCms}
            pushMgVideoToCms={pushMgVideoToCms}
            pushVideoToCms={pushVideoToCms}
            fetchAssessmentCmsSync={fetchAssessmentCmsSync}
            pushAssessmentAudioToCms={pushAssessmentAudioToCms}
            pushAssessmentImageToCms={pushAssessmentImageToCms}
            updateAssessmentNarrationFromCms={updateAssessmentNarrationFromCms}
          />
        </main>
      ) : null}

      {error && (
        <div className="error-toast">
          {error}
        </div>
      )}
    </div>
  );
}
