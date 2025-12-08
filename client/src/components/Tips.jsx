import { useState } from 'react';
import './Tips.css';

export default function Tips() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={`tips-box ${isOpen ? 'open' : ''}`}>
      <button className="tips-header" onClick={() => setIsOpen(!isOpen)}>
        <h3 className="tips-title">Veo 3.1 Tips</h3>
        <span className="tips-toggle">{isOpen ? '−' : '+'}</span>
      </button>

      <div className="tips-content">
        <div className="tip-section">
          <h4>Prompting Basics</h4>
          <ul>
            <li><strong>Be descriptive</strong> — Include subject, action, style, and camera angle</li>
            <li><strong>Use film terms</strong> — "close-up", "dolly shot", "aerial view", "shallow focus"</li>
            <li><strong>Set the mood</strong> — Describe lighting and color: "warm tones", "neon glow", "golden hour"</li>
          </ul>
        </div>

        <div className="tip-section">
          <h4>Audio & Dialogue</h4>
          <ul>
            <li><strong>Use quotes for speech</strong> — <code>"Hello there!"</code> generates spoken dialogue</li>
            <li><strong>Describe sounds</strong> — "birds chirping", "engine roaring", "soft piano music"</li>
          </ul>
        </div>

        <div className="tip-section">
          <h4>Negative Prompts</h4>
          <ul>
            <li><strong>Describe, don't instruct</strong> — Use "blurry, cartoon" not "no blur, not cartoon"</li>
          </ul>
        </div>

        <div className="tip-section">
          <h4>Extending Videos</h4>
          <ul>
            <li><strong>Veo-generated only</strong> — You can only extend videos created by Veo</li>
            <li><strong>Voice note</strong> — Dialogue may not continue if absent from the final second</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
