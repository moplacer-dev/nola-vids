import { useState, useEffect } from 'react';
import AssetList from './AssetList';
import CharacterPanel from './CharacterPanel';
import PromptEditor from './PromptEditor';
import ImagePreview from './ImagePreview';
import LibraryPicker from './LibraryPicker';
import './ImageGenerator.css';

export default function ImageGenerator({
  getAssetLists,
  getAssetList,
  getCharacters,
  setCharacterAnchor,
  removeCharacterReferenceImage,
  generateImage,
  regenerateImage,
  updateGeneratedImage,
  uploadGeneratedImage,
  importFromLibrary,
  getGeneratedImages,
  getLibrary,
  uploadMotionGraphicsVideo,
  deleteMotionGraphicsVideo,
  addMGScene,
  deleteMGScene,
  // Audio/TTS
  getVoices,
  generateAudio,
  uploadAudio,
  updateAudio,
  regenerateAudio,
  setSessionDefaultVoice,
  // Assessment Assets
  getAssessmentAssets,
  getAssessmentAsset
}) {
  const [assetLists, setAssetLists] = useState([]);
  const [selectedAssetList, setSelectedAssetList] = useState(null);
  const [generatedImages, setGeneratedImages] = useState([]);
  const [motionGraphicsVideos, setMotionGraphicsVideos] = useState([]);
  const [generatedAudioList, setGeneratedAudioList] = useState([]);
  const [voices, setVoices] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedAudio, setSelectedAudio] = useState(null);
  const [editingImage, setEditingImage] = useState(null);
  const [editingNarration, setEditingNarration] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importingForImage, setImportingForImage] = useState(null); // image ID we're importing for
  const [deletingScene, setDeletingScene] = useState(null); // scene being deleted (confirmation)
  const [addingSceneForSlide, setAddingSceneForSlide] = useState(null); // slideNumber when adding scene

  // Module/Session filters
  const [selectedModule, setSelectedModule] = useState('');
  const [selectedSession, setSelectedSession] = useState('');

  // Assessment assets state
  const [assessmentAssets, setAssessmentAssets] = useState([]);
  const [selectedAssessment, setSelectedAssessment] = useState(null);

  // Load asset lists and voices on mount
  useEffect(() => {
    loadAssetLists();
    loadVoices();
  }, []);

  const loadVoices = async () => {
    try {
      if (getVoices) {
        const voiceList = await getVoices();
        setVoices(voiceList || []);
      }
    } catch (err) {
      console.error('Failed to load voices:', err);
    }
  };

  // Load characters and assessment assets when module changes
  useEffect(() => {
    if (selectedModule) {
      loadCharacters(selectedModule);
      loadAssessmentAssets(selectedModule);
    }
  }, [selectedModule]);

  const loadAssessmentAssets = async (moduleName) => {
    try {
      if (getAssessmentAssets) {
        const assets = await getAssessmentAssets(moduleName);
        setAssessmentAssets(assets || []);
      }
    } catch (err) {
      console.error('Failed to load assessment assets:', err);
      setAssessmentAssets([]);
    }
  };

  // Poll for image and audio generation status
  useEffect(() => {
    const hasGeneratingImages = generatedImages.some(img => img.status === 'generating');
    const hasGeneratingAudio = generatedAudioList.some(a => a.status === 'generating');

    if (!hasGeneratingImages && !hasGeneratingAudio) return;

    const interval = setInterval(async () => {
      if (selectedAssetList) {
        await loadAssetListDetails(selectedAssetList.id);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [generatedImages, generatedAudioList, selectedAssetList]);

  const loadAssetLists = async () => {
    try {
      const lists = await getAssetLists();
      setAssetLists(lists);

      // Get unique modules
      const modules = [...new Set(lists.map(l => l.moduleName))];
      if (modules.length > 0 && !selectedModule) {
        setSelectedModule(modules[0]);
      }
    } catch (err) {
      console.error('Failed to load asset lists:', err);
    }
  };

  const loadAssetListDetails = async (assetListId) => {
    try {
      setLoading(true);
      const data = await getAssetList(assetListId);
      setSelectedAssetList(data);
      setGeneratedImages(data.generatedImages || []);
      setMotionGraphicsVideos(data.motionGraphicsVideos || []);
      setGeneratedAudioList(data.generatedAudio || []);

      // Update selectedImage if it exists in the new data (fixes preview not updating after regenerate)
      setSelectedImage(prev => {
        if (!prev) return prev;
        const updated = (data.generatedImages || []).find(img => img.id === prev.id);
        return updated || prev;
      });

      // Update selectedAudio if it exists in the new data
      setSelectedAudio(prev => {
        if (!prev) return prev;
        const updated = (data.generatedAudio || []).find(a => a.id === prev.id);
        return updated || prev;
      });
    } catch (err) {
      console.error('Failed to load asset list:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadCharacters = async (moduleName) => {
    try {
      const chars = await getCharacters(moduleName);
      setCharacters(chars);
    } catch (err) {
      console.error('Failed to load characters:', err);
    }
  };

  const handleSelectAssetList = (assetList) => {
    setSelectedAssessment(null);
    loadAssetListDetails(assetList.id);
  };

  const loadAssessmentDetails = async (assessmentId) => {
    try {
      setLoading(true);
      const data = await getAssessmentAsset(assessmentId);
      setSelectedAssessment(data);
      setSelectedAssetList(null);
      setGeneratedImages(data.generatedImages || []);
      setMotionGraphicsVideos([]);
      setGeneratedAudioList([]);
    } catch (err) {
      console.error('Failed to load assessment:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async (imageId, options = {}) => {
    try {
      await generateImage(imageId, options);
      // Reload to get updated status
      if (selectedAssetList) {
        await loadAssetListDetails(selectedAssetList.id);
      }
    } catch (err) {
      console.error('Generation failed:', err);
    }
  };

  const handleRegenerate = async (imageId, options = {}) => {
    try {
      await regenerateImage(imageId, options);
      if (selectedAssetList) {
        await loadAssetListDetails(selectedAssetList.id);
      }
    } catch (err) {
      console.error('Regeneration failed:', err);
    }
  };

  const handleUpload = async (imageId, file) => {
    if (!imageId || !file) {
      console.error('Upload failed: missing imageId or file', { imageId, file });
      return;
    }
    try {
      await uploadGeneratedImage(imageId, file);
      if (selectedAssetList) {
        await loadAssetListDetails(selectedAssetList.id);
      }
    } catch (err) {
      console.error('Upload failed:', err);
    }
  };

  const handleOpenLibraryPicker = (imageId) => {
    if (!imageId) {
      console.error('Cannot open library picker: no image ID');
      return;
    }
    setImportingForImage(String(imageId));
  };

  const handleImportFromLibrary = async (libraryItem) => {
    if (!importingForImage || !libraryItem?.id || !libraryItem?.type) {
      console.error('Import failed: missing required data', { importingForImage, libraryItem });
      return;
    }
    try {
      await importFromLibrary(
        String(importingForImage),
        String(libraryItem.id),
        String(libraryItem.type)
      );
      setImportingForImage(null);
      if (selectedAssetList) {
        await loadAssetListDetails(selectedAssetList.id);
      }
    } catch (err) {
      console.error('Import failed:', err);
    }
  };

  const handleEditPrompt = (image) => {
    setEditingImage(image);
  };

  const handleSavePrompt = async (imageId, newPrompt, newAssetType) => {
    try {
      const updates = { modifiedPrompt: newPrompt };
      if (newAssetType !== undefined) {
        updates.assetType = newAssetType;
      }
      await updateGeneratedImage(imageId, updates);
      if (selectedAssetList) {
        await loadAssetListDetails(selectedAssetList.id);
      }
      setEditingImage(null);
    } catch (err) {
      console.error('Failed to save prompt:', err);
    }
  };

  const handleSetAnchor = async (characterId, files) => {
    try {
      // Support both single file and array of files
      const fileList = Array.isArray(files) ? files : [files];
      await setCharacterAnchor(characterId, fileList);
      await loadCharacters(selectedModule);
    } catch (err) {
      console.error('Failed to set anchor:', err);
    }
  };

  const handleRemoveReferenceImage = async (characterId, imagePath) => {
    if (!removeCharacterReferenceImage) return;
    try {
      await removeCharacterReferenceImage(characterId, imagePath);
      await loadCharacters(selectedModule);
    } catch (err) {
      console.error('Failed to remove reference image:', err);
    }
  };

  const handleUploadMGVideo = async (slideNumber, file) => {
    if (!selectedAssetList?.id || !slideNumber || !file) {
      console.error('Upload MG video failed: missing required data', { assetListId: selectedAssetList?.id, slideNumber, file });
      return;
    }
    try {
      await uploadMotionGraphicsVideo(selectedAssetList.id, slideNumber, file);
      await loadAssetListDetails(selectedAssetList.id);
    } catch (err) {
      console.error('Failed to upload MG video:', err);
    }
  };

  const handleDeleteMGVideo = async (slideNumber) => {
    if (!selectedAssetList?.id || !slideNumber) {
      console.error('Delete MG video failed: missing required data');
      return;
    }
    try {
      await deleteMotionGraphicsVideo(selectedAssetList.id, slideNumber);
      await loadAssetListDetails(selectedAssetList.id);
    } catch (err) {
      console.error('Failed to delete MG video:', err);
    }
  };

  const handleAddScene = (slideNumber) => {
    setAddingSceneForSlide(slideNumber);
  };

  const handleSaveNewScene = async (slideNumber, prompt) => {
    if (!selectedAssetList?.id || !slideNumber) {
      console.error('Add scene failed: missing required data');
      return;
    }
    try {
      const slideNum = parseInt(slideNumber, 10);
      if (isNaN(slideNum)) {
        console.error('Add scene failed: invalid slide number');
        return;
      }
      await addMGScene(selectedAssetList.id, slideNum, { prompt });
      setAddingSceneForSlide(null);
      await loadAssetListDetails(selectedAssetList.id);
    } catch (err) {
      console.error('Failed to add scene:', err);
    }
  };

  const handleDeleteScene = (scene) => {
    setDeletingScene(scene);
  };

  const handleConfirmDeleteScene = async () => {
    if (!deletingScene?.id) {
      console.error('Delete scene failed: missing scene ID');
      return;
    }
    try {
      await deleteMGScene(deletingScene.id);
      setDeletingScene(null);
      if (selectedAssetList) {
        await loadAssetListDetails(selectedAssetList.id);
      }
    } catch (err) {
      console.error('Failed to delete scene:', err);
    }
  };

  // Audio handlers
  const handleGenerateAudio = async (audioId, options = {}) => {
    if (!generateAudio) return;
    try {
      await generateAudio(audioId, options);
      if (selectedAssetList) {
        await loadAssetListDetails(selectedAssetList.id);
      }
    } catch (err) {
      console.error('Audio generation failed:', err);
    }
  };

  const handleUploadAudio = async (audioId, file) => {
    if (!uploadAudio || !audioId || !file) return;
    try {
      await uploadAudio(audioId, file);
      if (selectedAssetList) {
        await loadAssetListDetails(selectedAssetList.id);
      }
    } catch (err) {
      console.error('Audio upload failed:', err);
    }
  };

  const handleEditNarration = async (audioId, updates) => {
    if (updates.editText) {
      // Open modal for text editing
      const audio = generatedAudioList.find(a => a.id === audioId);
      setEditingNarration(audio);
    } else if (updateAudio) {
      // Direct update (e.g., voice change)
      try {
        await updateAudio(audioId, updates);
        if (selectedAssetList) {
          await loadAssetListDetails(selectedAssetList.id);
        }
      } catch (err) {
        console.error('Failed to update narration:', err);
      }
    }
  };

  const handleSaveNarration = async (audioId, narrationText) => {
    if (!updateAudio) return;
    try {
      await updateAudio(audioId, { narrationText });
      if (selectedAssetList) {
        await loadAssetListDetails(selectedAssetList.id);
      }
      setEditingNarration(null);
    } catch (err) {
      console.error('Failed to save narration:', err);
    }
  };

  const handleRegenerateAudio = async (audioId, options = {}) => {
    if (!regenerateAudio) return;
    try {
      await regenerateAudio(audioId, options);
      if (selectedAssetList) {
        await loadAssetListDetails(selectedAssetList.id);
      }
    } catch (err) {
      console.error('Audio regeneration failed:', err);
    }
  };

  const handleSelectAudio = (audio) => {
    setSelectedAudio(audio);
    setSelectedImage(null); // Deselect image when audio is selected
  };

  const handleSetDefaultVoice = async (voiceId, voiceName) => {
    if (!setSessionDefaultVoice || !selectedAssetList?.id) return;
    try {
      await setSessionDefaultVoice(selectedAssetList.id, voiceId, voiceName);
      // Refresh asset list to get updated default voice
      await loadAssetListDetails(selectedAssetList.id);
    } catch (err) {
      console.error('Failed to set default voice:', err);
    }
  };

  // Get unique modules and sessions from asset lists
  const modules = [...new Set(assetLists.map(l => l.moduleName))];
  const sessions = assetLists
    .filter(l => l.moduleName === selectedModule)
    .map(l => ({
      number: l.sessionNumber,
      title: l.sessionTitle,
      type: l.sessionType || 'regular',
      id: l.id
    }))
    .sort((a, b) => {
      // Sort by session number first
      if (a.number !== b.number) return a.number - b.number;
      // Then sort by type: regular first, then rcp, rca, review
      const typeOrder = { regular: 0, rcp: 1, rca: 2, review: 3 };
      return (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99);
    });

  // Filter current asset list
  const filteredAssetList = sessions.find(s =>
    selectedSession ? s.id === selectedSession : true
  );

  return (
    <div className="image-generator">
      <div className="image-gen-left">
        {/* Module/Session Selector */}
        <div className="image-gen-selectors">
          <div className="selector-group">
            <label>Module</label>
            <select
              value={selectedModule}
              onChange={(e) => {
                setSelectedModule(e.target.value);
                setSelectedSession('');
                setSelectedAssetList(null);
                setSelectedAssessment(null);
                setGeneratedImages([]);
                setAssessmentAssets([]);
              }}
            >
              <option value="">Select Module...</option>
              {modules.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div className="selector-group">
            <label>Session</label>
            <select
              value={selectedSession}
              onChange={(e) => {
                const value = e.target.value;
                setSelectedSession(value);

                if (!value) {
                  setSelectedAssetList(null);
                  setSelectedAssessment(null);
                  setGeneratedImages([]);
                  return;
                }

                // Check if selection is an assessment
                if (value.startsWith('assessment:')) {
                  const assessmentId = value.replace('assessment:', '');
                  loadAssessmentDetails(assessmentId);
                } else {
                  // Regular session
                  const session = sessions.find(s => s.id === value);
                  if (session) {
                    handleSelectAssetList({ id: session.id });
                  }
                }
              }}
              disabled={!selectedModule}
            >
              <option value="">Select Session...</option>
              {/* Assessment options (Pre-Test, Post-Test) */}
              {assessmentAssets.map(a => (
                <option key={a.id} value={`assessment:${a.id}`}>
                  {a.assessmentType === 'pre_test' ? 'Pre-Test' : 'Post-Test'}
                </option>
              ))}
              {/* Session options (including RCA/RCP) */}
              {sessions.map(s => (
                <option key={s.id} value={s.id}>
                  Session {s.number}{s.type && s.type !== 'regular' ? ` ${s.type.toUpperCase()}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="selector-group">
            <label>Default Voice</label>
            <select
              value={selectedAssetList?.defaultVoiceId || ''}
              onChange={(e) => {
                const voice = voices.find(v => v.voice_id === e.target.value);
                handleSetDefaultVoice(e.target.value, voice?.name || '');
              }}
              disabled={!selectedAssetList}
            >
              <option value="">Select Voice...</option>
              {voices.map(v => (
                <option key={v.voice_id} value={v.voice_id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Character Panel - hide when assessment is selected */}
        {selectedModule && characters.length > 0 && !selectedAssessment && (
          <CharacterPanel
            characters={characters}
            onSetAnchor={handleSetAnchor}
            onRemoveReferenceImage={handleRemoveReferenceImage}
          />
        )}

        {/* Asset List for regular sessions */}
        {selectedAssetList && !selectedAssessment && (
          <AssetList
            assets={selectedAssetList.assets}
            slides={selectedAssetList.slides}
            generatedImages={generatedImages}
            motionGraphicsVideos={motionGraphicsVideos}
            generatedAudio={generatedAudioList}
            voices={voices}
            defaultVoiceId={selectedAssetList.defaultVoiceId}
            onGenerate={handleGenerate}
            onUpload={handleUpload}
            onImport={handleOpenLibraryPicker}
            onEditPrompt={handleEditPrompt}
            onSelectImage={(img) => { setSelectedImage(img); setSelectedAudio(null); }}
            onSelectVideo={(vid) => { setSelectedImage(vid); setSelectedAudio(null); }}
            onUploadMGVideo={handleUploadMGVideo}
            onDeleteMGVideo={handleDeleteMGVideo}
            onAddScene={handleAddScene}
            onDeleteScene={handleDeleteScene}
            onGenerateAudio={handleGenerateAudio}
            onUploadAudio={handleUploadAudio}
            onEditNarration={handleEditNarration}
            onSelectAudio={handleSelectAudio}
            selectedImageId={selectedImage?.id}
            selectedVideoId={selectedImage?.videoPath ? selectedImage?.id : null}
            selectedAudioId={selectedAudio?.id}
            loading={loading}
          />
        )}

        {/* Assessment Asset Display */}
        {selectedAssessment && (
          <div className="assessment-content">
            <div className="assessment-header">
              <h3>{selectedAssessment.assessmentType === 'pre_test' ? 'Pre-Test' : 'Post-Test'}</h3>
              <span className="question-count">{selectedAssessment.questions?.length || 0} Questions</span>
            </div>
            <div className="assessment-questions">
              {loading ? (
                <div className="loading-indicator">Loading assessment...</div>
              ) : (
                (selectedAssessment.questions || []).map((question, index) => {
                  const questionNum = question.questionNumber || (index + 1);
                  const questionImage = generatedImages.find(img => img.questionNumber === questionNum);
                  return (
                    <div
                      key={question.id || index}
                      className={`assessment-question-card ${selectedImage?.id === questionImage?.id ? 'selected' : ''}`}
                      onClick={() => questionImage && setSelectedImage(questionImage)}
                    >
                      <div className="question-number">Q{questionNum}</div>
                      <div className="question-content">
                        <p className="question-text">{question.scenario}</p>
                        {question.visual?.description && (
                          <p className="visual-prompt">{question.visual.description}</p>
                        )}
                        {question.visual?.type && (
                          <span className="visual-type-badge">{question.visual.type}</span>
                        )}
                      </div>
                      <div className="question-image-status">
                        {questionImage?.imagePath ? (
                          <img
                            src={questionImage.imagePath}
                            alt={`Q${index + 1}`}
                            className="question-thumbnail"
                          />
                        ) : questionImage?.status === 'generating' ? (
                          <span className="status-generating">Generating...</span>
                        ) : (
                          <span className="status-pending">No image</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

      </div>

      <div className="image-gen-right">
        {/* Preview Panel */}
        <ImagePreview
          image={selectedImage}
          audio={selectedAudio}
          onRegenerate={handleRegenerate}
          onRegenerateAudio={handleRegenerateAudio}
        />

        {/* Generation Queue */}
        <div className="generation-queue">
          <h3>Generation Queue</h3>
          <div className="queue-list">
            {generatedImages.filter(img => img.status !== 'pending').length === 0 ? (
              <p className="queue-empty">No images in queue</p>
            ) : (
              generatedImages
                .filter(img => img.status !== 'pending')
                .map(img => (
                  <div
                    key={img.id}
                    className={`queue-item status-${img.status} ${selectedImage?.id === img.id ? 'selected' : ''}`}
                    onClick={() => setSelectedImage(img)}
                    style={{ cursor: 'pointer' }}
                  >
                    <span className="queue-slide">
                      {selectedAssessment
                        ? `Q${img.questionNumber || img.slideNumber}`
                        : `S${selectedAssetList?.sessionNumber}.Slide${img.slideNumber}`}
                    </span>
                    <span className="queue-status">{img.status.toUpperCase()}</span>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>

      {/* Prompt Editor Modal */}
      {editingImage && (
        <PromptEditor
          image={editingImage}
          onSave={handleSavePrompt}
          onClose={() => setEditingImage(null)}
        />
      )}

      {/* Library Picker Modal */}
      {importingForImage && (
        <LibraryPicker
          onSelect={handleImportFromLibrary}
          onClose={() => setImportingForImage(null)}
          getLibrary={getLibrary}
          getGeneratedImages={getGeneratedImages}
          mediaType="all"
        />
      )}

      {/* Add Scene Modal */}
      {addingSceneForSlide && (
        <PromptEditor
          mode="add"
          image={{ slideNumber: addingSceneForSlide, assetType: 'motion_graphics' }}
          onSave={(_, prompt) => handleSaveNewScene(addingSceneForSlide, prompt)}
          onClose={() => setAddingSceneForSlide(null)}
        />
      )}

      {/* Delete Scene Confirmation Dialog */}
      {deletingScene && (
        <div className="prompt-editor-overlay" onClick={() => setDeletingScene(null)}>
          <div className="delete-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="delete-confirm-header">
              <h3>Delete Scene</h3>
            </div>
            <div className="delete-confirm-body">
              <p>Are you sure you want to delete Scene {deletingScene.assetNumber || 1} from Slide {deletingScene.slideNumber}?</p>
              {deletingScene.imagePath && (
                <p className="delete-warning">This will also delete the generated image.</p>
              )}
            </div>
            <div className="delete-confirm-footer">
              <button className="btn-cancel" onClick={() => setDeletingScene(null)}>
                Cancel
              </button>
              <button className="btn-danger-confirm" onClick={handleConfirmDeleteScene}>
                Delete Scene
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Narration Text Editor Modal */}
      {editingNarration && (
        <div className="prompt-editor-overlay" onClick={() => setEditingNarration(null)}>
          <div className="prompt-editor narration-editor" onClick={(e) => e.stopPropagation()}>
            <div className="prompt-editor-header">
              <h3>Edit Narration - Slide {editingNarration.slideNumber}</h3>
              <button className="btn-close" onClick={() => setEditingNarration(null)}>×</button>
            </div>
            <div className="prompt-editor-body">
              <label>Narration Text</label>
              <textarea
                defaultValue={editingNarration.narrationText || ''}
                placeholder="Enter narration text..."
                id="narration-text-input"
              />
            </div>
            <div className="prompt-editor-footer">
              <button className="btn-cancel" onClick={() => setEditingNarration(null)}>
                Cancel
              </button>
              <button
                className="btn-save"
                onClick={() => {
                  const textarea = document.getElementById('narration-text-input');
                  if (textarea) {
                    handleSaveNarration(editingNarration.id, textarea.value);
                  }
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
