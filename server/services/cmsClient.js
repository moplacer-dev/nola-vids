/**
 * Directus CMS Client for NOLA.vids
 *
 * Handles communication with the Directus CMS at nola.tools
 * for syncing slides between NOLA.vids and the CMS.
 */

const API_URL = process.env.DIRECTUS_API_URL || '';
const API_TOKEN = process.env.DIRECTUS_API_TOKEN || '';
const CARL_COURSE_ID = process.env.DIRECTUS_CARL_COURSE_ID || '';

class DirectusCMSClient {
  constructor(apiUrl = API_URL, apiToken = API_TOKEN, carlCourseId = CARL_COURSE_ID) {
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.apiToken = apiToken;
    this.carlCourseId = carlCourseId;
  }

  /**
   * Check if CMS client is properly configured
   */
  isAvailable() {
    return Boolean(this.apiUrl && this.apiToken);
  }

  /**
   * Make an authenticated request to Directus API
   */
  async request(endpoint, options = {}) {
    if (!this.isAvailable()) {
      throw new Error('CMS client not configured');
    }

    const url = `${this.apiUrl}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
      ...options.headers
    };

    const response = await fetch(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`CMS API error ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  /**
   * Get all pages for a session from the CMS
   *
   * @param {string} moduleName - Module name (e.g., "Chemistry of Food")
   * @param {number} sessionNumber - Session number
   * @param {string} sessionType - Session type ('regular', 'rcp', 'rca')
   * @returns {Array} Array of page objects with { pageId, slideNumber, title, narrationText, slideType }
   */
  async getSessionPages(moduleName, sessionNumber, sessionType = 'regular') {
    if (!this.isAvailable()) {
      throw new Error('CMS client not configured');
    }

    if (!this.carlCourseId) {
      throw new Error('DIRECTUS_CARL_COURSE_ID is required for CMS sync');
    }

    try {
      // Query the CARL course directly with nested relationship expansion
      // This avoids permission issues with filtering on foreign key fields
      // Structure discovered via explore-cms-schema.js:
      //   - child_units: M2M junction (content_courses_content_units) → use content_units_id
      //   - child_lessons: O2M direct → use directly
      //   - child_pages: M2M junction (content_lessons_content_pages) → use content_pages_id
      const courseResponse = await this.request(
        `/items/content_courses/${this.carlCourseId}?fields=id,title,child_units.content_units_id.id,child_units.content_units_id.title,child_units.content_units_id.child_lessons.id,child_units.content_units_id.child_lessons.title,child_units.content_units_id.child_lessons.sort,child_units.content_units_id.child_lessons.child_pages.content_pages_id.id,child_units.content_units_id.child_lessons.child_pages.content_pages_id.title,child_units.content_units_id.child_lessons.child_pages.content_pages_id.narration_text,child_units.content_units_id.child_lessons.child_pages.content_pages_id.slide_type,child_units.content_units_id.child_lessons.child_pages.content_pages_id.text_content,child_units.content_units_id.child_lessons.child_pages.content_pages_id.sort`
      );

      const course = courseResponse.data;
      if (!course) {
        throw new Error(`Course not found: ${this.carlCourseId}`);
      }

      // Extract units from junction table structure
      const childUnits = (course.child_units || [])
        .map(junction => junction.content_units_id)
        .filter(Boolean);
      console.log(`[CMS] Found ${childUnits.length} units in course "${course.title}"`);

      // Find the unit matching the module name
      const unit = childUnits.find(u =>
        u.title && u.title.toLowerCase().includes(moduleName.toLowerCase())
      );

      if (!unit) {
        console.log(`[CMS] No unit found matching module: ${moduleName}`);
        console.log(`[CMS] Available units:`, childUnits.map(u => u.title));
        return [];
      }

      console.log(`[CMS] Found unit: ${unit.title}`);

      // Find the lesson matching the session
      // For regular sessions: match "Session N" but NOT "Session N RCP/RCA"
      // For RCP/RCA sessions: match "Session N RCP" or "Session N RCA" specifically
      const lessons = unit.child_lessons || [];

      let lesson;
      if (sessionType === 'rcp') {
        // Look for "Session N RCP"
        lesson = lessons.find(l =>
          l.title && l.title.toLowerCase().includes(`session ${sessionNumber} rcp`.toLowerCase())
        );
      } else if (sessionType === 'rca') {
        // Look for "Session N RCA"
        lesson = lessons.find(l =>
          l.title && l.title.toLowerCase().includes(`session ${sessionNumber} rca`.toLowerCase())
        );
      } else {
        // Regular session: match "Session N" but exclude RCP/RCA variants
        lesson = lessons.find(l => {
          if (!l.title) return false;
          const titleLower = l.title.toLowerCase();
          const sessionPattern = `session ${sessionNumber}`;
          // Must include "Session N" but NOT be "Session N RCP" or "Session N RCA"
          return titleLower.includes(sessionPattern) &&
                 !titleLower.includes(`${sessionPattern} rcp`) &&
                 !titleLower.includes(`${sessionPattern} rca`);
        });
      }

      const lessonTitle = sessionType === 'rcp' ? `Session ${sessionNumber} RCP` :
                          sessionType === 'rca' ? `Session ${sessionNumber} RCA` :
                          `Session ${sessionNumber}`;

      if (!lesson) {
        console.log(`[CMS] No lesson found matching: ${lessonTitle}`);
        console.log(`[CMS] Available lessons:`, lessons.map(l => l.title));
        return [];
      }

      console.log(`[CMS] Found lesson: ${lesson.title}`);

      // Get pages from the lesson (through junction table), sorted by sort order
      const pages = (lesson.child_pages || [])
        .map(junction => junction.content_pages_id)
        .filter(Boolean)
        .sort((a, b) => (a.sort || 0) - (b.sort || 0));

      console.log(`[CMS] Found ${pages.length} pages`);

      // Map pages to our format
      // Use sort order as slide number (sort is 0-indexed, so add 1 for display)
      return pages.map((page) => ({
        pageId: page.id,
        slideNumber: (page.sort ?? 0) + 1, // Use sort order, 1-indexed for display
        title: page.title || '',
        narrationText: page.narration_text || '',
        slideType: page.slide_type || 'Text & Image',
        textContent: page.text_content || '',
        sortOrder: page.sort
      }));

    } catch (error) {
      console.error('[CMS] Error fetching session pages:', error.message);
      throw error;
    }
  }

  /**
   * Get details for a single CMS page
   *
   * @param {string} pageId - Directus page ID
   * @returns {Object} Page details { title, narrationText, slideType, textContent }
   */
  async getPageDetails(pageId) {
    if (!this.isAvailable()) {
      throw new Error('CMS client not configured');
    }

    const response = await this.request(
      `/items/content_pages/${pageId}?fields=id,title,narration_text,slide_type,text_content,sort`
    );

    const page = response.data;
    if (!page) {
      throw new Error(`Page not found: ${pageId}`);
    }

    return {
      pageId: page.id,
      title: page.title || '',
      narrationText: page.narration_text || '',
      slideType: page.slide_type || 'Text & Image',
      textContent: page.text_content || '',
      sortOrder: page.sort
    };
  }

  /**
   * Normalize text for comparison
   * Removes punctuation, normalizes whitespace, and converts number words to digits
   */
  normalizeText(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ')    // Normalize whitespace
      // Convert number words to digits for consistency
      .replace(/\bone\b/g, '1')
      .replace(/\btwo\b/g, '2')
      .replace(/\bthree\b/g, '3')
      .replace(/\bfour\b/g, '4')
      .replace(/\bfive\b/g, '5')
      .replace(/\bsix\b/g, '6')
      .replace(/\bseven\b/g, '7')
      .replace(/\beight\b/g, '8')
      .replace(/\bnine\b/g, '9')
      .replace(/\bten\b/g, '10')
      .trim();
  }

  /**
   * Get first N words from text for comparison
   * Using first ~30 words for matching (shorter = more forgiving of later differences)
   */
  getTextSignature(text, wordCount = 30) {
    if (!text) return '';
    const normalized = this.normalizeText(text);
    const words = normalized.split(' ').slice(0, wordCount);
    return words.join(' ');
  }

  /**
   * Calculate similarity between two strings (0-1)
   * Uses a simple approach: ratio of matching words
   */
  calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    const words1 = str1.split(' ');
    const words2 = str2.split(' ');
    const set1 = new Set(words1);
    const set2 = new Set(words2);

    let matches = 0;
    for (const word of set1) {
      if (set2.has(word)) matches++;
    }

    const totalUnique = new Set([...words1, ...words2]).size;
    return totalUnique > 0 ? matches / totalUnique : 0;
  }

