/**
 * Fix Session Slide Numbers
 *
 * This script fixes the slide numbering issue where regular sessions (2-6)
 * still have slide numbers that include the RCP slides (e.g., starting at 4 instead of 1).
 *
 * What it does:
 * 1. For each regular session that has an RCP counterpart
 * 2. Remove any RCP slides from the regular session's slides_json
 * 3. Renumber remaining slides to start at 1
 * 4. Update generated_images slide numbers
 * 5. Update generated_audio slide numbers
 *
 * Usage: node scripts/fix-session-slide-numbers.js [--dry-run]
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const DRY_RUN = process.argv.includes('--dry-run');

// RCP slide types to filter out
const RCP_SLIDE_TYPES = ['rcp', 'rcp_recall', 'rcp_connect', 'rcp_practice', 'rcp_apply'];

function isRcpSlideType(slideType) {
  if (!slideType) return false;
  const t = slideType.toLowerCase();
  return RCP_SLIDE_TYPES.some(rcp => t === rcp || t.startsWith('rcp_'));
}

async function fixSessionSlideNumbers() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Fix Session Slide Numbers ${DRY_RUN ? '(DRY RUN)' : ''}`);
  console.log(`${'='.repeat(60)}\n`);

  // Get all regular sessions that might need fixing
  const { data: regularSessions, error: sessionsError } = await supabase
    .from('asset_lists')
    .select('*')
    .eq('session_type', 'regular')
    .order('module_name')
    .order('session_number');

  if (sessionsError) {
    console.error('Error fetching sessions:', sessionsError);
    return;
  }

  console.log(`Found ${regularSessions.length} regular sessions\n`);

  for (const session of regularSessions) {
    // Check if there's a corresponding RCP session
    const { data: rcpSession } = await supabase
      .from('asset_lists')
      .select('id')
      .eq('module_name', session.module_name)
      .eq('session_number', session.session_number)
      .eq('session_type', 'rcp')
      .single();

    if (!rcpSession) {
      console.log(`[${session.module_name} Session ${session.session_number}] No RCP session found, skipping`);
      continue;
    }

    console.log(`\n[${session.module_name} Session ${session.session_number}] Found RCP counterpart`);

    const slides = session.slides_json || [];
    if (slides.length === 0) {
      console.log(`  No slides_json, skipping`);
      continue;
    }

    // Check current slide numbering
    const slideNumbers = slides.map(s => s.slideNumber ?? s.slide_number).sort((a, b) => a - b);
    const minSlide = Math.min(...slideNumbers);
    const maxSlide = Math.max(...slideNumbers);
    console.log(`  Current slides: ${slides.length} slides, numbers ${minSlide}-${maxSlide}`);

    // Filter out RCP slides
    const regularSlides = slides.filter(s => {
      const slideType = s.slideType || s.slide_type || '';
      return !isRcpSlideType(slideType);
    });

    const rcpSlidesRemoved = slides.length - regularSlides.length;
    if (rcpSlidesRemoved > 0) {
      console.log(`  Removing ${rcpSlidesRemoved} RCP slides from regular session`);
    }

    // Sort by current slide number
    regularSlides.sort((a, b) => {
      const numA = a.slideNumber ?? a.slide_number ?? 0;
      const numB = b.slideNumber ?? b.slide_number ?? 0;
      return numA - numB;
    });

    // Build renumbering map: oldNumber -> newNumber
    const renumberMap = {};
    regularSlides.forEach((slide, index) => {
      const oldNum = slide.slideNumber ?? slide.slide_number;
      const newNum = index + 1;
      if (oldNum !== newNum) {
        renumberMap[oldNum] = newNum;
      }
    });

    if (Object.keys(renumberMap).length === 0 && rcpSlidesRemoved === 0) {
      console.log(`  Already correctly numbered, skipping`);
      continue;
    }

    console.log(`  Renumbering ${Object.keys(renumberMap).length} slides:`);
    Object.entries(renumberMap).slice(0, 5).forEach(([old, newNum]) => {
      console.log(`    Slide ${old} -> ${newNum}`);
    });
    if (Object.keys(renumberMap).length > 5) {
      console.log(`    ... and ${Object.keys(renumberMap).length - 5} more`);
    }

    // Apply new numbers to slides
    const updatedSlides = regularSlides.map((slide, index) => ({
      ...slide,
      slideNumber: index + 1,
      slide_number: index + 1
    }));

    if (!DRY_RUN) {
      // Update slides_json
      const { error: updateError } = await supabase
        .from('asset_lists')
        .update({ slides_json: updatedSlides })
        .eq('id', session.id);

      if (updateError) {
        console.error(`  Error updating slides_json:`, updateError);
        continue;
      }
      console.log(`  Updated slides_json`);

      // Update generated_images
      if (Object.keys(renumberMap).length > 0) {
        const { data: images } = await supabase
          .from('generated_images')
          .select('id, slide_number')
          .eq('asset_list_id', session.id);

        if (images && images.length > 0) {
          let imagesUpdated = 0;
          for (const img of images) {
            const newNum = renumberMap[img.slide_number];
            if (newNum !== undefined) {
              await supabase
                .from('generated_images')
                .update({ slide_number: newNum })
                .eq('id', img.id);
              imagesUpdated++;
            }
          }
          console.log(`  Updated ${imagesUpdated} generated_images records`);
        }

        // Update generated_audio
        const { data: audioRecords } = await supabase
          .from('generated_audio')
          .select('id, slide_number')
          .eq('asset_list_id', session.id);

        if (audioRecords && audioRecords.length > 0) {
          let audioUpdated = 0;
          for (const audio of audioRecords) {
            const newNum = renumberMap[audio.slide_number];
            if (newNum !== undefined) {
              await supabase
                .from('generated_audio')
                .update({ slide_number: newNum })
                .eq('id', audio.id);
              audioUpdated++;
            }
          }
          console.log(`  Updated ${audioUpdated} generated_audio records`);
        }
      }
    } else {
      console.log(`  [DRY RUN] Would update slides_json and related records`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Done! ${DRY_RUN ? '(DRY RUN - no changes made)' : ''}`);
  console.log(`${'='.repeat(60)}\n`);
}

fixSessionSlideNumbers().catch(console.error);
