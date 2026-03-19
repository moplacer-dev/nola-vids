/**
 * Delete Reactions Sessions 2-6 (regular and RCP) from database
 * This clears the data so we can test re-pushing from Carl v7 with proper RCP splitting
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function deleteReactionsSessions() {
  const MODULE_NAME = 'Reactions';
  const SESSIONS_TO_DELETE = [2, 3, 4, 5, 6];

  console.log(`\n=== Deleting ${MODULE_NAME} Sessions ${SESSIONS_TO_DELETE.join(', ')} ===\n`);

  // Find all asset_lists for these sessions (both regular and RCP)
  const { data: assetLists, error: fetchError } = await supabase
    .from('asset_lists')
    .select('id, module_name, session_number, session_type')
    .eq('module_name', MODULE_NAME)
    .in('session_number', SESSIONS_TO_DELETE);

  if (fetchError) {
    console.error('Error fetching asset lists:', fetchError);
    return;
  }

  if (!assetLists || assetLists.length === 0) {
    console.log('No matching sessions found.');
    return;
  }

  console.log(`Found ${assetLists.length} sessions to delete:`);
  assetLists.forEach(al => {
    console.log(`  - Session ${al.session_number} (${al.session_type}) [ID: ${al.id}]`);
  });

  const assetListIds = assetLists.map(al => al.id);

  // Delete associated generated_images
  const { data: deletedImages, error: imgError } = await supabase
    .from('generated_images')
    .delete()
    .in('asset_list_id', assetListIds)
    .select('id');

  if (imgError) {
    console.error('Error deleting generated_images:', imgError);
  } else {
    console.log(`\nDeleted ${deletedImages?.length || 0} generated_images records`);
  }

  // Delete associated generated_audio
  const { data: deletedAudio, error: audioError } = await supabase
    .from('generated_audio')
    .delete()
    .in('asset_list_id', assetListIds)
    .select('id');

  if (audioError) {
    console.error('Error deleting generated_audio:', audioError);
  } else {
    console.log(`Deleted ${deletedAudio?.length || 0} generated_audio records`);
  }

  // Delete associated motion_graphics_videos
  const { data: deletedMg, error: mgError } = await supabase
    .from('motion_graphics_videos')
    .delete()
    .in('asset_list_id', assetListIds)
    .select('id');

  if (mgError) {
    console.error('Error deleting motion_graphics_videos:', mgError);
  } else {
    console.log(`Deleted ${deletedMg?.length || 0} motion_graphics_videos records`);
  }

  // Delete the asset_lists themselves
  const { data: deletedAssetLists, error: alError } = await supabase
    .from('asset_lists')
    .delete()
    .in('id', assetListIds)
    .select('id');

  if (alError) {
    console.error('Error deleting asset_lists:', alError);
  } else {
    console.log(`Deleted ${deletedAssetLists?.length || 0} asset_lists records`);
  }

  console.log('\n=== Done ===\n');
}

deleteReactionsSessions().catch(console.error);