  /**
   * Compare NOLA.vids slides with CMS pages
   * Matches by NARRATION TEXT for reliability (titles are often empty/generic in CMS)
   *
   * @param {Array} cmsPages - Pages from CMS
   * @param {Array} nolaSlides - Slides from NOLA.vids
   * @returns {Object} { matched, cmsOnly, nolaOnly }
   */
  compareSlides(cmsPages, nolaSlides) {
    const matched = [];
    const matchedCmsIds = new Set();
    const matchedNolaNumbers = new Set();

    // Build array of NOLA slides with their signatures
    const nolaWithSignatures = nolaSlides.map(slide => ({
      slide,
      signature: this.getTextSignature(slide.narrationText)
    })).filter(s => s.signature); // Only slides with narration

    console.log(`[CMS] Built narration signatures for ${nolaWithSignatures.length} NOLA slides`);

    // Similarity threshold (0.85 = 85% of words must match)
    const SIMILARITY_THRESHOLD = 0.75;

    // Try to match CMS pages to NOLA slides by narration text similarity
    for (const cmsPage of cmsPages) {
      const cmsSignature = this.getTextSignature(cmsPage.narrationText);

      if (cmsSignature) {
        // Find the best matching NOLA slide
        let bestMatch = null;
        let bestSimilarity = 0;

        for (const { slide, signature } of nolaWithSignatures) {
          if (matchedNolaNumbers.has(slide.slideNumber)) continue;

          // First try exact match
          if (signature === cmsSignature) {
            bestMatch = slide;
            bestSimilarity = 1;
            break;
          }

          // Otherwise calculate similarity
          const similarity = this.calculateSimilarity(cmsSignature, signature);
          if (similarity > bestSimilarity && similarity >= SIMILARITY_THRESHOLD) {
            bestMatch = slide;
            bestSimilarity = similarity;
          }
        }

        if (bestMatch) {
          matched.push({
            cmsSlideNumber: cmsPage.slideNumber,
            nolaSlideNumber: bestMatch.slideNumber,
            pageId: cmsPage.pageId,
            cmsTitle: cmsPage.title,
            nolaTitle: bestMatch.title,
            similarity: Math.round(bestSimilarity * 100),
            // Include full narration text for mismatches so UI can show diff
            cmsNarration: cmsPage.narrationText,
            nolaSlideNarration: bestMatch.narrationText
          });
          matchedCmsIds.add(cmsPage.pageId);
          matchedNolaNumbers.add(bestMatch.slideNumber);
        }
      }
    }

    // Separate exact matches from narration mismatches
    const exactMatches = matched.filter(m => m.similarity === 100);
    const narrationMismatches = matched.filter(m => m.similarity < 100);

    // CMS-Only: pages in CMS that didn't match any NOLA slide
    const cmsOnly = cmsPages
      .filter(p => !matchedCmsIds.has(p.pageId))
      .map(p => ({
        slideNumber: p.slideNumber,
        pageId: p.pageId,
        title: p.title,
        narrationText: p.narrationText,
        slideType: p.slideType
      }));

    // NOLA.vids-Only: slides that didn't match any CMS page
    const nolaOnly = nolaSlides
      .filter(s => !matchedNolaNumbers.has(s.slideNumber))
      .map(s => ({
        slideNumber: s.slideNumber,
        title: s.title,
        narrationText: s.narrationText,
        hasImage: s.hasImage,
        hasAudio: s.hasAudio,
        assetCount: (s.hasImage ? 1 : 0) + (s.hasAudio ? 1 : 0)
      }));

    console.log(`[CMS] Comparison: ${exactMatches.length} exact, ${narrationMismatches.length} mismatched narration, ${cmsOnly.length} CMS-only, ${nolaOnly.length} NOLA-only`);

    // Debug: show why unmatched slides didn't match
    if (cmsOnly.length > 0) {
      console.log(`[CMS] CMS-only slides (no narration match):`);
      cmsOnly.forEach(p => {
        const sig = this.getTextSignature(p.narrationText);
        console.log(`  CMS #${p.slideNumber}: "${sig.substring(0, 60)}..." (${sig ? 'has sig' : 'NO SIG'})`);
      });
    }
    if (nolaOnly.length > 0) {
      console.log(`[CMS] NOLA-only slides (no narration match):`);
      nolaOnly.forEach(s => {
        const sig = this.getTextSignature(s.narrationText);
        console.log(`  NOLA #${s.slideNumber}: "${sig.substring(0, 60)}..." (${sig ? 'has sig' : 'NO SIG'})`);
      });
    }

    return { matched: exactMatches, narrationMismatches, cmsOnly, nolaOnly };
  }
}

// Singleton instance
const cmsClient = new DirectusCMSClient();

module.exports = {
  DirectusCMSClient,
  cmsClient
};
