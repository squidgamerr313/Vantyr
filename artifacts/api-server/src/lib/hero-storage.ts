import { Storage } from '@google-cloud/storage';

// Replit App Storage sidecar configuration, as provided by the storage template.
const REPLIT_SIDECAR_ENDPOINT = 'http://127.0.0.1:1106';
export const heroStorageClient = new Storage({
  credentials: {
    audience: 'replit',
    subject_token_type: 'access_token',
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: 'external_account',
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: 'json', subject_token_field_name: 'access_token' },
    },
    universe_domain: 'googleapis.com',
  },
  projectId: '',
});

export function heroStorageLocation(asset: string) {
  const root = (process.env.PUBLIC_OBJECT_SEARCH_PATHS ?? '').split(',')[0]?.trim();
  if (!root?.startsWith('/')) throw new Error('Public App Storage is not configured');
  const [bucket, ...prefix] = root.slice(1).split('/');
  return { bucket: bucket!, name: [...prefix, 'hero-engine', asset].join('/') };
}
