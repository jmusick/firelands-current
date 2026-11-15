import { fileURLToPath } from 'node:url';
import { join, resolve, sep } from 'node:path';

const library = resolve(process.env.FIRELANDS_PROJECT_DIR || fileURLToPath(new URL('../../../Projects/firelands-current/', import.meta.url)));

export const repositoryDirectory = fileURLToPath(new URL('../', import.meta.url));
export const campaignDirectory = date => join(library, 'ad-creatives', date) + sep;
export const editorialDirectory = date => join(library, 'editorial', date) + sep;
export const imagePublicationDirectory = date => join(library, 'image-research', date, 'publication') + sep;
export const outreachDirectory = () => join(library, 'outreach') + sep;
