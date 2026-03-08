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
  deleteMGScene
}) {
  const [assetLists, setAssetLists] = useState([]);
  const [selectedAssetList, setSelectedAssetList] = useState(null);
  const [generatedImages, setGeneratedImages] = useState([]);
  const [motionGraphicsVideos, setMotionGraphicsVideos] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [editingImage, setEditingImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importingForImage, setImportingForImage] = useState(null); // image ID we're importing for
  const [deletingScene, setDeletingScene] = useState(null); // scene being deleted (confirmation)
  const [addingSceneForSlide, setAddingSceneForSlide] = useState(null); // slideNumber when adding scene

  // Module/Session filters
  const [selectedModule, setSelectedModule] = useState('');
  const [selectedSession, setSelectedSession] = useState('');

  // Load asset lists on mount
  useEffect(() => {
    loadAssetLists();
  }, []);

  // Load characters when module changes
  useEffect(() => {
    if (selectedModule) {
      loadCharacters(selectedModule);
    }
  }, [selectedModule]);

  // Poll for image generation status
  useEffect(() => {
    const hasGenerating = generatedImages.some(img => img.status === 'generating');
    if (!hasGenerating) return;

    const interval = setInterval(async () => {
      if (selectedAssetList) {
        await loadAssetListDetails(selectedAssetList.id);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [generatedImages, selectedAssetList]);

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
    loadAssetListDetails(assetList.id);
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

  const handleSetAnchor = async (characterId, file) => {
    try {
      const formData = new FormData();
      formData.append('anchor', file);
      await setCharacterAnchor(characterId, formData);
      await loadCharacters(selectedModule);
    } catch (err) {
      console.error('Failed to set anchor:', err);
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

  // Get unique modules and sessions from asset lists
  const modules = [...new Set(assetLists.map(l => l.moduleName))];
  const sessions = assetLists
    .filter(l => l.moduleName === selectedModule)
    .map(l => ({ number: l.sessionNumber, title: l.sessionTitle, id: l.id }))
    .sort((a, b) => a.number - b.number);

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
                setGeneratedImages([]);
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
                setSelectedSession(e.target.value);
                if (e.target.value) {
                  const session = sessions.find(s => s.id === e.target.value);
                  if (session) {
                    handleSelectAssetList({ id: session.id });
                  }
                }
              }}
              disabled={!selectedModule}
            >
              <option value="">Select Session...</option>
              {sessions.map(s => (
                <option key={s.id} value={s.id}>
                  Session {s.number}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Character Panel */}
        {selectedModule && characters.length > 0 && (
          <CharacterPanel
            characters={characters}
            onSetAnchor={handleSetAnchor}
          />
        )}

        {/* Asset List */}
        {selectedAssetList && (
          <AssetList
            assets={selectedAssetList.assets}
            slides={selectedAssetList.slides}
            generatedImages={generatedImages}
            motionGraphicsVideos={motionGraphicsVideos}
            onGenerate={handleGenerate}
            onUpload={handleUpload}
            onImport={handleOpenLibraryPicker}
            onEditPrompt={handleEditPrompt}
            onSelectImage={setSelectedImage}
            onUploadMGVideo={handleUploadMGVideo}
            onDeleteMGVideo={handleDeleteMGVideo}
            onAddScene={handleAddScene}
            onDeleteScene={handleDeleteScene}
            selectedImageId={selectedImage?.id}
            loading={loading}
          />
        )}

      </div>

      <div className="image-gen-right">
        {/* Preview Panel */}
        <ImagePreview
          image={selectedImage}
          onRegenerate={handleRegenerate}
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
                    <span className="queue-slide">S{selectedAssetList?.sessionNumber}.Slide{img.slideNumber}</span>
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
    </div>
  );
}
