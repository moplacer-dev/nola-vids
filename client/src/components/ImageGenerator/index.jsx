import { useState, useEffect, useRef, useCallback } from 'react';
import AssetList from './AssetList';
import CharacterPanel from './CharacterPanel';
import PromptEditor from './PromptEditor';
import ImagePreview from './ImagePreview';
import LibraryPicker from './LibraryPicker';
import AssessmentNarrationPanel from './AssessmentNarrationPanel';
import CmsSyncModal from './CmsSyncModal';
import AssessmentCmsSyncModal from './AssessmentCmsSyncModal';
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
  // Assessment CMS Sync
  fetchAssessmentCmsSync,
  pushAssessmentAudioToCms,
  pushAssessmentImageToCms,
  updateAssessmentNarrationFromCms
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
  const [deletingAsset, setDeletingAsset] = useState(null); // asset being deleted (confirmation)
  const [addingAssetForSlide, setAddingAssetForSlide] = useState(null); // slideNumber when adding asset
  const [deletingAudio, setDeletingAudio] = useState(null); // audio being deleted (confirmation)

  // CMS Sync state
  const [cmsAvailable, setCmsAvailable] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncData, setSyncData] = useState(null);
  const [syncing, setSyncing] = useState(false);

  // Assessment CMS Sync state
  const [assessmentSyncModalOpen, setAssessmentSyncModalOpen] = useState(false);
  const [assessmentSyncData, setAssessmentSyncData] = useState(null);
  const [assessmentSyncing, setAssessmentSyncing] = useState(false);

  // Module/Session filters
  const [selectedModule, setSelectedModule] = useState('');
  const [selectedSession, setSelectedSession] = useState('');

  // Assessment assets state
  const [assessmentAssets, setAssessmentAssets] = useState([]);
  const [selectedAssessment, setSelectedAssessment] = useState(null);
  const [assessmentAudioList, setAssessmentAudioList] = useState([]);

  // Load asset lists, voices, and check CMS status on mount
  useEffect(() => {
    loadAssetLists();
    loadVoices();
    loadCmsStatus();
  }, []);

  const loadCmsStatus = async () => {
    try {
      if (checkCmsStatus) {
        const result = await checkCmsStatus();
        setCmsAvailable(result?.available || false);
      }
    } catch (err) {
      console.error('Failed to check CMS status:', err);
      setCmsAvailable(false);
    }
  };

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

  // Track generating state in refs to avoid polling restart on every state update
  const generatingStateRef = useRef({
    hasGeneratingImages: false,
    generatingAudioIds: [],
    selectedAssetListId: null,
    selectedAssessmentId: null
  });

  // Update refs when state changes
  useEffect(() => {
    generatingStateRef.current = {
      hasGeneratingImages: generatedImages.some(img => img.status === 'generating'),
      generatingAudioIds: [
        ...generatedAudioList.filter(a => a.status === 'generating').map(a => a.id),
        ...assessmentAudioList.filter(a => a.status === 'generating').map(a => a.id)
      ],
      selectedAssetListId: selectedAssetList?.id,
      selectedAssessmentId: selectedAssessment?.id
    };
  }, [generatedImages, generatedAudioList, assessmentAudioList, selectedAssetList, selectedAssessment]);

  // Stable polling function using refs
  const pollGenerationStatus = useCallback(async () => {
    const state = generatingStateRef.current;
    if (!state.hasGeneratingImages && state.generatingAudioIds.length === 0) return;

    const tasks = [];

    // Image polling task
    if (state.hasGeneratingImages) {
      if (state.selectedAssetListId) {
        tasks.push(loadAssetListDetails(state.selectedAssetListId));
      } else if (state.selectedAssessmentId) {
        tasks.push(loadAssessmentDetails(state.selectedAssessmentId));
      }
    }

    // Audio polling task (lightweight status check)
    if (state.generatingAudioIds.length > 0 && checkAudioStatus) {
      tasks.push(
        checkAudioStatus(state.generatingAudioIds)
          .then(result => {
            if (result?.records) {
              const statusMap = new Map(result.records.map(r => [r.id, r]));

              setGeneratedAudioList(prev => prev.map(audio => {
                const update = statusMap.get(audio.id);
                return update ? { ...audio, ...update } : audio;
              }));

              setAssessmentAudioList(prev => prev.map(audio => {
                const update = statusMap.get(audio.id);
                return update ? { ...audio, ...update } : audio;
              }));

              setSelectedAudio(prev => {
                if (!prev) return prev;
                const update = statusMap.get(prev.id);
                return update ? { ...prev, ...update } : prev;
              });
            }
          })
          .catch(err => {
            console.error('Failed to check audio status:', err);
          })
      );
    }

    if (tasks.length > 0) {
      await Promise.all(tasks);
    }
  }, [checkAudioStatus]);

  // Poll for image and audio generation status - stable interval that doesn't restart
  useEffect(() => {
    const interval = setInterval(pollGenerationStatus, 5000);
    return () => clearInterval(interval);
  }, [pollGenerationStatus]);

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
      // Load assessment audio records
      setAssessmentAudioList(data.generatedAudio || []);

      // Update selectedImage if it exists in the new data (fixes preview not updating after upload/regenerate)
      setSelectedImage(prev => {
        if (!prev) return prev;
        const updated = (data.generatedImages || []).find(img => img.id === prev.id);
        return updated || prev;
      });
    } catch (err) {
      console.error('Failed to load assessment:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async (imageId, options = {}) => {
    try {
      // Optimistically update the image status to 'generating'
      setGeneratedImages(prev => prev.map(img =>
        img.id === imageId ? { ...img, status: 'generating' } : img
      ));
      setSelectedImage(prev =>
        prev?.id === imageId ? { ...prev, status: 'generating' } : prev
      );

      await generateImage(imageId, options);
      // Polling will pick up the completed status - no need to reload
    } catch (err) {
      console.error('Generation failed:', err);
      // Revert optimistic update on error
      setGeneratedImages(prev => prev.map(img =>
        img.id === imageId ? { ...img, status: 'failed' } : img
      ));
    }
  };

  const handleRegenerate = async (imageId, options = {}) => {
    try {
      // Optimistically update the image status to 'generating'
      setGeneratedImages(prev => prev.map(img =>
        img.id === imageId ? { ...img, status: 'generating' } : img
      ));
      setSelectedImage(prev =>
        prev?.id === imageId ? { ...prev, status: 'generating' } : prev
      );

      await regenerateImage(imageId, options);
      // Polling will pick up the completed status - no need to reload
    } catch (err) {
      console.error('Regeneration failed:', err);
      // Revert optimistic update on error
      setGeneratedImages(prev => prev.map(img =>
        img.id === imageId ? { ...img, status: 'failed' } : img
      ));
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
      } else if (selectedAssessment) {
        await loadAssessmentDetails(selectedAssessment.id);
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
      } else if (selectedAssessment) {
        await loadAssessmentDetails(selectedAssessment.id);
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
      } else if (selectedAssessment) {
        await loadAssessmentDetails(selectedAssessment.id);
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

  const handleAddAsset = (slideNumber) => {
    setAddingAssetForSlide(slideNumber);
  };

  const handleSaveNewAsset = async (slideNumber, prompt, assetType) => {
    if (!selectedAssetList?.id || !slideNumber) {
      console.error('Add asset failed: missing required data');
      return;
    }
    try {
      const slideNum = parseInt(slideNumber, 10);
      if (isNaN(slideNum)) {
        console.error('Add asset failed: invalid slide number');
        return;
      }
      await addMGScene(selectedAssetList.id, slideNum, { prompt, assetType });
      setAddingAssetForSlide(null);
      await loadAssetListDetails(selectedAssetList.id);
    } catch (err) {
      console.error('Failed to add asset:', err);
    }
  };

  const handleDeleteAsset = (asset) => {
    setDeletingAsset(asset);
  };

  const handleConfirmDeleteAsset = async () => {
    if (!deletingAsset?.id) {
      console.error('Delete asset failed: missing asset ID');
      return;
    }
    try {
      await deleteMGScene(deletingAsset.id);
      setDeletingAsset(null);
      if (selectedAssetList) {
        await loadAssetListDetails(selectedAssetList.id);
      }
    } catch (err) {
      console.error('Failed to delete asset:', err);
    }
  };

  // Audio handlers - use optimistic updates instead of full refetch
  const handleGenerateAudio = async (audioId, options = {}) => {
    if (!generateAudio) return;
    try {
      // Optimistic update: set status to 'generating' immediately
      setGeneratedAudioList(prev => prev.map(audio =>
        audio.id === audioId ? { ...audio, status: 'generating' } : audio
      ));
      setSelectedAudio(prev =>
        prev?.id === audioId ? { ...prev, status: 'generating' } : prev
      );

      await generateAudio(audioId, options);
      // Polling will handle the status update when complete
    } catch (err) {
      console.error('Audio generation failed:', err);
      // Revert on error
      setGeneratedAudioList(prev => prev.map(audio =>
        audio.id === audioId ? { ...audio, status: 'failed' } : audio
      ));
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

  const handleSaveNarration = async (audioId, narrationText, narrationType) => {
    if (!updateAudio) return;
    try {
      const updates = { narrationText };
      if (narrationType) {
        updates.narrationType = narrationType;
      }
      await updateAudio(audioId, updates);
      if (selectedAssetList) {
        await loadAssetListDetails(selectedAssetList.id);
      } else if (selectedAssessment) {
        await loadAssessmentDetails(selectedAssessment.id);
      }
      setEditingNarration(null);
    } catch (err) {
      console.error('Failed to save narration:', err);
    }
  };

  const handleRegenerateAudio = async (audioId, options = {}) => {
    if (!regenerateAudio) return;
    try {
      // Optimistic update: set status to 'generating' immediately
      setGeneratedAudioList(prev => prev.map(audio =>
        audio.id === audioId ? { ...audio, status: 'generating' } : audio
      ));
      setSelectedAudio(prev =>
        prev?.id === audioId ? { ...prev, status: 'generating' } : prev
      );

      await regenerateAudio(audioId, options);
      // Polling will handle the status update when complete
    } catch (err) {
      console.error('Audio regeneration failed:', err);
      // Revert on error
      setGeneratedAudioList(prev => prev.map(audio =>
        audio.id === audioId ? { ...audio, status: 'failed' } : audio
      ));
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

  const handleSetAssessmentDefaultVoice = async (voiceId, voiceName) => {
    if (!setAssessmentDefaultVoice || !selectedAssessment?.id) return;
    try {
      await setAssessmentDefaultVoice(selectedAssessment.id, voiceId, voiceName);
      await loadAssessmentDetails(selectedAssessment.id);
    } catch (err) {
      console.error('Failed to set assessment default voice:', err);
    }
  };

  // Assessment audio handlers - use optimistic updates
  const handleGenerateAssessmentAudio = async (audioId, options = {}) => {
    if (!generateAssessmentAudio) return;
    try {
      // Optimistic update: set status to 'generating' immediately
      setAssessmentAudioList(prev => prev.map(audio =>
        audio.id === audioId ? { ...audio, status: 'generating' } : audio
      ));
      setSelectedAudio(prev =>
        prev?.id === audioId ? { ...prev, status: 'generating' } : prev
      );

      await generateAssessmentAudio(audioId, options);
      // Polling will handle the status update when complete
    } catch (err) {
      console.error('Assessment audio generation failed:', err);
      // Revert on error
      setAssessmentAudioList(prev => prev.map(audio =>
        audio.id === audioId ? { ...audio, status: 'failed' } : audio
      ));
    }
  };

  const handleGenerateAllAssessmentAudio = async (questionNumber) => {
    if (!generateBulkAudio || !selectedAssessment) return;
    try {
      // Optimistic update: set all pending audio for this question to 'generating'
      setAssessmentAudioList(prev => prev.map(audio =>
        audio.questionNumber === questionNumber && audio.status === 'pending'
          ? { ...audio, status: 'generating' }
          : audio
      ));

      await generateBulkAudio({
        assessmentAssetId: selectedAssessment.id,
        questionNumber,
        voiceId: selectedAssessment?.defaultVoiceId
      });
      // Polling will handle the status updates when complete
    } catch (err) {
      console.error('Bulk audio generation failed:', err);
      // Revert on error
      setAssessmentAudioList(prev => prev.map(audio =>
        audio.questionNumber === questionNumber && audio.status === 'generating'
          ? { ...audio, status: 'pending' }
          : audio
      ));
    }
  };

  const handleUploadAssessmentAudio = async (audioId, file) => {
    if (!uploadAudio || !audioId || !file) return;
    try {
      await uploadAudio(audioId, file);
      if (selectedAssessment) {
        await loadAssessmentDetails(selectedAssessment.id);
      }
    } catch (err) {
      console.error('Assessment audio upload failed:', err);
    }
  };

  const handleEditAssessmentNarration = async (audioId, updates) => {
    if (updates.editText) {
      // Open modal for text editing
      const audio = assessmentAudioList.find(a => a.id === audioId);
      setEditingNarration(audio);
    } else if (updateAudio) {
      // Direct update (e.g., voice change)
      try {
        await updateAudio(audioId, updates);
        if (selectedAssessment) {
          await loadAssessmentDetails(selectedAssessment.id);
        }
      } catch (err) {
        console.error('Failed to update assessment narration:', err);
      }
    }
  };

  // Handler for generating all audio for an RCP slide
  const handleGenerateAllSlideAudio = async (slideNumber) => {
    if (!generateBulkAudio || !selectedAssetList) return;
    try {
      await generateBulkAudio({
        assetListId: selectedAssetList.id,
        slideNumber,
        voiceId: selectedAssetList.defaultVoiceId
      });
      // Refresh to get updated status
      await loadAssetListDetails(selectedAssetList.id);
    } catch (err) {
      console.error('Bulk audio generation failed:', err);
    }
  };

  // Handler for adding a new narration part
  const handleAddNarration = async (context) => {
    if (!createAudio) return;
    try {
      const result = await createAudio(context);
      // Optimistically add the new audio record to the correct state (prevents scroll reset)
      if (result?.audio) {
        if (context.assessmentAssetId) {
          setAssessmentAudioList(prev => [...prev, result.audio]);
        } else {
          setGeneratedAudioList(prev => [...prev, result.audio]);
        }
      }
    } catch (err) {
      console.error('Failed to create audio:', err);
    }
  };

  // Handler for deleting a narration part
  const handleDeleteNarration = async (audioId) => {
    if (!deleteAudio) return;
    try {
      // Clear selection if this was the selected audio
      if (selectedAudio?.id === audioId) {
        setSelectedAudio(null);
      }
      await deleteAudio(audioId);
      setDeletingAudio(null);
      // Optimistically remove the audio record from the correct state (prevents scroll reset)
      if (selectedAssessment) {
        setAssessmentAudioList(prev => prev.filter(a => a.id !== audioId));
      } else {
        setGeneratedAudioList(prev => prev.filter(a => a.id !== audioId));
      }
    } catch (err) {
      console.error('Failed to delete audio:', err);
    }
  };

  // CMS Sync handlers
  const handleOpenSyncModal = async () => {
    if (!selectedAssetList?.id || !fetchCmsSync) return;

    setSyncing(true);
    setSyncModalOpen(true);
    setSyncData(null);

    try {
      const data = await fetchCmsSync(selectedAssetList.id);
      setSyncData(data);
    } catch (err) {
      console.error('Failed to fetch sync data:', err);
      setSyncData({ error: err.message });
    } finally {
      setSyncing(false);
    }
  };

  const handleAddSlideFromCms = async (slideNumber, cmsPageId) => {
    if (!selectedAssetList?.id || !addSlideFromCms) return;

    try {
      await addSlideFromCms(selectedAssetList.id, slideNumber, cmsPageId);
      // Refresh sync data and asset list
      const [syncResult] = await Promise.all([
        fetchCmsSync(selectedAssetList.id),
        loadAssetListDetails(selectedAssetList.id)
      ]);
      setSyncData(syncResult);
    } catch (err) {
      console.error('Failed to add slide from CMS:', err);
      throw err; // Re-throw so useApi error toast shows
    }
  };

  const handleDeleteSlideFromNola = async (slideNumber) => {
    if (!selectedAssetList?.id || !deleteSlideFromNola) return;

    try {
      await deleteSlideFromNola(selectedAssetList.id, slideNumber);

      // Renumber subsequent slides (shift slides after deleted one down by 1)
      if (renumberSlides) {
        await renumberSlides(selectedAssetList.id, -1, slideNumber + 1);
      }

      // Refresh sync data and asset list
      const [syncResult] = await Promise.all([
        fetchCmsSync(selectedAssetList.id),
        loadAssetListDetails(selectedAssetList.id)
      ]);
      setSyncData(syncResult);
    } catch (err) {
      console.error('Failed to delete slide:', err);
      throw err; // Re-throw so useApi error toast shows
    }
  };

  const handleUpdateNarration = async (slideNumber, narrationText, pageId) => {
    if (!selectedAssetList?.id || !updateNarrationFromCms) return;

    try {
      await updateNarrationFromCms(selectedAssetList.id, slideNumber, narrationText, pageId);
      // Refresh sync data and asset list
      const [syncResult] = await Promise.all([
        fetchCmsSync(selectedAssetList.id),
        loadAssetListDetails(selectedAssetList.id)
      ]);
      setSyncData(syncResult);
    } catch (err) {
      console.error('Failed to update narration:', err);
      throw err; // Re-throw so useApi error toast shows
    }
  };

  // CMS Push handler with optimistic UI update
  const handlePushToCms = async (assetId, assetType) => {
    if (!assetId || !assetType) return;

    // Optimistic update: immediately show "Pushing..." state
    if (assetType === 'image' || assetType === 'video') {
      setGeneratedImages(prev => prev.map(img =>
        img.id === assetId ? { ...img, cmsPushStatus: 'pushing' } : img
      ));
    } else if (assetType === 'audio') {
      setGeneratedAudioList(prev => prev.map(audio =>
        audio.id === assetId ? { ...audio, cmsPushStatus: 'pushing' } : audio
      ));
    } else if (assetType === 'mg-video') {
      setMotionGraphicsVideos(prev => prev.map(video =>
        video.id === assetId ? { ...video, cmsPushStatus: 'pushing' } : video
      ));
    }

    try {
      if (assetType === 'image') {
        await pushImageToCms(assetId);
        setGeneratedImages(prev => prev.map(img =>
          img.id === assetId ? { ...img, cmsPushStatus: 'pushed' } : img
        ));
      } else if (assetType === 'video') {
        await pushVideoToCms(assetId);
        setGeneratedImages(prev => prev.map(img =>
          img.id === assetId ? { ...img, cmsPushStatus: 'pushed' } : img
        ));
      } else if (assetType === 'audio') {
        await pushAudioToCms(assetId);
        setGeneratedAudioList(prev => prev.map(audio =>
          audio.id === assetId ? { ...audio, cmsPushStatus: 'pushed' } : audio
        ));
      } else if (assetType === 'mg-video') {
        await pushMgVideoToCms(assetId);
        setMotionGraphicsVideos(prev => prev.map(video =>
          video.id === assetId ? { ...video, cmsPushStatus: 'pushed' } : video
        ));
      }
    } catch (err) {
      console.error(`Failed to push ${assetType} to CMS:`, err);
      // Revert optimistic update on error
      if (selectedAssetList) {
        await loadAssetListDetails(selectedAssetList.id);
      }
    }
  };

  // Assessment CMS Sync handlers
  const handleOpenAssessmentSyncModal = async () => {
    if (!selectedAssessment?.id || !fetchAssessmentCmsSync) return;

    setAssessmentSyncing(true);
    setAssessmentSyncModalOpen(true);
    setAssessmentSyncData(null);

    try {
      const data = await fetchAssessmentCmsSync(selectedAssessment.id);
      setAssessmentSyncData(data);
      // Refresh assessment to get updated cmsPageMapping
      await loadAssessmentDetails(selectedAssessment.id);
    } catch (err) {
      console.error('Failed to fetch assessment sync data:', err);
      setAssessmentSyncData({ error: err.message });
    } finally {
      setAssessmentSyncing(false);
    }
  };

  // Assessment update narration handler
  const handleAssessmentUpdateNarration = async (questionKey, narrationText, pageId) => {
    if (!selectedAssessment?.id || !updateAssessmentNarrationFromCms) return;

    try {
      await updateAssessmentNarrationFromCms(selectedAssessment.id, questionKey, narrationText, pageId);
      // Refresh sync data and assessment
      const [syncResult] = await Promise.all([
        fetchAssessmentCmsSync(selectedAssessment.id),
        loadAssessmentDetails(selectedAssessment.id)
      ]);
      setAssessmentSyncData(syncResult);
    } catch (err) {
      console.error('Failed to update assessment narration:', err);
      throw err; // Re-throw so useApi error toast shows
    }
  };

  // Assessment CMS Push handler with optimistic updates
  const handleAssessmentPushToCms = async (assetId, assetType) => {
    if (!assetId || !assetType) return;

    // Optimistic update: set status to 'pushing' immediately
    if (assetType === 'image') {
      setGeneratedImages(prev => prev.map(img =>
        img.id === assetId ? { ...img, cmsPushStatus: 'pushing' } : img
      ));
    } else if (assetType === 'audio') {
      setAssessmentAudioList(prev => prev.map(audio =>
        audio.id === assetId ? { ...audio, cmsPushStatus: 'pushing' } : audio
      ));
    }

    try {
      if (assetType === 'image') {
        await pushAssessmentImageToCms(assetId);
        // Optimistic success: set status to 'pushed'
        setGeneratedImages(prev => prev.map(img =>
          img.id === assetId ? { ...img, cmsPushStatus: 'pushed' } : img
        ));
      } else if (assetType === 'audio') {
        await pushAssessmentAudioToCms(assetId);
        // Optimistic success: set status to 'pushed'
        setAssessmentAudioList(prev => prev.map(audio =>
          audio.id === assetId ? { ...audio, cmsPushStatus: 'pushed' } : audio
        ));
      }
    } catch (err) {
      console.error(`Failed to push assessment ${assetType} to CMS:`, err);
      // Revert on error
      if (assetType === 'image') {
        setGeneratedImages(prev => prev.map(img =>
          img.id === assetId ? { ...img, cmsPushStatus: 'failed' } : img
        ));
      } else if (assetType === 'audio') {
        setAssessmentAudioList(prev => prev.map(audio =>
          audio.id === assetId ? { ...audio, cmsPushStatus: 'failed' } : audio
        ));
      }
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
              value={selectedAssessment?.defaultVoiceId || selectedAssetList?.defaultVoiceId || ''}
              onChange={(e) => {
                const voice = voices.find(v => v.voice_id === e.target.value);
                if (selectedAssessment) {
                  handleSetAssessmentDefaultVoice(e.target.value, voice?.name || '');
                } else {
                  handleSetDefaultVoice(e.target.value, voice?.name || '');
                }
              }}
              disabled={!selectedAssetList && !selectedAssessment}
            >
              <option value="">Select Voice...</option>
              {voices.map(v => (
                <option key={v.voice_id} value={v.voice_id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>

          {/* Sync with CMS button - only show for regular sessions (not assessments) */}
          {selectedAssetList && !selectedAssessment && cmsAvailable && (
            <div className="selector-group sync-button-group">
              <button
                className="btn-sync-cms"
                onClick={handleOpenSyncModal}
                disabled={syncing}
              >
                {syncing ? 'Syncing...' : 'Sync with CMS'}
              </button>
            </div>
          )}
        </div>

        {/* Character Panel - hide when assessment is selected */}
        {selectedModule && characters.length > 0 && !selectedAssessment && (
          <CharacterPanel
            characters={characters}
            onSetAnchor={handleSetAnchor}
            onRemoveReferenceImage={handleRemoveReferenceImage}
          />
        )}

        {/* Loading state - shown when fetching session/assessment data */}
        {loading && !selectedAssetList && !selectedAssessment && selectedSession && (
          <div className="asset-list">
            <div className="loading-indicator">Loading session data...</div>
          </div>
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
            onAddAsset={handleAddAsset}
            onDeleteAsset={handleDeleteAsset}
            onGenerateAudio={handleGenerateAudio}
            onUploadAudio={handleUploadAudio}
            onEditNarration={handleEditNarration}
            onSelectAudio={handleSelectAudio}
            onGenerateAllAudio={handleGenerateAllSlideAudio}
            onAddNarration={(context) => handleAddNarration({ ...context, assetListId: selectedAssetList?.id })}
            onDeleteNarration={(audioId) => setDeletingAudio({ id: audioId })}
            onPushToCms={handlePushToCms}
            cmsAvailable={cmsAvailable}
            cmsPageMapping={selectedAssetList.cmsPageMapping || {}}
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
              {cmsAvailable && (
                <button
                  className="btn-sync-cms"
                  onClick={handleOpenAssessmentSyncModal}
                  disabled={assessmentSyncing}
                >
                  {assessmentSyncing ? 'Syncing...' : 'Sync with CMS'}
                </button>
              )}
            </div>
            <div className="assessment-questions">
              {loading ? (
                <div className="loading-indicator">Loading assessment...</div>
              ) : (
                (selectedAssessment.questions || []).map((question, index) => {
                  const questionNum = question.questionNumber || (index + 1);
                  const questionImage = generatedImages.find(img => img.slideNumber === questionNum);
                  return (
                    <div
                      key={question.id || index}
                      className={`assessment-question-card ${selectedImage?.id === questionImage?.id ? 'selected' : ''}`}
                      onClick={() => questionImage && setSelectedImage(questionImage)}
                    >
                      <div className="question-row">
                        <div className="question-number">Q{questionNum}</div>
                        <div className="question-content">
                          {/* Badge for question type */}
                          {question.questionType === 'two_part' && (
                            <span className="question-type-badge two-part">Two-Part</span>
                          )}

                          {/* Check if visual is required (type is not 'none') */}
                          {question.visual?.type && question.visual.type.toLowerCase() !== 'none' ? (
                            <>
                              {/* Show visual requirements prominently */}
                              <p className="visual-prompt">{question.visual.description || 'Visual required'}</p>
                              <span className="visual-type-badge">{question.visual.type}</span>
                              {/* Show question context as secondary info for artist reference */}
                              {question.questionType === 'two_part' ? (
                                <div className="question-context secondary">
                                  {question.partA?.stem && <p><strong>Part A:</strong> {question.partA.stem}</p>}
                                  {question.partB?.stem && <p><strong>Part B:</strong> {question.partB.stem}</p>}
                                </div>
                              ) : question.stem && (
                                <p className="question-text secondary">{question.stem}</p>
                              )}
                            </>
                          ) : (
                            /* No visual required - show minimal info */
                            <>
                              <p className="no-visual-message">No visual required for this question</p>
                              <span className="visual-type-badge none">NONE</span>
                            </>
                          )}
                        </div>
                        <div className="question-image-status">
                          {questionImage?.imagePath ? (
                            <img
                              src={(() => {
                                const url = questionImage.imagePath;
                                // Add cache-busting parameter using updatedAt timestamp
                                const cacheBuster = questionImage.updatedAt ? `&_t=${new Date(questionImage.updatedAt).getTime()}` : '';
                                if (url.includes('supabase.co/storage/v1/object/public/')) {
                                  return url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=400&quality=80' + cacheBuster;
                                }
                                return url + (url.includes('?') ? cacheBuster : cacheBuster.replace('&', '?'));
                              })()}
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
                      <div className="question-actions">
                        <button
                          className="btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (questionImage) {
                              handleEditPrompt({
                                ...questionImage,
                                asset: {
                                  prompt: question.visual?.description || question.scenario,
                                }
                              });
                            }
                          }}
                          disabled={!questionImage}
                        >
                          Edit Prompt
                        </button>
                        <input
                          type="file"
                          id={`upload-question-${questionNum}`}
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            if (e.target.files?.[0] && questionImage) {
                              handleUpload(questionImage.id, e.target.files[0]);
                              e.target.value = '';
                            }
                          }}
                        />
                        <button
                          className="btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            document.getElementById(`upload-question-${questionNum}`)?.click();
                          }}
                          disabled={!questionImage}
                        >
                          Upload
                        </button>
                        <button
                          className="btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (questionImage) handleOpenLibraryPicker(questionImage.id);
                          }}
                          disabled={!questionImage}
                        >
                          Import
                        </button>
                        <button
                          className="btn-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (questionImage) handleGenerate(questionImage.id);
                          }}
                          disabled={!questionImage || questionImage?.status === 'generating' || loading}
                        >
                          {questionImage?.status === 'generating' ? 'Generating...' : 'Generate'}
                        </button>
                        {/* Push image to CMS */}
                        {cmsAvailable && questionImage?.imagePath && (
                          <button
                            className={`btn-push-cms ${questionImage?.cmsPushStatus === 'pushed' ? 'pushed' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (questionImage) handleAssessmentPushToCms(questionImage.id, 'image');
                            }}
                            disabled={questionImage?.cmsPushStatus === 'pushing'}
                            title={questionImage?.cmsPushStatus === 'pushed' ? 'Already pushed to CMS' : 'Push to CMS'}
                          >
                            {questionImage?.cmsPushStatus === 'pushing' ? 'Pushing...' : questionImage?.cmsPushStatus === 'pushed' ? 'Pushed' : 'Push'}
                          </button>
                        )}
                      </div>

                      {/* Multi-part Narration Panel for this question */}
                      <AssessmentNarrationPanel
                        questionNumber={questionNum}
                        audioRecords={assessmentAudioList}
                        voices={voices}
                        defaultVoiceId={selectedAssessment?.defaultVoiceId || voices[0]?.voice_id}
                        onGenerateAudio={handleGenerateAssessmentAudio}
                        onGenerateAll={handleGenerateAllAssessmentAudio}
                        onUploadAudio={handleUploadAssessmentAudio}
                        onEditNarration={handleEditAssessmentNarration}
                        onSelectAudio={handleSelectAudio}
                        onAddNarration={(context) => handleAddNarration({ ...context, assessmentAssetId: selectedAssessment?.id })}
                        onDeleteNarration={(audioId) => setDeletingAudio({ id: audioId })}
                        onPushToCms={handleAssessmentPushToCms}
                        cmsAvailable={cmsAvailable}
                        hasCmsPageMapping={!!selectedAssessment?.cmsPageMapping && Object.keys(selectedAssessment.cmsPageMapping).length > 0}
                        selectedAudioId={selectedAudio?.id}
                        loading={loading}
                      />
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
                    <span className="queue-status">{(img.status || 'pending').toUpperCase()}</span>
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

      {/* Add Asset Modal */}
      {addingAssetForSlide && (
        <PromptEditor
          mode="add"
          image={{ slideNumber: addingAssetForSlide, assetType: 'ai_generated_image' }}
          onSave={(_, prompt, assetType) => handleSaveNewAsset(addingAssetForSlide, prompt, assetType)}
          onClose={() => setAddingAssetForSlide(null)}
          showAssetTypeSelector={true}
        />
      )}

      {/* Delete Asset Confirmation Dialog */}
      {deletingAsset && (
        <div className="prompt-editor-overlay" onClick={() => setDeletingAsset(null)}>
          <div className="delete-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="delete-confirm-header">
              <h3>Delete Asset</h3>
            </div>
            <div className="delete-confirm-body">
              <p>Delete {(deletingAsset.assetType || 'asset').replace(/_/g, ' ')} #{deletingAsset.assetNumber || 1} from slide {deletingAsset.slideNumber}?</p>
              {deletingAsset.imagePath && (
                <p className="delete-warning">The generated image will also be removed.</p>
              )}
            </div>
            <div className="delete-confirm-footer">
              <button className="btn-cancel" onClick={() => setDeletingAsset(null)}>
                Cancel
              </button>
              <button className="btn-danger-confirm" onClick={handleConfirmDeleteAsset}>
                Delete
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
              <h3>Edit Narration - Slide {editingNarration.slideNumber || editingNarration.questionNumber}</h3>
              <button className="btn-close" onClick={() => setEditingNarration(null)}>×</button>
            </div>
            <div className="prompt-editor-body">
              <label>Narration Type</label>
              <select
                id="narration-type-input"
                defaultValue={editingNarration.narrationType || 'slide_narration'}
                className="narration-type-select"
              >
                <optgroup label="Basic">
                  <option value="slide_narration">Slide Narration</option>
                  <option value="popup_1">Pop Up 1</option>
                  <option value="popup_2">Pop Up 2</option>
                  <option value="popup_3">Pop Up 3</option>
                  <option value="popup_4">Pop Up 4</option>
                  <option value="popup_5">Pop Up 5</option>
                  <option value="popup_6">Pop Up 6</option>
                  <option value="question">Question</option>
                </optgroup>
                <optgroup label="Answer Choices">
                  <option value="answer_a">Answer A</option>
                  <option value="answer_b">Answer B</option>
                  <option value="answer_c">Answer C</option>
                  <option value="answer_d">Answer D</option>
                  <option value="answer_e">Answer E</option>
                  <option value="answer_f">Answer F</option>
                </optgroup>
                <optgroup label="Feedback">
                  <option value="correct_response">Correct Response</option>
                  <option value="incorrect_1">First Incorrect</option>
                  <option value="incorrect_2">Second Incorrect</option>
                </optgroup>
                <optgroup label="RCP Parts">
                  <option value="scenario">Scenario</option>
                  <option value="questions">Questions</option>
                  <option value="answers">Answers</option>
                </optgroup>
                <optgroup label="Two-Part Questions">
                  <option value="part_a_question">Part A - Question</option>
                  <option value="part_a_answer_a">Part A - Answer A</option>
                  <option value="part_a_answer_b">Part A - Answer B</option>
                  <option value="part_a_answer_c">Part A - Answer C</option>
                  <option value="part_a_answer_d">Part A - Answer D</option>
                  <option value="part_b_question">Part B - Question</option>
                  <option value="part_b_answer_a">Part B - Answer A</option>
                  <option value="part_b_answer_b">Part B - Answer B</option>
                  <option value="part_b_answer_c">Part B - Answer C</option>
                  <option value="part_b_answer_d">Part B - Answer D</option>
                </optgroup>
              </select>

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
                  const typeSelect = document.getElementById('narration-type-input');
                  if (textarea && typeSelect) {
                    handleSaveNarration(editingNarration.id, textarea.value, typeSelect.value);
                  }
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Audio Confirmation Dialog */}
      {deletingAudio && (
        <div className="prompt-editor-overlay" onClick={() => setDeletingAudio(null)}>
          <div className="delete-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="delete-confirm-header">
              <h3>Delete Narration</h3>
            </div>
            <div className="delete-confirm-body">
              <p>Are you sure you want to delete this narration part?</p>
              <p className="delete-warning">This action cannot be undone.</p>
            </div>
            <div className="delete-confirm-footer">
              <button className="btn-cancel" onClick={() => setDeletingAudio(null)}>
                Cancel
              </button>
              <button className="btn-danger-confirm" onClick={() => handleDeleteNarration(deletingAudio.id)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CMS Sync Modal */}
      {syncModalOpen && (
        <CmsSyncModal
          syncData={syncData}
          onAddSlide={handleAddSlideFromCms}
          onDeleteSlide={handleDeleteSlideFromNola}
          onUpdateNarration={handleUpdateNarration}
          onClose={() => setSyncModalOpen(false)}
          loading={syncing}
        />
      )}

      {/* Assessment CMS Sync Modal */}
      {assessmentSyncModalOpen && (
        <AssessmentCmsSyncModal
          syncData={assessmentSyncData}
          onUpdateNarration={handleAssessmentUpdateNarration}
          onClose={() => setAssessmentSyncModalOpen(false)}
          loading={assessmentSyncing}
        />
      )}
    </div>
  );
}
