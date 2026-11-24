import { db, BUCKET, getRole, json } from '../../../lib/server';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (getRole(req) !== 'chauffeur') return json({ error: 'Nicht erlaubt' }, 403);
  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return json({ error: 'Keine Datei' }, 400);
  const name = `${Date.now()}-${crypto.randomUUID()}.jpg`;
  const sb = db();
  const { error } = await sb.storage.from(BUCKET).upload(name, file, { contentType: 'image/jpeg' });
  if (error) return json({ error: error.message }, 500);
  const { data } = sb.storage.from(BUCKET).getPublicUrl(name);
  return json({ url: data.publicUrl });
}
