import { useState } from 'react';
import './CmsSyncModal.css';

export default function CmsSyncModal({
  syncData,
  onAddSlide,
  onDeleteSlide,
  onUpdateNarration,
  onClose,
  loading
}) {
  const [actionInProgress, setActionInProgress] = useState(null);
  const [expandedMismatch, setExpandedMismatch] = useState(null);

  const { matched = [], narrationMismatches = [], cmsOnly = [], nolaOnly = [] } = syncData || {};

  const handleAddSlide = async (slide) => {
    setActionInProgress(`add-${slide.slideNumber}`);
    try {
      await onAddSlide(slide.slideNumber, slide.pageId);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDeleteSlide = async (slide) => {
    setActionInProgress(`delete-${slide.slideNumber}`);
    try {
      await onDeleteSlide(slide.slideNumber);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleUpdateNarration = async (mismatch) => {
    setActionInProgress(`update-${mismatch.nolaSlideNumber}`);
    try {
      await onUpdateNarration(mismatch.nolaSlideNumber, mismatch.cmsNarration, mismatch.pageId);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleUpdateAllNarrations = async () => {
    // Only update non-title-matched slides (title matches have intentionally different structure)
    const updatableMismatches = narrationMismatches.filter(m => m.matchedBy !== 'title');
    if (updatableMismatches.length === 0) return;

    setActionInProgress('update-all');
    try {
      const results = await Promise.allSettled(
        updatableMismatches.map(mismatch =>
          onUpdateNarration(mismatch.nolaSlideNumber, mismatch.cmsNarration, mismatch.pageId)
        )
      );
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) {
        console.warn(`Update All: ${updatableMismatches.length - failed} succeeded, ${failed} failed`);
      }
    } finally {
      setActionInProgress(null);
    }
  };

  // Check if there are any updatable mismatches (non-title-matched)
  const hasUpdatableMismatches = narrationMismatches.some(m => m.matchedBy !== 'title');

  return (
    <div className="cms-sync-overlay" onClick={onClose}>
      <div className="cms-sync-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cms-sync-header">
          <h3>Sync with CMS</h3>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>

        <div className="cms-sync-body">
          {loading ? (
            <div className="loading-indicator">Loading sync data...</div>
          ) : (
            <>
              {/* Matched Slides */}
              <div className="sync-section sync-matched">
                <div className="sync-section-header">
                  <span className="sync-icon matched">✓</span>
                  <h4>Matched Slides ({matched.length})</h4>
                </div>
                {matched.length > 0 ? (
                  <div className="sync-slide-list matched-list">
                    {matched.map((m, idx) => (
                      <div key={m.pageId || idx} className="sync-slide-item matched-item">
                        <span className="slide-number">NOLA #{m.nolaSlideNumber}</span>
                        <span className="slide-title">{m.nolaTitle || m.cmsTitle || '(untitled)'}</span>
                        <span className="cms-position">CMS #{m.cmsSlideNumber}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="sync-section-description">No exact matches found</p>
                )}
              </div>

              {/* Narration Mismatches - need update */}
              {narrationMismatches.length > 0 && (
                <div className="sync-section sync-mismatch">
                  <div className="sync-section-header">
                    <span className="sync-icon mismatch">!</span>
                    <h4>Narration Mismatch ({narrationMismatches.length})</h4>
                    {hasUpdatableMismatches && (
                      <button
                        className="btn-update-all"
                        onClick={handleUpdateAllNarrations}
                        disabled={actionInProgress !== null}
                      >
                        {actionInProgress === 'update-all' ? 'Updating...' : 'Update All'}
                      </button>
                    )}
                  </div>
                  <p className="sync-section-note">
                    These slides matched but have different narration text.
                    {hasUpdatableMismatches ? ' Update to use CMS version.' : ' Page mappings saved.'}
                  </p>
                  <div className="sync-slide-list">
                    {narrationMismatches.map((mismatch) => {
                      const isTitleMatch = mismatch.matchedBy === 'title';
                      return (
                        <div key={mismatch.pageId} className="sync-slide-item mismatch-item">
                          <div className="mismatch-header">
                            <div className="sync-slide-info">
                              <span className="slide-number">NOLA #{mismatch.nolaSlideNumber}</span>
                              <span className="slide-title">{mismatch.nolaTitle || mismatch.cmsTitle || '(untitled)'}</span>
                              {isTitleMatch ? (
                                <span className="match-confidence title-match">TITLE MATCH</span>
                              ) : (
                                <span className="match-confidence">{mismatch.similarity}% match</span>
                              )}
                            </div>
                            <div className="mismatch-actions">
                              <button
                                className="btn-expand"
                                onClick={() => setExpandedMismatch(
                                  expandedMismatch === mismatch.pageId ? null : mismatch.pageId
                                )}
                              >
                                {expandedMismatch === mismatch.pageId ? 'Hide' : 'Show Diff'}
                              </button>
                              {!isTitleMatch && (
                                <button
                                  className="btn-update-narration"
                                  onClick={() => handleUpdateNarration(mismatch)}
                                  disabled={actionInProgress !== null}
                                >
                                  {actionInProgress === `update-${mismatch.nolaSlideNumber}` ? 'Updating...' : 'Update'}
                                </button>
                              )}
                            </div>
                          </div>
                          {isTitleMatch && (
                            <div className="title-match-note">
                              Page mapping saved. Narration differs because CMS combines question + answers,
                              but NOLA.vids separates them for individual audio generation.
                            </div>
                          )}
                          {expandedMismatch === mismatch.pageId && (
                            <div className="narration-diff">
                              <div className="diff-section diff-nola">
                                <strong>NOLA.vids (current):</strong>
                                <p>{mismatch.nolaSlideNarration || '(empty)'}</p>
                              </div>
                              <div className="diff-section diff-cms">
                                <strong>CMS (source of truth):</strong>
                                <p>{mismatch.cmsNarration || '(empty)'}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* CMS-Only Slides */}
              <div className="sync-section sync-cms-only">
                <div className="sync-section-header">
                  <span className="sync-icon cms-only">+</span>
                  <h4>CMS-Only Slides ({cmsOnly.length})</h4>
                </div>
                {cmsOnly.length > 0 ? (
                  <div className="sync-slide-list">
                    {cmsOnly.map((slide) => (
                      <div key={slide.pageId} className="sync-slide-item cms-only-item">
                        <div className="sync-slide-info">
                          <span className="slide-number">CMS #{slide.slideNumber}</span>
                          <span className="slide-title">{slide.title || 'Untitled'}</span>
                          <span className="slide-type-badge">{slide.slideType}</span>
                        </div>
                        {slide.narrationText && (
                          <div className="narration-preview">
                            {slide.narrationText.substring(0, 80)}...
                          </div>
                        )}
                        <button
                          className="btn-add-slide"
                          onClick={() => handleAddSlide(slide)}
                          disabled={actionInProgress !== null}
                        >
                          {actionInProgress === `add-${slide.slideNumber}` ? 'Adding...' : 'Add'}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="sync-section-description">No CMS-only slides</p>
                )}
              </div>

              {/* NOLA.vids-Only Slides */}
              <div className="sync-section sync-nola-only">
                <div className="sync-section-header">
                  <span className="sync-icon nola-only">−</span>
                  <h4>NOLA.vids-Only Slides ({nolaOnly.length})</h4>
                </div>
                {nolaOnly.length > 0 ? (
                  <div className="sync-slide-list">
                    {nolaOnly.map((slide) => (
                      <div key={slide.slideNumber} className="sync-slide-item nola-only-item">
                        <div className="sync-slide-info">
                          <span className="slide-number">NOLA #{slide.slideNumber}</span>
                          <span className="slide-title">{slide.title || 'Untitled'}</span>
                          {slide.assetCount > 0 && (
                            <span className="asset-count">
                              {slide.hasImage && '1 image'}{slide.hasImage && slide.hasAudio && ', '}{slide.hasAudio && '1 audio'}
                            </span>
                          )}
                        </div>
                        {slide.narrationText && (
                          <div className="narration-preview">
                            {slide.narrationText.substring(0, 80)}...
                          </div>
                        )}
                        <button
                          className="btn-delete-slide"
                          onClick={() => handleDeleteSlide(slide)}
                          disabled={actionInProgress !== null}
                        >
                          {actionInProgress === `delete-${slide.slideNumber}` ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="sync-section-description">No NOLA.vids-only slides</p>
                )}
              </div>
            </>
          )}
        </div>

        <div className="cms-sync-footer">
          <button className="btn-close-modal" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
