/**
 * @deprecated This component is no longer used in the UI.
 * Library functionality has been integrated into Video Gen and Image Gen tabs
 * using their respective queue components (JobList and ImageGenQueue).
 * Kept for reference.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import VideoCard from './VideoCard';
import ImageCard from './ImageCard';
import FolderSidebar from './FolderSidebar';
import MediaViewer from './MediaViewer';
import './Library.css';

export default function Library({
  accessKey,
  getLibrary,
  getFolders,
  createFolder,
  deleteFolder,
  updateVideo,
  deleteVideo,
  getGeneratedImages,
  deleteImage,
  onReusePrompt,
  onExtendVideo,
  onReuseImagePrompt
}) {
  const [videos, setVideos] = useState([]);
  const [images, setImages] = useState([]);
  const [folders, setFolders] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState('newest');
  const [typeFilter, setTypeFilter] = useState('all'); // 'all' | 'videos' | 'images'
  const [moduleFilter, setModuleFilter] = useState('all'); // 'all' | module name
  const [loading, setLoading] = useState(true);
  const [viewerItem, setViewerItem] = useState(null);

  // Extract unique module names from images and videos
  const availableModules = useMemo(() => {
    const modules = new Set();
    images.forEach(img => {
      if (img.moduleName) {
        modules.add(img.moduleName);
      }
    });
    videos.forEach(v => {
      if (v.moduleName) {
        modules.add(v.moduleName);
      }
    });
    return Array.from(modules).sort();
  }, [images, videos]);


  const loadVideos = useCallback(async () => {
    try {
      const data = await getLibrary({
        folder: selectedFolder,
        search: searchQuery || undefined
      });
      return data;
    } catch (err) {
      console.error('Failed to load videos:', err);
      return [];
    }
  }, [getLibrary, selectedFolder, searchQuery]);

  const loadImages = useCallback(async () => {
    if (!getGeneratedImages) return [];
    try {
      // Fetch all fulfilled statuses (completed, uploaded, imported, default)
      const data = await getGeneratedImages({ status: 'completed,uploaded,imported,default' });
      // Filter by search query if present
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return data.filter(img =>
          (img.cmsFilename || '').toLowerCase().includes(query) ||
          (img.originalPrompt || '').toLowerCase().includes(query) ||
          (img.modifiedPrompt || '').toLowerCase().includes(query)
        );
      }
      return data;
    } catch (err) {
      console.error('Failed to load images:', err);
      return [];
    }
  }, [getGeneratedImages, searchQuery]);

  const loadFolders = useCallback(async () => {
    try {
      const data = await getFolders();
      setFolders(data);
    } catch (err) {
      console.error('Failed to load folders:', err);
    }
  }, [getFolders]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [videoData, imageData] = await Promise.all([
        loadVideos(),
        loadImages(),
        loadFolders()
      ]);
      setVideos(videoData);
      setImages(imageData);
      setLoading(false);
    };
    load();
  }, [loadVideos, loadImages, loadFolders]);

  // Combined and sorted items
  const getFilteredItems = () => {
    let items = [];

    if (typeFilter === 'all' || typeFilter === 'videos') {
      let filteredVideos = videos;

      // Apply module filter to videos (when they have module data)
      if (moduleFilter !== 'all') {
        filteredVideos = videos.filter(v => v.moduleName === moduleFilter);
      }

      items = items.concat(filteredVideos.map(v => ({ ...v, _type: 'video' })));
    }

    if (typeFilter === 'all' || typeFilter === 'images') {
      let filteredImages = images;

      // Apply module filter to images
      if (moduleFilter !== 'all') {
        filteredImages = images.filter(img => img.moduleName === moduleFilter);
      }

      items = items.concat(filteredImages.map(i => ({
        ...i,
        _type: 'image',
        created_at: i.createdAt || i.created_at
      })));
    }

    // Sort
    return items.sort((a, b) => {
      const dateA = new Date(a.created_at);
      const dateB = new Date(b.created_at);
      return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });
  };

  const filteredItems = getFilteredItems();

  const handleCreateFolder = async (name) => {
    try {
      await createFolder(name);
      await loadFolders();
    } catch (err) {
      console.error('Failed to create folder:', err);
    }
  };

  const handleDeleteFolder = async (folderId) => {
    try {
      await deleteFolder(folderId);
      if (folders.find(f => f.id === folderId)?.name === selectedFolder) {
        setSelectedFolder(null);
      }
      const [videoData] = await Promise.all([loadVideos(), loadFolders()]);
      setVideos(videoData);
    } catch (err) {
      console.error('Failed to delete folder:', err);
    }
  };

  const handleUpdateVideo = async (videoId, updates) => {
    try {
      await updateVideo(videoId, updates);
      const [videoData] = await Promise.all([loadVideos(), loadFolders()]);
      setVideos(videoData);
    } catch (err) {
      console.error('Failed to update video:', err);
    }
  };

  const handleDeleteVideo = async (videoId) => {
    try {
      await deleteVideo(videoId);
      const [videoData] = await Promise.all([loadVideos(), loadFolders()]);
      setVideos(videoData);
    } catch (err) {
      console.error('Failed to delete video:', err);
    }
  };

  const handleDeleteImage = async (imageId) => {
    if (!deleteImage) return;
    try {
      await deleteImage(imageId);
      const imageData = await loadImages();
      setImages(imageData);
    } catch (err) {
      console.error('Failed to delete image:', err);
    }
  };

  // Calculate counts
  const videoCount = videos.length;
  const filteredVideoCount = moduleFilter === 'all'
    ? videos.length
    : videos.filter(v => v.moduleName === moduleFilter).length;
  const imageCount = images.length;
  const filteredImageCount = moduleFilter === 'all'
    ? images.length
    : images.filter(img => img.moduleName === moduleFilter).length;
  const allVideosCount = folders.reduce((acc, f) => acc + f.videoCount, 0) +
    videos.filter(v => !v.folder).length;

  // Get title based on filter
  const getTitle = () => {
    if (typeFilter === 'videos') return 'Video Library';
    if (typeFilter === 'images') return 'Image Library';
    return 'Media Library';
  };

  // Viewer navigation
  const handleOpenViewer = (item) => {
    setViewerItem(item);
  };

  const handleCloseViewer = () => {
    setViewerItem(null);
  };

  const handleNextItem = () => {
    const currentIndex = filteredItems.findIndex(
      i => i.id === viewerItem.id && i._type === viewerItem._type
    );
    if (currentIndex < filteredItems.length - 1) {
      setViewerItem(filteredItems[currentIndex + 1]);
    }
  };

  const handlePrevItem = () => {
    const currentIndex = filteredItems.findIndex(
      i => i.id === viewerItem.id && i._type === viewerItem._type
    );
    if (currentIndex > 0) {
      setViewerItem(filteredItems[currentIndex - 1]);
    }
  };

  const getViewerNav = () => {
    if (!viewerItem) return { hasNext: false, hasPrev: false };
    const currentIndex = filteredItems.findIndex(
      i => i.id === viewerItem.id && i._type === viewerItem._type
    );
    return {
      hasNext: currentIndex < filteredItems.length - 1,
      hasPrev: currentIndex > 0
    };
  };

  return (
    <div className="library">
      <div className="library-header">
        <h2 className="library-title">{getTitle()}</h2>
        <div className="library-controls">
          <div className="library-type-filter">
            <button
              className={`type-filter-btn ${typeFilter === 'all' ? 'active' : ''}`}
              onClick={() => setTypeFilter('all')}
            >
              All ({filteredVideoCount + filteredImageCount})
            </button>
            <button
              className={`type-filter-btn ${typeFilter === 'videos' ? 'active' : ''}`}
              onClick={() => setTypeFilter('videos')}
            >
              Videos ({moduleFilter !== 'all' ? `${filteredVideoCount}/${videoCount}` : videoCount})
            </button>
            <button
              className={`type-filter-btn ${typeFilter === 'images' ? 'active' : ''}`}
              onClick={() => setTypeFilter('images')}
            >
              Images ({moduleFilter !== 'all' ? `${filteredImageCount}/${imageCount}` : imageCount})
            </button>
          </div>
          {availableModules.length > 0 && (
            <select
              className="library-module-filter"
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
            >
              <option value="all">All Modules</option>
              {availableModules.map(mod => (
                <option key={mod} value={mod}>{mod}</option>
              ))}
            </select>
          )}
          <input
            type="text"
            className="library-search"
            placeholder="Search by title or prompt..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <select
            className="library-sort"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>
        </div>
      </div>

      <div className="library-content">
        <FolderSidebar
          folders={folders}
          selectedFolder={selectedFolder}
          onSelectFolder={setSelectedFolder}
          onCreateFolder={handleCreateFolder}
          onDeleteFolder={handleDeleteFolder}
          totalVideoCount={allVideosCount}
        />

        <div className="library-grid-container">
          {loading ? (
            <div className="library-loading">
              <span className="spinner" />
              <p>Loading media...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="library-empty">
              <p>No {typeFilter === 'all' ? 'media' : typeFilter} found</p>
              <span>
                {selectedFolder
                  ? `No videos in "${selectedFolder}" folder`
                  : moduleFilter !== 'all'
                    ? `No ${typeFilter === 'all' ? 'media' : typeFilter} in "${moduleFilter}" module`
                    : searchQuery
                      ? 'Try a different search term'
                      : `Generate some ${typeFilter === 'all' ? 'media' : typeFilter} to see them here`}
              </span>
            </div>
          ) : (
            <div className="library-grid">
              {filteredItems.map(item =>
                item._type === 'video' ? (
                  <VideoCard
                    key={`video-${item.id}`}
                    video={item}
                    folders={folders}
                    onUpdateVideo={handleUpdateVideo}
                    onDeleteVideo={handleDeleteVideo}
                    onReusePrompt={onReusePrompt}
                    onExtendVideo={onExtendVideo}
                    onClick={() => handleOpenViewer(item)}
                  />
                ) : (
                  <ImageCard
                    key={`image-${item.id}`}
                    image={item}
                    onDeleteImage={deleteImage ? handleDeleteImage : null}
                    onReusePrompt={onReuseImagePrompt}
                    onClick={() => handleOpenViewer(item)}
                  />
                )
              )}
            </div>
          )}
        </div>
      </div>

      {viewerItem && (
        <MediaViewer
          item={viewerItem}
          onClose={handleCloseViewer}
          onNext={handleNextItem}
          onPrev={handlePrevItem}
          hasNext={getViewerNav().hasNext}
          hasPrev={getViewerNav().hasPrev}
          onDelete={viewerItem._type === 'video' ? handleDeleteVideo : (deleteImage ? handleDeleteImage : null)}
          onReusePrompt={viewerItem._type === 'video' ? onReusePrompt : onReuseImagePrompt}
        />
      )}
    </div>
  );
}
