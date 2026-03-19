import { useState, useEffect } from 'react';

export default function LibraryPicker({
  onSelect,
  onClose,
  getLibrary,
  getGeneratedImages,
  mediaType = 'image' // 'image' | 'video' | 'all'
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(mediaType === 'all' ? 'images' : mediaType === 'video' ? 'videos' : 'images');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadItems();
  }, [filter]);

  const loadItems = async () => {
    setLoading(true);
    try {
      if (filter === 'videos') {
        const videos = await getLibrary({});
        setItems(videos.map(v => ({
          ...v,
          _type: 'video',
          thumbnailUrl: v.path, // Use the actual Supabase URL
          displayName: v.title || v.params?.prompt?.substring(0, 50) || v.filename
        })));
      } else {
        // Load completed, uploaded, and imported images
        const [completed, uploaded, imported] = await Promise.all([
          getGeneratedImages({ status: 'completed' }),
          getGeneratedImages({ status: 'uploaded' }),
          getGeneratedImages({ status: 'imported' })
        ]);
        const allImages = [...completed, ...uploaded, ...imported];
        setItems(allImages.map(img => {
          // Use the actual image path directly (no transform - it was causing display issues)
          return {
            ...img,
            _type: 'image',
            thumbnailUrl: img.imagePath,
            displayName: img.cmsFilename || img.originalPrompt?.substring(0, 50) || `Image ${img.id}`
          };
        }));
      }
    } catch (err) {
      console.error('Failed to load library items:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredItems = items.filter(item => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      (item.displayName || '').toLowerCase().includes(query) ||
      (item.originalPrompt || '').toLowerCase().includes(query) ||
      (item.params?.prompt || '').toLowerCase().includes(query)
    );
  });

  const handleSelect = (item) => {
    if (!item?.id) {
      console.error('Cannot import: item has no ID', item);
      return;
    }
    onSelect({
      id: String(item.id),
      type: item._type,
      path: item._type === 'video' ? item.path : item.imagePath,
      filename: item._type === 'video' ? item.filename : item.imagePath?.split('/').pop()
    });
  };

  return (
    <div className="library-picker-overlay" onClick={onClose}>
      <div className="library-picker" onClick={e => e.stopPropagation()}>
        <div className="library-picker-header">
          <h3>Import from Library</h3>
          <button className="btn-close" onClick={onClose}>&times;</button>
        </div>

        <div className="library-picker-controls">
          {mediaType === 'all' && (
            <div className="picker-type-filter">
              <button
                className={`picker-filter-btn ${filter === 'images' ? 'active' : ''}`}
                onClick={() => setFilter('images')}
              >
                Images
              </button>
              <button
                className={`picker-filter-btn ${filter === 'videos' ? 'active' : ''}`}
                onClick={() => setFilter('videos')}
              >
                Videos
              </button>
            </div>
          )}
          <input
            type="text"
            className="picker-search"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="library-picker-grid">
          {loading ? (
            <div className="picker-loading">Loading...</div>
          ) : filteredItems.length === 0 ? (
            <div className="picker-empty">
              No {filter} found
            </div>
          ) : (
            filteredItems.map(item => (
              <div
                key={`${item._type}-${item.id}`}
                className="picker-item"
                onClick={() => handleSelect(item)}
              >
                {item._type === 'video' ? (
                  <div className="picker-thumbnail-wrapper">
                    <video
                      src={item.thumbnailUrl}
                      className="picker-thumbnail-img"
                      muted
                      onMouseOver={e => e.target.play()}
                      onMouseOut={e => { e.target.pause(); e.target.currentTime = 0; }}
                    />
                  </div>
                ) : item.thumbnailUrl ? (
                  <div className="picker-thumbnail-wrapper">
                    <img
                      src={item.thumbnailUrl}
                      alt={item.displayName}
                      className="picker-thumbnail-img"
                      onError={(e) => {
                        // Fallback to original URL if transform fails
                        if (item.imagePath && e.target.src !== item.imagePath) {
                          e.target.src = item.imagePath;
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div className="picker-thumbnail picker-no-image">No Image</div>
                )}
                <div className="picker-item-label">
                  {item.displayName}
                </div>
                <div className="picker-item-type">
                  {item._type === 'video' ? 'VIDEO' : 'IMAGE'}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
