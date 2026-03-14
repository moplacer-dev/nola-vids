# NOLA.vids Supabase Setup Guide

## Prerequisites
You've already created your Supabase project:
- **Project URL**: `https://wzkrpircqrhkulymozhz.supabase.co`

## Step 1: Configure Environment Variables

Add these to your `.env` file (and to Render environment variables):

```env
SUPABASE_URL=https://wzkrpircqrhkulymozhz.supabase.co
SUPABASE_SERVICE_KEY=<your-service-role-key>
```

To get your service role key:
1. Go to your Supabase project dashboard
2. Navigate to **Settings** → **API**
3. Copy the **service_role** key (NOT the anon key)

## Step 2: Run the Database Schema

1. Go to your Supabase dashboard
2. Navigate to **SQL Editor**
3. Copy the contents of `schema.sql` and paste into the editor
4. Click **Run**

This creates all tables:
- `jobs` - Video generation job tracking
- `videos` - Generated video metadata
- `folders` - Video organization
- `characters` - Character definitions with reference images
- `asset_lists` - Carl v7 imports
- `generated_images` - Image generation records
- `generation_history` - Regeneration tracking
- `motion_graphics_videos` - MG video records
- `generated_audio` - TTS audio records

## Step 3: Create Storage Buckets

1. Go to **Storage** in your Supabase dashboard
2. Create the following buckets by clicking **New bucket**:

| Bucket Name | Public | Description |
|-------------|--------|-------------|
| `videos` | ✅ Yes | Generated videos (.mp4) |
| `images` | ✅ Yes | Generated images (.png, .jpg) |
| `anchors` | ✅ Yes | Character reference images |
| `mg-videos` | ✅ Yes | Motion graphics videos |
| `audio` | ✅ Yes | Generated TTS audio (.mp3) |
| `uploads` | ❌ No | Temporary uploads |
| `defaults` | ✅ Yes | Template images |

### Making Buckets Public

For each public bucket:
1. Click on the bucket name
2. Go to **Policies** tab
3. Click **New Policy** → **For full customization**
4. Create an "allow all reads" policy:

```sql
CREATE POLICY "Allow public read access"
ON storage.objects FOR SELECT
USING (bucket_id = 'YOUR_BUCKET_NAME');
```

Or use the quick policy creator:
- Policy name: `Allow public access`
- Allowed operations: `SELECT`
- Target roles: `public`

## Step 4: Upload Default Images (Optional)

If you have default images (cleanup.png, lab_safety.png), upload them:
1. Go to **Storage** → `defaults` bucket
2. Click **Upload files**
3. Upload your default images

## Step 5: Install Dependencies & Test

```bash
# Install new dependencies
cd /Users/moriahplacer/Desktop/mo.vault.2/nola.vids
npm install

# Test the server
npm run server
```

## Step 6: Deploy to Render

1. Add environment variables in Render dashboard:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`

2. Trigger a new deploy

## Troubleshooting

### "Missing Supabase configuration" error
Make sure both `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set in your `.env` file.

### "Failed to connect to Supabase" error
1. Verify your project URL is correct
2. Verify you're using the **service_role** key (not anon key)
3. Check that the tables were created in SQL Editor

### "Bucket not found" error
Create the missing bucket in Storage dashboard. Make sure the bucket name matches exactly.

### Images/Videos not loading
Check that the buckets are set to public and have the correct read policy.

## Data Migration (Optional)

If you have existing data in the local SQLite database, you'll need to:
1. Export data from SQLite before the migration
2. Import into Supabase using SQL INSERT statements or the dashboard

The old SQLite database was at: `server/storage/nola.db`
