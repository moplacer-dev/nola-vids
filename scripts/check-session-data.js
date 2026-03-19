/**
 * Check session data to debug slide numbering
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function checkSession() {
  // Get Reactions Session 2 (regular)
  const { data: session, error } = await supabase
    .from('asset_lists')
    .select('*')
    .eq('module_name', 'Reactions')
    .eq('session_number', 2)
    .eq('session_type', 'regular')
    .single();

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('\n=== Reactions Session 2 (Regular) ===\n');

  // Check slides_json
  const slides = session.slides_json || [];
  console.log(`slides_json has ${slides.length} slides`);
  if (slides.length > 0) {
    const slideNums = slides.map(s => s.slideNumber ?? s.slide_number).sort((a, b) => a - b);
    console.log(`  Slide numbers: ${slideNums.slice(0, 5).join(', ')}... to ${slideNums[slideNums.length - 1]}`);
    console.log(`  First slide:`, JSON.stringify(slides[0], null, 2).substring(0, 200));
  }

  // Check assets_json
  const assets = session.assets_json || [];
  console.log(`\nassets_json has ${assets.length} assets`);
  if (assets.length > 0) {
    const assetSlideNums = [...new Set(assets.map(a => a.slideNumber))].sort((a, b) => a - b);
    console.log(`  Asset slide numbers: ${assetSlideNums.slice(0, 5).join(', ')}... to ${assetSlideNums[assetSlideNums.length - 1]}`);
    console.log(`  First asset:`, JSON.stringify(assets[0], null, 2).substring(0, 200));
  }

  // Check generated_images
  const { data: images } = await supabase
    .from('generated_images')
    .select('slide_number')
    .eq('asset_list_id', session.id);

  if (images && images.length > 0) {
    const imgSlideNums = [...new Set(images.map(i => i.slide_number))].sort((a, b) => a - b);
    console.log(`\ngenerated_images has ${images.length} records`);
    console.log(`  Image slide numbers: ${imgSlideNums.slice(0, 5).join(', ')}... to ${imgSlideNums[imgSlideNums.length - 1]}`);
  }

  // Check generated_audio
  const { data: audio } = await supabase
    .from('generated_audio')
    .select('slide_number')
    .eq('asset_list_id', session.id);

  if (audio && audio.length > 0) {
    const audioSlideNums = [...new Set(audio.map(a => a.slide_number))].sort((a, b) => a - b);
    console.log(`\ngenerated_audio has ${audio.length} records`);
    console.log(`  Audio slide numbers: ${audioSlideNums.slice(0, 5).join(', ')}... to ${audioSlideNums[audioSlideNums.length - 1]}`);
  }

  console.log('\n');
}

checkSession().catch(console.error);
