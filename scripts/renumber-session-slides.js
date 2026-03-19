/**
 * Renumber session slides to start at 1
 *
 * Directly updates slides_json, assets_json, generated_images, and generated_audio
 * for Sessions 2-6 that have slide numbers starting at 4.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function renumberSession(moduleName, sessionNumber) {
  console.log(`\n=== ${moduleName} Session ${sessionNumber} ===`);

  // Get the session
  const { data: session, error } = await supabase
    .from('asset_lists')
    .select('*')
    .eq('module_name', moduleName)
    .eq('session_number', sessionNumber)
    .eq('session_type', 'regular')
    .single();

  if (error || !session) {
    console.log(`  Session not found`);
    return;
  }

  const slides = session.slides_json || [];
  const assets = session.assets_json || [];

  if (slides.length === 0) {
    console.log(`  No slides`);
    return;
  }

  // Get current slide numbers
  const slideNums = slides.map(s => s.slideNumber ?? s.slide_number).filter(n => n != null);
  const minSlide = Math.min(...slideNums);
  const maxSlide = Math.max(...slideNums);

  console.log(`  Current: ${slides.length} slides, numbers ${minSlide}-${maxSlide}`);

  if (minSlide === 1) {
    console.log(`  Already starts at 1, skipping`);
    return;
  }

  // Sort slides by current number
  const sortedSlides = [...slides].sort((a, b) =>
    (a.slideNumber ?? a.slide_number) - (b.slideNumber ?? b.slide_number)
  );

  // Build renumber map: oldNum -> newNum
  const renumberMap = {};
  sortedSlides.forEach((slide, index) => {
    const oldNum = slide.slideNumber ?? slide.slide_number;
    renumberMap[oldNum] = index + 1;
  });

  console.log(`  Renumbering: ${minSlide} -> 1, ${maxSlide} -> ${slides.length}`);

  // Renumber slides
  const newSlides = sortedSlides.map((slide, index) => ({
    ...slide,
    slideNumber: index + 1,
    slide_number: index + 1
  }));

  // Renumber assets
  const newAssets = assets.map(asset => ({
    ...asset,
    slideNumber: renumberMap[asset.slideNumber] ?? asset.slideNumber
  }));

  // Update the asset list
  const { error: updateError } = await supabase
    .from('asset_lists')
    .update({
      slides_json: newSlides,
      assets_json: newAssets
    })
    .eq('id', session.id);

  if (updateError) {
    console.log(`  Error updating asset list:`, updateError.message);
    return;
  }
  console.log(`  Updated slides_json and assets_json`);

  // Update generated_images
  const { data: images } = await supabase
    .from('generated_images')
    .select('id, slide_number')
    .eq('asset_list_id', session.id);

  if (images && images.length > 0) {
    let updated = 0;
    for (const img of images) {
      const newNum = renumberMap[img.slide_number];
      if (newNum && newNum !== img.slide_number) {
        await supabase
          .from('generated_images')
          .update({ slide_number: newNum })
          .eq('id', img.id);
        updated++;
      }
    }
    console.log(`  Updated ${updated} generated_images`);
  }

  // Update generated_audio
  const { data: audio } = await supabase
    .from('generated_audio')
    .select('id, slide_number')
    .eq('asset_list_id', session.id);

  if (audio && audio.length > 0) {
    let updated = 0;
    for (const a of audio) {
      const newNum = renumberMap[a.slide_number];
      if (newNum && newNum !== a.slide_number) {
        await supabase
          .from('generated_audio')
          .update({ slide_number: newNum })
          .eq('id', a.id);
        updated++;
      }
    }
    console.log(`  Updated ${updated} generated_audio`);
  }

  console.log(`  Done!`);
}

async function main() {
  console.log('Renumbering Sessions 2-6 to start at slide 1...');

  for (const sessionNum of [2, 3, 4, 5, 6]) {
    await renumberSession('Reactions', sessionNum);
  }

  console.log('\nAll done!');
}

main().catch(console.error);
