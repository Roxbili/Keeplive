import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';

// macOS exposes /var through /private/var. Keep generated fixtures canonical,
// just as the real source API does, without weakening root-replacement checks.
if(process.platform==='darwin')process.env.TMPDIR=realpathSync(tmpdir());
